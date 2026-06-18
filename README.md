# Cloud Panel

> A Pterodactyl-style game server management panel — with **PufferPanel's default ports**.
> Deploy. Scale. Dominate.

**Repository:** https://github.com/Notbangbang-dev/cloud-panel

Cloud Panel is a self-contained game server control panel. It boots in seconds,
manages **real** server processes, streams a **live console** over WebSockets,
ships a **per-server SFTP** server, and includes a slick admin console for users,
nodes, locations, eggs and port allocations.

It deliberately uses **PufferPanel's ports** rather than Pterodactyl's:

| Service | Cloud Panel / PufferPanel | (Pterodactyl) |
| ------- | ------------------------- | ------------- |
| Web / API | **8080** | 80 / 443 |
| SFTP | **5657** | 2022 |

---

## Quick start

```bash
cd cloud-panel
npm install
npm start
```

Then open **http://localhost:8080**.

### First-run setup (no default passwords)

Cloud Panel ships with **no default accounts**. On first launch you'll be greeted
by a setup wizard — create your administrator and you're in. Prefer the terminal?

```bash
npm run setup            # interactive: create the first admin
# …or non-interactively:
node src/scripts/setup.js --username admin --email you@example.com --password 'S3cret!!'
```

Then, as admin, open **Admin → Servers → Create Server**, pick an egg
(**Paper**, **Purpur**, **Fabric**, **Vanilla**, **Velocity**, …) and Cloud Panel
downloads the real server jar, accepts the EULA, and lets you start it
(Java is installed automatically by the VPS installer).

### Managing users from the CLI

```bash
npm run user list                                     # list users
npm run user create --username bob --email b@x.io --password 'pw' --admin
npm run user create                                   # interactive (asks admin or not)
npm run user passwd bob                               # reset a password
npm run user promote bob        # grant admin   |     npm run user demote bob
npm run user delete bob --yes                         # delete
```

Admins can also create users in the web UI under **Admin → Users → Create User**.

---

## Deploy to a VPS (one command)

On a fresh **Ubuntu/Debian** server, upload or clone the project, then:

```bash
git clone https://github.com/Notbangbang-dev/cloud-panel.git   # or scp/rsync the folder up
cd cloud-panel
sudo bash scripts/install.sh
```

That single command will:

1. Install **Node.js**, build tools, and **Java** (Temurin) for Minecraft.
2. Create a locked-down `cloudpanel` system user and install to `/opt/cloud-panel`.
3. `npm install` (compiling the real SQLite driver) and generate a `.env` with a
   **random JWT secret** and your server's public IP.
4. **Create your administrator** — prompts for username/email/password, or
   auto-generates a strong password and prints it (no default credentials, ever).
5. Register a **systemd** service (`cloud-panel`) and start it on boot.
6. Open firewall ports **8080**, **5657**, and the game range **25565–25600**.

When it finishes it prints your panel URL and the admin login it created. Manage it with:

```bash
systemctl status cloud-panel      # service state
journalctl -u cloud-panel -f      # live logs
sudo cloud-panel-update           # update to the latest version (one command)
sudo bash scripts/uninstall.sh    # remove (add --purge to delete data)
```

**Updating** is a single command — it pulls the latest code, keeps your `.env`,
database & backups, reinstalls deps and restarts (no installer re-run):

```bash
sudo cloud-panel-update
```

First time only — installs the global `cloud-panel-update` command on any
existing install (works no matter how it was deployed):

```bash
curl -fsSL https://raw.githubusercontent.com/Notbangbang-dev/cloud-panel/main/scripts/update.sh | sudo bash
```

After that, every user (with sudo) can run `sudo cloud-panel-update` anytime.

> Put Cloud Panel behind Nginx/Caddy + TLS for a production domain; proxy
> `http://127.0.0.1:8080` and keep port 5657 open for SFTP.

---

## Features

- **Real database** — durable, transactional **SQLite** (`better-sqlite3`, WAL).
  Automatically falls back to an atomic JSON store if a platform can't build it,
  so the panel always runs.
