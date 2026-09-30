#!/usr/bin/env bash
# Remove the AbleView macOS LaunchAgent.

set -euo pipefail

LABEL="com.ableview.server"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--label com.ableview.server]"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"

if [[ -f "$PLIST" ]]; then
  echo "Unloading LaunchAgent: $LABEL"
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "LaunchAgent removed."
else
  echo "Plist not found: $PLIST (already removed?)"
fi

echo "Config, .env, and logs were not deleted."
