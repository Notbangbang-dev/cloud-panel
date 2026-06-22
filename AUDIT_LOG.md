# Cloud Panel — Security Remediation Audit Log

- **Date:** 2026-06-22
- **Base version:** 2.4.0 → **2.4.1** (security patch); **2.4.2** adds LOW-1;
  **2.4.3** adds the second-pass findings R1–R4; **2.4.4** hardens avatar uploads.
- **Scope:** Remediation of the external "Security & Bug Audit Report" findings
  (C1, M1–M4, L1–L5) **plus** additional issues discovered during remediation,
  and a follow-up hardening of the OCI startup path (LOW-1, v2.4.2).
- **Method:** Source fixes + targeted functional tests (28 assertions) + a live
  boot/health check. No new runtime dependencies were added.

> All server-side outbound-request, auth, session and access-control paths were
> reviewed while implementing the fixes. Every change is opt-in-safe (no default
> behaviour regressed) and was validated (see **Validation** at the end).

---

## 1. Summary

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| M1 | Weak SSRF guard for automation webhooks (DNS-rebind + CGNAT bypass) | Medium | ✅ Fixed |
| M2 | SSRF guard didn't re-validate HTTP redirect targets | Medium | ✅ Fixed |
| M3 | Stripe webhook lacked timestamp tolerance (replay) | Medium | ✅ Fixed |
| M4 | WebSocket console session not revoked on tokenVersion bump | Medium | ✅ Fixed |
| **A2** | **Backup download authorized without the `backup` permission** | **Medium (NEW)** | ✅ Fixed |
| **A1** | **ReDoS via user-supplied automation regex** | **Low–Medium (NEW)** | ✅ Mitigated |
| L1 | First-run setup race condition | Low | ✅ Fixed |
| L2 | Username enumeration via login timing | Low | ✅ Fixed |
| L3 | Weak password policy / silent bcrypt truncation | Low | ✅ Fixed |
| L4 | Minimal Permissions-Policy; HSTS lacked `preload` | Low | ✅ Fixed |
| L5 | Custom CSS permitted remote `url()` / `@import` data-exfil | Low | ✅ Fixed |
| **A3** | **Admin password reset didn't revoke the target's sessions** | **Low (NEW)** | ✅ Fixed |
| C1 | Host RCE by design (unsandboxed eggs) | Critical (accepted) | ✅ Hardened |
| **LOW-1** | **OCI startup ran through `sh -c` with pre-substituted vars** | **Low (v2.4.2)** | ✅ Fixed |
| **R1** | **Anti-VPN/proxy verdict fetched over cleartext HTTP (MITM-spoofable)** | **Low (v2.4.3)** | ✅ Fixed |
| **R2** | **Server env values not stripped of CR/LF control chars** | **Low/DiD (v2.4.3)** | ✅ Fixed |
| **R3** | **Single-IP lock stored raw IP (dual-stack/v4-mapped friction)** | **Info/Low (v2.4.3)** | ✅ Fixed |
| **R4** | **Custom `egg.docker` image reference unvalidated** | **Info (v2.4.3)** | ✅ Fixed |

**New issues found & fixed during remediation: A1, A2, A3. Follow-up: LOW-1, R1–R4.**

---

## 2. Original findings — fixes

### M1 — Automation webhooks now use the canonical DNS-aware SSRF guard
**Was:** `automations.safeWebhook()` validated webhook URLs with a hand-rolled
regex only — no DNS resolution (DNS-rebind bypass) and missing CGNAT
`100.64.0.0/10` and IPv4-mapped IPv6 ranges.

**Fix:**
- `safeWebhook()` now does a fast sync sanity check (`https:` + not
  `nettrust.isObviouslyInternal()`), removing the bespoke regex and its gaps.
- The **authoritative** check moved to delivery time: `notify()` now sends via
  `nettrust.safeFetch()`, which resolves DNS and rejects private results — the
  same guard the installers use — so rebind/CGNAT/v4-mapped are all covered.

**Files:** `src/services/automations.js`.

### M2 — SSRF guard re-validates every redirect hop
**Was:** `nettrust.assertPublicUrl()` validated only the initial URL; `fetch()`
follows 3xx automatically, so a public URL could redirect to
`169.254.169.254` / RFC1918 and was never re-checked.

**Fix:** Added **`nettrust.safeFetch(url, options, { protocols, maxRedirects })`**
which follows redirects manually (`redirect: 'manual'`), resolves each `Location`
(including relative), and re-runs `assertPublicUrl` on every hop (max 5). All
user-influenced fetches now go through it:
- `installers.js` → `fetchJson()` and `download()` (egg installers + `.mrpack`
  file/index URLs).
