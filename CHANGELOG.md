# Changelog

All notable changes to **Cloud Panel** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [2.2.0] — 2026-06-21

### 🚀 Improved — Network status page
The public **/status** overview went from 3 numbers to a real status dashboard:
- **Overall health banner** — "All systems operational" or "Degraded" (flips
  automatically if any server is crashed).
- **Live headline tiles** — servers online (x/total), players online, **24h
  uptime** (averaged across servers), and live **CPU** load.
- **Network usage bars** — aggregate **memory** and **disk** used vs total
  capacity across all nodes.
- **Per-node cards** — each node shows an online dot, location, servers
  online/total, and live **RAM / disk** usage bars + CPU load.
- Wider, auto-refreshing layout (every 12s).

Backend: a new testable `statuspage.overview()` aggregates live `pm` stats,
`players`, `metrics` (uptime) and disk usage per node. Still admin-toggleable.

## [2.1.3] — 2026-06-21

### 🐛 Fixed
- **"nullnull" on the login screen** — when both Discord login and registration
  were disabled, the login footer rendered the literal text "nullnull". (Native
  `Element.append()` stringifies `null`; the page now filters empty sections.)
- **Startup tab "null"** — servers whose egg has no variables no longer render a
  stray "null" below the startup command.
- Swept the rest of the frontend for the same native-append/null pattern — these
  were the only remaining cases.

## [2.1.2] — 2026-06-21

### 💅 Improved
- **Create / Edit User dialog** — cleaner, balanced layout: the form is a tidy
  2×2 grid (Username/Email, First/Last) with a **full-width Password** field, and
  the old bare "Administrator" checkbox is now a proper **toggle row** with an
  icon, label and a "Full access to every server, user, node and setting" helper
  — consistent with the Settings switches.

### 🐛 Fixed
- **Per-server status page** no longer renders the literal text **"null"** for
  servers without a description or with nobody online (native `Element.append`
  was stringifying empty sections).

## [2.1.1] — 2026-06-21

> Upgrades five 2.1 features from "lite" to full builds. All additive.

### ✨ Improved
- **Per-server custom ANSI palettes** — the console theme is now saved
  **per server** (not per browser) and you can set a fully **custom palette**
  (background, text + the 6 ANSI colors) via a color picker. (`PUT /api/servers/:id/console`)
- **Scheduled maintenance windows** — maintenance can auto-enable for a
  **start→end** window (not just an on/off toggle); the gate uses the effective
  state.
- **Animated seasonal effects** — seasons now render real particles:
  **snow** (winter/christmas), drifting **embers** (halloween) and **confetti**
  (new year) — respecting `prefers-reduced-motion`.
- **Economy flow chart** — Admin → Analytics now shows real **coins earned vs
  spent** per day, backed by a new coin **ledger** (daily/AFK/shop/pets/admin).
- **Friends → share a server** — one click on a friend adds them as a **subuser**
  with the permissions you choose.

### 🔧 Notes
- New `ledger` collection + `maintenance.{scheduleEnabled,start,end}` settings
  migrate automatically.

## [2.1.0] — 2026-06-21

> Builds on v2 with creator tools, social, and sharing. All additive — update
> with `sudo cloud-panel-update`.

### 🚀 Added
- **Egg builder (admin)** 🥚 — create, edit and delete server types right in
  **Admin → Eggs**: name, category, Docker image, startup command, stop command,
  description and a full **variables** editor — no JSON. Custom eggs are
  manual-install; editing a built-in **keeps its auto-installer**.
  (`POST/PUT/DELETE /api/admin/eggs`)
- **Friends & presence** 🤝 — a new **Friends** tab: send/accept/decline friend
  requests by username and see who's **online** (live, in-memory presence with a
  60s heartbeat). (`/api/friends`, `/api/presence/ping`)
- **Console upgrades** 🖥️ — in-console **log search/filter**, a **Next error**
  jump button, and **5 console themes** (saved per browser).
- **Brag cards** 🃏 — export a shareable **PNG** of a server's stats (name,
  status, uptime, CPU/RAM/disk, branding) from the console. Admin-toggleable.
