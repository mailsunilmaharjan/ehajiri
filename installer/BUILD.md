# How to Build the eHajiri Windows Installer

## One-time Setup (do these once)

### 1. Install Inno Setup 6
Download from: https://jrsoftware.org/isdl.php

### 2. Download dependencies into installer/deps/
```
installer/deps/
  nssm.exe          ← https://nssm.cc/download  (nssm-2.24/win64/nssm.exe)
  pg-setup.exe      ← https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
                      (PostgreSQL 16 Windows x64 installer)
  node/             ← https://nodejs.org/dist/v22.x.x/node-v22.x.x-win-x64.zip
                      Extract the ZIP contents here (node.exe, npm, node_modules/)
```

### 3. Create installer/assets/
- `icon.ico`      — Your app icon (256x256 ICO)
- `eHajiri.exe`   — Simple launcher EXE (see below)

#### Creating eHajiri.exe (the launcher that opens browser)
Use this AutoHotkey script compiled to EXE:
```autohotkey
Run, http://localhost:5000
ExitApp
```
Or use any URL-opener EXE or a simple Go/C# program.

---

## Every Release — Build Steps

```batch
REM 1. Build frontend
cd d:\ClaudeAi\ehajiri
npm run build

REM 2. Set version in server\version.js
REM    Bump APP_VERSION to new version (e.g. "1.1.0")

REM 3. Compile installer
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\setup.iss

REM 4. Output: dist-installer\eHajiri-Setup-v1.1.0.exe
```

---

## Update Package for Auto-Update (separate from full installer)

For clients who already have it installed, you only need to distribute:
- `server/` folder (new backend code)
- `dist/` folder (new frontend build)
- New migration files in `server/migrations/`

```batch
REM Create update ZIP
powershell Compress-Archive -Path server,dist,package.json -DestinationPath releases\v1.1.0.zip -Force

REM Get SHA256 checksum
powershell (Get-FileHash releases\v1.1.0.zip -Algorithm SHA256).Hash
```

Then update your update server's `version.json`:
```json
{
  "version": "1.1.0",
  "releaseDate": "2026-06-03",
  "downloadUrl": "https://updates.ehajiri.com/releases/v1.1.0.zip",
  "checksum": "abc123...(SHA256 hash)",
  "minVersion": "1.0.0",
  "changelog": [
    "Fixed leave balance display",
    "Fixed date comparison in attendance reports",
    "Added auto-update system"
  ]
}
```

---

## Production .env (written to {app}/ by installer)

```env
NODE_ENV=production
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ehajiriPlanetInfosys_db
DB_USER=ehajiri
DB_PASS=Eh@jiri2026!@Pl@nE!iNfOsYS
UPDATE_SERVER_URL=https://updates.ehajiri.com
```

---

## Folder Structure After Install

```
C:\Program Files\eHajiri\
  ├── node\              ← portable Node.js (no system install)
  ├── server\            ← Express backend
  ├── dist\              ← Vite build (served by Express)
  ├── data\              ← NOT here — PostgreSQL data in its own install
  ├── logs\
  │     server.log
  │     server-error.log
  ├── backups\           ← auto-backups before updates
  ├── nssm.exe
  ├── eHajiri.exe        ← opens http://localhost:5000
  ├── .env
  └── package.json
```
