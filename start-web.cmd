@echo off
setlocal
cd /d "%~dp0"

if "%MEGLE_WEB_URL%"=="" set "MEGLE_WEB_URL=http://127.0.0.1:5173"

echo Starting Megle Web on %MEGLE_WEB_URL%
npm --workspace @megle/web run dev -- --host 127.0.0.1 --port 5173 --strictPort
