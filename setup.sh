#!/bin/bash
# === Setup script pour le droplet ===
# Lancer avec: bash setup.sh

set -e

echo "📦 Mise à jour système..."
apt update && apt upgrade -y

echo "📦 Installation des dépendances Chromium..."
apt install -y \
  ca-certificates fonts-liberation libappindicator3-1 libasound2t64 \
  libatk-bridge2.0-0t64 libatk1.0-0t64 libcups2t64 libdbus-1-3 \
  libdrm2 libgbm1 libgtk-3-0t64 libnspr4 libnss3 libx11-xcb1 \
  libxcomposite1 libxdamage1 libxrandr2 xdg-utils wget curl

echo "📦 Installation Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

echo "📦 Installation des packages npm..."
cd /root/udemy-bot
npm install

echo "📦 Installation de pm2..."
npm install -g pm2

echo "🔓 Ouverture du port monitoring..."
ufw allow 3000/tcp 2>/dev/null || true

echo "✅ Setup terminé ! Configure .env puis lance avec: pm2 start index.js --name udemy"
