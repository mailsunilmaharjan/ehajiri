@echo off
REM ── Repairs the eHajiriServer Windows service if it's stuck in a crash ──
REM ── loop ("Cannot find module 'C:\Program'" in logs\server-error.log), ──
REM ── caused by an unquoted "C:\Program Files\..." path reaching node.exe.──
REM Run this AS ADMINISTRATOR (right-click -> "Run as administrator") --
REM modifying a Windows service requires elevation.

set APP_DIR=%~dp0
set NSSM=%APP_DIR%nssm.exe
set SCRIPT=%APP_DIR%server\index.js
set SERVICE=eHajiriServer

echo Stopping %SERVICE%...
"%NSSM%" stop %SERVICE%

echo Re-pointing AppParameters to a properly quoted script path...
REM NSSM stores AppParameters verbatim and does not re-quote it when building
REM the final command line, so a path with spaces must be stored WITH its
REM surrounding quotes already embedded (\"...\" below achieves that).
"%NSSM%" set %SERVICE% AppParameters "\"%SCRIPT%\""

echo Starting %SERVICE%...
"%NSSM%" start %SERVICE%

echo.
echo Done. Current AppParameters value:
"%NSSM%" get %SERVICE% AppParameters
echo.
echo If the service is now "Running", open http://localhost:5000 in your browser.
pause
