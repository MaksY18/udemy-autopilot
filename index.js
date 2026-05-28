require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
const fs = require("fs");
const path = require("path");
const http = require("http");

const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR);

const TIMEZONE = process.env.TIMEZONE || "Europe/Paris";
const MONITOR_PORT = parseInt(process.env.MONITOR_PORT || "3000");
const MONITOR_PASSWORD = process.env.MONITOR_PASSWORD || "udemy123";

// Buffer des derniers logs
const logBuffer = [];
const MAX_LOGS = 100;

const log = (msg) => {
  const time = new Date().toLocaleTimeString("fr-FR", { timeZone: TIMEZONE });
  const line = `[${time}] ${msg}`;
  console.log(line);
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// === SERVEUR DE MONITORING (accessible depuis le tel) ===
let botStatus = { state: "starting", course: "-", lastCheck: "-" };

function startMonitorServer() {
  const expectedAuth = "Basic " + Buffer.from(`admin:${MONITOR_PASSWORD}`).toString("base64");

  http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${MONITOR_PORT}`);

    // HTTP Basic Auth
    if (req.headers.authorization !== expectedAuth) {
      res.writeHead(401, {
        "Content-Type": "text/html",
        "WWW-Authenticate": 'Basic realm="Udemy Bot Monitor"',
      });
      res.end("<h1>🔒 Authentification requise</h1>");
      return;
    }

    // Route : dernier screenshot
    if (url.pathname === "/screenshot") {
      const files = fs.readdirSync(SCREENSHOTS_DIR).sort();
      if (files.length === 0) {
        res.writeHead(404);
        res.end("Pas encore de screenshot");
        return;
      }
      const latest = path.join(SCREENSHOTS_DIR, files[files.length - 1]);
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(fs.readFileSync(latest));
      return;
    }

    // Route : page de monitoring
    const { hour, minute } = getNowInTimezone();
    const now = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const active = isWithinSchedule();

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Udemy Bot</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; padding: 16px; }
    h1 { font-size: 20px; margin-bottom: 12px; }
    .status { padding: 12px; border-radius: 8px; margin-bottom: 12px;
      background: ${active ? "#1a3a1a" : "#3a2a1a"}; border: 1px solid ${active ? "#2d5a2d" : "#5a3d1a"}; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 13px; font-weight: 600;
      background: ${active ? "#22c55e" : "#f59e0b"}; color: #000; }
    .info { font-size: 14px; color: #aaa; margin-top: 6px; }
    img { width: 100%; border-radius: 8px; margin: 12px 0; border: 1px solid #333; }
    .logs { background: #1a1a1a; border-radius: 8px; padding: 12px; font-family: monospace;
      font-size: 11px; max-height: 400px; overflow-y: auto; line-height: 1.6; border: 1px solid #333; }
    .refresh { display: block; width: 100%; padding: 12px; margin-top: 12px; border-radius: 8px;
      background: #7c3aed; color: white; border: none; font-size: 16px; cursor: pointer; }
  </style>
</head><body>
  <h1>📺 Udemy Bot Monitor</h1>
  <div class="status">
    <span class="badge">${active ? "▶ ACTIF" : "⏸ PAUSE"}</span>
    <div class="info">Heure: ${now} (${TIMEZONE})</div>
    <div class="info">Planning: ${process.env.SCHEDULE_START || "∞"} → ${process.env.SCHEDULE_END || "∞"}</div>
    <div class="info">État: ${botStatus.state} | Cours: ${botStatus.course}</div>
  </div>
  <h2 style="font-size:16px;margin-bottom:8px">📸 Dernier screenshot</h2>
  <img src="/screenshot" alt="screenshot">
  <h2 style="font-size:16px;margin:12px 0 8px">📋 Logs récents</h2>
  <div class="logs">${logBuffer.slice(-30).map(l => l.replace(/</g, "&lt;").replace(/>/g, "&gt;")).join("<br>")}</div>
  <button class="refresh" onclick="location.reload()">🔄 Rafraîchir</button>
</body></html>`);
  }).listen(MONITOR_PORT, () => {
    log(`📱 Monitoring dispo sur http://<IP_DROPLET>:${MONITOR_PORT} (login: admin / ${MONITOR_PASSWORD})`);
  });
}

// Liste des cours depuis .env
function getCourseUrls() {
  const urls = [];
  if (process.env.COURSE_URL) urls.push(process.env.COURSE_URL);
  for (let i = 1; i <= 20; i++) {
    const url = process.env[`COURSE_URL_${i}`];
    if (url) urls.push(url);
  }
  return [...new Set(urls)];
}

