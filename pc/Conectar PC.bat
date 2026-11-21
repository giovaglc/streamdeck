@echo off
cd /d "%~dp0"
echo Conectando el PC con la Stream Deck...
python deck_daemon.py
pause