- **Network status page** 🌐 — an optional public **/status** overview (total
  servers, online count, nodes), configurable title, toggled in Admin → Settings.

### 🔧 Notes
- New per-user fields (`friends`, `friendRequests`) and the `bragCards` /
  `statusOverview` settings migrate automatically on upgrade.
- Presence is ephemeral (in-memory) and resets on restart by design.

## [2.0.0] — 2026-06-21

> **Cloud Panel v2 is here.** 🎉 The economy gets real, the panel gets personal,
> and admins get superpowers. All migrations are additive — update with
> `sudo cloud-panel-update`. (Consolidates the 2.0.0-beta.1 → beta.5 line.)

### 💸 Economy & self-service
- **Self-service resources** — owners change RAM/CPU/disk/backups/databases per
  server, bounded by their account quota (`PUT /servers/:id/build`).
- **Databases economy** — buy database slots in the shop; backups **and**
  databases are drawn from your quota.
- **Daily reward** 🎁 — claim coins once per day with an optional **streak
  bonus**. Admin-configurable (coins/day, streak, cap).

### 🎨 Personalization
- **Profile pictures** 🖼️ — upload an avatar (png/jpg/gif/webp); shown in the
  sidebar; admins can clear one.
- **Per-user themes** 🌗 — pick your own palette from 9 presets, saved to your
  profile, applied only for you.
- **Seasonal auto-themes** 🍂 — Halloween / Winter / Christmas / New Year / Auto
  (by date), toggled in Admin → Settings.

### 🏅 Gamification
- **Achievements & XP** — a new tab with an XP/level bar and badges; 9 built-ins
  auto-unlock (Backup Hoarder, Crash Survivor, Night Owl…). Admins toggle it and
  **add custom achievements** (Admin → Achievements).
- **Server pets** 🐾 — a coin-bought Tamagotchi (no default — buy your first)
  that reacts to your fleet's health. Admin-toggleable.

### 🛡️ Admin superpowers
- **Panel analytics** — a new Admin → Analytics tab: signups (14-day chart),
  user/server/node totals, coins in circulation, servers-by-type, top balances.
- **View as user (impersonation)** — open the panel exactly as any member sees
  it, with a persistent banner and one-click exit (1-hour scoped, audited).
- **Maintenance mode** 🛠️ — lock non-admins out with a custom notice; admins
  keep full access.
- **Broadcast banner** 📣 — a site-wide announcement bar (4 styles) across the
  panel and login screen.

### 🔒 Security (from the v2 hardening pass)
- SSRF egress guard on all server-side downloads; prototype-pollution guard on
  settings; secrets locked to `0600` even without full isolation; trust-proxy
  off by default in the installer; the Discord bot re-checks permissions
  server-side. See `SECURITY.md`.

### 🔧 Notes
- New collections (`achievements`) and user fields (`avatar`, `themePreset`,
  `xp`, `achievements`, `stats`, `pets`, `activePet`, `dailyStreak`,
  `lastDailyAt`) and settings are created automatically on upgrade.

---

<details><summary>v2 beta history (2.0.0-beta.1 → beta.5)</summary>

## [2.0.0-beta.5] — 2026-06-21

> v2 gamification drop. All additive — update with `sudo cloud-panel-update`.

### 🚀 Added

- **Achievements & XP** 🏅 — a new **Achievements** tab with an XP/level bar and
  a badge grid. 9 built-ins unlock automatically (Liftoff, Fleet Commander,
  Backup Hoarder, **Crash Survivor**, **Night Owl**, Dedicated, Loaded, Locked
  Down…) from your stats. Admins toggle the feature and **add custom
  achievements** (icon, XP, and an "unlock when *stat* ≥ *value*" rule) in
  **Admin → Achievements**. New `GET /api/achievements` + admin CRUD.
- **Server Pets** 🐾 — a coin-bought Tamagotchi: a new **Pets** tab with a shop
  (9 pets, no default — you buy your first), an equip/unequip collection, and a
  **mascot that reacts to your fleet's health** (happy when servers are healthy,
  stressed when RAM is near full, asleep when everything's offline). Admin
  toggle; requires the economy. New `GET /api/pets`, `POST /api/pets/buy`,
  `PUT /api/pets/active`.

