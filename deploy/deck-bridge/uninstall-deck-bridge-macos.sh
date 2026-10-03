#!/usr/bin/env bash
# Remove the AbleView deck-bridge LaunchAgent and its install folder.
#
# The installed copy lives at ~/AbleView-deck-bridge/uninstall.sh and works
# after the source folder is gone. From a checkout:
#
#   ./deploy/deck-bridge/uninstall-deck-bridge-macos.sh
#   ./deploy/deck-bridge/uninstall-deck-bridge-macos.sh \
#     --install-dir ~/AbleView-deck-bridge-tt \
#     --source-id tt-samples
#
# Does not delete the ableview source folder, Xcode Command Line Tools, or
# the Accessibility / Local Network switches. Those last two are printed
# at the end — macOS will not drop them from a script.

set -euo pipefail

INSTALL_DIR=""
SOURCE_ID=""

usage() {
  sed -n '2,14p' "$0"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --source-id) SOURCE_ID="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

step() { printf '==> %s\n' "$1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -z "$INSTALL_DIR" ]]; then
  if [[ -f "${SCRIPT_DIR}/.deck-bridge-install" || -x "${SCRIPT_DIR}/bin/DeckBridge" ]]; then
    INSTALL_DIR="$SCRIPT_DIR"
  else
    INSTALL_DIR="${HOME}/AbleView-deck-bridge"
  fi
fi
if [[ "$INSTALL_DIR" != /* ]]; then
  INSTALL_DIR="$(cd "$(dirname "$INSTALL_DIR")" && pwd)/$(basename "$INSTALL_DIR")"
fi

if [[ -z "$SOURCE_ID" && -f "${INSTALL_DIR}/.deck-bridge-install" ]]; then
  SOURCE_ID="$(
    grep '^sourceId=' "${INSTALL_DIR}/.deck-bridge-install" 2>/dev/null | head -n 1 | cut -d= -f2- || true
  )"
fi
if [[ -z "$SOURCE_ID" && -f "${INSTALL_DIR}/config/config.json" ]]; then
  SOURCE_ID="$(
    /usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("sourceId",""))' \
      "${INSTALL_DIR}/config/config.json" 2>/dev/null || true
  )"
fi
SOURCE_ID="${SOURCE_ID:-tt-samples}"

if [[ ! "$SOURCE_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Refusing sourceId ${SOURCE_ID} (expected letters, numbers, dot, underscore, or hyphen)." >&2
  exit 1
fi

LABEL="com.ableview.deck-bridge.${SOURCE_ID}"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"

step "Removing deck-bridge ${LABEL}"

if [[ -f "$PLIST" ]] || launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1; then
  step "Stopping login item"
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  launchctl disable "${DOMAIN}/${LABEL}" 2>/dev/null || true
fi

if [[ -f "$PLIST" ]]; then
  rm -f "$PLIST"
  echo "Removed ${PLIST}"
else
  echo "No plist at ${PLIST} (already removed, or a different sourceId)."
fi

safe_to_delete() {
  local dir="$1"
  [[ -n "$dir" && "$dir" != "/" && "$dir" != "$HOME" ]] || return 1
  [[ "$dir" == "$HOME/"* ]] || return 1
  [[ -f "${dir}/.deck-bridge-install" || -x "${dir}/bin/DeckBridge" ]] || return 1
  return 0
}

echo ""
echo "macOS will not clear these from a script. Remove them by hand:"
echo "  1. System Settings → Privacy & Security → Accessibility"
echo "     Select DeckBridge and click the minus button."
echo "  2. System Settings → Privacy & Security → Local Network"
echo "     Turn DeckBridge off if it is listed."
echo ""
echo "This does not delete the ableview source folder, if you still have one."
echo "This does not uninstall Xcode Command Line Tools."
echo "deploy/uninstall-macos.sh removes the show-box agent (com.ableview.server), not this helper."
echo ""

if [[ -d "$INSTALL_DIR" ]]; then
  if safe_to_delete "$INSTALL_DIR"; then
    step "Deleting ${INSTALL_DIR}"
    # One line so this still finishes if the script itself is inside that folder.
    rm -rf "$INSTALL_DIR" && echo "Deleted ${INSTALL_DIR}"
  else
    echo "Left ${INSTALL_DIR} in place. It does not look like a deck-bridge install." >&2
    echo "Delete that folder yourself only if you are sure it is the helper." >&2
  fi
else
  echo "Install folder not found: ${INSTALL_DIR}"
fi