- **Real game servers** — egg installers for **PaperMC** and **Vanilla** download
  the actual server jars and accept the EULA; one-click **Reinstall**.
- **Real resource stats** — true CPU, memory **and disk** usage (Windows-safe
  sampler that does not depend on the removed `wmic`; `pidusage`/`/proc` on Linux).
- **Real process management** — each server is a child process. Start / Stop /
  Restart / Kill with graceful shutdown and crash detection.
- **Live console** — WebSocket streaming of stdout/stderr with ANSI colors, log
  replay on connect, and command input (history with ↑/↓).
- **Insane dark UI** — glassmorphism, neon gradients, animated background, fully
  responsive. Zero external CDNs (works offline); custom ANSI renderer + sparklines.
- **File manager** — browse, edit, create, rename and delete files per server,
  with path-traversal protection.
- **Per-server SFTP** (port **5657**) — connect with FileZilla / WinSCP / VS Code.
  - Username: `<your-username>.<server-id>`  ·  Password: your account password.
- **Allocations** — IP:port management for game servers (range configurable).
- **Admin console** — CRUD for servers, users, nodes, locations, allocations, and
  an egg (template) catalog, plus a live capacity overview.
- **JWT auth** + bcrypt password hashing + one-command VPS install.

---

## Configuration

All settings are environment variables (see `.env.example`). Common ones:

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `CP_WEB_PORT` | `8080` | Panel web/API port (PufferPanel) |
| `CP_SFTP_PORT` | `5657` | SFTP port (PufferPanel) |
| `CP_PUBLIC_HOST` | `127.0.0.1` | Address advertised for allocations/SFTP |
| `CP_JWT_SECRET` | dev secret | **Change in production** |
| `CP_ALLOC_START` / `CP_ALLOC_END` | `25565` / `25600` | Seeded game-port range |

### Useful scripts

```bash
npm start      # run the panel
npm run dev    # run with --watch (auto-restart on changes)
npm run reset  # wipe + re-seed the database and server volumes
```

### Data & persistence

Cloud Panel stores everything in a real **SQLite** database at
`data/cloud-panel.db` (WAL mode, ACID writes). If `better-sqlite3` can't be built
on a given platform, it transparently falls back to an atomic JSON store
(`data/cloud-panel.json`). Per-server files live under `data/volumes/<id>/` and are
exposed over both the file manager and SFTP. Force the JSON store with `CP_FORCE_JSON=1`.

---

## Architecture

```
src/
  server.js              Express + WebSocket + static SPA + graceful shutdown
  config.js              Ports (8080 / 5657), paths, .env loader
  db.js                  SQLite store (+ JSON fallback) + demo seed
  auth.js                JWT + bcrypt helpers and middleware
  routes/                REST API (auth, client, admin) + serializers
  services/
    processManager.js    Child-process lifecycle, log streaming, provisioning
    stats.js             Cross-platform CPU/memory sampler (no wmic)
    files.js             Safe per-server file ops + real disk usage
    installers.js        Real egg installers (PaperMC, Vanilla)
  ws/console.js          Live console WebSocket
  sftp/sftpServer.js     SFTP server on port 5657 (ssh2)
scripts/                 VPS install.sh / update.sh / uninstall.sh + systemd unit
demo/demo-server.js      Built-in simulated game server
public/                  Self-contained SPA (no bundler/CDN)
data/                    SQLite DB, SFTP host key, per-server volumes
```

## Connecting over SFTP

```
Host:     127.0.0.1
Port:     5657
Username: admin.<server-id>     # the server id is shown on the Network tab
Password: <your account password>
```

The first SFTP connection generates a host key under `data/sftp_host.key`.

---

## Notes

Cloud Panel runs game servers as host child processes (not Docker containers).
CPU, memory and disk usage are **real**; per-process network isolation isn't
available without containers, so network counters are omitted rather than faked.
The Paper/Vanilla eggs download real server jars and need **Java** (installed by
`scripts/install.sh`). The demo egg needs only Node.js. Point any egg's startup
command at any binary to run other software.

## License

MIT
