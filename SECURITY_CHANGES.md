# Security hardening — consolidated change summary (2026-10-12)

Three code trees were touched. **Nothing is committed, deployed or restarted.**
Use `SECURITY_DEPLOY_CHECKLIST.md` for rollout order. This file is for review.

> **Caution when reading `git diff`:** several of these files already had *your own*
> uncommitted work before this session (e.g. `routes/events.js`, `routes/settings.js`,
> `routes/overtime.js`, `migrations/runner.js`, `version.js`, `src/components/Settings/Settings.jsx`).
> A plain `git diff` mixes both. Review with `git diff -p -- <file>` and look for the
> hunks described below, or `git add -p` only the hunks you want.
> `routes/zktecoApi.js` shows as modified but was **not** touched by me.

---

## 1. `C:\Attendance\ehajiri` (git)

### New files
| File | Purpose |
|---|---|
| `server/utils/secrets.js` | `requireSecret()`; JWT/SSO secrets, no fallbacks, refuses defaults; list of known seeded default passwords |
| `server/utils/licenseVerify.js` | Ed25519 public-key license verification |
| `server/middleware/security.js` | security headers, CORS allow-list, rate limiter, login lockout, JSON size policy, `safeEqual` |
| `server/middleware/validate.js` | `validateBody()` schemas + global `bodySanity` |
| `src/utils/promptPassword.js` | masked password dialog (backup/restore re-auth) |
| `SECURITY_DEPLOY_CHECKLIST.md`, `SECURITY_CHANGES.md` | docs |

### Modified — server core
| File | Change |
|---|---|
| `server/index.js` | securityHeaders, CORS allow-list, tiered JSON limits (1 MB on auth/license/guest/bug-report, 50 MB elsewhere), `bodySanity`, rate limit on `/api/standalone-sync` |
| `server/middleware/authGuard.js` | secrets from `secrets.js`; HS256 pinned; `?token=` only for SSE and disable-able; single-use SSE tickets; **live DB role/active check + `sessions_valid_after` revocation**; single-use SSO `jti` |
| `server/middleware/standaloneSyncTokenGuard.js` | token must be 64 hex |
| `server/migrations/runner.js` | **v155** `users.sessions_valid_after`; **v156** neutralise seeded SYS001/SYS002 default passwords |
| `server/version.js` | `DB_VERSION` 154 → 156 |
| `server/services/emailService.js` | SMTP TLS verification on (opt-out `SMTP_ALLOW_INSECURE_TLS`) |
| `server/package.json`, `package-lock.json` | express chain patched, nodemailer 10.1.0 |
| `server/.env.example` | removed committed DB password; documents required secrets |

### Modified — routes
| File | Change |
|---|---|
| `routes/auth.js` | login throttle + validation; SSO single-use; stream-ticket endpoint; `/users` now needs login; min password 8; password change/reset revoke sessions; refuse known default passwords |
| `routes/license.js` | `LICENSE_SECRET` from env (no literal), timing-safe compare, Ed25519 `EHAJ2-` support, `LICENSE_ALLOW_LEGACY`, `/deactivate` + `/distributor` need internal key or superAdmin |
| `routes/backup.js` | audit log, confined save path on hosted, column-name validation, password re-entry (`/unlock`) |
| `routes/employees.js` | per-record scope guard on identity/official-changes/bio-photo; remarks redaction; `Object.hasOwn` lookups; validation; session revoke on admin reset |
| `routes/overtime.js` | `DELETE /:id` now authorised (was open) |
| `routes/shifts.js` | role gates on create/edit/delete |
| `routes/tasks.js` | followup/reply must belong to task; validation |
| `routes/contacts.js` | `/:id/persons*` follows contact visibility/owner; validation |
| `routes/leaves.js`, `visits.js`, `staffNotes.js`, `messages.js` | request validation |
| `routes/settings.js` | `Object.hasOwn` on list lookup |
| `routes/zkteco.js` | SN format check, per-SN rate limit, optional gateway key |
| `routes/standaloneSync.js` | record cap, SN/PIN validation |
| `routes/bugReports.js`, `events.js`, `guestCheckin.js` | JWT secret import; bug report rate limit + clipping |