// === PLANNING ===
function getNowInTimezone() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour").value);
  const minute = parseInt(parts.find((p) => p.type === "minute").value);
  return { hour, minute, totalMinutes: hour * 60 + minute };
}

function isWithinSchedule() {
  const start = process.env.SCHEDULE_START; // ex: "09:00" ou "22:00"
  const end = process.env.SCHEDULE_END;     // ex: "15:00" ou "02:00"

  // Pas de planning = toujours actif
  if (!start || !end) return true;

  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;

  const { totalMinutes } = getNowInTimezone();

  // Plage qui passe minuit (ex: 22:00 → 02:00)
  if (startTotal > endTotal) {
    return totalMinutes >= startTotal || totalMinutes < endTotal;
  }
  // Plage normale (ex: 09:00 → 15:00)
  return totalMinutes >= startTotal && totalMinutes < endTotal;
}

function minutesUntilScheduleStart() {
  const start = process.env.SCHEDULE_START;
  if (!start) return 0;
  const [startH, startM] = start.split(":").map(Number);
  const startTotal = startH * 60 + startM;
  const { totalMinutes } = getNowInTimezone();
  let diff = startTotal - totalMinutes;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}


async function takeScreenshot(page, label) {
  const file = path.join(SCREENSHOTS_DIR, `${label}-${Date.now()}.png`);
  await page.screenshot({ path: file });
  log(`📸 Screenshot: ${file}`);
  // Garder uniquement les 20 derniers screenshots (triés par date)
  const files = fs.readdirSync(SCREENSHOTS_DIR)
    .map((f) => ({ name: f, time: fs.statSync(path.join(SCREENSHOTS_DIR, f)).mtimeMs }))
    .sort((a, b) => a.time - b.time)
    .map((f) => f.name);
  while (files.length > 20) {
    fs.unlinkSync(path.join(SCREENSHOTS_DIR, files.shift()));
  }
}

async function dismissCookieBanner(page) {
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const allow = btns.find((b) =>
      ["Allow all", "Tout accepter", "Accept all", "Reject all", "Tout refuser"].includes(b.textContent.trim())
    );
    if (allow) allow.click();
  });
  await sleep(1000);
}

async function login(page, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    log(`🔐 Tentative de login (${attempt}/${retries})...`);

    await page.goto("https://skolae.udemy.com", { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(3000);
    await takeScreenshot(page, "01-landing");

    // Vérifier si la page est bloquée dès le départ
    const landingError = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      if (text.includes("forbidden")) return "forbidden";
      if (text.includes("temporarily unavailable") || text.includes("temporairement indisponible")) return "server_error";
      return null;
    });

    if (landingError) {
      const wait = landingError === "forbidden" ? 90 : 30;
      log(`⚠️  ${landingError === "forbidden" ? "Bloqué (Forbidden)" : "Erreur serveur"} dès la landing. Retry dans ${wait}s...`);
      await sleep(wait * 1000);
      continue;
    }

    // Virer le bandeau cookies
    await dismissCookieBanner(page);

    // --- ÉTAPE 1 : Saisie de l'email ---
    log("📧 Étape 1 : Saisie de l'email...");

    const emailSelector = 'input[name="email"], input[type="email"], input[id*="email"]';
    await page.waitForSelector(emailSelector, { visible: true, timeout: 30000 });

    // Vider le champ au cas où (retry)
    await page.evaluate((sel) => { document.querySelector(sel).value = ""; }, emailSelector);
    await page.type(emailSelector, process.env.UDEMY_EMAIL, { delay: 80 });
    await sleep(1000);

    // Clic sur "Continuer" / "Continue"
    log("➡️  Clic sur Continuer...");
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      const btn = buttons.find((b) => ["Continuer", "Continue"].includes(b.textContent.trim()));
      if (btn) btn.click();
    });
    await sleep(5000);
    await takeScreenshot(page, "03-after-email");

    // Vérifier s'il y a une erreur serveur ou un blocage
    const pageError = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      if (text.includes("forbidden")) return "forbidden";
      if (text.includes("temporarily unavailable") || text.includes("temporairement indisponible")) return "server_error";
      return null;
    });

    if (pageError) {
      const wait = pageError === "forbidden" ? 60 : 30;
      log(`⚠️  ${pageError === "forbidden" ? "Bloqué (Forbidden)" : "Erreur serveur Udemy"}. Retry dans ${wait}s...`);
      await sleep(wait * 1000);
      continue;
    }

    // --- ÉTAPE 2 : Saisie du mot de passe ---
    log("🔑 Étape 2 : Saisie du mot de passe...");
    const pwdSelector = 'input[name="password"], input[type="password"]';
    try {
      await page.waitForSelector(pwdSelector, { visible: true, timeout: 15000 });
    } catch (e) {
      log("⚠️  Champ mot de passe pas trouvé. Retry...");
      await takeScreenshot(page, "no-password-field");
      continue;
    }

    await page.type(pwdSelector, process.env.UDEMY_PASSWORD, { delay: 80 });
    await sleep(1000);

    // Soumettre le formulaire avec Entrée (plus fiable que chercher le bouton)
    log("➡️  Soumission du formulaire (Entrée)...");
    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
        page.keyboard.press("Enter"),
      ]);
    } catch (e) {
      log("⚠️  Navigation post-login timeout, on vérifie quand même...");
    }

    await sleep(5000);
    await takeScreenshot(page, "04-post-login");

    // Vérifier qu'on est connecté : le formulaire de login a disparu ?
    const stillOnLogin = await page.evaluate(() => {
      return !!document.querySelector('input[name="email"], input[type="email"], input[name="password"]');
    });

    const url = page.url();
    log(`📍 URL actuelle: ${url} | Formulaire login visible: ${stillOnLogin}`);

    if (stillOnLogin) {
      log("⚠️  Login échoué (formulaire encore visible), retry...");
      continue;
    }

    log("✅ Login réussi !");
    return true;
  }

  log("❌ Échec du login après toutes les tentatives.");
  return false;
}

