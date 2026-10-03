#!/usr/bin/env bash
# Install AbleView deck-bridge as a macOS LaunchAgent on a performer Mac (Djay Pro).
#
# Usage (from repo root or with --repo-dir):
#   ./deploy/deck-bridge/install-deck-bridge-macos.sh \
#     [--repo-dir .] \
#     [--install-dir ~/AbleView-deck-bridge] \
#     [--config deploy/deck-bridge/config.example.json] \
#     [--source-id tt-samples]
#
# Other Mac (D), or a second bridge on one dev Mac:
#   ./deploy/deck-bridge/install-deck-bridge-macos.sh \
#     --install-dir ~/AbleView-deck-bridge-d \
#     --config deploy/deck-bridge/config.djay-d.example.json
#
# Dave's steps: deploy/deck-bridge/README.md
# Remove later: ~/AbleView-deck-bridge/uninstall.sh
#   or ./deploy/deck-bridge/uninstall-deck-bridge-macos.sh --install-dir <same dir>

set -euo pipefail

REPO_DIR=""
INSTALL_DIR="${HOME}/AbleView-deck-bridge"
CONFIG_SRC=""
SOURCE_ID=""
SOURCE_ID_FROM_FLAG=0
SKIP_BUILD=0

usage() {
  sed -n '2,18p' "$0"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir) REPO_DIR="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --config) CONFIG_SRC="$2"; shift 2 ;;
    --source-id) SOURCE_ID="$2"; SOURCE_ID_FROM_FLAG=1; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

