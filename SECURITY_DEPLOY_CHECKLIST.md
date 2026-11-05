# Security hardening — deployment checklist (2026-10-12)

Everything below is **edited on disk but not live**. Nothing has been restarted,
and `dist/` has not been rebuilt. Work through this top to bottom.

Related notes: memory file `security_hardening_2026_10_12.md`.

---

## 0. Before you start

- [ ] `.env` backups exist: `ehajiri\server\.env.bak-2026-10-12T00-33-13-685Z`,
      `LicenseAdmin\.env.bak-2026-10-12T00-33-13-685Z`
- [ ] Pre-edit agent sources: `%TEMP%\agent_bak_*` (agent is in `C:\Attendance\StandaloneBridge`, no git)
- [ ] Review `git diff` in `C:\Attendance\ehajiri` — it also contains your own earlier uncommitted work
- [ ] Migration numbers: ehajiri adds **v155** (sessions_valid_after) and **v156** (seed-account passwords), LicenseAdmin adds **v24**. Renumber if you added your own.
- [ ] Pick a quiet window. Each tenant restart runs one additive `ALTER TABLE users ADD COLUMN` (fast).

Required values already in place (verify, don't print):

| File | Keys |
|---|---|
| `ehajiri\server\.env` | `JWT_SECRET`, `SSO_SECRET` (rotated), `LICENSE_SECRET` (legacy value), `INTERNAL_API_KEY` (new) |
| `LicenseAdmin\.env`   | `JWT_SECRET` (rotated), `SSO_SECRET` (= tenants'), `SESSION_SECRET`, `LICENSE_SECRET`, `INTERNAL_API_KEY` (= tenants') |

`SSO_SECRET`, `INTERNAL_API_KEY` and `SEED_ACCOUNT_PASSWORD` **must be identical** in both files.

**Back up `LICENSE_SIGNING_KEY` somewhere offline.** It exists only in `LicenseAdmin.env`; if it is lost no new EHAJ2 keys can be issued (the public half is baked into the tenant code).

## 1. Restart order

1. **LicenseAdminWeb** first (runs migration v24; new `SSO_SECRET`/`JWT_SECRET`).
   - Logs out its admin/mobile sessions once (JWT secret rotated).
   - Check: `GET /api/health` shows `dbVersion: 24`.
2. **eHajiriWeb** (the shared-login hub).
3. **Tenant services, staggered** — `eHajiriTenant_*`, a few at a time.
   Each runs v155. Between batches check health (`dbApplied` = 155).
   Suggested loop (PowerShell, adjust batch/sleep):

   ```powershell
   Get-Service 'eHajiriTenant_*' | ForEach-Object {
     Restart-Service $_.Name -Force
     Start-Sleep -Seconds 8
     $p = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$($_.Name)\Parameters").AppEnvironmentExtra |
          Where-Object { $_ -like 'PORT=*' } | ForEach-Object { $_.Split('=')[1] }
     try { $h = Invoke-RestMethod "http://localhost:$p/api/health" -TimeoutSec 10
           "{0,-45} port {1} db {2}" -f $_.Name, $p, $h.dbApplied }
     catch { "{0,-45} FAILED: {1}" -f $_.Name, $_.Exception.Message }
   }
   ```
   > Per your notes: all these are `node.exe` — never kill by process name, use
   > `Restart-Service`. Before killing anything, check `ParentProcessId`.

4. If a tenant fails to boot, look at its stderr log. The most likely cause is
   `[security] ... is not set` / `known default` — i.e. a secret missing from a `.env`.

### What migration v156 does on each tenant (important — read before restarting)

Every tenant was seeded with SYS001 (superAdmin) and SYS002 (admin) using fixed
passwords that are public in the source. On first boot v156 replaces any of those
two accounts that still hold a default password with `SEED_ACCOUNT_PASSWORD`
(from `.env`, same value on every tenant) — or a random one if unset.
- **Your own password login to those accounts changes** to the `SEED_ACCOUNT_PASSWORD`
  value in `ehajiriserver.env`. "Open Software" SSO from LicenseAdmin is unaffected.
- Login with a known default password is also refused at runtime (403) on hosted
  instances. Desktop (`ELECTRON=true`) and `ALLOW_DEFAULT_PASSWORDS=true` (dev) are exempt.
- LicenseAdmin's "show tenant credentials" now shows `SEED_ACCOUNT_PASSWORD`.

### Dependency updates (package.json / lockfile changed; `node_modules` NOT touched)

`npm audit` fixes were validated in an isolated copy (server booted, login/guard/limits OK):
- `ehajiri/server`: express/body-parser/qs/proxy-addr patched; nodemailer 8 -> 10.1.0.
  8 vulns -> 4 remaining (all `http-proxy-middleware -> micromatch -> braces` ReDoS on
  static glob patterns, no upstream fix, not reachable by user input).
- `LicenseAdmin`: 5 vulns -> **0** (nodemailer 9 -> 10.1.0, express chain).
To activate: with that service group stopped, run `npm ci` in `ehajiriserver` and in
`LicenseAdmin`, then start. Do this in a window — Windows locks loaded files, so don't
run it under live services. Current `node_modules` still run fine (code is compatible with both).
- Not changed (frontend, needs a build): `react-router-dom`/`@remix-run/router`/`brace-expansion`
  have non-breaking fixes; `exceljs`/`uuid` need a major bump; `xlsx` has no fix (prototype
  pollution/ReDoS when parsing a malicious spreadsheet — only admins' own uploads).

### Behaviour changes to expect
- **SMTP TLS is now verified.** It was `rejectUnauthorized:false`. A tenant whose mail server
  has a self-signed/mismatched certificate will fail to send until you set
  `SMTP_ALLOW_INSECURE_TLS=true` (or fix the cert). Test one tenant's "send test email" after restart.
- **Request validation**: login/forgot/reset/change-password, license activate, backup unlock,
  admin reset-password now return 400 for wrong types/oversized fields (e.g. username as an
  object, >200 chars) instead of a 500. Same for leaves/visits/tasks/notes/contacts/messages/
  employee create-edit (ids/dates must be scalars, free text capped generously). If a
  legitimate save ever returns "<field> is too long/invalid", loosen that field's rule in the route's `validateBody(...)`.
- Any JSON body containing `__proto__`/`constructor`/`prototype` keys or nested >24 levels is rejected.

## 2. Smoke tests after restart

- [ ] Log in to one tenant, open Attendance, Leave, Staff Detail (ID cards tab).
- [ ] LicenseAdmin → Tenant Companies → "Open Software" signs in to the tenant (SSO).
- [ ] Reusing the same SSO link a second time is rejected ("already been used").
- [ ] A device punch still arrives (ZKTeco `/iclock` via the gateway).
- [ ] Attendance live toasts still arrive (SSE works with the old `?token=` until step 4).
- [ ] 9 wrong logins for one user → HTTP 429.
- [ ] Settings → Backup still works (password prompt only after step 4).

## 3. Rollback

1. Restore `.env` from the `.bak-*` files (note: that re-opens the SSO/JWT defaults).
2. `git stash` / checkout the previous code in `C:\Attendance\ehajiri`
   and `C:\Attendance\LicenseAdmin`.
3. Restart services in the same order.
   The added columns (`users.sessions_valid_after`, `serial_numbers.agent_key_hash`) are
   harmless to older code — no DB rollback needed.

## 4. Frontend build (needs your approval — it replaces the live `dist/` for ~20 tenants)

Source changes are made; **no build was run**. They are:

- `src/api/client.js` — `liveStreamUrl()` (single-use SSE ticket instead of JWT in URL)
- `src/context/ChatContext.jsx`, `src/components/Notifications/AttendanceToasts.jsx` — use it
- `src/components/Common/ProfileTab.jsx` — keep the fresh token after a password change
  (without this build, a user changing their own password is logged out once)
- `src/utils/promptPassword.js` + `src/components/Settings/Settings.jsx` —
  password prompt before backup / restore

After the build, flip the strict flags in `ehajiri\server\.env` and restart tenants again:

| Flag | Effect | Turn on when |
|---|---|---|
| `ALLOW_QUERY_TOKEN=false` | JWT in `?token=` no longer accepted on the live stream | new `dist` is live |
| `BACKUP_REQUIRE_PASSWORD=true` | backup/save/restore need password re-entry | new `dist` is live |
| `ICLOCK_REQUIRE_GATEWAY_KEY=true` | `/iclock` only accepts calls via the LicenseAdmin gateway | LicenseAdmin restarted with `INTERNAL_API_KEY` |
| `AGENT_GATEWAY_REQUIRE_KEY=true` (LicenseAdmin `.env`) | agent gateway rejects keyless calls | every agent upgraded + signed in |
| `COOKIE_SECURE=true` (LicenseAdmin `.env`) | session cookie `Secure` | site is HTTPS-only |
| `BACKUP_ROOT=<folder>` | allows "save to server folder" on hosted instances, confined to that folder | only if you want that feature |
| `CORS_ORIGINS=https://a,https://b` | extra browser origins | only if a separate origin truly needs API access |

## 5. Agent rollout (ZKTeco Agent)

1. LicenseAdmin restarted (adds `serial_numbers.agent_key_hash`).
2. Build and publish the new agent from `C:\Attendance\StandaloneBridge\Agent`
   (`dotnet build` already succeeds; publish/installer step is yours).
3. Each site: open the agent, **sign in again** — it then enrols each device for a key
   automatically on its next sync.
4. Once all are enrolled, set `AGENT_GATEWAY_REQUIRE_KEY=true`.

## 5b. Ed25519 licensing rollout

Done in code: LicenseAdmin signs new EHAJ keys as `EHAJ2-…` (Ed25519) when
`LICENSE_SIGNING_KEY` is set; tenants verify `EHAJ2-` with the embedded public
key and still accept legacy `EHAJ-` HMAC keys until you turn that off.

1. Restart LicenseAdmin and tenants (new keys then come out as EHAJ2).
2. `node LicenseAdminserverscriptsmigrate-licenses-to-ed25519.js` (dry-run shows
   77 keys, all verifiable) then `--apply` — backs up to `licenses_key_backup_ed25519`.
3. Re-push/renew keys to tenants as needed (activated tenants keep working).
4. When every key in circulation is EHAJ2: set `LICENSE_ALLOW_LEGACY=false` in the
   tenants' `.env`, restart. HMAC forgery is then impossible.
5. Packaged desktop builds from before this change cannot read EHAJ2 — ship an updated
   build first, or leave `LICENSE_ALLOW_LEGACY` unset for them.
Not done: machine-fingerprint binding in the payload; EHLT (Lite) keys remain HMAC.

## 6. Still to do by hand

- [ ] **Rotate the DB password** that was committed in `server/.env.example`
      (`ehajiriPlanetInfosys_db` / user `ehajiri`) — it remains in git history.
      Consider rewriting history or treating it as burned.
- [ ] **Rotate `LICENSE_SECRET`**: set a new value in both `.env` files, run
      `node LicenseAdmin\server\scripts\rotate-license-secret.js` (dry-run first, then
      `--apply`), restart. Do **not** do this while desktop customers still hold
      keys signed with the legacy secret.
- [ ] Validation coverage: auth/license/backup, leaves, visits, tasks (+followups/replies), staff-notes, contacts (+persons), messages and employees create/update now have schemas; a global `bodySanity` guard (prototype-pollution keys, >24 levels deep) covers every /api request. Not yet schema'd: settings lists, attendance/manual postings, overtime, duty roster, events, chat, field-visit, zkteco/standalone admin routes.
- [ ] Enable Dependabot (GitHub repo settings -> Security) — needs your GitHub access.
- [ ] Frontend dependency bump (react-router-dom etc.) with the next `dist` build.
- [ ] Real domain + Let's Encrypt in place of self-signed certs.
- [ ] Remove the legacy `LICENSE_SECRET` literal from the desktop build once it moves to EHAJ2-only.
- [ ] Rotate `SEED_ACCOUNT_PASSWORD` occasionally (change in both `.env`, then reset SYS001/SYS002 per tenant).