### 🔧 Notes

- New user fields (`achievements`, `xp`, `stats`, `pets`, `activePet`), the
  `achievements` collection, and the `achievements`/`pets` settings are created
  automatically on upgrade.
- XP bumps are best-effort and never block core actions (backup, power, AFK,
  daily, server-create hooks).

## [2.0.0-beta.4] — 2026-06-21

> v2 personalization drop. All additive — update with `sudo cloud-panel-update`.

### 🚀 Added

- **Profile pictures** 🖼️ — upload an avatar (png/jpg/gif/webp, ≤ 3 MB) in
  **Account → Appearance**; it shows in the sidebar. Old avatars are cleaned up
  on replace, and admins can clear a user's avatar from the user editor.
- **Per-user themes** 🌗 — pick any of the 9 built-in palettes as your **own**
  theme (saved to your profile, applied only for you) without changing the
  panel-wide theme. New `GET /api/appearance/presets` +
  `GET /api/appearance/preset/:id` and `PUT /api/account/theme`.
- **Seasonal auto-themes** 🍂 — **Admin → Settings** can layer a festive accent
  palette over the panel: **Halloween**, **Winter**, **Christmas**, **New Year**,
  or **Auto** (picks by the calendar date). Toggle to **Off** any time.

### 🔧 Notes

- New per-user fields (`avatar`, `themePreset`) and the `seasonal` setting are
  added automatically on upgrade.
- Avatar uploads are stored under `data/uploads/avatars/` and served at
  `/uploads`. Image types only (no SVG).

## [2.0.0-beta.3] — 2026-06-20

> First feature drop of the v2 cycle. All additive — update with
> `sudo cloud-panel-update`. (More v2 features are landing in batches.)

### 🚀 Added

- **Daily reward** 🎁 — members can claim coins once per day, with an optional
  **streak bonus** for consecutive days (resets if you miss a day). A claim card
  appears on the dashboard. Fully configurable in **Admin → Settings → Daily
  reward** (enable, coins/day, streak bonus, max bonus); requires the economy.
- **Maintenance mode** 🛠️ — flip the panel into maintenance from **Admin →
  Settings**. Non-admins get a themed "be right back" notice (custom title +
  message) and the entire client API is locked for them; **admins keep full
  access** so you can keep working. New `503` + `maintenance:true` API contract.
- **Broadcast banner** 📣 — show a site-wide banner across the panel **and the
  login screen** (info / warning / success / danger styles), set in **Admin →
  Settings**. Banner text renders as plain text (no HTML injection).

### 🔧 Notes

- Settings and per-user fields (`lastDailyAt`, `dailyStreak`, `xp`) are added
  automatically on upgrade — all migrations are additive.
- Daily rewards reset on the **UTC** day boundary.

## [2.0.0-beta.2] — 2026-06-20

> **Security hardening release** (full self-audit). No breaking changes — update
> with `sudo cloud-panel-update`. After updating, regenerate or review your
> `.env` (see the trust-proxy note below).

### 🔒 Security

- **SSRF guard on all server-side downloads.** The Modrinth **modpack** installer
  fetched every URL listed in a pack's `modrinth.index.json` with no validation,
  so a crafted pack could make the panel request internal services (e.g. the
  cloud metadata endpoint `169.254.169.254`, `localhost`, RFC1918 hosts). A new
  egress guard (`src/services/nettrust.js`) now requires **https to a public
  host** — with DNS resolution checked against private ranges (anti DNS-rebind) —
  for every fetch in the installers and the plugin/mod downloader.
- **Installer no longer ships a rate-limit bypass.** `scripts/install.sh` wrote
  `CP_TRUST_PROXY=1` while exposing the panel port **directly** (no proxy). That
  let anyone spoof `X-Forwarded-For` to forge `req.ip` and bypass login / SFTP
  brute-force limits. New installs now default to `CP_TRUST_PROXY=0`; set it to
  the number of hops only when actually behind a reverse proxy.
- **Prototype-pollution hardening.** The admin settings merge (`deepMerge`) now
  rejects `__proto__` / `prototype` / `constructor` keys (CWE-1321), so a settings
  payload can no longer reach `Object.prototype`.
