# 🤖 Udemy Business Auto-Player

Bot qui lance automatiquement les vidéos Udemy Business en arrière-plan sur un VPS, avec planning horaire et monitoring à distance.

## Fonctionnalités

- **Login automatique** sur Udemy Business (email + mot de passe)
- **Autoplay** - lance la première vidéo, Udemy enchaîne les suivantes
- **Multi-cours** - enchaîne automatiquement plusieurs cours
- **Planning horaire** - tourne uniquement sur des plages définies (supporte les plages de nuit type 22h→4h)
- **Anti-détection** - `puppeteer-extra-plugin-stealth` pour passer les protections Cloudflare
- **Monitoring web** - dashboard accessible depuis mobile avec Basic Auth, screenshot en direct et logs
- **Auto-retry** - gère les erreurs serveur et les blocages temporaires

## Prérequis

- Un VPS Ubuntu (recommandé 2 Go RAM)
- Un compte Udemy Business

## Installation

```bash
# Cloner le repo
git clone https://github.com/MaksY18/udemy-autopilot.git
cd udemy-autopilot

# Configurer
cp .env.example .env
nano .env  # Remplir avec tes identifiants

# Installer les dépendances et lancer
chmod +x setup.sh
bash setup.sh

# Démarrer le bot
pm2 start index.js --name udemy
```

## Configuration (.env)

```env
# Identifiants Udemy Business
UDEMY_EMAIL=prenom.nom@example.com
UDEMY_PASSWORD=secret

# Planning (heure de Paris) - supprimer pour tourner 24/7
SCHEDULE_START=22:00
SCHEDULE_END=04:00
TIMEZONE=Europe/Paris

# Dashboard de monitoring (login: admin / mot de passe)
MONITOR_PORT=3000
MONITOR_PASSWORD=un-mot-de-passe-solide

# Cours à enchaîner (dans l'ordre)
COURSE_URL_1=https://xxx.udemy.com/course/.../learn/lecture/...
COURSE_URL_2=https://xxx.udemy.com/course/.../learn/lecture/...
```

## Monitoring

Depuis un navigateur (mobile ou desktop) :

```
http://<IP_DU_VPS>:3000
```

Login : `admin` / ton `MONITOR_PASSWORD`.

Le dashboard affiche l'état du bot (actif/pause), le planning, le dernier screenshot du navigateur headless et les logs récents.

## Commandes utiles

| Commande            | Description                    |
| ------------------- | ------------------------------ |
| `pm2 logs udemy`    | Logs en temps réel             |
| `pm2 status`        | Statut du bot                  |
| `pm2 restart udemy` | Relancer (après modif du .env) |
| `pm2 stop udemy`    | Arrêter le bot                 |

## Stack

- [Puppeteer](https://pptr.dev/) + [puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)
- Node.js
- PM2 (process manager)

