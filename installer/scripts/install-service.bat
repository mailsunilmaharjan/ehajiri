@echo off
REM ── Register eHajiri backend as a Windows Service using NSSM ──
REM NSSM (Non-Sucking Service Manager) restarts the process automatically if it crashes

set APP_DIR=%~dp0
REM %~dp0 always ends in a backslash. Quoting it directly as "%APP_DIR%" makes the
REM trailing \" sequence collapse into a single literal quote character (Windows
REM command-line quoting rules), corrupting the path NSSM stores (e.g. it becomes
REM `C:\Program Files\eHajiri"` — an invalid directory). Strip the trailing slash
REM with %APP_DIR:~0,-1% whenever the value needs to be passed as a quoted argument.
set APP_DIR_NOSLASH=%APP_DIR:~0,-1%
set NODE=%APP_DIR%node\node.exe
set SCRIPT=%APP_DIR%server\index.js
set SERVICE=eHajiriServer
set LOG_DIR=%APP_DIR%logs

REM Set by setup.iss: "bundled" when this installer's own PostgreSQL was installed
REM (so the ehajiri/<DB_PASS> credentials created by setup-db.js are valid), or
REM "existing" when a pre-existing PostgreSQL server was detected and the bundled
REM install was skipped — in that case the admin's own server\.env credentials must
REM be used, so we must NOT inject DB_* values here (they would silently override
REM the .env file, since dotenv does not override variables already in the
REM process environment).
set PG_MODE=%~1
if /I not "%PG_MODE%"=="bundled" set PG_MODE=existing

REM DB_PASS is stored base64-encoded so the plaintext isn't visible to anyone
REM opening this file in a text editor. Decoded at run time via PowerShell
REM (built into Windows) before being handed to NSSM.
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('RWhAamlyaTIwMjYhQFBsQG5FIWlOZk9zWVM='))"`) do set "DB_PASS_DEC=%%P"

REM Remove old service if exists
"%APP_DIR%nssm.exe" stop   %SERVICE% 2>nul
"%APP_DIR%nssm.exe" remove %SERVICE% confirm 2>nul

REM Install service
REM NOTE: Pass only the program here. NSSM stores whatever follows as
REM AppParameters verbatim (stripping the quotes cmd.exe used to delimit the
REM argument) and does NOT re-quote it when building the final command line —
REM so a path containing spaces (e.g. "C:\Program Files\...") would reach
REM node.exe unquoted and get split at the space, producing
REM "Cannot find module 'C:\Program'". Set AppParameters explicitly below with
REM literal embedded quotes (\"...\") so NSSM stores — and later replays — the
REM value WITH quotes around it.
"%APP_DIR%nssm.exe" install %SERVICE% "%NODE%"
"%APP_DIR%nssm.exe" set %SERVICE% AppParameters "\"%SCRIPT%\""

REM Configure service
"%APP_DIR%nssm.exe" set %SERVICE% AppDirectory      "%APP_DIR_NOSLASH%"
if /I "%PG_MODE%"=="bundled" (
  "%APP_DIR%nssm.exe" set %SERVICE% AppEnvironmentExtra "NODE_ENV=production" "PORT=5000" "DB_HOST=localhost" "DB_PORT=5432" "DB_NAME=ehajiriPlanetInfosys_db" "DB_USER=ehajiri" "DB_PASS=%DB_PASS_DEC%" "UPDATE_SERVER_URL=https://updates.ehajiri.com"
) else (
  "%APP_DIR%nssm.exe" set %SERVICE% AppEnvironmentExtra "NODE_ENV=production" "PORT=5000" "UPDATE_SERVER_URL=https://updates.ehajiri.com"
)
"%APP_DIR%nssm.exe" set %SERVICE% AppStdout         "%LOG_DIR%\server.log"
"%APP_DIR%nssm.exe" set %SERVICE% AppStderr         "%LOG_DIR%\server-error.log"
"%APP_DIR%nssm.exe" set %SERVICE% AppRotateFiles    1
"%APP_DIR%nssm.exe" set %SERVICE% AppRotateBytes    5242880
"%APP_DIR%nssm.exe" set %SERVICE% Start             SERVICE_AUTO_START
"%APP_DIR%nssm.exe" set %SERVICE% DisplayName       "eHajiri TMS Server"
"%APP_DIR%nssm.exe" set %SERVICE% Description       "eHajiri Attendance Management System - API Backend"
"%APP_DIR%nssm.exe" set %SERVICE% ObjectName        LocalSystem

echo Service installed successfully.
