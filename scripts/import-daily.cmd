@echo off
REM Daily import, for Windows Task Scheduler.
REM
REM A .cmd wrapper rather than putting the command straight into the task:
REM schtasks mangles nested quotes, and the node path contains a space.
REM
REM Requires a cached Spotify refresh token. Seed it once by running an import
REM interactively; after that this needs no browser and no person.
REM
REM Logs append to logs\import.log so a run that fails overnight leaves evidence.

cd /d "%~dp0.."
if not exist "logs" mkdir "logs"

echo. >> logs\import.log
"C:\Program Files\nodejs\node.exe" scripts\import-daily.mjs >> logs\import.log 2>&1

REM 75 means the daily quota ran out, which is expected and not a failure.
if %ERRORLEVEL%==75 exit /b 0
exit /b %ERRORLEVEL%
