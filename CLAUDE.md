# eHajiri — Developer Guide

हाजिरी व्यवस्थापन प्रणाली | Attendance Management System

---

## Stack

| Layer | Tech | Port |
|---|---|---|
| Frontend | React 18 + Vite | 4000 |
| Backend | Node.js / Express 4 | 5001 |
| Database | PostgreSQL | 5432 |
| Desktop | Electron 31 (packaged with electron-forge) | — |
| ZKTeco ADMS | Express endpoint (push protocol) | 5000 |

---

## Local Development

### 1. Prerequisites
- Node.js 18+
- PostgreSQL running locally (DB: `ehajiri_db`, user: `postgres`)
- Copy `server/.env.example` → `server/.env` and fill in your credentials

### 2. Install dependencies
```bash
npm install
cd server && npm install && cd ..
```

### 3. Run (frontend + backend together)
```bash
npm run dev
```
- Frontend: http://localhost:4000
- API: http://localhost:5001
- ZKTeco ADMS: http://localhost:5000

### 4. Run only one side
```bash
npm run dev:client   # Vite only
npm run dev:server   # Node only
```

---

## Database

- **Host:** localhost:5432
- **Name:** `ehajiri_db`
- **User:** postgres
- **Credentials:** stored in `server/.env` — copy from `server/.env.example` and fill in (never commit `.env`)
- **Schema migrations:** `server/migrations/` — run in order, tracked by version number
- **Seed data:** `npm run seed`

---

## Project Structure

```
ehajiri/
├── src/                  # React frontend (Vite)
│   └── components/       # All UI components
├── server/               # Express backend
│   ├── routes/           # API route handlers
│   ├── middleware/        # Auth, license guard, etc.
│   ├── migrations/        # DB migration files (run in order)
│   ├── services/          # ZKTeco, license, etc.
│   └── index.js           # Server entry point
├── electron/
│   ├── main.cjs          # Electron main process + Velopack auto-updater
│   └── preload.cjs       # Context bridge
├── forge.config.js       # Electron Forge packaging config
├── vite.config.js        # Vite build config
└── CLAUDE.md             # This file
```

---

## ZKTeco Integration

- Devices push attendance data TO the server (ADMS push protocol)
- Endpoint: `POST /iclock/cdata` on port 5000
- Device SN is auto-registered on first connect
- Employee link: `users.device_id` = PIN on the ZKTeco device
- Supported models: M2F, SenseFace, K40 Pro, MB2000, SenseFace 4A/7A
- UI: Settings → "Attendance Device" tab

---

## Release / Deployment

> The app uses **Velopack** for auto-updates. Releases are hosted on:
> **https://github.com/mailsunilmaharjan/ehajiri-releases** (private repo)

### Tools required (one-time setup)
```bash
# .NET SDK 9
winget install Microsoft.DotNet.SDK.9

# vpk CLI
dotnet tool install -g vpk
```

### GitHub credentials
- Repo: `https://github.com/mailsunilmaharjan/ehajiri-releases`
- Token: stored in `.env.deploy` (root of project, never committed — ask repo owner for token)
- Format of `.env.deploy`:
  ```
  GITHUB_TOKEN=ghp_YOUR_TOKEN_HERE
  GITHUB_REPO=https://github.com/mailsunilmaharjan/ehajiri-releases
  ```

### Release a new version (e.g. 1.0.1)

**Step 1 — Download the current live release** (needed for delta generation)
```powershell
vpk download github `
  --repoUrl https://github.com/mailsunilmaharjan/ehajiri-releases `
  --token <GITHUB_TOKEN from .env.deploy> `
  --outputDir .\releases
```

**Step 2 — Build the frontend**
```powershell
npm run build
```

**Step 3 — Package with electron-forge**
```powershell
$env:APP_VERSION = "1.0.1"
npx electron-forge package
```

**Step 4 — Pack with vpk**
```powershell
vpk pack `
  --packId eHajiri `
  --packVersion 1.0.1 `
  --packDir "out\eHajiri-win32-x64" `
  --mainExe "eHajiri.exe" `
  --outputDir .\releases
```

**Step 5 — Upload and publish**
```powershell
vpk upload github `
  --repoUrl https://github.com/mailsunilmaharjan/ehajiri-releases `
  --token <GITHUB_TOKEN from .env.deploy> `
  --outputDir .\releases `
  --publish
```

> Users running any previous version will automatically receive the update
> within 5 seconds of launching the app. They download only the small
> **delta** file, not the full package.

### What gets generated in `.\releases\`
| File | Purpose |
|---|---|
| `eHajiri-{ver}-full.nupkg` | Full update package |
| `eHajiri-{ver}-delta.nupkg` | Delta (incremental) update |
| `eHajiri-win-Setup.exe` | Installer for new users |
| `eHajiri-win-Portable.zip` | Portable build |
| `releases.win.json` | Version manifest (read by auto-updater) |

---

## LicenseAdmin Portal

Separate Node.js app at `d:\ClaudeAi\LicenseAdmin`

- **URL:** http://localhost:3000
- **Default login:** `admin` / *(see `.env.deploy` or ask the repo owner)*
- **DB:** `ehajiri_license` (separate from main DB)
- **Run:** `cd ..\LicenseAdmin && npm run dev`

---

## UI / DataGrid Standards

All data tables use `src/components/DataGrid/DataGrid.jsx`.

| Element | Style |
|---|---|
| Header background | `#efefef` |
| Header text | `#374151` |
| Header border | `2px solid #dedede` (bottom), `1px solid #dedede` (right) |
| Header font | `12px, weight 700` |
| Hover sort | `#e4e4e4` |
| Active sort | `#e0e7f0`, text `#1a56db` |
| Total/summary row | `#f1f5f9`, `borderTop: 2px solid #d1d5db` |
| Present tint | `#f0fdf4` / `#065f46` |
| Absent tint | `#fff5f5` / `#991b1b` |

**Never use dark navy or colored headers.** Always use `#efefef/#374151/#dedede`.

---

## Source Code Repo

- **Repo:** https://github.com/mailsunilmaharjan/ehajiri (private)
- **Releases repo:** https://github.com/mailsunilmaharjan/ehajiri-releases (private)
- To add a developer as collaborator: GitHub → repo → Settings → Collaborators
