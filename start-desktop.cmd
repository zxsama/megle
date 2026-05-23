@echo off
setlocal
cd /d "%~dp0"

if "%MEGLE_WEB_URL%"=="" set "MEGLE_WEB_URL=http://127.0.0.1:5173"

echo Starting Megle Desktop with Web at %MEGLE_WEB_URL%
npm run dev
