@echo off
chcp 65001 >nul
title Installation de Prospecto
cd /d "%~dp0"
echo.
echo  === Installation de Prospecto ===
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js n'est pas installe.
  echo  Telechargez la version LTS sur https://nodejs.org puis relancez ce fichier.
  start https://nodejs.org/fr/download
  pause
  exit /b 1
)
echo  Node.js detecte :
node -v
echo.
echo  Installation des composants (une minute environ)...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo  L'installation a echoue. Verifiez votre connexion internet.
  pause
  exit /b 1
)
echo.
echo  Creation du raccourci sur le bureau...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\creer-raccourci.ps1"
echo.
choice /c ON /m " Lancer Prospecto automatiquement au demarrage de Windows (O/N) ?"
if not errorlevel 2 powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\creer-raccourci.ps1" -Demarrage
echo.
echo  Termine ! Double-cliquez sur l'icone Prospecto de votre bureau.
echo.
choice /c ON /m " Ouvrir Prospecto maintenant (O/N) ?"
if errorlevel 2 exit /b 0
wscript.exe "%~dp0launcher\Prospecto.vbs"