### Modified — other
| File | Change |
|---|---|
| `electron/main.cjs` | per-install `JWT_SECRET`/`SSO_SECRET` persisted in userData |
| `.gitignore` | ignores `server/.env.bak-*` |
| `src/api/client.js` | `liveStreamUrl()` ticket helper |
| `src/context/ChatContext.jsx`, `src/components/Notifications/AttendanceToasts.jsx` | use stream tickets |
| `src/components/Common/ProfileTab.jsx` | keep fresh token after password change |
| `src/components/Settings/Settings.jsx` | password prompt before backup/restore |

### Not in git (config)
`server/.env`: rotated `SSO_SECRET`; added `INTERNAL_API_KEY`, `LICENSE_SECRET`, `SEED_ACCOUNT_PASSWORD`.
Backup: `server/.env.bak-2026-10-12T00-33-13-685Z` (contains the **old** secrets — delete once satisfied).

---

## 2. `C:\Attendance\LicenseAdmin` (git)

| File | Change |
|---|---|
| `server/services/secrets.js` (new) | fail-fast secrets |
| `server/services/httpSecurity.js` (new) | headers, CORS, limiter, lockout, body policy |
| `server/services/validate.js` (new) | validation helper |
| `server/services/security.js` | no fallback secrets; SSO tokens get `jti` |
| `server/index.js` | CORS allow-list, headers, tiered limits, credential throttle, cookie `secure` via `COOKIE_SECURE` |
| `server/services/licenseUtils.js` | Ed25519 signer (`issueKey`), required `LICENSE_SECRET`, internal key on tenant calls |
| `server/routes/licenses.js` | issue/verify `EHAJ2-` keys |
| `server/routes/agentGateway.js` | rate limits, size caps, **per-device key** (`/device-key`, `X-Agent-Key`) |
| `server/routes/zktecoGateway.js` | sends `x-internal-key` to tenants |
| `server/routes/auth.js`, `dealerAuth.js` | login validation |
| `server/services/tenantProvision.js` | seed passwords come from `SEED_ACCOUNT_PASSWORD` |
| `server/services/tenantAppManager.js` | strict subdomain check |
| `server/migrations/runner.js` | **v24** `serial_numbers.agent_key_hash` |
| `index.html` | removed embedded HMAC secret; accepts `EHAJ2-` |
| `server/scripts/rotate-license-secret.js`, `migrate-licenses-to-ed25519.js` (new) | license migration tooling (dry-run default) |
| `package.json`, `package-lock.json` | 0 audit findings |
| `.gitignore` | ignores `.env.bak-*` |

Pre-existing, **not mine**: `admin.css`, `dealer.html`, `routes/dealers.js`, `routes/broadcasts.js`,
`routes/serialVerify.js`, `services/liteLicense.js`.
Config (`.env`, not in git): rotated `JWT_SECRET`, new `SSO_SECRET`, `INTERNAL_API_KEY`,
`SEED_ACCOUNT_PASSWORD`, `LICENSE_SIGNING_KEY` (private — back up offline).

---

## 3. `C:\Attendance\StandaloneBridge\Agent` (no git)

`AgentConfig.cs`, `GatewayClient.cs`, `LicenseAdminAuthClient.cs`, `LicenseAdminLoginForm.cs`,
`SettingsForm.cs`, `SyncEngine.cs`, `DeviceControlForm.cs` — per-device key enrolment.
Originals copied to `%TEMP%\agent_bak_*`. Builds clean; **not published**.

---

## 4. Review aids

```powershell
# ehajiri — only the files I created/edited
git -C C:\Attendance\ehajiri diff -- server/middleware server/utils server/routes/auth.js server/routes/license.js
# new-file contents
git -C C:\Attendance\ehajiri status --short | Select-String '\?\?'
# LicenseAdmin
git -C C:\Attendance\LicenseAdmin diff -- server/routes/agentGateway.js server/services
```

Suggested commit split (so a revert is surgical):
1. secrets + fail-fast + .env.example
2. authGuard/session/revocation + migrations v155/v156
3. network hardening (CORS, headers, limits, validation)
4. licensing (Ed25519 + endpoint locks)
5. authorization fixes (IDOR)
6. device ingestion + agent gateway
7. frontend source changes (separate; needs the `dist` build)
8. dependency updates