- **Panel secrets are locked down even without full isolation.** On boot the
  panel now best-effort `chmod 600`s `data/.jwt-secret`, the database, the SFTP
  host key and `.env` (so other OS users can't read them), and logs a clear
  **C1 warning** when servers run unisolated while registration is open.
- **Discord bot — permissions re-checked server-side.** Slash commands now
  verify the caller's permissions in-handler instead of trusting Discord's
  *default* permissions alone (which a guild admin can loosen via Integrations).
- **Docs/UX:** removed the unused `CLOUDPANEL_*` admin-credential fields from the
  bot's `.env.example` (the bot doesn't control the panel — don't store panel
  passwords there); the theme-upload error no longer lists SVG (it's blocked);
  removed a dead, weaker path-join helper in the SFTP server.
- **Website** now sends a Content-Security-Policy and `X-Frame-Options` /
  `Referrer-Policy` / `Permissions-Policy` (both the Node server and Vercel).

### 🔧 Notes

- The SSRF guard validates the **initial** URL of each download; redirect targets
  are not re-validated (a known, hard problem) — for fully untrusted users prefer
  the documented container/per-user isolation. See `SECURITY.md`.
- True protection against server **code** reading panel secrets still requires
  isolation (`CP_SERVER_UID/GID` as root) or containers — this release adds
  defense-in-depth and louder warnings, not a sandbox.

## [2.0.0-beta.1] — 2026-06-20

### 🐛 Fixed — boot crash on upgrade (hotfix)

- Fixed a startup crash (`TypeError: backend.filter is not a function`) introduced
  in `2.0.0-beta`. The new v2 quota migration called an internal helper that only
  exists on the public DB wrapper, not the raw storage backend — so any install
  **with existing users** would `exit(1)` on boot and systemd would restart-loop.
  It now uses `backend.all('servers').filter(...)`. Verified against a simulated
  pre-v2 install (existing user missing the new `databases` quota).

</details>

## [1.9.1] — 2026-06-20

### 🐛 Fixed — Metrics tab rendering

- **Summary tiles no longer clip** — the Uptime / Peak CPU / Peak RAM / Samples
  tiles now have a guaranteed minimum height, so their values can't be cut off.
- **Real graphs that actually draw** — replaced the stretched sparkline canvases
  with a self-sizing area chart (gridlines + DPR-aware) that scales CPU to 100%
  and memory to the server's RAM limit, handles a single data point, and redraws
  on window resize.
- **Clear empty state** — fresh servers (or a just-restarted panel) now show
  *"No data yet — metrics are recorded every minute"* instead of blank boxes,
  since history is sampled once a minute.

## [1.9.0] — 2026-06-20

### 🚀 Added — the biggest feature drop yet (10 major features)

**👥 Subusers / per-server sharing**
- Invite other Cloud Panel accounts to a server with **granular permissions**
  (console, send-commands, power, files, backups, schedules, databases, players,
  startup, network, settings, activity).
- Permissions are enforced everywhere — REST routes **and** the console
  WebSocket — and the UI hides tabs/actions a subuser can't use. Owners and
  admins always hold every permission. New **Subusers** tab (owner-only).

**⏰ Scheduled tasks (cron)**
- A new **Schedules** tab: run a console command, power action, or **backup** on
  a standard 5-field cron expression (with quick presets). Daily restarts,
  nightly backups, timed announcements. Shows next/last run; “only when online”.

**🔐 Two-factor authentication (TOTP)**
- Authenticator-app 2FA (Google Authenticator, Authy, 1Password…), wiring up the
  previously-dead `twoFactor` field. Self-contained TOTP + an in-house QR-code
  generator (no dependencies), one-time **recovery codes**, and a second-step
  login challenge. The TOTP secret never leaves the server.

**🗄️ Per-server databases**
- `featureLimits.databases` now does something: provision real **MySQL/MariaDB**
  databases per server (create, rotate password, delete) against admin-managed
  **database hosts** (Admin → Databases, with a connection **Test**). Uses the
  optional `mysql2` driver.

**🎮 Plugin / mod browser (Modrinth)**
- Search Modrinth and **one-click install** plugins/mods straight into the
  server's `plugins/` or `mods/` folder (auto-detected from the egg). New
  **Mods** tab with installed-file listing.

**📦 One-click Modrinth modpack egg**
- New **Minecraft: Modpack (Modrinth)** egg: enter a pack slug/URL and Cloud
  Panel downloads the `.mrpack`, installs every mod + override, **and** the
  matching Fabric/Quilt/Forge/NeoForge loader, then sets the startup.

**🟢 Live player list**
- New **Players** tab: who's online (parsed live from the console), with
  one-click **kick/ban**. Works for Java; best-effort for Bedrock/PocketMine.

**🥚 More auto-install eggs (19 → 27)**
- **Quilt**, **Pufferfish**, **Leaf** (Minecraft: Java), **PocketMine-MP**
  (Bedrock), and **SteamCMD** games — **Rust**, **Valheim**, **Counter-Strike 2**
  via a new SteamCMD installer type.

**📈 Historical metrics**
- CPU / memory / disk and uptime are recorded every minute and kept per server,
  powering a new **Metrics** tab with real graphs (1h/6h/24h/7d) plus
  uptime-%, peak CPU and peak RAM. (Live sparklines still stream on Console.)

**🌐 Public status page**
- Opt-in, shareable **read-only** page per server at `/status/<slug>` — live
  status, player count, address and (optionally) uptime-% and resources. No
  login required. Configure it in the server's **Settings** tab.

### 🔧 Notes
- New collections (`subusers`, `schedules`, `databases`) and per-user/-server
  fields are added automatically on upgrade; all migrations are additive.
- Per-server databases need the optional **`mysql2`** package (`npm install`)
  and at least one database host configured in **Admin → Databases**.
- SteamCMD eggs require `steamcmd` on the host (Linux); PocketMine requires PHP.

## [1.8.1] — 2026-06-20

### ✨ Changed — Forge, NeoForge & Sponge now auto-install
- **Forge** and **NeoForge** now auto-download and **run their official
  installer** for the chosen version, then set the correct run-args startup
  command automatically (no manual jar upload).
- **Sponge (SpongeVanilla)** auto-downloads its recommended build via the Sponge
  API and accepts the EULA.
- Installers can now return a generated startup command, which the panel applies
  to the server (used by Forge/NeoForge).
- **Spigot** remains upload-only (it can only be produced with BuildTools) — the
  **Paper** egg is the auto-installing, plugin-compatible alternative.
- **Bedrock** and **Terraria** remain upload-only (no stable public download API).

## [1.8.0] — 2026-06-20

### ✨ Added — More server types (eggs)
The egg catalog grows from **11 → 19**. New templates appear automatically on
upgrade (`ensureEggs` is additive).

- **Auto-installing** (downloaded for you):
  - **BungeeCord** — the classic Minecraft proxy (latest build).
  - **Geyser (Bedrock Bridge)** — standalone proxy that lets Minecraft: Bedrock
    players join a Java server.
- **Upload-your-files** templates with sensible startup commands:
  - **Minecraft: Forge** and **Minecraft: NeoForge** (modded)
  - **Minecraft: Spigot** (plugins) and **Sponge (SpongeVanilla)**
  - **Minecraft: Bedrock Edition**
  - **Terraria**

## [1.7.0] — 2026-06-19

### ✨ Added — Discord login (OAuth2)
- Optional **"Continue with Discord"** sign-in, toggled and configured entirely
  in **Admin → Login**. The operator supplies their **own** Discord application
  (Client ID / Secret + Redirect URI) — nothing is shared or hardcoded.
- Accounts link to Discord by ID, or to an existing account on a **verified**
  email match (prevents takeover via unverified emails). New Discord sign-ups
  can be allowed/blocked and follow your approval setting.
- The session token is returned to the browser in the URL **hash** (not the
  query string, so it isn't logged), and the OAuth `state` is a signed,
  short-lived CSRF token.

### 🔧 Notes
- The panel must be able to reach `discord.com` outbound.
- In your Discord app's OAuth2 settings, add the **Redirect URI** shown in
  Admin → Login exactly (`…/api/auth/discord/callback`).

## [1.6.1] — 2026-06-19

### ✨ Added
- The **Cloud Panel** logo/name in the sidebar is now a clickable shortcut back
  to the **Dashboard** (also keyboard-accessible via Enter/Space).

## [1.6.0] — 2026-06-19

### 🔒 Added — Optional server-process isolation (mitigates audit finding C1)
- Game servers can now run as a dedicated **unprivileged OS user** instead of the
  panel's user, so server code can no longer read the panel's database, JWT
  secret or other servers' files.
- Enable by running the panel as root and setting `CP_SERVER_UID` / `CP_SERVER_GID`
  (full steps in `SECURITY.md`). Each server is spawned with **dropped
  privileges**; volumes are chowned to the server user; and `data/`, the
  database, `.env`, the SFTP host key and `backups/` are locked to root on boot.
- **Fully opt-in and guarded** — with no config (or when the panel isn't running
  as root) behavior is unchanged, and a warning is logged if isolation is
  requested but can't be applied (never silently runs unisolated-as-isolated).

> A shared server user isolates servers from the **panel** (the C1 worst case —
> stealing the admin-signing secret + reading all password hashes). Isolating
> servers from **each other** still needs a per-server user or containers.

## [1.5.2] — 2026-06-19

### 🔒 Security hardening (round 2)
- **Spawned servers no longer inherit the panel's environment** — a server
  process gets only a minimal host-var whitelist plus its own egg variables,
  never `CP_JWT_SECRET` or other panel secrets.
- **Per-server disk quota is now enforced** on file writes, uploads, zip
  extraction and backup restores (previously only at creation), with a hard
  anti-zip-bomb extraction cap.
- **Revocable sessions** — JWTs carry a `tokenVersion`; changing your password
  bumps it and signs out all other sessions (your current one is re-issued
  automatically).
- **No tokens in URLs** — the session token is accepted only via the
  `Authorization` header; the WebSocket console and backup downloads now use
  short-lived (120s), scope-limited **tickets**.
- **Console WebSocket** requires an approved account and rate-limits
  command/power messages.
- **Dropped SVG** from theme uploads (stored-XSS vector) and added an
  **HSTS** header.

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

## [1.3.2] — 2026-06-18

### 📜 Added — Legal
- **Terms of Service** and **Privacy Policy**, available on the website
  (`/terms`, `/privacy`) and inside the panel, and linked from the login screen
  and the site footer.
- Covers accounts, acceptable use, the coins/economy (virtual items), backups,
  and how data is handled. No tracking cookies — only your login token is stored
  locally.

## [1.3.1] — 2026-06-18

### ⚡ Added — One-command updates
- `sudo cloud-panel-update` — update to the latest version in one command. Keeps
  your `.env`, database & backups, reinstalls dependencies, and restarts
  automatically (no more re-running the installer).
- Added an **Updating** guide to the website docs.

### 🔧 Changed
- Safer self-updater (won't break mid-run) that records your repo URL for future
  pulls.
- First-time bootstrap: `cd ~/cloud-panel && git pull && sudo bash scripts/update.sh`.

## [1.3.0] — 2026-06-18

### 💾 Added — Backups
- New **Backups** tab on every server — snapshot files in one click, then
  **Restore**, **Download** (`.zip`) or **Delete** any backup.
- **Backup Slots** added as a purchasable **Shop** item (default 1 slot/user).

### 🛠️ Admin
- Configure default backups, the backup shop price/amount, and per-user backup
  quotas in **Admin → Settings**.

### 🔒 Security
- Backups and restores stay locked inside each server's own files.

## [1.2.0] — 2026-06-18

### 📁 Added — File uploads
- Upload one or many files at once, or whole **folders** (full structure
  recreated).
- **Drag & drop** onto the file manager, with a live streamed progress bar (up
  to 2 GB per file).
- **Zip support** — upload a `.zip` and **Extract** it in place.

### 🔒 Security
- Safe extraction blocks "zip-slip" path escapes; all uploads and extractions
  stay inside the server's own files.

## [1.1.0] — 2026-06-18

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

## [1.0.0] — 2026-06-18

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
