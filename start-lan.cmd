@echo off
setlocal
cd /d "%~dp0"
title Image2 Studio LAN
node scripts\start-backend.js
if errorlevel 1 pause
