# Changelog

All notable changes to **Cloud Panel** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [2.16.1] — 2026-06-24 — "Ballast, for real"

A follow-up independent audit found that the v2.16.0 "atomic restore" claim was
**overstated** — so this patch makes it true rather than leaving a wrong claim
in the changelog.

### 💾 Restore is now genuinely staged before it touches your files
- v2.16.0 validated the archive's *declared* sizes before writing, which fixed
  the honest-over-quota case — but a **crafted backup that lied about its entry
  sizes** (or an I/O error mid-write) could still half-overwrite the live volume,
  because pass 2 wrote file-by-file directly onto it.
- `backups.restore` now **extracts the whole archive into a staging directory on
  the same filesystem, bounding the REAL (inflated) size as it goes**, and only
  once everything is staged and within budget does it commit onto the live volume
  (a fast same-filesystem move per file). A lying header or an inflation error is
  caught in staging — **before a single live file is changed.** (Regression tests
  cover both the rejection and the happy-path commit.)

### ✅ Tests
- 24 tests (added a happy-path staging-restore test); CI green on Node 18/20/22.

> Honesty note: the v2.16.0 entry below said restore "can no longer half-overwrite
> a volume." That was true only for honest backups. It's accurate now.

## [2.16.0] — 2026-06-24 — "Ballast"

Fixes the concrete issues a fresh independent review found — including one that
proved my own "CI is green" claim was overstated. No spin: these are real
reliability + honesty fixes.

### 🧪 The test suite is now genuinely isolated (CI was flaky)
- **Each test process gets its own data directory.** The reviewer found the suite
  could share one SQLite `settings` singleton across parallel `node --test`
  workers, so the billing tests raced (`mode: free` vs `mode: trial`) and CI
  failed ~40% of the time on Linux even though it passed locally. `tests/_env.js`
  now allocates a fresh per-process dir unconditionally — the race is now
  structurally impossible. (Node-18-safe; no runner-flag changes.)

### 💾 Restore can no longer half-overwrite a volume
- **`backups.restore` now validates the entire archive before writing a byte.** It
  used to check the disk quota *mid-loop*, so a backup that exceeded quota would
  leave the volume partially overwritten with no rollback. Now it resolves every
  entry (zip-slip safe), sums declared sizes, and rejects up front — a failed
  restore leaves your files exactly as they were. (Regression test added.)

### ⚙️ Disk-usage walk no longer freezes the panel
- **Volume size is now measured off the event loop.** `files.diskUsage` was a
  synchronous recursive walk that could block the whole process for up to ~1.5s
  on a cache miss — freezing every console, API call and SFTP session (the exact
  bug class the v2.14 backup change fixed, still lurking here). The walk is now
  async and yields; the sync accessor is non-blocking (serves cached, refreshes
  in the background). Quota-critical paths (write/upload/unzip/restore) await an
  accurate refresh so limits stay correct.

### 📣 Marketing site now matches the README's single-node honesty
- Removed "scaling across nodes" / "manage multiple nodes" / "multi-node admin
  area" from the website — Cloud Panel is **single-node** and now says so
  everywhere, not just in the README.

### ✅ Tests
- 23 tests (added atomic-restore + async-disk-usage regression tests); CI green on
  Node 18/20/22.

## [2.15.0] — 2026-06-24 — "Keystone"

Closes the loop on the #1 review criticism: the strong sandbox is no longer
opt-in — a fresh install is **isolated by default**.

### 🔐 The container sandbox is now the default
- **`CP_OCI` now defaults to `auto`.** A plain `sudo bash scripts/install.sh`
  detects an existing Docker/Podman — or installs Docker — and runs **every
  server in its own OCI container by default**: filesystem/PID/network isolation,
  `--cap-drop=ALL`, `no-new-privileges`, **and hard CPU/RAM/PID caps** from each
  server's plan. v2.14 made the panel *refuse* to run servers without a sandbox;
  v2.15 actually *sets one up for you*.
- **Never silently unsandboxed.** If no container engine can be installed, the
  installer does **not** fall back to bare host processes — it leaves the panel in
  its refuse-to-run state and tells you exactly what to do.
- **Explicit escape hatches preserved.** `CP_OCI=1` forces containers (install if
  needed); `CP_OCI=0` (or `host`) selects host-process mode, where you still
  consciously choose `CP_SERVER_UID/GID` isolation or `CP_ALLOW_UNSANDBOXED=1`.
