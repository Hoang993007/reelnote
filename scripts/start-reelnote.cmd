@echo off
rem Starts Reelnote (http://localhost:3900) in this window. Closing the window stops it.
rem Build first: pnpm build (first-run.ps1 does it).
title Reelnote
cd /d "%~dp0.."
call pnpm start
rem Only reached when the server stopped by itself: keep its last lines on screen.
pause
