@echo off
REM ── Manual/foreground launcher for the eHajiri backend ──
REM The installed app normally runs as a Windows Service (see install-service.bat),
REM which supplies its own environment. This script is only for troubleshooting —
REM it runs the server in a visible console window so you can read startup errors.
REM It picks up configuration from server\.env (same file the service-less server reads).

set APP_DIR=%~dp0
cd /d "%APP_DIR%"

echo Stopping the eHajiriServer service (if running) so the port is free...
"%APP_DIR%nssm.exe" stop eHajiriServer >nul 2>&1

echo Starting eHajiri server in foreground — press Ctrl+C to stop.
"%APP_DIR%node\node.exe" "%APP_DIR%server\index.js"

pause