- This also closes the **"no resource limits in host mode"** gap for the default
  path: OCI enforces real `--memory` / `--cpus` / `--pids-limit` per server.

### ✅ Tests
- 21 tests; CI green on Node 18/20/22. Installer mode-resolution
  (`auto`/force/host) verified.

> Still deliberately NOT shipped (multi-week, or need real Linux+root hardware to
> verify honestly): per-server-user isolation as a *host-mode* default, and the
> real multi-node daemon. The honest path for multi-user hosting is the new
> default — OCI containers.

## [2.14.0] — 2026-06-24 — "Bedrock"

Directly addresses the heaviest-weighted gaps from the latest honest review.

### 🔐 Secure-by-default actually means it now
- **The VPS installer no longer auto-opts-out of the sandbox.** It used to write
  `CP_ALLOW_UNSANDBOXED=1` for a plain install — silently negating "secure by
  default." Now it leaves the sandbox **unconfigured** (the panel refuses to run
  servers) and prints an explicit choice: enable `CP_OCI=1` (recommended) or, for
  a trusted single-operator panel, consciously uncomment `CP_ALLOW_UNSANDBOXED=1`.

### ⚙️ No more event-loop-blocking backups
- **Backup creation now runs in a worker thread.** A multi-GB backup used to zip
  synchronously on the main thread, freezing every console, API call and SFTP
  session for its whole duration. It's now off-thread — the panel stays
  responsive while backups run. (Read errors still fail the backup loudly; an
  empty/absent volume is still fine.)

### 💾 Updates are recoverable
- **`cloud-panel-update` now snapshots the panel's own state** (the SQLite DB /
  JSON store) into `data/state-backups/<timestamp>/` *before* it restarts &
  migrates — keeping the 7 most recent. A bad update or migration can now be
  rolled back instead of being unrecoverable.

### ✅ Tests
- 21 tests (added a worker-thread backup test); CI green on Node 18/20/22.

> Still deliberately NOT shipped (they need Linux+root real-world verification or
> are multi-week — and faking them would be dishonest): per-tenant isolation +
> host-mode cgroup limits, and the real multi-node daemon. For untrusted/multi-
> user use, run with `CP_OCI=1` (the OCI sandbox already provides per-server
> isolation and resource caps).

## [2.13.0] — 2026-06-24 — "Insight"

### 📊 Observability
- **Structured logging** (zero new dependencies): a small leveled logger
  (`CP_LOG_LEVEL` = debug|info|warn|error, default info; `CP_LOG_JSON=1` for
  one-JSON-object-per-line). Replaces ad-hoc `console.*` on the hot paths.
- **Per-request logging**: every API request is logged once on finish with
  method, path, status and latency (e.g. `GET /api/health 200 1ms`) — at the
  right level (4xx→warn, 5xx→error). The HTTP error handler now logs through it
  too.

### 🛡️ More hardening (finishing the audit's safe remainder)
- **Outbound fetch timeout**: `safeFetch` (installers, modpacks, automation
  webhooks) now applies a default 20s wall-clock timeout when the caller doesn't
  pass its own signal, so a hostile/slow upstream can't hang an install forever.
- **Admin node edits are coerced**: `PATCH /nodes/:id` now coerces the numeric
  capacity fields (memory/disk/cpu/overallocate) like the create path did, so a
  non-numeric value can't poison node accounting or the public status-page math.

### ✅ Tests
- Suite grown to **20 tests** (added logger level-filtering coverage); CI green
  on Node 18/20/22.

> Scope note: the remaining items to push past this — a **third-party security
> audit**, a **real multi-node daemon**, and worker-thread offload for heavy zip
> work — are deliberately tracked as larger follow-ups rather than rushed in.

## [2.12.0] — 2026-06-24 — "Hardened"

### 🛡️ Security hardening (from an internal adversarial audit)
A multi-agent security audit of the auth/SFTP/files/SSRF/route surfaces turned
up real, verified issues — fixed here (with regression tests):

- **SFTP authorization bypass (HIGH).** SFTP sessions only checked server
  *access*, never the per-server **`file` permission** — so a subuser invited
  with any grant (e.g. console-only) could read/write/delete the whole volume
  over SFTP, bypassing the web file-manager's permission model. SFTP now
  requires the `file` permission, matching the web API.
