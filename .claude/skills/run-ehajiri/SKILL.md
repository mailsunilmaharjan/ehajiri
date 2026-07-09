---
name: run-ehajiri
description: Build, run, and drive eHajiri TMS (React + Vite frontend, Express/Postgres API). Use when asked to start eHajiri, run the dev servers, take a screenshot of the app, log in, or verify a UI/API change actually works in the running app.
---

eHajiri TMS is a React 18 + Vite frontend talking to an Express API backed by
PostgreSQL (the Electron/Velopack packaging described in the root `CLAUDE.md`
is only for production releases — day-to-day dev is a plain web app). Drive
it with the Playwright driver at
`.claude/skills/run-ehajiri/driver.mjs` — no `chromium-cli` is installed in
this environment, so this script fills that role.

All paths below are relative to the repo root (`d:\Project_Attendance\ehajiri`).

## Prerequisites

- Node.js 18+ (already satisfied in this environment).
- PostgreSQL reachable with the credentials in `server/.env` (DB `ehajiri_db`).
  Confirmed already running locally on port 5432 in this environment; if it
  isn't, start your local Postgres service first — the server will fail to
  boot without it (no embedded-Postgres fallback in dev mode, that's
  production-only).

## Setup

```bash
npm install
cd server && npm install && cd ..
cd .claude/skills/run-ehajiri && npm install && npx playwright install chromium && cd ../../..
```

The last line installs the driver's own Playwright dependency + Chromium —
self-contained inside the skill directory, does not touch the project's own
`package.json`.

## Build

No build step needed to run in dev mode (Vite serves the frontend directly).
`npm run build` (→ `vite build`) only matters for producing the static
`dist/` bundle used by production/Electron packaging — not needed to drive
the app locally.

## Run (agent path)

Start the dev stack (frontend on :4000, API on :5001):

```bash
npm run dev
```

This runs `vite` and `node --watch server/index.js` concurrently and stays
in the foreground — run it with `run_in_background: true` (Bash tool) or in
its own terminal. Wait for the API to answer before driving it:

```bash
curl -s http://localhost:5001/api/health
# {"status":"ok","appVersion":"1.0.8","dbVersion":61,"dbApplied":61,...}
```

Then drive it with the Playwright script:

```bash
node .claude/skills/run-ehajiri/driver.mjs smoke ./smoke-out
```

This logs in as the system admin, then visits Daily Attendance Report and
Role & Permission Management, screenshotting each step and failing loudly
(non-zero exit) if expected content doesn't render. Screenshots land in
`./smoke-out/01-login.png` … `04-role-management.png` (pass any directory as
the argument).

| command | what it does |
|---|---|
| `node driver.mjs smoke [outDir]` | Full login + 3-page nav smoke test, 4 screenshots |
| `node driver.mjs screenshot <path> <out.png>` | Screenshot any route while logged out |
| `node driver.mjs login-screenshot <path> <out.png> [user] [pass]` | Log in, navigate to `<path>`, screenshot |

Env overrides: `BASE_URL` (default `http://localhost:4000`), `HEADLESS=false`
to watch it run.

### Direct invocation (no browser needed)

Most backend-only changes (a route, a migration, a scoping rule) don't need
the browser at all — hit the API directly once the server is up:

```bash
curl -s -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"#28O29@9837"}'
# → { "token": "...", "role": "admin", ... }
```

Use the returned `token` as `Authorization: Bearer <token>` for any other
`/api/*` route. This is faster than the browser path for verifying a single
endpoint (e.g. a new report's scoping logic).

## Run (human path)

`npm run dev` also works for a human: opens nothing automatically, but
http://localhost:4000 in any browser shows the login screen. Ctrl-C stops
both processes.

## Test

No automated test suite exists in this repo (`npm test` is not defined in
either `package.json`). The Playwright smoke driver above is the closest
thing to one — use it to verify changes.

---

## Gotchas

- **The login form's email field silently blocks non-email usernames.** The
  input is `<input type="email">`, so the browser's native validation
  rejects anything without an `@` *before* React's `onSubmit` ever runs — no
  network request, no console error, no exception. The seeded system admin
  account (`username: admin`, from `server/migrations/runner.js` migration
  v21, password `#28O29@9837`) fails this check, so **typing it into the
  on-screen form never works**, no matter how you fill the fields
  (`.fill()`, `.pressSequentially()`, `Enter`, even calling
  `form.requestSubmit()` directly all no-op silently). The driver's `login()`
  sidesteps this by calling `POST /api/auth/login` directly and injecting
  the response into `localStorage` (`auth_token` + `current_user` — see
  `src/api/client.js` and `src/context/AuthContext.jsx`) before navigating
  to `/dashboard`. If you need to test the *actual login form UI*, use an
  account whose username is a real email address instead.
- **`/api/*` calls return 401 or ECONNREFUSED noise on every page load even
  when nothing is wrong.** `DataContext` eagerly fetches `/api/employees`,
  `/api/leaves`, etc. on mount regardless of auth state, and there's an
  unrelated `advertisement` widget that always tries `localhost:3000` (a
  separate LicenseAdmin service, not part of this unit) and fails with
  `ERR_CONNECTION_REFUSED` if that's not running. Both are expected noise —
  don't treat them as smoke-test failures.
- **Stale dev-server processes accumulate across sessions.** This
  environment already had a `vite` + `node server/index.js` pair listening
  on :4000/:5001 from an earlier session when this skill was built — check
  with `Get-NetTCPConnection -LocalPort 4000,5001 -State Listen` (or
  `lsof -i :4000,:5001` outside Windows) before assuming you need to start
  a fresh one.

## Troubleshooting

- **`npx playwright install chromium` prints nothing and exits 0**: this is
  normal — it silently no-ops if the browser is already cached at
  `~/AppData/Local/ms-playwright/`. Verify with
  `ls ~/AppData/Local/ms-playwright/` (Windows) rather than trusting stdout.
- **`page.waitForURL(/dashboard/)` times out after a "successful" login
  click**: see the login-form Gotcha above — you likely typed a non-email
  username into the on-screen form. Switch to the API-login-and-inject
  approach the driver uses.
