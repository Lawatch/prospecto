#!/bin/bash
# Installation de Prospecto sur macOS : double-cliquez sur ce fichier.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé. Téléchargez la version LTS sur https://nodejs.org puis relancez ce fichier."
  open "https://nodejs.org/fr/download"
  read -r -p "Appuyez sur Entrée pour fermer."
  exit 1
fi
echo "Installation des composants…"
npm install --omit=dev --no-audit --no-fund || { echo "Échec de l'installation."; exit 1; }
APP="$HOME/Desktop/Prospecto.command"
cat > "$APP" <<LAUNCH
#!/bin/bash
cd "$(pwd)" && node launcher/launcher.js
osascript -e 'tell application "Terminal" to close (every window whose name contains "Prospecto.command")' >/dev/null 2>&1 &
exit 0
LAUNCH
chmod +x "$APP"
echo "Terminé : un raccourci « Prospecto » a été créé sur le bureau."
node launcher/launcher.js