- **SSRF guard bypass (HIGH).** The private-IP check only matched the dotted
  `::ffff:1.2.3.4` form; the equivalent **hex IPv4-mapped IPv6** (`::ffff:7f00:1`,
  `::ffff:a9fe:a9fe` = cloud metadata, etc.) slipped through and could reach
  loopback / RFC1918 / `169.254.169.254` via user-supplied URLs (modpack files,
  automation webhooks). Now both forms are decoded and blocked.
- **Automation regex ReDoS (HIGH).** A user "evil regex" like `(a+)+$` runs
  synchronously and could freeze the whole single-process panel. Nested-
  quantifier patterns are now rejected at create/test time.
- **Zip-bomb OOM (HIGH).** Unzip and backup-restore now check each entry's
  declared uncompressed size **before** decompressing, so one tiny entry can't
  inflate to many GB and OOM the panel.
- **Unbounded installer downloads (MEDIUM).** Jar/modpack downloads now enforce
  an 8 GiB ceiling (the size header is untrusted, so a running byte counter
  aborts oversized streams).
- **AuthZ consistency (LOW).** The mutating file routes (write/upload/unzip/
  mkdir/rename/delete) now require an **active** (approved) account, like the
  rest of the mutating API.
- **Reduced info disclosure (LOW).** The unauthenticated `/api/health` is now a
  bare liveness signal; detailed self-health (Node version, memory, store,
  sandbox, server counts) moved to **admin-only** `GET /api/admin/health`.

### ♿ Accessibility
- Added `aria-label`s to icon-only controls (menu toggle, search, modal close)
  and made the modal close keyboard-activatable.

### 📣 Honest positioning
- README + package description now state plainly that Cloud Panel is a
  **single-node** panel (the Nodes/Allocations screens organize one host — there
  is no remote daemon yet), with a clear **"Who this is for"** section. Tones
  down the marketing to match what the architecture actually delivers.

### ✅ Tests
- Suite grown to **18 tests** — added the SSRF IPv6 classifier, the ReDoS
  prelinter, and the cross-account trial anti-abuse path.

## [2.11.0] — 2026-06-24 — "Foundation"

### ✅ Automated tests + CI (the panel finally has a safety net)
The standing "zero tests, zero CI" gap is closed.

- **Test suite** (`npm test`, zero new dependencies — Node's built-in
  `node:test`): 15 tests covering the load-bearing, safety-critical code —
  auth (token sign/verify/tamper, password hashing), billing (trial expiry,
  `requiresPlan` gating, reconcile downgrade), the secure-by-default sandbox
  gate, file-path traversal containment, IP canonicalization, settings
  sanitization, and boot-state reconciliation. Tests run against a throwaway
  data dir, never touching real panel data.
- **CI** (GitHub Actions): every push/PR runs a syntax check + the suite on
  Node 18, 20 and 22.
- **Safer updates:** `cloud-panel-update` now **runs the tests after pulling and
  refuses to restart if they fail** — a bad update can no longer take your panel
  down; it stays on the previous version until you investigate.

### 📈 Observability
- `/api/health` now also reports basic panel self-health: Node version, process
  uptime, RSS memory, the store backend, sandbox mode, and live server counts —
  enough to monitor the panel itself, not just per-server graphs.

## [2.10.0] — 2026-06-24 — "Resilience"

### 🔁 The panel now survives restarts and crashes
The biggest reliability gaps from the self-review are closed.

- **Resume on boot.** On startup the panel reconciles stale state (the in-memory
  runtime is empty after a restart, so any persisted `running`/`starting`/
  `stopping`/`crashed` row is reset to `offline`) and then **re-launches the
  servers that were running before shutdown**. So a panel restart/update no
  longer silently leaves every server down. Per-server **Auto-start** toggle
  (default on) controls this.
- **Auto-restart on crash.** When a server exits unexpectedly it now **restarts
  automatically** after a short delay, with a crash-loop guard (max 5 restarts
  per 10 minutes, then it stops and tells you). Per-server **Auto-restart**
  toggle (default on).
- **No more phantom-online servers.** Stale `running` rows left by a hard kill
  are reconciled to `offline` at boot.

### 🐛 Reliability fixes
- **Failed installs are no longer disguised as ready.** A server whose install
  fails now shows a distinct **`install failed`** status (was silently set to
  `offline`, indistinguishable from a ready server) and the error is logged.
