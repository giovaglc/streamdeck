@echo off
cd /d "%~dp0"
echo Conectando el PC con la cuenta de mama...
python deck_daemon.py --config config-mama.json
pause
