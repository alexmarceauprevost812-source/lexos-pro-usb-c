@echo off
rem ─────────────────────────────────────────────────────────────────────────
rem  LexOS IA — active les IA locales de la clé USB-C en un clic (Windows)
rem  Usage : ACTIVER-IA.bat [chat|codex|codexterminal|modeles|textes]
rem ─────────────────────────────────────────────────────────────────────────
chcp 65001 >nul
setlocal
set "ICI=%~dp0"
set "OLLAMA=%ICI%ia\ollama-windows\ollama.exe"
set "OLLAMA_MODELS=%ICI%ia\modeles"
title LexOS IA

if not exist "%OLLAMA%" (
  echo Le moteur IA Windows n'est pas sur la cle.
  echo Prepare la cle avec :  bash usb/installer-sur-cle.sh CHEMIN_DE_LA_CLE --windows
  pause
  exit /b 1
)

rem Python : py (lanceur officiel) ou python
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY (
  echo Python 3 est requis : https://www.python.org/downloads/
  pause
  exit /b 1
)

rem Port 11434, ou 11435 si un Ollama tourne deja sur ce PC
set "PORT=11434"
powershell -NoProfile -Command "try{(New-Object Net.Sockets.TcpClient('127.0.0.1',11434)).Close();exit 0}catch{exit 1}" && set "PORT=11435"
set "OLLAMA_HOST=127.0.0.1:%PORT%"
set "LEXOS_IA_HOTE=127.0.0.1:%PORT%"

echo Activation des IA de la cle...
for /f %%p in ('powershell -NoProfile -Command "(Start-Process -FilePath $env:OLLAMA -ArgumentList 'serve' -WindowStyle Hidden -PassThru).Id"') do set "PID=%%p"

powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){try{(New-Object Net.Sockets.TcpClient('127.0.0.1',%PORT%)).Close();exit 0}catch{Start-Sleep -Milliseconds 500}};exit 1"
if errorlevel 1 (
  echo Le moteur IA n'a pas demarre.
  goto fin
)
echo Pret.

cd /d "%USERPROFILE%"
if /i "%~1"=="textes" (
  %PY% "%ICI%apps\lexos_textes.py"
) else (
  %PY% "%ICI%lexos_ia.py" %*
)

:fin
if defined PID taskkill /pid %PID% /t /f >nul 2>&1
endlocal
