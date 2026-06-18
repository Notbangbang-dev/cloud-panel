#!/usr/bin/env bash
# Cloud Panel — uninstall.  Pass --purge to also delete app dir + data.
set -euo pipefail

APP_DIR="${CP_APP_DIR:-/opt/cloud-panel}"
SERVICE="${CP_SERVICE:-cloud-panel}"
RUN_USER="${CP_USER:-cloudpanel}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo bash scripts/uninstall.sh)"; exit 1; }

echo ":: Stopping and disabling ${SERVICE}…"
systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
rm -f "/etc/systemd/system/${SERVICE}.service"
systemctl daemon-reload

if [ "${1:-}" = "--purge" ]; then
  echo ":: Purging ${APP_DIR} (including data)…"
  rm -rf "$APP_DIR" "$APP_DIR.src"
  userdel "$RUN_USER" >/dev/null 2>&1 || true
  echo "✓ Cloud Panel fully removed."
else
  echo "✓ Service removed. App files and data kept at ${APP_DIR}."
  echo "  Run with --purge to delete everything."
fi
