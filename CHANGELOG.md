# Changelog

All notable changes to **Cloud Panel** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [1.5.1] — 2026-06-19

### 🔒 Security hardening
- **Trust-proxy now defaults OFF** (`CP_TRUST_PROXY`). Trusting `X-Forwarded-For`
  by default let a directly-reachable panel be brute-forced by spoofing the
  header to dodge IP rate limits. Set `CP_TRUST_PROXY=1` (hops) behind a proxy.
- **SFTP brute-force throttling** — SFTP password auth is now rate-limited per
  source IP (temporary lockout) and abusive connections are dropped; previously
  only the web login was throttled. SFTP also now requires an **approved**
  account.
- **Symlink-escape protection** — the file manager, backups and SFTP now
  realpath-check paths, so a server process can't drop a symlink in its volume
  to read/write host files outside it (e.g. the panel's `data/`).
- **Content-Security-Policy** added on every response (`script-src 'self'`,
  etc.) to contain XSS; the SPA loads only external JS and binds events without
  inline handlers, so it stays fully functional.
- **Password length** unified to **8+** characters (the change-password endpoint
  previously allowed 6).
- Added **`SECURITY.md`** with the threat model (host-process isolation caveat)
  and a deployment hardening checklist.

## [1.5.0] — 2026-06-18

### ✨ Added — Console Automations (a Cloud Panel exclusive)

Reactive rules that watch each server's **live console output** and automatically
take action when a line matches — something other panels (Pterodactyl,
PufferPanel) don't offer. New **Automations** tab on every server.

- **Match** console output by **contains** text or **regex** (case-sensitive optional).
- **Act** automatically:
  - **Command** — send a console command (e.g. `save-all`).
  - **Power** — start / stop / restart / kill the server.
  - **Notify** — POST to a Discord / webhook with the matched line.
- **Per-rule cooldown** prevents action storms and feedback loops.
- **Enable/disable** toggle, **fire counter**, and a built-in **"test against a
  sample line"** matcher in the editor.
- Examples: auto-restart on `OutOfMemoryError`, auto `/save-all` on a keyword,
  or an instant crash alert to Discord.

### ⚙️ Under the hood
- New engine (`src/services/automations.js`) subscribes to each server's console
  stream (no changes to the process manager); enabled rules are compiled and
  cached in memory, matched with cooldowns, and acted on asynchronously.
- New endpoints: `GET/POST/PUT/DELETE /api/servers/:id/automations` plus
  `POST /api/servers/:id/automations/test`.
- New `automations` collection (migrates automatically on upgrade).

### 🔒 Security
- `notify` webhooks are restricted to **https** URLs to **public** hosts
  (loopback/private/link-local ranges are blocked) to mitigate SSRF.

## [1.4.4] — 2026-06-18

### 🌐 Website & docs
- Reworded the install messaging so it no longer implies Cloud Panel gives you a
  free VPS — it's now clear the one-command installer runs on **your own** VPS
  ("One-command install").
- Updated the "How is this site hosted?" answer: the marketing site now runs on
  **Vercel** (previously a self-hosted Node server behind a Cloudflare Tunnel).
- The website source is now open at
  [`Notbangbang-dev/cloud-panel-web`](https://github.com/Notbangbang-dev/cloud-panel-web).

> Website/docs only — the panel application itself is unchanged from 1.4.3.

## [1.4.3] — 2026-06-18

### 🐛 Fixed
- **Admin → Users:** the "Pending approval" heading rendered raw `<svg>` markup
  instead of the clock icon. It now displays correctly (icon is passed as HTML,
  not text).

### ✨ Added
- **Admin → Users:** a dedicated **Add / Remove coins** dialog on each user —
  shows the current balance, an amount field, and **Add** / **Remove** buttons.
  Removing coins no longer requires typing a negative number (balances still
  floor at 0).

## [1.4.2] — 2026-06-18

### ✨ Added — Appearance & Theming (admin console)

A full, live theming engine. **Admin Console → Appearance** now lets you
restyle the entire panel — no code, no restarts.

- **Theme presets** — 9 built-in palettes: Nebula (default), Midnight, Aurora,
  Sunset, Grape, Matrix, Crimson, Slate, and a light theme (Cotton).
- **Custom colors** — override Primary, Secondary, Accent, Background, Surface
  and Text with live color pickers (or "Reset" any one back to the preset).
- **Backgrounds** — choose a type:
  - Preset (animated nebula), Solid color, CSS gradient (with quick presets),
  - **Image**, **GIF**, or **Video** (mp4 / webm) — paste a URL **or upload**.
  - Controls for darken overlay, blur, fit (cover / contain / tile / center)
    and fixed/parallax.
- **Effects** — toggle background animations and glass/blur panels, and tune
  the global corner radius.
- **Branding** — override the panel name and tagline.
- **Custom CSS** — an advanced escape hatch injected site-wide.
- **Live preview** — every change previews instantly across the panel; nothing
  is applied for other users until you **Save**. Plus **Discard** and
  **Reset to default**.

### ⚙️ Under the hood

- New theming engine (`src/services/appearance.js`) generates the active theme
  as CSS custom-property overrides.
- New **public** endpoints `GET /api/appearance.css` and `GET /api/appearance.json`.
  `index.html` links the stylesheet so there's **no flash** of the default theme,
  and the login screen is themed too.
- New **admin** endpoints: `GET/PUT /api/admin/appearance`,
  `POST /api/admin/appearance/{preview,reset,upload}`.
- Uploaded theme assets are stored under `data/uploads/` and served at `/uploads`.
- Theme config lives in the existing global settings document and migrates
  automatically on upgrade (existing installs get the default theme).
- Inputs and panels are now driven by theme variables, so palettes (including
  the light theme) restyle forms correctly.

### 🔒 Security / validation

- Colors, URLs and gradients are validated; custom CSS is sanitized to stay
  inside the stylesheet context. Uploads are admin-only and restricted to
  image/gif/video types (≤ 40 MB).

## [1.3.2]

### 📜 Added — Legal
- **Terms of Service** and **Privacy Policy**, available on the website
  (`/terms`, `/privacy`) and inside the panel, and linked from the login screen
  and the site footer.
- Covers accounts, acceptable use, the coins/economy (virtual items), backups,
  and how data is handled. No tracking cookies — only your login token is stored
  locally.

## [1.3.1]

### ⚡ Added — One-command updates
- `sudo cloud-panel-update` — update to the latest version in one command. Keeps
  your `.env`, database & backups, reinstalls dependencies, and restarts
  automatically (no more re-running the installer).
- Added an **Updating** guide to the website docs.

### 🔧 Changed
- Safer self-updater (won't break mid-run) that records your repo URL for future
  pulls.
- First-time bootstrap: `cd ~/cloud-panel && git pull && sudo bash scripts/update.sh`.

## [1.3.0]

### 💾 Added — Backups
- New **Backups** tab on every server — snapshot files in one click, then
  **Restore**, **Download** (`.zip`) or **Delete** any backup.
- **Backup Slots** added as a purchasable **Shop** item (default 1 slot/user).

### 🛠️ Admin
- Configure default backups, the backup shop price/amount, and per-user backup
  quotas in **Admin → Settings**.

### 🔒 Security
- Backups and restores stay locked inside each server's own files.

## [1.2.0]

### 📁 Added — File uploads
- Upload one or many files at once, or whole **folders** (full structure
  recreated).
- **Drag & drop** onto the file manager, with a live streamed progress bar (up
  to 2 GB per file).
- **Zip support** — upload a `.zip` and **Extract** it in place.

### 🔒 Security
- Safe extraction blocks "zip-slip" path escapes; all uploads and extractions
  stay inside the server's own files.

## [1.1.0]

### 🌙 Added — AFK rewards
- New **AFK** page — earn coins just by keeping it open (default **+1 coin /
  30s**) with a live countdown ring. Fully server-timed, so it can't be cheated
  by spamming or scripts.
- **Anti-abuse:** only one AFK page can earn at a time — extra tabs are blocked,
  and you can't earn while no page is open.

### ⚙️ Admin
- Set the AFK rate & interval, or toggle the page on/off, in **Admin → Settings**.
- Coin balance now updates live in the sidebar.

### 🐛 Fixed
- Squashed a settings bug and general stability tweaks.

## [1.0.0]

### 🎉 Initial release
A full game-server panel **plus** a Discord bot.

**Panel**
- Real-time console and live CPU / RAM / disk stats.
- One-click servers: Paper, Purpur, Folia, Fabric, Vanilla, Velocity, Waterfall
  (plus Node.js, Python and generic Java).
- Built-in file manager + per-server SFTP.
- Multi-node admin: nodes, locations, allocations & eggs.

**Economy & self-service**
- Coins + shop (buy RAM, CPU, Disk & server slots), per-user resource quotas,
  and members deploying their own servers within their limits.

**Accounts**
- Public sign-ups with admin approval, a first-run setup wizard (no default
  passwords), and admin-editable defaults, prices & feature toggles.

**Discord bot**
- 26 slash commands; moderation (ban, kick, timeout, lock, slowmode, warns);
  ticket system with HTML transcripts; welcome/leave messages + autorole.

**Behind the scenes**
- SQLite database, JWT auth, rate limiting & security headers.
- One-command VPS installer (Node, Java, systemd, firewall).
