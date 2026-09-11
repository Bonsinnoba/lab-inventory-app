@echo off
setlocal
set "ROOT=%~dp0..\.."
set "BACKUP=%ROOT%\backups"
if not exist "%BACKUP%" mkdir "%BACKUP%"
for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set "D=%%c-%%a-%%b"
for /f "tokens=1-2 delims=: " %%a in ("%time%") do set "T=%%a%%b"
set "OUT=%BACKUP%\labos-backup-%D%-%T%"
mkdir "%OUT%"
echo This script assumes PostgreSQL client tools are installed.
if not defined DATABASE_URL (echo Set DATABASE_URL first.& exit /b 1)
pg_dump --format=custom --no-owner --no-acl --file="%OUT%\labos-postgres.dump" "%DATABASE_URL%"
if errorlevel 1 exit /b 1
echo Database backup complete: %OUT%\labos-postgres.dump
echo Back up the backend storage directory alongside this dump.
pause
