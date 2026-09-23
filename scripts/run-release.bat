@echo off
rem Çift tıklayarak interaktif canlı çıkış işlemini başlatır.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-release.ps1" %*
echo.
pause