async function startCourse(page, courseUrl) {
  log(`🎬 Navigation vers le cours: ${courseUrl.substring(0, 80)}...`);
  await page.goto(courseUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(5000);
  await takeScreenshot(page, "05-course-page");

  // Vérifier si on a été redirigé vers le login
  const redirectedToLogin = await page.evaluate(() => {
    return !!document.querySelector('input[name="email"], input[type="email"]');
  });

  if (redirectedToLogin) {
    log("⚠️  Session expirée, re-login nécessaire...");
    const loggedIn = await login(page);
    if (!loggedIn) {
      log("❌ Re-login échoué.");
      return;
    }
    // Re-naviguer vers le cours après re-login
    await page.goto(courseUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(5000);
    await takeScreenshot(page, "05-course-page-retry");
  }

  await forcePlayVideo(page);
}

async function forcePlayVideo(page) {
  log("▶️  Tentative de lancement de la vidéo...");

  // Méthode 1: Cliquer sur le bouton play
  try {
    await page.evaluate(() => {
      const playBtns = document.querySelectorAll(
        '[data-purpose="play-button"], button[aria-label*="play" i], button[aria-label*="lecture" i], .vjs-big-play-button, .play-button'
      );
      if (playBtns.length > 0) playBtns[0].click();
    });
    await sleep(2000);
  } catch (e) {
    log("Pas de bouton play trouvé");
  }

  // Méthode 2: Forcer play sur l'élément <video>
  await page.evaluate(() => {
    const videos = document.querySelectorAll("video");
    videos.forEach((v) => {
      v.muted = false;
      v.volume = 0.01;
      v.playbackRate = 1;
      v.play().catch(() => {});
    });
  });

  await sleep(3000);
  await takeScreenshot(page, "06-video-playing");
  log("✅ Vidéo lancée. L'autoplay Udemy fera le reste.");
}

// Détecter si le cours est terminé (plus de vidéo, ou page de complétion)
async function isCourseFinished(page) {
  return await page.evaluate(() => {
    // Pas de <video> sur la page = probablement fini ou sur un écran de fin
    const video = document.querySelector("video");
    if (!video) return true;

    // Chercher des indicateurs de complétion
    const completionTexts = ["congratulations", "félicitations", "course complete", "cours terminé"];
    const bodyText = document.body.innerText.toLowerCase();
    return completionTexts.some((t) => bodyText.includes(t));
  });
}

async function dismissPopups(page) {
  // Fermer les popups "Êtes-vous toujours là ?", cookies, promos, etc.
  await page.evaluate(() => {
    // Popup "still watching"
    const btns = document.querySelectorAll(
      'button[data-purpose*="still"], button[data-purpose*="continue"], [class*="still-watching"] button, [class*="interstitial"] button'
    );
    btns.forEach((b) => b.click());

    // Fermer les modals/dialogs génériques
    const closeBtns = document.querySelectorAll(
      'button[data-purpose="dismiss"], button[aria-label="close" i], button[aria-label="fermer" i], [class*="modal"] button[class*="close"]'
    );
    closeBtns.forEach((b) => b.click());

    // Accepter cookies si y'en a
    const cookieBtns = document.querySelectorAll('button[id*="accept"], button[class*="accept"]');
    cookieBtns.forEach((b) => b.click());
  });
}

async function checkVideoProgress(page) {
  const info = await page.evaluate(() => {
    const video = document.querySelector("video");
    if (!video) return null;
    return {
      currentTime: Math.round(video.currentTime),
      duration: Math.round(video.duration),
      paused: video.paused,
      src: video.currentSrc?.substring(0, 80),
    };
  });

  if (info) {
    const pct = info.duration > 0 ? Math.round((info.currentTime / info.duration) * 100) : 0;
    log(`📊 Vidéo: ${info.currentTime}s / ${info.duration}s (${pct}%) | Paused: ${info.paused}`);

    // Si la vidéo est en pause, relancer
    if (info.paused) {
      log("⚠️  Vidéo en pause, relance...");
      await page.evaluate(() => {
        const v = document.querySelector("video");
        if (v) v.play().catch(() => {});
      });
    }
  } else {
    log("⚠️  Pas de <video> trouvé sur la page");
    await takeScreenshot(page, "no-video");
  }
}

// === BOUCLE PRINCIPALE ===
(async () => {
  log("🚀 Démarrage du bot Udemy...");
  startMonitorServer();

  const courseUrls = getCourseUrls();
  if (courseUrls.length === 0) {
    log("❌ Aucune URL de cours trouvée dans .env");
    process.exit(1);
  }
  log(`📚 ${courseUrls.length} cours à enchaîner`);

  if (process.env.SCHEDULE_START && process.env.SCHEDULE_END) {
    log(`🕐 Planning actif : ${process.env.SCHEDULE_START} → ${process.env.SCHEDULE_END} (${TIMEZONE})`);
  } else {
    log("🕐 Pas de planning → tourne en continu");
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--window-size=1280,720",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--no-first-run",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  );

  // Login
  const loggedIn = await login(page);
  if (!loggedIn) {
    log("❌ Échec du login. Arrêt.");
    await browser.close();
    process.exit(1);
  }

  let currentCourseIndex = 0;
  let isPlaying = false;
  let noVideoCount = 0;
  let iteration = 0;

  async function startPlaying() {
    if (!isPlaying) {
      log("▶️  Reprise de la lecture...");
      botStatus.state = "playing";
      botStatus.course = `${currentCourseIndex + 1}/${courseUrls.length}`;
      await startCourse(page, courseUrls[currentCourseIndex]);
      isPlaying = true;
    }
  }

  async function pausePlaying() {
    if (isPlaying) {
      log("⏸️  Pause — hors planning. On met la vidéo en pause.");
      botStatus.state = "paused (hors planning)";
      await page.evaluate(() => {
        const v = document.querySelector("video");
        if (v) v.pause();
      });
      isPlaying = false;
    }
  }

  // Boucle toutes les 2 minutes
  log("🔄 Boucle de surveillance active...");

  setInterval(async () => {
    try {
      iteration++;
      const active = isWithinSchedule();

      // --- Hors planning : pause ---
      if (!active) {
        if (isPlaying) await pausePlaying();
        if (iteration % 15 === 0) { // log toutes les ~30 min
          const wait = minutesUntilScheduleStart();
          log(`😴 Hors planning. Reprise dans ~${wait} min`);
        }
        return;
      }

      // --- Dans le planning : jouer ---
      if (!isPlaying) await startPlaying();

      await dismissPopups(page);
      await checkVideoProgress(page);

      // Vérifier si le cours est terminé
      const finished = await isCourseFinished(page);
      if (finished) {
        noVideoCount++;
        if (noVideoCount >= 3) {
          currentCourseIndex++;
          if (currentCourseIndex < courseUrls.length) {
            log(`🎓 Cours terminé ! Passage au suivant (${currentCourseIndex + 1}/${courseUrls.length})...`);
            noVideoCount = 0;
            await startCourse(page, courseUrls[currentCourseIndex]);
          } else {
            log("🏁 Tous les cours sont terminés !");
            await takeScreenshot(page, "all-done");
          }
        }
      } else {
        noVideoCount = 0;
      }

      if (iteration % 10 === 0) {
        await takeScreenshot(page, "check");
      }
    } catch (e) {
      log(`❌ Erreur dans la boucle: ${e.message}`);
      await takeScreenshot(page, "error");
    }
  }, 2 * 60 * 1000);

  log("✅ Bot actif. pm2 stop udemy pour arrêter.");
})();
