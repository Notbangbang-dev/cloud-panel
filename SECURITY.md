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
- Automation webhooks are restricted to `https` public hosts (SSRF mitigation).

## Supported versions

The latest release on `main` receives security fixes.
