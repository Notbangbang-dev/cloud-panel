#!/usr/bin/env bash
#
# Cloud Panel — one-command VPS installer (Debian / Ubuntu)
#
# Usage (from inside the cloned/uploaded project directory):
#     sudo bash scripts/install.sh
#
# Or clone + install in one go:
#     sudo CP_REPO_URL=https://github.com/you/cloud-panel.git bash scripts/install.sh
#
# Environment overrides:
#     CP_WEB_PORT (8080)  CP_SFTP_PORT (5657)  CP_SKIP_JAVA (0)
#     CP_APP_DIR (/opt/cloud-panel)  CP_SERVICE (cloud-panel)  CP_USER (cloudpanel)
#
set -euo pipefail

APP_DIR="${CP_APP_DIR:-/opt/cloud-panel}"
SERVICE="${CP_SERVICE:-cloud-panel}"
RUN_USER="${CP_USER:-cloudpanel}"
WEB_PORT="${CP_WEB_PORT:-8080}"
SFTP_PORT="${CP_SFTP_PORT:-5657}"
ALLOC_START="${CP_ALLOC_START:-25565}"
ALLOC_END="${CP_ALLOC_END:-25600}"
NODE_MAJOR="${CP_NODE_MAJOR:-20}"

c_blue='\033[1;36m'; c_grn='\033[1;32m'; c_ylw='\033[1;33m'; c_red='\033[1;31m'; c_off='\033[0m'
say()  { echo -e "${c_blue}::${c_off} $*"; }
ok()   { echo -e "${c_grn}✓${c_off} $*"; }
warn() { echo -e "${c_ylw}!${c_off} $*"; }
die()  { echo -e "${c_red}✗ $*${c_off}" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run as root (sudo bash scripts/install.sh)"
command -v apt-get >/dev/null 2>&1 || die "This installer targets Debian/Ubuntu (apt-get not found)."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"

echo
echo "  ┌────────────────────────────────────────────┐"
echo "  │   Cloud Panel — VPS Installer                │"
echo "  │   Web :${WEB_PORT}   SFTP :${SFTP_PORT}  (PufferPanel ports)  │"
echo "  └────────────────────────────────────────────┘"
echo

# ---- 1. Base packages ----------------------------------------------------
say "Installing base packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -q
apt-get install -y -q curl ca-certificates gnupg git build-essential python3 rsync ufw openssl >/dev/null
ok "Base packages ready."

# ---- 2. Node.js ----------------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  cur="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$cur" -ge 18 ] 2>/dev/null && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  say "Installing Node.js ${NODE_MAJOR}.x (NodeSource)…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -q nodejs >/dev/null
fi
ok "Node $(node -v) / npm $(npm -v)"

# ---- 3. Java (for Minecraft eggs) ---------------------------------------
if [ "${CP_SKIP_JAVA:-0}" != "1" ]; then
  if ! command -v java >/dev/null 2>&1; then
    say "Installing Java (Temurin 21) for Minecraft servers…"
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://packages.adoptium.net/artifactory/api/gpg/key/public \
      | gpg --dearmor -o /etc/apt/keyrings/adoptium.gpg 2>/dev/null || true
    . /etc/os-release
    echo "deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb ${VERSION_CODENAME} main" \
      > /etc/apt/sources.list.d/adoptium.list
    apt-get update -y -q >/dev/null 2>&1 || true
    if ! apt-get install -y -q temurin-21-jre >/dev/null 2>&1; then
      warn "Temurin unavailable; installing distro default-jre instead."
      apt-get install -y -q default-jre >/dev/null 2>&1 || warn "Could not install Java automatically."
    fi
  fi
  command -v java >/dev/null 2>&1 && ok "Java $(java -version 2>&1 | head -n1)"
else
  warn "Skipping Java install (CP_SKIP_JAVA=1). Minecraft eggs will need Java later."
fi

# ---- 4. Service user -----------------------------------------------------
if ! id "$RUN_USER" >/dev/null 2>&1; then
  say "Creating service user '${RUN_USER}'…"
  useradd --system --create-home --shell /usr/sbin/nologin "$RUN_USER"
fi
ok "Service user '${RUN_USER}' ready."

# ---- 5. Application files -------------------------------------------------
if [ ! -f "$SOURCE_DIR/package.json" ]; then
  if [ -n "${CP_REPO_URL:-}" ]; then
    say "Cloning ${CP_REPO_URL}…"
    rm -rf "$APP_DIR.src"; git clone --depth 1 "$CP_REPO_URL" "$APP_DIR.src" >/dev/null
    SOURCE_DIR="$APP_DIR.src"
  else
    die "No package.json found. Run from the project directory, or set CP_REPO_URL."
  fi
fi

say "Installing application to ${APP_DIR}…"
mkdir -p "$APP_DIR"
if [ "$(readlink -f "$SOURCE_DIR")" != "$(readlink -f "$APP_DIR")" ]; then
  rsync -a --delete \
    --exclude node_modules --exclude .git --exclude data --exclude '.env' \
    "$SOURCE_DIR"/ "$APP_DIR"/
fi
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR"
ok "Files installed."

say "Installing npm dependencies (this compiles better-sqlite3)…"
sudo -u "$RUN_USER" bash -lc "cd '$APP_DIR' && npm install --omit=dev --no-fund --no-audit"
ok "Dependencies installed."

# ---- 6. Environment ------------------------------------------------------
PUBLIC_IP="$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
PUBLIC_IP="${PUBLIC_IP:-127.0.0.1}"
# Domain or IP people will use to reach the panel (env override or prompt).
PUBLIC_HOST="${CP_PUBLIC_HOST:-}"
if [ -z "$PUBLIC_HOST" ] && [ -t 0 ]; then
  read -rp "  Domain or IP to reach the panel [${PUBLIC_IP}]: " _h
  PUBLIC_HOST="${_h:-$PUBLIC_IP}"
fi
PUBLIC_HOST="${PUBLIC_HOST:-$PUBLIC_IP}"
if [ ! -f "$APP_DIR/.env" ]; then
  say "Generating .env (random JWT secret, public host ${PUBLIC_HOST})…"
  SECRET="$(openssl rand -hex 32)"
  cat > "$APP_DIR/.env" <<EOF
CP_WEB_PORT=${WEB_PORT}
CP_SFTP_PORT=${SFTP_PORT}
CP_HOST=0.0.0.0
CP_PUBLIC_HOST=${PUBLIC_HOST}
CP_TRUST_PROXY=1
CP_JWT_SECRET=${SECRET}
CP_JWT_TTL=7d
CP_ALLOC_START=${ALLOC_START}
CP_ALLOC_END=${ALLOC_END}
EOF
  chown "$RUN_USER":"$RUN_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
else
  warn ".env already exists — keeping it."
fi

# ---- 6b. Administrator account -------------------------------------------
ADMIN_USER="${CP_ADMIN_USERNAME:-}"
ADMIN_EMAIL="${CP_ADMIN_EMAIL:-}"
ADMIN_PASS="${CP_ADMIN_PASSWORD:-}"
ADMIN_CREATED=0
GENERATED_PASS=0

NEEDS="$(cd "$APP_DIR" && sudo -u "$RUN_USER" node -e 'const d=require("./src/db");d.load();console.log(d.needsSetup()?1:0)' 2>/dev/null || echo 1)"
if [ "$NEEDS" = "0" ]; then
  warn "An account already exists — skipping admin creation."
else
  say "Creating your administrator account…"
  if [ -t 0 ] && [ -z "$ADMIN_PASS" ]; then
    read -rp "  Admin username [admin]: " _u; ADMIN_USER="${_u:-admin}"
    read -rp "  Admin email [admin@example.com]: " _e; ADMIN_EMAIL="${_e:-admin@example.com}"
    read -rsp "  Admin password (leave blank to auto-generate): " ADMIN_PASS; echo
  fi
  ADMIN_USER="${ADMIN_USER:-admin}"
  ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
  if [ -z "$ADMIN_PASS" ]; then ADMIN_PASS="$(openssl rand -hex 10)"; GENERATED_PASS=1; fi
  if sudo -u "$RUN_USER" env CP_ADMIN_USERNAME="$ADMIN_USER" CP_ADMIN_EMAIL="$ADMIN_EMAIL" CP_ADMIN_PASSWORD="$ADMIN_PASS" \
       bash -lc "cd '$APP_DIR' && node src/scripts/setup.js --yes --if-needed"; then
    ADMIN_CREATED=1
    ok "Administrator '${ADMIN_USER}' created."
  else
    warn "Could not create the admin automatically — finish in the browser or run: sudo -u ${RUN_USER} node ${APP_DIR}/src/scripts/setup.js"
  fi
fi

# ---- 7. systemd service --------------------------------------------------
say "Creating systemd service '${SERVICE}'…"
cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=Cloud Panel — game server management
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=$(command -v node) ${APP_DIR}/src/server.js
Restart=always
RestartSec=3
LimitNOFILE=65535
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl restart "$SERVICE"
ok "Service started."

# ---- 8. Firewall ---------------------------------------------------------
say "Configuring firewall rules (ufw)…"
ufw allow OpenSSH        >/dev/null 2>&1 || true
ufw allow "${WEB_PORT}"/tcp  >/dev/null 2>&1 || true
ufw allow "${SFTP_PORT}"/tcp >/dev/null 2>&1 || true
ufw allow "${ALLOC_START}:${ALLOC_END}/tcp" >/dev/null 2>&1 || true
ufw allow "${ALLOC_START}:${ALLOC_END}/udp" >/dev/null 2>&1 || true
ok "Firewall rules added (ufw not auto-enabled to protect SSH)."

# ---- Done ----------------------------------------------------------------
sleep 1
echo
ok "Cloud Panel is installed and running!"
echo
echo -e "  ${c_grn}Web panel${c_off}   : http://${PUBLIC_HOST}:${WEB_PORT}"
echo -e "  ${c_grn}SFTP${c_off}        : ${PUBLIC_HOST}:${SFTP_PORT}  (user: <name>.<serverId>)"
echo
if [ "$ADMIN_CREATED" = "1" ]; then
  echo -e "  ${c_ylw}Your administrator login:${c_off}"
  echo    "    username : ${ADMIN_USER}"
  echo    "    email    : ${ADMIN_EMAIL}"
  if [ "$GENERATED_PASS" = "1" ]; then
    echo -e "    password : ${c_grn}${ADMIN_PASS}${c_off}   ${c_ylw}(auto-generated — save it now!)${c_off}"
  else
    echo    "    password : (the one you entered)"
  fi
else
  echo -e "  ${c_ylw}No admin yet${c_off} — open the web panel to create your administrator,"
  echo    "  or run:  sudo -u ${RUN_USER} node ${APP_DIR}/src/scripts/setup.js"
fi
echo
echo    "  There are NO default passwords. Keep your admin credentials safe."
echo
echo    "  Manage:  systemctl status ${SERVICE}   |   journalctl -u ${SERVICE} -f"
echo    "  Update:  sudo bash ${APP_DIR}/scripts/update.sh"
echo    "  Users :  sudo -u ${RUN_USER} node ${APP_DIR}/src/scripts/user.js create --admin"
echo
systemctl --no-pager --lines=0 status "$SERVICE" || true
