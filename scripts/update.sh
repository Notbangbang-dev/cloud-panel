#!/usr/bin/env bash
#
# Cloud Panel — one-command self-update.
# Pulls the latest code, keeps your .env / database / backups, reinstalls
# dependencies and restarts the service. No need to re-run the installer.
#
#   sudo cloud-panel-update           (after the first update/install)
#   sudo bash scripts/update.sh       (always works)
#
set -euo pipefail

APP_DIR="${CP_APP_DIR:-/opt/cloud-panel}"
SERVICE="${CP_SERVICE:-cloud-panel}"
RUN_USER="${CP_USER:-cloudpanel}"
DEFAULT_REPO="https://github.com/Notbangbang-dev/cloud-panel.git"

c_b='\033[1;36m'; c_g='\033[1;32m'; c_y='\033[1;33m'; c_r='\033[1;31m'; c_0='\033[0m'
say()  { echo -e "${c_b}::${c_0} $*"; }
ok()   { echo -e "${c_g}✓${c_0} $*"; }
warn() { echo -e "${c_y}!${c_0} $*"; }
die()  { echo -e "${c_r}✗ $*${c_0}" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root:  sudo cloud-panel-update   (or: sudo bash $APP_DIR/scripts/update.sh)"
[ -d "$APP_DIR" ] || die "Cloud Panel is not installed at $APP_DIR (set CP_APP_DIR to override)."

ensure_link() {
  mkdir -p /usr/local/bin
  cat > /usr/local/bin/cloud-panel-update <<EOF
#!/usr/bin/env bash
exec bash "$APP_DIR/scripts/update.sh" "\$@"
EOF
  chmod 755 /usr/local/bin/cloud-panel-update
}
resolve_repo() {
  if [ -n "${CP_REPO_URL:-}" ]; then echo "$CP_REPO_URL"; return; fi
  if [ -s "$APP_DIR/.repo-url" ]; then cat "$APP_DIR/.repo-url"; return; fi
  echo "$DEFAULT_REPO"
}

# ---- Stage 2: deploy from a freshly-downloaded copy (runs OUTSIDE $APP_DIR
#      so we never overwrite this script while it's executing) ----
if [ "${CP_UPD_STAGE:-1}" = "2" ]; then
  SRC="${CP_UPD_SRC:?missing source}"
  command -v rsync >/dev/null 2>&1 || die "rsync is required (apt-get install -y rsync)"
  say "Syncing new files into ${APP_DIR} …"
  rsync -a --delete \
    --exclude .git --exclude node_modules --exclude data \
    --exclude '.env' --exclude '.repo-url' --exclude '.jwt-secret' \
    "$SRC"/ "$APP_DIR"/
  chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR"
  say "Installing dependencies …"
  sudo -u "$RUN_USER" bash -lc "cd '$APP_DIR' && npm install --omit=dev --no-fund --no-audit"
  ensure_link
  systemctl restart "$SERVICE"
  rm -rf "$(dirname "$SRC")" 2>/dev/null || true
  echo
  ok "Cloud Panel updated and restarted."
  systemctl --no-pager --lines=0 status "$SERVICE" || true
  exit 0
fi

# ---- Stage 1 ----
echo
say "Updating Cloud Panel at ${APP_DIR}"

# In-place git checkout? Just pull.
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$RUN_USER" git -C "$APP_DIR" pull --ff-only
  sudo -u "$RUN_USER" bash -lc "cd '$APP_DIR' && npm install --omit=dev --no-fund --no-audit"
  ensure_link
  systemctl restart "$SERVICE"
  ok "Cloud Panel updated and restarted."
  systemctl --no-pager --lines=0 status "$SERVICE" || true
  exit 0
fi

command -v git >/dev/null 2>&1 || die "git is required to update (apt-get install -y git)"
REPO="$(resolve_repo)"
say "Fetching latest from ${REPO} …"
TMP="$(mktemp -d)"
git clone --depth 1 "$REPO" "$TMP/src" >/dev/null 2>&1 || die "Could not clone ${REPO}"
# Hand off to the fresh updater so a changed update.sh can't break mid-run.
exec env CP_UPD_STAGE=2 CP_UPD_SRC="$TMP/src" CP_APP_DIR="$APP_DIR" CP_SERVICE="$SERVICE" CP_USER="$RUN_USER" \
  bash "$TMP/src/scripts/update.sh"