- `modrinth.js` → `downloadInto()` (plugin/mod jar URLs).
- `automations.js` → `notify()` (webhooks).

**Files:** `src/services/nettrust.js`, `src/services/installers.js`,
`src/services/modrinth.js`, `src/services/automations.js`.

### M3 — Stripe webhook timestamp tolerance (replay protection)
**Was:** `billing.verifyWebhook()` verified the HMAC but never checked the signed
timestamp `t`, so a captured valid webhook could be replayed indefinitely
(re-grant/extend or repeatedly cancel a plan).

**Fix:** Before the HMAC comparison, reject when
`|now − t| > 300s` (matches Stripe's default tolerance) or `t` is non-numeric.

**Files:** `src/services/billing.js`.

### M4 — Console WebSocket re-authorizes against live records
**Was:** The console socket authenticated once at the HTTP upgrade and then
trusted the **cached** user/server captured at connect — so a live console
(command + power) survived password change, demotion, deletion or subuser-grant
revocation until manual disconnect.

**Fix:** Added a `liveContext()` that re-loads the live user + server and checks
identity on **every** action and on a 15s interval:
- token still valid (`tokenVersion` unchanged → catches password change / forced
  logout),
- account still exists and still `canAccessServer`,
- per-action `hasPermission` is evaluated against the **live** records.

On any mismatch the socket is closed (`4001 session-revoked`). Passive viewers
are dropped by the interval check too.

**Files:** `src/ws/console.js`.

---

## 3. New findings discovered during remediation

### A2 (Medium) — Backups downloadable without the `backup` permission *(Broken Access Control)*
**Found while** verifying the ticket flow for M4.

**Issue:** `POST /api/tickets` issues a generic `download`-scoped ticket to **any**
authenticated user with no server/resource scope, and `GET /api/dl/backups/:sid/:bid`
only checked `canAccessServer()` — **not** the `backup` permission. A subuser with
any access to a server (e.g. console-only) could therefore download that server's
backups they were never granted.

**Fix:** The download route now enforces the same authorization as the REST API:
`canAccessServer(user, server) && hasPermission(user, server, 'backup')`.

**Files:** `src/routes/download.js`.

### A1 (Low–Medium) — ReDoS via user-supplied automation regex
**Issue:** Automation rules compile a user-supplied `RegExp` and run it against
every console line. A catastrophic-backtracking pattern (e.g. `(a+)+$`) created
by anyone with the `automation` grant could pin the event loop when matching
console output (CPU DoS).

**Mitigation:** The input fed to user regexes is now capped to **2000 chars**
(`MAX_MATCH_INPUT`) in both the live matcher and the "test against a sample"
endpoint. Backtracking cost grows with input length, so bounding it sharply
limits the worst case. Combined with the existing per-rule cooldown and the fact
that `automation` is a semi-trusted grant, residual risk is low.

*Residual:* This is a mitigation, not elimination — Node has no per-regex
timeout. A future hardening could reject nested-quantifier patterns at creation
or evaluate matches in a worker with a deadline.

**Files:** `src/services/automations.js`.

### A3 (Low) — Admin password reset didn't revoke the target's sessions
**Issue:** Self-service password change bumps `tokenVersion` (revoking other
sessions), but the admin `PATCH /api/admin/users/:id` password path did not —
so resetting a compromised user's password left their existing tokens valid.

**Fix:** The admin password change now also bumps the target's `tokenVersion`,
invalidating their existing sessions (consistent with the self-service flow).

**Files:** `src/routes/admin.js`.

---

## 4. Low-severity findings — fixes

### L1 — Atomic first-run setup
A module-level `creating` guard plus a re-check of `db.needsSetup()` under the
guard prevents concurrent setup POSTs from creating more than one initial admin
(CWE-362). **File:** `src/routes/setup.js`.

### L2 — Constant-time login (no username enumeration)
`auth.checkPassword()` now **always** runs bcrypt — against a fixed `DUMMY_HASH`
when the user (or hash) is missing — and the login route no longer short-circuits
before the comparison. The "no such user" and "wrong password" paths now take
comparable time (CWE-208). **Files:** `src/auth.js`, `src/routes/auth.js`.

### L3 — Centralized password policy + 72-byte cap
New `users.validatePassword()` enforces min 8 chars and **max 72 bytes** (bcrypt
silently ignores bytes beyond 72; longer inputs are now rejected rather than
truncated). Applied at signup/setup (`users.validate`), self-service change
(`PUT /api/account/password`) and admin edit (`PATCH /api/admin/users/:id`).
**Files:** `src/services/users.js`, `src/routes/client.js`, `src/routes/admin.js`.

### L4 — Hardened security headers
`Permissions-Policy` now also denies `payment`, `usb`, `magnetometer`,
`gyroscope`, `accelerometer` and `interest-cohort`; `Strict-Transport-Security`
gained `preload`. **File:** `src/middleware.js`.

### L5 — Custom CSS can't beacon to remote hosts
`sanitizeCustomCss()` now strips `@import` and neutralizes remote `url(...)`
(`http:`, `https:`, protocol-relative `//`) to `url()`, while keeping relative
(`/uploads/...`) and `data:` URLs so legitimate themes still work.
**File:** `src/services/appearance.js`.

---

## 5. C1 (Critical, accepted-by-design) — hardening

Unsandboxed code-capable eggs remain an accepted, documented risk, but the gating
is now louder and integrated with the **OCI container sandbox** (added in v2.4.0):

- The boot warning is far more prominent and now recommends **`CP_OCI=1`**
  (Docker/Podman) as the primary remedy, alongside `CP_SERVER_UID/GID`.
- When the **OCI sandbox is active**, `isolation.init()` recognises that servers
  are already isolated in containers and **suppresses** the (now-incorrect) C1
  warning, logging that container isolation is in effect instead.

**Files:** `src/services/isolation.js` (reads `oci.active()`).

> To fully eliminate C1, run with `CP_OCI=1` (see `SECURITY.md` → *Enabling the
> OCI container sandbox*).

---

## 5b. LOW-1 (v2.4.2) — OCI startup no longer runs through a shell

**Was:** The OCI backend launched servers via `sh -c "exec <cmd>"`, where `<cmd>`
was the startup line with `{{VAR}}` (including owner-editable `server.environment`)
already substituted. Shell metacharacters (`;`, `&&`, `$(…)`, backticks) in that
line were therefore interpreted by the in-container shell. Impact was limited
(it runs inside the cap-dropped, no-new-privileges, single-volume container, and
editing startup is admin-gated), so this was defense-in-depth only.

**Fix:** The startup command is now tokenized (the same `tokenize()` host mode
uses) and passed to the container as a **verbatim argv** (`run … <image>
<program> <args…>`) — there is no `sh -c`, so metacharacters are inert
(handed to `execve` as literal arguments). `--init` (tini) remains PID 1 and
forwards signals. All built-in eggs already run fine as argv in host mode, so no
egg required the shell. An empty/blank startup is now rejected in both modes.

**Files:** `src/services/oci.js` (`buildRunArgs` takes `argv`),
`src/services/processManager.js` (passes `argv: [program, ...args]`).

---

## 5c. R1–R4 (v2.4.3) — second-pass hardening

### R1 — Anti-VPN/proxy lookup forced to HTTPS
**Was:** On the free tier the proxy/hosting verdict (a security decision) and the
client IP were fetched over cleartext `http://ip-api.com`, so an on-path attacker
on the panel's egress could spoof `proxy:false` (bypass) or `proxy:true` (DoS).
**Fix:** The lookup is now always made over **https**. The free tier is HTTP-only,
so without a Pro key the request fails and the control **fails open** (never
trusting cleartext), with a one-time warning to configure a Pro key. Fail-open +
admin-opt-in keep this Low.
**Files:** `src/services/ipguard.js`.

### R2 — Control characters stripped from env values
**Was:** Owner-set environment values became `-e KEY=VALUE` (and host env entries)
without stripping `\n`/`\r`. Argv-injection was already impossible (separate argv
tokens, no shell), but stray control chars are undesirable.
**Fix:** Control chars (`\x00–\x1f`, `\x7f`) are stripped from all env values in
`buildEnv` and again in the OCI `-e` builder, and **rejected at input** (server
create + startup edit) with a clear error.
**Files:** `src/services/processManager.js`, `src/services/oci.js`,
`src/routes/client.js`, `src/services/servers.js`.

### R3 — Single-IP lock canonicalizes the address
**Was:** The lock stored the raw `req.ip`, so IPv4↔IPv6 dual-stack, `::ffff:`
mapping or IPv6 privacy addresses could make one client look like several IPs
(lockout friction / evasion).
**Fix:** New `canonicalIp()` drops zone ids, unwraps IPv4-mapped IPv6, and
collapses IPv6 to its `/64`. Both the stored and incoming values are canonicalized
at compare time (so existing raw locks still match).
**Files:** `src/services/ipguard.js`.

### R4 — Custom egg image reference validated
**Was:** `egg.docker` (admin-set, capped 100 chars) was otherwise unvalidated and
flows onto the `docker run … <image>` line.
**Fix:** `validImageRef()` requires a real image reference — starts alphanumeric,
safe charset only (no leading `-`, spaces, `$`, `;`, control chars) — so the
image field can't smuggle extra `run` flags (e.g. `--privileged`). Admin-only
boundary, so Info; this is defense-in-depth.
**Files:** `src/routes/admin.js`.

---

## 5d. Avatar upload hardening (v2.4.4)

**Context:** A self-service avatar upload already existed but trusted the
client-supplied `?filename=` extension and never inspected the bytes.

**Fixes:**
- **Content sniffing:** `POST /account/avatar` now validates magic bytes (PNG /
  JPEG / GIF / WebP) and derives the stored extension from the verified type;
  SVG and any non-image payload are rejected. With the global `nosniff` header,
  a stored avatar can't be served as HTML/script.
- **Server-generated filenames:** `<userId>-<ts>-<rand>.<verified-ext>` — no part
  of the client filename is used (no path traversal).
- **Rate limit:** 12 uploads/min.
- **Admin field validation:** `PATCH /admin/users/:id` `avatar` only accepts a
  same-origin `/uploads/avatars/…` path (or null), blocking remote/script URLs
  and CSS/HTML injection (the avatar is rendered into an `<img src>` and a CSS
  `url()`).
- **Default avatar** changed from initials-on-gradient to a neutral icon (no
  security impact; product polish).

**Validation:** live instance (isolated data dir) — real PNG/JPEG accepted;
HTML-renamed-`.png` and SVG rejected (400); admin remote-URL avatar stored as
null; valid uploaded path accepted. 8/8 assertions passed.

**Files:** `src/routes/client.js`, `src/routes/admin.js`,
`public/js/pages/account.js`, `public/js/app.js`, `public/js/ui.js`.

---

## 6. Validation

- **Static:** `node --check` on all 16 modified modules — all pass.
- **Module graph:** every changed module + dependents `require()`-load cleanly.
- **Functional (28/28 passed):**
  - nettrust: blocks loopback/CGNAT/v4-mapped/`http:`, allows public; `safeFetch`
    blocks a public→`169.254.169.254` redirect and the initial-URL case, passes
    benign 200s.
  - automation webhooks: reject http/localhost/CGNAT, accept public https.
  - `checkPassword`: null→false, correct→true, wrong→false (always runs bcrypt).
  - `validatePassword`: rejects <8 and >72 bytes; accepts 8 and 72.
  - `sanitizeCustomCss`: neutralizes remote `url()`, drops `@import`, keeps
    relative + `data:`.
  - `verifyWebhook`: accepts fresh signed event, rejects stale (replay) and
    tampered body.
- **Live boot:** panel starts; `/api/health` 200 with new `sandbox` field;
  hardened `Permissions-Policy`/HSTS present; louder C1 warning emitted in host
  mode.

## 7. Files changed

```
src/services/nettrust.js       safeFetch() + docs (M2 core)
src/services/installers.js     fetchJson/download via safeFetch (M2)
src/services/modrinth.js       downloadInto via safeFetch (M2)
src/services/automations.js    webhook guard (M1), redirect-safe notify (M2), ReDoS cap (A1)
src/services/billing.js        webhook timestamp tolerance (M3)
src/ws/console.js              live re-authorization + revoke (M4)
src/routes/download.js         enforce 'backup' permission (A2)
src/routes/setup.js            atomic first-run setup (L1)
src/auth.js                    constant-time checkPassword (L2)
src/routes/auth.js             always run bcrypt on login (L2)
src/services/users.js          validatePassword + 72-byte cap (L3)
src/routes/client.js           password change uses validatePassword (L3)
src/routes/admin.js            password set validated + revokes sessions (L3, A3)
src/middleware.js              Permissions-Policy + HSTS preload (L4)
src/services/appearance.js     custom-CSS url()/@import hardening (L5)
src/services/isolation.js      louder C1 warning + OCI-aware (C1)
```

## 8. Not changed (verified acceptable)

- **I1–I4** (IDOR posture, SQLi, frontend XSS, CSRF) — confirmed sound; the one
  gap in the access-control posture (backup download, A2) is fixed above.
- Discord OAuth `state` is a signed, short-lived nonce but isn't bound to a
  browser cookie (the app is header-token based, no cookies). Login-CSRF via
  OAuth is a known trade-off of cookieless auth; left as-is (informational).