- **Backups fail loudly instead of silently capturing nothing.** A real read/
  permission error while archiving now fails the backup with a clear message,
  instead of writing an empty zip you'd trust as a real snapshot. (Only a
  genuinely absent/empty volume is treated as OK.)

### ⚙️ Settings
- New per-server **Auto-start** and **Auto-restart** toggles (API:
  `POST /servers/:id/settings/rename`), backfilled to **on** for existing servers.

## [2.9.0] — 2026-06-24 — "Bastion"

### 🔐 Secure by default — servers refuse to run unsandboxed (audit C1)
The panel's #1 risk was that, with no sandbox, a server runs as the panel user
and can read the JWT secret / DB and forge an admin token. That default is now
inverted.

- **A server will not start unless it's sandboxed.** Starting a server now
  requires either the **OCI container sandbox** (`CP_OCI=1`) or **per-server-user
  isolation** (`CP_SERVER_UID/GID` as root) — both of which prevent server code
  from reading the panel secret. With neither active, `start()` refuses with a
  clear message instead of silently running arbitrary code as the panel user.
- **Explicit opt-out for trusted, single-operator panels:** set
  `CP_ALLOW_UNSANDBOXED=1` (env) or toggle `security.allowUnsandboxed`
  (Admin → Settings). This is a conscious, logged risk-acceptance — never use it
  on a panel with untrusted/self-service users.
- The boot warning now states the gate, and the VPS installer writes the opt-in
  flag automatically for a plain single-operator install while preferring
  `CP_OCI=1` when you request the container sandbox.

> ⚠️ **Action required after updating an existing, non-sandboxed install:** your
> servers will refuse to start until you either enable a sandbox (recommended:
> `CP_OCI=1` with Docker/Podman) or, for a trusted single-operator panel, add
> `CP_ALLOW_UNSANDBOXED=1` to your `.env` and restart.

## [2.8.1] — 2026-06-24

### 🐛 Fixes
- **Admin → Settings: the Maintenance "Schedule a window" date inputs no longer
  overflow their card.** `datetime-local` controls have a fixed intrinsic
  min-width and wouldn't shrink inside the two-column grid, so the **End** field
  was clipped at the card's right edge. Form controls (and the grid fields that
  hold them) can now shrink to fit — verified the End input went from 122px of
  overflow to 0.

## [2.8.0] — 2026-06-24 — "Trial Guard"

### 🔒 Free trials now actually end (and are hard to abuse)
Previously a free trial's end date was stored and shown but **never enforced** —
`requiresPlan` only checked the status string, and nothing flipped it when the
clock ran out, so a trial granted permanent access. Fixed:

- **Trials expire on time.** A new request-time reconcile (wired into the auth
  middleware) downgrades an elapsed trial the instant it lapses — sets
  `planStatus: 'expired'`, drops the plan, and reverts the quota to the panel
  defaults. New server creation is blocked and the "pick a plan" gate appears.
  No scheduler needed; the check is idempotent.

### 🛡️ Trial anti-abuse (cross-account)
- One trial per **identity**, not just per account. Normalized **email**
  (gmail dots + `+tag` collapsed), **Discord id**, and **IP** are recorded in a
  persistent `trialClaims` store; any prior match blocks a new trial — and it
  survives deleting & re-registering the account.
- Trials are **blocked over VPN/proxy** when anti-VPN is enabled (stops IP
  rotation to mint new trials).
- Trials are restricted to the admin-configured **trial plan** when one is set,
  and are disabled entirely when trial length is 0 days.

