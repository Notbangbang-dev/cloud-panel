#!/usr/bin/env bash
#
# Cloud Panel — node daemon installer (Debian / Ubuntu).
#
# Installs the daemon on a VPS so the panel can run servers on this machine via
# Docker. Get the exact command (with --node and --token filled in) from your
# panel: Admin → Nodes → Create node.
#
#   curl -fsSL https://your-panel/scripts/install-daemon.sh | sudo bash -s -- \
#       --panel https://your-panel --node <nodeId> --token <daemonToken> [--port 8080]
#
set -euo pipefail

PANEL_URL=""; NODE_ID=""; TOKEN=""; DPORT="8080"; RUNTIME="docker"
REPO_URL="${CP_REPO_URL:-https://github.com/Notbangbang-dev/cloud-panel.git}"
APP_DIR="${CP_APP_DIR:-/opt/cloud-panel}"
DATA_DIR="${CP_DAEMON_DATA_DIR:-/var/lib/cloud-panel-daemon}"
RUN_USER="${CP_DAEMON_USER:-cloud-panel-daemon}"
SERVICE="cloud-panel-daemon"
NODE_MAJOR="${CP_NODE_MAJOR:-20}"
ALLOC_START="${CP_ALLOC_START:-25565}"; ALLOC_END="${CP_ALLOC_END:-25600}"

while [ $# -gt 0 ]; do
  case "$1" in
    --panel) PANEL_URL="$2"; shift 2;;
    --node) NODE_ID="$2"; shift 2;;
    --token) TOKEN="$2"; shift 2;;
    --port) DPORT="$2"; shift 2;;
    --runtime) RUNTIME="$2"; shift 2;;
    *) echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

c_blue='\033[1;36m'; c_grn='\033[1;32m'; c_ylw='\033[1;33m'; c_red='\033[1;31m'; c_off='\033[0m'
say(){ echo -e "${c_blue}::${c_off} $*"; }; ok(){ echo -e "${c_grn}✓${c_off} $*"; }
warn(){ echo -e "${c_ylw}!${c_off} $*"; }; die(){ echo -e "${c_red}✗ $*${c_off}" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (sudo)."
command -v apt-get >/dev/null 2>&1 || die "This installer targets Debian/Ubuntu."
[ -n "$PANEL_URL" ] && [ -n "$NODE_ID" ] && [ -n "$TOKEN" ] || die "Missing --panel / --node / --token (copy the full command from the panel)."

echo; echo "  Cloud Panel daemon installer — node ${NODE_ID} → panel ${PANEL_URL}"; echo

# ---- 1. Base + Node.js ----------------------------------------------------
say "Installing base packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -q
apt-get install -y -q curl ca-certificates gnupg git build-essential python3 rsync ufw >/dev/null
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 18 ]; then
  say "Installing Node.js ${NODE_MAJOR}.x…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -q nodejs >/dev/null
fi
ok "Node $(node -v)"

# ---- 2. Container engine (REQUIRED on a node) -----------------------------
if [ "$RUNTIME" = "podman" ]; then
  command -v podman >/dev/null 2>&1 || { say "Installing Podman…"; apt-get install -y -q podman >/dev/null 2>&1 || warn "Install Podman manually."; }
else
  if ! command -v docker >/dev/null 2>&1; then
    say "Installing Docker…"; curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || die "Docker install failed — install it, then re-run."
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
fi

# ---- 3. User + app + data -------------------------------------------------
id "$RUN_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$RUN_USER"
usermod -aG docker "$RUN_USER" 2>/dev/null || true
mkdir -p "$DATA_DIR"; chown -R "$RUN_USER":"$RUN_USER" "$DATA_DIR"

if [ ! -f "$APP_DIR/package.json" ]; then
  say "Cloning ${REPO_URL}…"; git clone --depth 1 "$REPO_URL" "$APP_DIR" >/dev/null
fi
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR"
say "Installing npm dependencies…"
sudo -u "$RUN_USER" bash -lc "cd '$APP_DIR' && npm install --omit=dev --no-fund --no-audit"
ok "Daemon code ready at ${APP_DIR}"

# ---- 4. Environment -------------------------------------------------------
cat > "$APP_DIR/.env.daemon" <<EOF
CP_ROLE=daemon
CP_DAEMON_TOKEN=${TOKEN}
CP_PANEL_URL=${PANEL_URL}
CP_NODE_ID=${NODE_ID}
CP_WEB_PORT=${DPORT}
CP_HOST=0.0.0.0
CP_DATA_DIR=${DATA_DIR}
CP_OCI=1
CP_OCI_RUNTIME=${RUNTIME}
CP_JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo daemon-$(date +%s))
EOF
chown "$RUN_USER":"$RUN_USER" "$APP_DIR/.env.daemon"; chmod 600 "$APP_DIR/.env.daemon"

# ---- 5. systemd service ---------------------------------------------------
say "Creating systemd service '${SERVICE}'…"
cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=Cloud Panel daemon (node agent)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env.daemon
ExecStart=$(command -v node) ${APP_DIR}/src/daemon.js
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl restart "$SERVICE"

# ---- 6. Firewall ----------------------------------------------------------
ufw allow "${DPORT}"/tcp >/dev/null 2>&1 || true
ufw allow "${ALLOC_START}:${ALLOC_END}/tcp" >/dev/null 2>&1 || true
ufw allow "${ALLOC_START}:${ALLOC_END}/udp" >/dev/null 2>&1 || true

sleep 2
echo
if curl -fsS "http://127.0.0.1:${DPORT}/" >/dev/null 2>&1; then
  ok "Daemon is running on port ${DPORT}. The panel should show this node ONLINE shortly."
else
  warn "Daemon started but didn't answer yet — check:  journalctl -u ${SERVICE} -f"
fi
echo
echo "  Manage:  systemctl status ${SERVICE}   |   journalctl -u ${SERVICE} -f"
echo "  IMPORTANT: open port ${DPORT} (and game ports ${ALLOC_START}-${ALLOC_END}) in your"
echo "             cloud provider's security group, and point the panel at a reachable URL/IP."
echo