step() { printf '==> %s\n' "$1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -z "$REPO_DIR" ]]; then
  REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
  REPO_DIR="$(cd "$REPO_DIR" && pwd)"
fi

BRIDGE_DIR="${REPO_DIR}/bridge/deck-bridge"
[[ -f "${BRIDGE_DIR}/Package.swift" ]] || {
  echo "Missing bridge package at ${BRIDGE_DIR}" >&2
  exit 1
}

if [[ -z "$CONFIG_SRC" ]]; then
  CONFIG_SRC="${SCRIPT_DIR}/config.example.json"
fi
if [[ "$CONFIG_SRC" != /* ]]; then
  CONFIG_SRC="${REPO_DIR}/${CONFIG_SRC}"
fi
[[ -f "$CONFIG_SRC" ]] || {
  echo "Config not found: ${CONFIG_SRC}" >&2
  exit 1
}

if [[ -z "$SOURCE_ID" ]]; then
  SOURCE_ID="$(
    /usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("sourceId",""))' "$CONFIG_SRC" 2>/dev/null \
      || node -e "const c=require('fs').readFileSync(process.argv[1],'utf8'); console.log(JSON.parse(c).sourceId||'')" "$CONFIG_SRC" 2>/dev/null \
      || true
  )"
fi
SOURCE_ID="${SOURCE_ID:-tt-samples}"
LABEL="com.ableview.deck-bridge.${SOURCE_ID}"

step "AbleView deck-bridge LaunchAgent install"
step "Repo: ${REPO_DIR}"
step "Install dir: ${INSTALL_DIR}"
step "sourceId / label: ${SOURCE_ID} / ${LABEL}"

if ! command -v swift >/dev/null 2>&1; then
  echo "swift not found. Install Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi

mkdir -p "${INSTALL_DIR}/bin" "${INSTALL_DIR}/logs" "${INSTALL_DIR}/config"

CONFIG_DEST="${INSTALL_DIR}/config/config.json"
CONFIG_FRESH=0
if [[ -f "$CONFIG_DEST" ]]; then
  step "Keeping existing config: ${CONFIG_DEST}"
else
  step "Installing config from ${CONFIG_SRC}"
  cp "$CONFIG_SRC" "$CONFIG_DEST"
  CONFIG_FRESH=1
fi

if [[ "$SOURCE_ID_FROM_FLAG" -eq 1 && "$CONFIG_FRESH" -eq 1 ]]; then
  /usr/bin/python3 - "$CONFIG_DEST" "$SOURCE_ID" <<'PY'
import json, sys
path, source_id = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as fh:
    cfg = json.load(fh)
cfg["sourceId"] = source_id
with open(path, "w", encoding="utf-8") as fh:
    json.dump(cfg, fh, indent=2)
    fh.write("\n")
PY
fi

if [[ "$SOURCE_ID_FROM_FLAG" -eq 1 && "$CONFIG_FRESH" -eq 0 ]]; then
  EXISTING_ID="$(
    /usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("sourceId",""))' "$CONFIG_DEST" 2>/dev/null \
      || true
  )"
  if [[ -n "$EXISTING_ID" && "$EXISTING_ID" != "$SOURCE_ID" ]]; then
    echo "Warning: ${CONFIG_DEST} sourceId is ${EXISTING_ID}; LaunchAgent label uses ${SOURCE_ID}." >&2
    echo "Use a separate --install-dir per source so each bridge keeps its own config." >&2
  fi
fi

BINARY_PATH="${INSTALL_DIR}/bin/DeckBridge"
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  step "Building release DeckBridge"
  (
    cd "$BRIDGE_DIR"
    swift build -c release --product DeckBridge
  )
  BUILT="${BRIDGE_DIR}/.build/release/DeckBridge"
  [[ -x "$BUILT" ]] || {
    echo "Build did not produce ${BUILT}" >&2
    exit 1
  }
  cp "$BUILT" "$BINARY_PATH"
  chmod +x "$BINARY_PATH"
else
  [[ -x "$BINARY_PATH" ]] || {
    echo "Missing binary ${BINARY_PATH} (omit --skip-build to compile)" >&2
    exit 1
  }
fi

PLIST_SRC="${SCRIPT_DIR}/com.ableview.deck-bridge.plist.example"
PLIST_DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
[[ -f "$PLIST_SRC" ]] || {
  echo "Missing ${PLIST_SRC}" >&2
  exit 1
}

step "Installing uninstall script"
cp "${SCRIPT_DIR}/uninstall-deck-bridge-macos.sh" "${INSTALL_DIR}/uninstall.sh"
chmod +x "${INSTALL_DIR}/uninstall.sh"
cat > "${INSTALL_DIR}/.deck-bridge-install" <<EOF
sourceId=${SOURCE_ID}
label=${LABEL}
EOF

step "Installing LaunchAgent ${LABEL}"
mkdir -p "${HOME}/Library/LaunchAgents"
sed -e "s|{LABEL}|${LABEL}|g" \
    -e "s|{BINARY_PATH}|${BINARY_PATH}|g" \
    -e "s|{CONFIG_PATH}|${CONFIG_DEST}|g" \
    -e "s|{INSTALL_DIR}|${INSTALL_DIR}|g" \
    "$PLIST_SRC" > "$PLIST_DEST"

UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"

launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || launchctl unload "$PLIST_DEST" 2>/dev/null || true
# A previous uninstall disables the label. Re-enable or bootstrap will refuse to load it.
launchctl enable "${DOMAIN}/${LABEL}" 2>/dev/null || true

if launchctl bootstrap "$DOMAIN" "$PLIST_DEST" 2>/dev/null; then
  :
elif launchctl load "$PLIST_DEST"; then
  :
else
  echo "Failed to load LaunchAgent" >&2
  exit 1
fi

TARGET_PORT="$(
  /usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("targetPort",9102))' "$CONFIG_DEST" 2>/dev/null \
    || echo 9102
)"
TARGET_HOST="$(
  /usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("targetHost","127.0.0.1"))' "$CONFIG_DEST" 2>/dev/null \
    || echo "show-box-ip"
)"

echo ""
echo "deck-bridge LaunchAgent installed."
echo ""
echo "REQUIRED — grant Accessibility (one-time):"
echo "  1. Open System Settings → Privacy & Security → Accessibility"
echo "  2. Click + and add:  ${BINARY_PATH}"
echo "     (or enable it if it already appears after first launch)"
echo "  3. Toggle ON. After rebuilds, toggle OFF then ON if reports stop."
echo "  4. Open djay Pro (jog / deck view; keep timers visible for elapsed time)."
echo ""
echo "Verify UDP on the show box (listening for ${SOURCE_ID}):"
echo "  nc -u -l ${TARGET_PORT}"
echo "  (bridge sends to ${TARGET_HOST}:${TARGET_PORT} — edit config if needed)"
echo ""
echo "Edit targetHost/targetPort/sourceId:  ${CONFIG_DEST}"
echo "  then: launchctl kickstart -k ${DOMAIN}/${LABEL}"
echo ""
echo "Logs:   ${INSTALL_DIR}/logs/deck-bridge.log"
echo "Status: launchctl print ${DOMAIN}/${LABEL}"
echo ""
echo "Remove completely (login item, program, config, logs):"
echo "  ${INSTALL_DIR}/uninstall.sh"
echo "Then delete DeckBridge under Privacy & Security → Accessibility (and Local Network if listed)."
echo ""
echo "Full docs: ${REPO_DIR}/deploy/deck-bridge/README.md"
