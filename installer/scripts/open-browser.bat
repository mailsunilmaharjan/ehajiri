@echo off
REM Wait 3 seconds for server to be ready, then open browser
timeout /t 3 /nobreak >nul
start "" "http://localhost:5000"
