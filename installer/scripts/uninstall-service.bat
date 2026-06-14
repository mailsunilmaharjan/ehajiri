@echo off
set APP_DIR=%~dp0
set SERVICE=eHajiriServer

"%APP_DIR%nssm.exe" stop   %SERVICE%
"%APP_DIR%nssm.exe" remove %SERVICE% confirm

REM Also stop PostgreSQL service (optional - comment out if you want to keep data)
REM net stop postgresql-x64-16

echo Service removed.
