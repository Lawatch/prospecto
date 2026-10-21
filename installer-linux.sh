#!/bin/bash
# Installation de Prospecto sous Linux (crée une entrée de menu et un raccourci de bureau).
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Installez Node.js 22 ou plus récent (https://nodejs.org)"; exit 1; }
npm install --omit=dev --no-audit --no-fund
DESKTOP_FILE="$HOME/.local/share/applications/prospecto.desktop"
mkdir -p "$(dirname "$DESKTOP_FILE")"
cat > "$DESKTOP_FILE" <<EOD
[Desktop Entry]
Type=Application
Name=Prospecto
Comment=Prospection et candidatures spontanées
Exec=node "$(pwd)/launcher/launcher.js"
Icon=$(pwd)/public/favicon.svg
Terminal=false
Categories=Office;
EOD
[ -d "$HOME/Desktop" ] && cp "$DESKTOP_FILE" "$HOME/Desktop/" && chmod +x "$HOME/Desktop/prospecto.desktop"
echo "Prospecto est installé. Lancez-le depuis le menu ou le bureau."
