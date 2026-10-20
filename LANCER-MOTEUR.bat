@echo off
rem LexOS - Moteur d interface portable (Windows)
cd /d "%~dp0"
where py >nul 2>nul && (py -3 "MOTEUR-INTERFACE\moteur.py" %* & goto fin)
where python >nul 2>nul && (python "MOTEUR-INTERFACE\moteur.py" %* & goto fin)
echo Python 3 est requis sur ce PC : https://www.python.org/downloads/
:fin
pause
