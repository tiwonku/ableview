#!/usr/bin/env bash
# Install AbleView as a macOS LaunchAgent (user session, boot/login start, crash restart).
#
# Usage:
#   ./deploy/install-macos.sh [--install-dir ~/AbleView] [--label com.ableview.server] [--skip-smoke-test]
#
# Prerequisites: Node.js >= 20, .env, config/config.json, sim.enabled false.

set -euo pipefail

INSTALL_DIR="${HOME}/AbleView"
LABEL="com.ableview.server"
SKIP_SMOKE_TEST=0

usage() {
  sed -n '2,6p' "$0"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --skip-smoke-test) SKIP_SMOKE_TEST=1; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

INSTALL_DIR="$(cd "$INSTALL_DIR" 2>/dev/null && pwd)" || { echo "Install directory not found: $INSTALL_DIR" >&2; exit 1; }

step() { printf '==> %s\n' "$1"; }

dotenv_get() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 1
  grep -E "^[[:space:]]*${key}=" "$file" | tail -n1 | sed -E "s/^[[:space:]]*${key}=//" | sed -E 's/^["'\''']|["'\''']$//g'
}

resolve_path() {
  local base="$1" rel="$2"
  if [[ "$rel" = /* ]]; then
    echo "$rel"
  else
    echo "${base}/${rel}"
  fi
}

lan_ip() {
  ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost"
}

step "AbleView macOS LaunchAgent install"
step "Install directory: $INSTALL_DIR"

NODE_PATH="$(command -v node || true)"
if [[ -z "$NODE_PATH" ]]; then
  echo "node not found on PATH. Install Node.js >= 20." >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_PATH" -v | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "Node.js >= 20 required (found $($NODE_PATH -v))." >&2
  exit 1
fi
step "Node: $NODE_PATH ($("$NODE_PATH" -v))"

ENV_FILE="${INSTALL_DIR}/.env"
CONFIG_FILE="${INSTALL_DIR}/config/config.json"
[[ -f "$ENV_FILE" ]] || { echo "Missing .env — copy .env.example to .env and configure." >&2; exit 1; }
[[ -f "$CONFIG_FILE" ]] || { echo "Missing config/config.json." >&2; exit 1; }

if ! node -e "
  const fs = require('fs');
  const c = JSON.parse(fs.readFileSync('${CONFIG_FILE}', 'utf8'));
  if (c.sim?.enabled === true) process.exit(1);
"; then
  echo "sim.enabled is true — set to false for show production." >&2
  exit 1
fi

SHEET_ID="$(dotenv_get "$ENV_FILE" SHEET_ID || true)"
KEY_PATH="$(dotenv_get "$ENV_FILE" GOOGLE_SERVICE_ACCOUNT_KEY_PATH || true)"
HTTP_PORT="$(dotenv_get "$ENV_FILE" HTTP_PORT || true)"
HTTP_PORT="${HTTP_PORT:-8080}"

[[ -n "$SHEET_ID" ]] || { echo "SHEET_ID is not set in .env" >&2; exit 1; }
[[ -n "$KEY_PATH" ]] || { echo "GOOGLE_SERVICE_ACCOUNT_KEY_PATH is not set in .env" >&2; exit 1; }

KEY_FULL="$(resolve_path "$INSTALL_DIR" "$KEY_PATH")"
[[ -f "$KEY_FULL" ]] || { echo "Service account key not found: $KEY_FULL" >&2; exit 1; }

step "Preflight OK"

cd "$INSTALL_DIR"
step "Running npm install --omit=dev"
npm install --omit=dev

mkdir -p "${INSTALL_DIR}/logs"
WRAPPER="${INSTALL_DIR}/deploy/run-production.mjs"
[[ -f "$WRAPPER" ]] || { echo "Missing deploy/run-production.mjs" >&2; exit 1; }

SMOKE_PID=""
cleanup_smoke() {
  if [[ -n "$SMOKE_PID" ]] && kill -0 "$SMOKE_PID" 2>/dev/null; then
    kill "$SMOKE_PID" 2>/dev/null || true
    wait "$SMOKE_PID" 2>/dev/null || true
  fi
}
trap cleanup_smoke EXIT

if [[ "$SKIP_SMOKE_TEST" -eq 0 ]]; then
  step "Smoke test: starting AbleView briefly and checking /health"
  "$NODE_PATH" "$WRAPPER" &
  SMOKE_PID=$!

  healthy=0
  for _ in $(seq 1 22); do
    sleep 2
    if curl -sf "http://127.0.0.1:${HTTP_PORT}/health" >/dev/null 2>&1; then
      status="$(curl -sf "http://127.0.0.1:${HTTP_PORT}/health" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).status||'')}catch{}})")"
      echo "Smoke test: /health returned status=${status:-unknown}"
      healthy=1
      break
    fi
    if ! kill -0 "$SMOKE_PID" 2>/dev/null; then
      echo "Smoke test: process exited before /health responded" >&2
      exit 1
    fi
  done

  cleanup_smoke
  SMOKE_PID=""
  trap - EXIT

  if [[ "$healthy" -ne 1 ]]; then
    echo "Smoke test timed out — fix errors with 'npm run start:production' before installing LaunchAgent" >&2
    exit 1
  fi
fi

PLIST_SRC="${INSTALL_DIR}/deploy/ableview.plist.example"
PLIST_DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
[[ -f "$PLIST_SRC" ]] || { echo "Missing deploy/ableview.plist.example" >&2; exit 1; }

step "Installing LaunchAgent plist"
mkdir -p "${HOME}/Library/LaunchAgents"
sed -e "s|{INSTALL_DIR}|${INSTALL_DIR}|g" \
    -e "s|{NODE_PATH}|${NODE_PATH}|g" \
    "$PLIST_SRC" > "$PLIST_DEST"

UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"

# Unload if already loaded
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || launchctl unload "$PLIST_DEST" 2>/dev/null || true

if launchctl bootstrap "$DOMAIN" "$PLIST_DEST" 2>/dev/null; then
  :
elif launchctl load "$PLIST_DEST"; then
  :
else
  echo "Failed to load LaunchAgent" >&2
  exit 1
fi

sleep 2
if curl -sf "http://127.0.0.1:${HTTP_PORT}/health" >/dev/null 2>&1; then
  echo "LaunchAgent health check OK"
else
  echo "LaunchAgent loaded but /health not yet reachable — check ${INSTALL_DIR}/logs/launchd.log"
fi

IP="$(lan_ip)"
echo ""
echo "AbleView LaunchAgent installed successfully."
echo "Log out and back in (or reboot) to verify auto-start."
echo ""
echo "Operator URLs (fill in deploy/RUNBOOK.md):"
echo "  Band:     http://${IP}:${HTTP_PORT}/views/band"
echo "  Visuals:  http://${IP}:${HTTP_PORT}/views/visuals"
echo "  Lighting: http://${IP}:${HTTP_PORT}/views/lighting"
echo "  Admin:    http://${IP}:${HTTP_PORT}/views/admin"
echo "  Health:   http://${IP}:${HTTP_PORT}/health"
echo ""
echo "Logs: ${INSTALL_DIR}/logs/launchd.log"
echo "Status: launchctl print ${DOMAIN}/${LABEL}"
echo "Runbook: ${INSTALL_DIR}/deploy/RUNBOOK.md"
echo "Uninstall: ./deploy/uninstall-macos.sh --install-dir ${INSTALL_DIR}"
