#!/usr/bin/env bash
# Cloud Panel — update & restart
set -euo pipefail

APP_DIR="${CP_APP_DIR:-/opt/cloud-panel}"
SERVICE="${CP_SERVICE:-cloud-panel}"
RUN_USER="${CP_USER:-cloudpanel}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo bash scripts/update.sh)"; exit 1; }
[ -d "$APP_DIR" ] || { echo "Not installed at $APP_DIR"; exit 1; }

echo ":: Updating Cloud Panel in $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$RUN_USER" bash -lc "cd '$APP_DIR' && git pull --ff-only"
else
  echo "!  No git checkout in $APP_DIR — re-run install.sh from a fresh copy to update files."
fi

sudo -u "$RUN_USER" bash -lc "cd '$APP_DIR' && npm install --omit=dev --no-fund --no-audit"
systemctl restart "$SERVICE"
echo "✓ Updated and restarted."
systemctl --no-pager --lines=0 status "$SERVICE" || true