### 🐛 Billing hardening (found in an adversarial review)
- **Stripe webhooks are now idempotent** — each event id is processed once
  (defeats replay within the signature window and Stripe's own retries/reordering).
- **Webhook state changes are ownership-bound** — cancellations/past-due are
  matched by stored subscription/customer id, never by caller-supplied metadata,
  so a crafted event can't cancel an account it doesn't own.
- **Card recovery works** — added `invoice.payment_succeeded` (clears `past_due`)
  and `customer.subscription.updated` handling.
- **Checkout confirm is safe & idempotent** — only a genuinely *paid* session
  activates a plan (no longer trusts `status: complete` alone), a returned
  session can't be replayed, and the confirm route now requires an active account.
- **No self-serve quota grants** — claiming a free (price-0) plan is blocked in
  `free` mode and is idempotent (can't be looped to reset quota).
- **Deleting a plan** now downgrades members who were on it (no orphaned grants).
- Plan price is clamped to Stripe's max.
- Registered the `trialClaims` / `stripeEvents` DB collections.

## [2.7.2] — 2026-06-23

### 🐛 Fixes
- **Saving a panel theme now actually changes what you see** — even if you have
  a *personal* theme selected. Root cause: a personal theme (Account →
  Appearance) is layered on top of the global theme and wins the CSS cascade for
  that user (by design). So when an admin with a personal theme saved the
  **global** theme, their own view stayed on their personal theme and the save
  looked like it did nothing / reverted (the live preview hid this while editing,
  then revealed the personal theme again on Save).
  - The Admin → Appearance editor now **temporarily suspends your personal
    theme** while you're on that tab, so you preview and save against the true
    global theme. Your personal theme is **restored automatically** when you
    leave the tab — per-user themes keep working everywhere else.
  - A warning is shown in the editor when a personal theme is active.
  - `reloadGlobal()` now re-appends the per-user stylesheet after the global one
    so the global-vs-personal cascade order is deterministic.

## [2.7.1] — 2026-06-23

### 🐛 Fixes
- **Saving a theme no longer flashes back to the base theme.** Clicking *Save*
  (or *Reset*) in Admin → Appearance briefly swapped the global stylesheet's
  `href`, which made the browser drop the current theme while the new one
  downloaded — so the panel snapped to the un-themed base CSS for a moment and
  looked like the save had reverted. The reload is now **double-buffered**: a
  fresh stylesheet is loaded in the background and only swapped in once ready,
  and the live preview is held until then — a seamless transition with no flash.
- Fixed a stale "Nebula" reference in the *Reset theme* dialog (the default is
  now Editorial).

## [2.7.0] — 2026-06-23 — "Editorial"

### 🎨 Editorial look + new default theme
A refined, magazine-style pass over the panel UI. **No routes, behaviour, or
markup structure changed** — every class name and the live-theming contract are
preserved.

- **Serif display headings.** Big page headings (dashboard/server titles, auth,
  legal) are now set in **Instrument Serif** — an elegant editorial serif —
  while the UI body stays **Geist** and data/console stay **Geist Mono**.
- **New default theme: `Editorial`.** A near-black canvas with a single soft
  **cyan** accent. Added as a first-class preset and set as the default; all
  existing presets (Precision, Nebula, Midnight, Aurora, Sunset, Grape, Matrix,
  Crimson, Slate, Cotton) remain selectable and the editor is untouched.
- **Pill chrome.** Buttons are now fully rounded pills; the primary button is a
  theme-adaptive solid (near-white on dark themes, dark on light) for crisp
  contrast on any palette.
- **Cyan section labels.** Uppercase, letter-spaced accent labels.

*Existing installs keep their saved theme; pick **Editorial** in
Admin → Appearance to switch.*

## [2.6.0] — 2026-06-23 — "Precision"

### 🎨 Full front-end redesign — "Precision"
A complete redesign of the panel UI to a clean, restrained operations surface
(Linear / Vercel school). Hairline borders carry the structure, elevation is
flat, motion is calm, and there's a single quiet accent instead of the old
tri-colour glow. **No routes, behaviour, or markup structure changed** — every
class name and the live-theming contract were preserved.

- **New default theme: `Precision`.** Added as a first-class preset (deep
  near-black surfaces, flat panels, one indigo accent) and set as the default
  for new installs. **All existing presets remain** — Nebula, Midnight, Aurora,
  Sunset, Grape, Matrix, Crimson, Slate and Cotton are still selectable, and the
  theme editor is untouched. *Existing installs keep their saved theme; pick
  **Precision** in Admin → Appearance to switch.*
- **New default effects.** Glass/blur is off by default (near-solid surfaces)
  and the corner radius is tighter (12px) for the sharper, flatter look. Both
  remain toggles in the appearance editor.
- **Typography.** Switched to **Geist** (UI + display) and **Geist Mono**
  (data/console) — a precision grotesk system — replacing the previous
  Sora/IBM Plex pairing. Numeric stats keep tabular figures.
- **Components.** Solid buttons (single accent, no gradient), hairline-bordered
  cards with a quiet hover lift, a clean filled active-nav state, bordered
  status pills, a flat 1px-grid backdrop, and a calmer console.

### ♿ Accessibility
- Visible keyboard focus rings retained across buttons, nav, tabs and links.
- `prefers-reduced-motion` fully respected.

## [2.5.0] — 2026-06-23 — "Nebula"

### 🎨 Front-end redesign — "Command Deck"
A full visual overhaul of the panel UI. **No behaviour, routes, or markup
structure changed** — every existing class name and the live-theming contract
were preserved, so all pages and custom admin themes keep working.

- **Real typographic identity.** The UI now ships **Sora** (display/headings),
  **IBM Plex Sans** (body/UI) and **JetBrains Mono** (data, console, addresses)
  via Google Fonts with `font-display: swap` — previously the CSS named Inter
  but fell back to system fonts. Numeric stats now use tabular figures so live
  values stop jittering as they update.
- **Deep-space "Command Deck" look.** Layered nebula background that gently
  breathes, refined glass surfaces (blur + saturation), a single consistent
  elevation/shadow scale, and a hairline "glass lip" on cards and controls.
- **Component polish.** Primary buttons get a gradient + hover light-sweep,
  cards lift with an accent halo, the active nav item has a glowing rail,
  status pills/resource bars use richer gradients, and the console gains subtle
  CRT scanlines.
- **Motion.** Spring-style easing throughout, a staggered page-load reveal, and
  smoother resource-bar fills.

### ♿ Accessibility
- **Visible keyboard focus rings** added across buttons, nav, tabs and links
  (previously focus was only styled on inputs).
- **`prefers-reduced-motion` is now fully respected** — ambient background
  drift/aurora, pulses and transitions are disabled when the OS requests it.

## [2.4.4] — 2026-06-22

### ✨ Profile pictures
- The profile picture now has its **own clearly-labeled card** in Account
  (upload / remove) so it's easy to find.
- The default (no picture) avatar is now a **clean neutral person icon** on a
  muted background instead of the initial-letter-on-gradient.

### 🔒 Avatar upload hardening
- Uploads are validated by **file content (magic bytes)**, not the client-sent
  filename/extension — only real PNG/JPG/GIF/WebP are stored, and the saved
  extension is derived from the verified type. SVG (script-capable) is rejected.
- The stored filename is **fully server-generated** (no part of the client
  filename is used) → no path-traversal surface; combined with the global
  `nosniff` header, stored files can't be served as HTML/script.
- Avatar uploads are **rate-limited** (12/min).
- The admin "edit user" avatar field now only accepts a **same-origin uploaded
  path** (or clear), blocking remote/script URLs and CSS/HTML injection.
- Verified end-to-end on a live instance (real PNG/JPEG accepted; HTML-as-`.png`
  and SVG rejected; admin remote-URL rejected).

## [2.4.3] — 2026-06-22

### 🔒 Security — second-pass audit hardening (R1–R4)
- **Anti-VPN/proxy now requires HTTPS (R1).** The proxy/hosting verdict is a
  security decision, so the ip-api lookup is always made over **https**. The
  free tier is HTTP-only, so without a Pro key the check now **fails open**
  (doesn't block) instead of trusting MITM-spoofable cleartext — with a clear
  warning to add a Pro key. Set it in **Admin → Settings → IP security**.
- **Env values are control-char-safe (R2).** CR/LF and other control characters
  are stripped from server environment values before they're passed to a host
  process or a container `-e KEY=VALUE`, and rejected at input.
- **Single-IP lock canonicalizes addresses (R3).** IPv4-mapped IPv6
  (`::ffff:…`) is unwrapped, zone ids dropped, and IPv6 collapsed to its `/64`
  — so a client's dual-stack / privacy addresses no longer cause false lockouts.
- **Custom egg images are validated (R4).** `egg.docker` must be a real image
  reference (no leading dash, spaces or shell characters), preventing extra
  `docker run` flags from being smuggled via the image field.

## [2.4.2] — 2026-06-22

### 🔒 Security — OCI startup hardening (LOW-1)
- The OCI container backend no longer launches servers through `sh -c`. The
  startup command is tokenized and passed to the container as a **verbatim argv**
  (just like host mode), so shell metacharacters (`;`, `&&`, `$(…)`, backticks)
  in the (owner-editable) startup line are inert — there's no shell to interpret
  them. `--init` still forwards signals to the server process; all built-in eggs
  run unchanged. Blank startup commands are now rejected in both modes.
  Defense-in-depth — the container is still the sandbox. See `AUDIT_LOG.md`.

## [2.4.1] — 2026-06-22

### 🔒 Security — external audit remediation
Fixed every actionable finding from the 2026-06-22 security audit, plus three
issues found while remediating. Full write-up in **`AUDIT_LOG.md`**.

- **SSRF hardening (M1/M2).** New `nettrust.safeFetch()` follows redirects
  **manually and re-validates every hop** against the DNS-aware public-host
  guard. All user-influenced fetches (egg/modpack installers, Modrinth
  downloads, automation webhooks) now use it. Automation webhooks no longer use
  the weaker bespoke regex (which missed CGNAT/IPv4-mapped and DNS-rebind).
- **Stripe webhook replay (M3).** Webhook signatures are now rejected unless the
  signed timestamp is within 300s (matches Stripe's tolerance).
- **Console session revocation (M4).** The console WebSocket re-authorizes
  against **live** user/server records on every action and on a 15s interval —
  password change, demotion, deletion or a revoked subuser grant now ends the
  socket immediately.
- **Backup download authorization (NEW, A2).** The download endpoint now
  requires the `backup` permission, not just server access — closing a path
  where a console-only subuser could download backups.
- **ReDoS mitigation (NEW, A1).** Input fed to user-supplied automation regexes
  is capped (2000 chars) to bound catastrophic-backtracking cost.
- **Admin password reset (NEW, A3).** Now bumps `tokenVersion`, revoking the
  target user's existing sessions (matching the self-service flow).
- **Login enumeration (L2).** Login always runs bcrypt (dummy hash for unknown
  users) so timing can't reveal whether an account exists.
- **Password policy (L3).** Min 8 **and** max 72 bytes (no silent bcrypt
  truncation), enforced on signup, setup, self-service change and admin edit.
- **First-run setup race (L1).** Initial-admin creation is now guarded/atomic.
- **Headers (L4).** Tighter `Permissions-Policy`; `Strict-Transport-Security`
  gains `preload`.
- **Custom CSS (L5).** Admin theme CSS can no longer beacon out — remote
  `url(...)` and `@import` are stripped (relative + `data:` kept).
- **Unsandboxed warning (C1).** Louder boot warning that recommends `CP_OCI=1`;
  when the OCI sandbox is active the (now-incorrect) C1 warning is suppressed.

## [2.4.0] — 2026-06-22

### 🛡️ Added — OCI container sandbox (real isolation for untrusted users)
Servers can now run **inside their own OCI container** instead of as host child
processes — the strongest isolation, closing audit finding **C1** ("anyone can
run a rootkit"). Set **`CP_OCI=1`** (with **Docker** or **Podman** installed) and
every server starts in a container that:
- mounts only its volume at `/home/container` (the panel's data/secrets, the
  host, and other tenants' files are all invisible),
- **drops all Linux capabilities** (`--cap-drop=ALL`) with
  **`--security-opt=no-new-privileges`**,
- enforces a **PID cap** (`CP_OCI_PIDS_LIMIT`, default 512 — fork-bomb guard) and
  hard **memory/CPU** limits derived from the server's plan,
- publishes only its allocated game ports.

Each built-in egg already declares its image (`eclipse-temurin:21-jre`,
`node:lts`, `python:3`, `cm2network/steamcmd`, …), so there's nothing per-server
to set up. Live console, console input, **real CPU/RAM stats** (sampled via the
engine), graceful stop/kill and SFTP all keep working.

### 🔧 Notes
- **Opt-in & loud-on-misconfig** (mirrors `CP_SERVER_UID/GID`): with `CP_OCI=1`
  but no usable engine, servers **refuse to start** rather than silently running
  unsandboxed. Unset `CP_OCI` for the unchanged host-process default.
- `scripts/install.sh` can install Docker and wire the panel user into the
  `docker` group when run with `CP_OCI=1`.
- New `oci.*` config + every `CP_OCI_*` knob (runtime, image fallback, bind IP,
  network, in-container user, read-only rootfs, pull policy, extra args) are
  documented in `.env.example`; full threat model in **SECURITY.md**.
- `/api/health` now reports the active `sandbox` mode (`oci` vs `host`).
- New service `src/services/oci.js`; `src/services/processManager.js` runs the
  container backend when active.

## [2.3.3] — 2026-06-22

### 🛡️ Added — IP security (admin-configurable)
New **IP security** card in **Admin → Settings**, all toggleable:
- **Lock to one IP** — each non-admin account is bound to the first IP it signs
  in from; sign-ins (and reused sessions) from any other IP are blocked
  server-side. Admins can **reset a user's locked IP** from the edit-user dialog.
- **Block VPNs & proxies** — rejects sign-in/sign-up from VPN/proxy IPs via
  **ip-api.com** (keyless free tier, or paste an ip-api **Pro key** for HTTPS).
  Optional **"also block datacenters/hosting"** sub-toggle.
- **Admins are always exempt**; lookups are cached and **fail-open** (an outage
  never locks everyone out); localhost/private IPs are never blocked.

### 🔧 Notes
- These need the **real client IP** — set `CP_TRUST_PROXY` when running behind a
  reverse proxy / tunnel, or everyone will look like the proxy's IP.
- New `security.{singleIp,antiVpn,blockHosting,ipApiKey}` settings + per-user
  `lockedIp` migrate automatically.

## [2.3.2] — 2026-06-21

### ♻️ Changed — economy vs. paid plans
Cleanly separated the two monetization styles:
- **The coin economy is now free-mode only.** When billing is set to **Paid** or
  **Paid + trial**, the entire economy (coins, shop, AFK earning, daily rewards
  and pets) is automatically **disabled** — those features are for the free,
  coin-based model. (`economyEnabled()` now requires `billing.mode === 'free'`.)
- **Plans grant quota only.** Removed the per-plan "bonus coins" — a paid/trial
  plan now grants exactly its **resource quota** (RAM/CPU/disk/servers/backups/
  databases) and nothing else. The coins field is gone from the plan editor and
  plan cards.
- Achievements & XP are unaffected (they're not coin-based) and still work in any
  mode.

## [2.3.1] — 2026-06-21

### 🔒 Added — Plan paywall (not bypassable)
When billing is in **Paid** or **Paid + trial** mode, members must hold an active
plan (or trial) before they can use the panel:
- On login, members **without** a plan hit a full-screen **"Choose a plan"** gate
  (no sidebar) showing your plans — with a **"Start free trial"** button when the
  mode is trial. They can't navigate the panel until they pick one (only "Sign
  out" is available).
- **Server-side enforced too** — `POST /api/servers` now returns **402** for a
  member without a plan, so the gate can't be bypassed by calling the API
  directly. (`/api/auth/me` exposes `needsPlan`.)
- **Admins are exempt** (so they can still configure billing/plans), and **Free**
  mode is unaffected.
- After subscribing (Stripe), starting a trial, or selecting a free plan, the
  gate lifts automatically.

## [2.3.0] — 2026-06-21

### 🚀 Added — Paid plans & real-money billing
A complete, highly-customizable monetization system, all configured in the admin
console (**Admin → Billing**):
- **Three modes:** **Free** (no billing), **Paid** (members must buy a plan), or
  **Paid + free trial** (each member gets one trial, configurable length).
- **Fully custom plans** — name, description, **price** (any currency), interval
  (monthly / yearly / one-time), **resource grant** (RAM/CPU/disk/servers/backups/
  databases), bonus coins, a features list, "featured/popular" flag and
  active/hidden toggle. Full CRUD with a plan editor.
- **Real payments via Stripe** — paste your Stripe keys in the admin console;
  members check out on Stripe-hosted Checkout. Subscriptions **and** one-time
  payments. Activation happens on return (verified server-side) and via a
  **signed webhook** (`/api/billing/webhook`) for renewals/cancellations.
- **Free plans** work with no Stripe setup at all (instant select).
- New member **Plans** page (pricing cards, current-plan banner, trial button)
  appears automatically when billing is enabled.
- On cancellation, quota can **revert to defaults** or **stay** (admin choice).

### 🔒 Notes
- Stripe is called over plain HTTPS — **no new dependency**. Secret keys are
  stored server-side and never echoed back to the browser (admin sees only
  "set"/"not set").
- New `plans` collection + `billing` settings + per-user plan fields migrate
  automatically. Buying/selling real money? Configure Stripe tax/receipts in your
  Stripe dashboard.

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
