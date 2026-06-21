# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for
anything exploitable.

- Open a GitHub **Security Advisory** on the repository, or
- contact the maintainer via the project's Discord (DM an admin).

Include steps to reproduce and the impact. We'll acknowledge as soon as we can.

## ⚠️ Threat model — read this before exposing the panel publicly

Cloud Panel runs each game/app server as a **host process** (there is no
container/VM sandbox by default). Several eggs (Node.js, Python, Generic Java,
`.jar`) execute **user-supplied code**.

**Therefore any account that can create/run a server can execute arbitrary code
as the OS user the panel runs as.** Such code could read the panel's data
directory (database, JWT secret), other servers' files, and otherwise compromise
the host.

Run Cloud Panel with untrusted/self-service users **only** if you add isolation.
Recommended hardening:

- **Isolate servers** — run them in containers (Docker) or as a dedicated,
  unprivileged OS user **per server**, with the volume owned by that user.
- **Protect panel secrets** — ensure server processes cannot read the panel's
  `data/` directory, especially `data/.jwt-secret` (used to sign admin tokens)
  and the database. Run the panel as a different user than the servers.
- **Keep registration approval ON** (the default) so new accounts can't deploy
  servers until an admin approves them. Only approve people you trust.
- **Firewall** the SFTP port (default 5657) and the panel port to where they're
  needed.

## Enabling built-in server isolation (recommended for untrusted users)

The panel supports running every game server as a dedicated **unprivileged OS
user** so server code can't read the panel's database/secret or other servers.
This requires the panel to run as **root** (so it can drop privileges per
server). On your VPS (paths assume the default `/opt/cloud-panel`):

```bash
# 1) Create the unprivileged server user
sudo useradd --system --no-create-home --shell /usr/sbin/nologin cp-servers
id -u cp-servers   # note the UID
id -g cp-servers   # note the GID

# 2) Hand the server volumes to it; lock panel internals to root
sudo chown -R cp-servers:cp-servers /opt/cloud-panel/data/volumes
sudo chown root:root /opt/cloud-panel/.env /opt/cloud-panel/data/cloud-panel.db 2>/dev/null

# 3) Run the panel as root with the server uid/gid, then restart
sudo systemctl edit cloud-panel    # add the overrides below
```
In the override (or the unit / `.env`):
```
[Service]
User=root
Environment=CP_SERVER_UID=<uid-from-step-1>
Environment=CP_SERVER_GID=<gid-from-step-1>
```
```bash
sudo systemctl daemon-reload && sudo systemctl restart cloud-panel
```

On boot the panel logs `[isolation] active — servers run as uid:… gid:…`, locks
`data/` (711), the database, `.env` and the host key to root (600), closes
`backups/` (700), and chowns each volume to the server user on start.

**Verify** with the C1 probe (a server that tries to read `cloud-panel.db` /
`.env`): it should now print `blocked … EACCES`.

Caveats:
- The panel runs as **root** to drop privileges (the standard model for this).
  Its own attack surface is the authenticated API.
- A single shared `cp-servers` user isolates servers from the **panel**, but not
  from **each other**. For per-tenant isolation, use a unique UID per server or
  containers.
- If `CP_SERVER_UID/GID` are set but the panel is **not** root, isolation stays
  **off** and the panel logs a warning (it never silently runs unisolated as if
  isolated).

## Deployment hardening checklist

- **Reverse proxy / TLS.** Terminate HTTPS at a proxy (Nginx/Caddy/Cloudflare).
  When behind a proxy, set `CP_TRUST_PROXY` to the number of proxy hops
  (e.g. `CP_TRUST_PROXY=1`) so the real client IP is used for rate limiting.
  Leave it **unset/`0`** when the panel is reachable directly — trusting
  `X-Forwarded-For` from untrusted clients lets them bypass rate limits.
- **Set a strong `CP_JWT_SECRET`** (or let the panel auto-generate
  `data/.jwt-secret`, which is created `0600`). Rotating it invalidates all
  existing sessions.
- **Bcrypt cost** — raise `CP_BCRYPT_ROUNDS` (e.g. `12`) on capable hardware.
- **Back up** `data/` regularly; it contains the database and secrets.

## What the panel already does

- No hard-coded secrets; JWT secret is auto-generated and stored `0600`.
- Passwords hashed with bcrypt; password hashes are never returned by the API.
- Parameterized SQLite (no SQL injection); fixed table set.
- Per-server file access is confined to the server's volume, with traversal
  **and symlink-escape** protection; zip extraction is zip-slip protected.
- Console output is HTML-escaped before rendering (no console XSS); a strict
  `Content-Security-Policy` (`script-src 'self'`) is sent on every response.
- Admin APIs require an admin token; authorization is re-checked against the
  live user record (a token's stale `admin` claim is ignored).
- Login, registration, setup **and SFTP** authentication are rate-limited /
  throttled against brute force.
- **All server-side fetches** (egg/modpack/plugin installers and automation
  webhooks) are restricted to `https` **public** hosts — loopback, link-local
  (incl. the cloud metadata IP), private/CGNAT/ULA ranges are blocked, with DNS
  resolution checked against private addresses (SSRF mitigation,
  `src/services/nettrust.js`).
- Admin settings/merge input is guarded against prototype pollution
  (`__proto__` / `prototype` / `constructor` are rejected).
- On boot the panel best-effort restricts its secrets (`data/.jwt-secret`, the
  database, SFTP host key, `.env`) to `0600` even when full isolation is off, and
  logs a clear warning when servers run unisolated while registration is open.

## Supported versions

The latest release on `main` receives security fixes.
