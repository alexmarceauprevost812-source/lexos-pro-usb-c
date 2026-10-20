/* LexOS · Fonds d'écran animés + paramètres (gardés SUR la clé) */
"use strict";

const PAR_DEFAUT = { accent: "#ff7a18", police: "Space Grotesk", taille: 100, anim: "constellation", image: "", voile: 35, flou: 0, vitesse: 100, densite: 100,
                     orbes: true, grille: true, curseur: true, zoom: true };
let P = { ...PAR_DEFAUT };
const SOURIS = { x: -9999, y: -9999 };
/* ════════════════════════ Thème : couleur + police ════════════════════════ */
const THEME = { hex: "#ff7a18", rgb: "255,122,24", clair: "#ffb070", fonce: "#d9580a", police: "'LX Space Grotesk', system-ui, sans-serif" };
const COULEURS = [
  ["Orange LexOS", "#ff7a18"], ["Rouge feu", "#ff3b30"], ["Sang", "#c81e1e"], ["Corail", "#ff6b6b"], ["Saumon", "#ff8f70"],
  ["Rose néon", "#ff2d95"], ["Rose bonbon", "#ff7ac6"], ["Magenta", "#e040fb"], ["Violet", "#8b5cf6"], ["Lavande", "#c4b5fd"],
  ["Indigo", "#6366f1"], ["Bleu Québec", "#1e6bff"], ["Bleu ciel", "#38bdf8"], ["Cyan", "#22d3ee"], ["Turquoise", "#14b8a6"],
  ["Émeraude", "#10b981"], ["Menthe", "#5eead4"], ["Vert néon", "#39ff14"], ["Lime", "#a3e635"], ["Jaune", "#facc15"],
  ["Or", "#e8b04a"], ["Ambre", "#f59e0b"], ["Cuivre", "#c87533"], ["Argent", "#cbd5e1"], ["Blanc pur", "#f4f4f5"],
  ["🌈 Arc-en-ciel", "arc-en-ciel"],
];
const POLICES = [
  ["Space Grotesk", "moderne (LexOS)"], ["Inter", "propre et lisible"], ["Poppins", "ronde et douce"], ["Montserrat", "élégante"],
  ["Lexend", "très lisible"], ["Nunito", "amicale"], ["Quicksand", "légère"], ["Fredoka", "ronde, fun"], ["Comfortaa", "arrondie"],
  ["Exo 2", "techno"], ["Rajdhani", "science-fiction"], ["Oxanium", "jeu vidéo"], ["Orbitron", "futuriste"], ["Audiowide", "rétro-futur"],
  ["Righteous", "affiche des années 70"], ["Bebas Neue", "titres en majuscules"], ["Press Start 2P", "jeu rétro 8-bit"],
  ["JetBrains Mono", "code / terminal"], ["Système", "police de l'ordinateur"], ["Serif classique", "comme un livre"],
];
const pileDe = (nom) => nom === "Système" ? "system-ui, -apple-system, 'Segoe UI', Ubuntu, sans-serif"
  : nom === "Serif classique" ? "Georgia, 'DejaVu Serif', 'Times New Roman', serif"
  : `'LX ${nom}', system-ui, sans-serif`;

function hexVersRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbVersHex(r, g, b) { return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join(""); }
function hslVersHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbVersHex(f(0) * 255, f(8) * 255, f(4) * 255);
}
function melanger(hex, vers, t) { const a = hexVersRgb(hex), b = hexVersRgb(vers); return rgbVersHex(...a.map((v, i) => v + (b[i] - v) * t)); }
function luminance(hex) { const [r, g, b] = hexVersRgb(hex).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; }

function poserCouleur(hex) {
  const racine = document.documentElement.style;
  THEME.hex = hex; THEME.rgb = hexVersRgb(hex).join(","); THEME.clair = melanger(hex, "#ffffff", .35); THEME.fonce = melanger(hex, "#000000", .22);
  racine.setProperty("--orange", hex); racine.setProperty("--orange-2", THEME.clair); racine.setProperty("--orange-fonce", THEME.fonce);
  racine.setProperty("--acc-rgb", THEME.rgb);
  racine.setProperty("--sur-accent", luminance(hex) > .45 ? "#0a0a0a" : "#ffffff");
  $('link[rel="icon"]')?.setAttribute("data-teinte", hex);
}
let teinteArc = 20, minuteurArc = null;
function appliquerTheme() {
  clearInterval(minuteurArc);
  if (P.accent === "arc-en-ciel") minuteurArc = setInterval(() => { teinteArc = (teinteArc + 1.2) % 360; poserCouleur(hslVersHex(teinteArc, 95, 58)); }, 60);
  else poserCouleur(/^#[0-9a-f]{6}$/i.test(P.accent) ? P.accent : "#ff7a18");
  THEME.police = pileDe(P.police);
  document.documentElement.style.setProperty("--police", THEME.police);
  $("#app").style.zoom = P.taille / 100;
  document.documentElement.style.setProperty("--hauteur", `calc(100vh / ${P.taille / 100})`);
  $$("#couleurs .pastille").forEach((b) => b.classList.toggle("choisi", b.dataset.c === P.accent));
  $(".pastille-perso").classList.toggle("choisi", !COULEURS.some(([, c]) => c === P.accent));
  if (/^#/.test(P.accent)) $("#couleur-libre").value = P.accent;
  $$("#polices .police-carte").forEach((b) => b.classList.toggle("choisi", b.dataset.p === P.police));
}
function construireTheme() {
  $("#couleurs").innerHTML = COULEURS.map(([nom, c], i) => `<button type="button" class="pastille${c === "arc-en-ciel" ? " arc" : ""}" data-c="${c}" title="${nom}"
      style="--c:${c === "arc-en-ciel" ? "#ff7a18" : c};animation-delay:${i * 25}ms"><span class="rond-couleur"></span><small>${nom}</small></button>`).join("");
  $$("#couleurs .pastille").forEach((b) => b.addEventListener("click", () => {
    changer({ accent: b.dataset.c }, false); etincelles(b, 18); toast("Couleur : " + b.title);
  }));
  $("#couleur-libre").addEventListener("input", (e) => changer({ accent: e.target.value }, false));
  $("#polices").innerHTML = POLICES.map(([nom, desc], i) => `<button type="button" class="police-carte" data-p="${nom}" style="font-family:${pileDe(nom).replace(/"/g, "'")};animation-delay:${i * 30}ms">
      <span class="police-grand">Aa</span><b>${nom}</b><span class="police-phrase">Salut Alex ! 123 éàç</span><small>${desc}</small></button>`).join("");
  $$("#polices .police-carte").forEach((b) => b.addEventListener("click", () => {
    changer({ police: b.dataset.p }, false); etincelles(b, 16); toast("Police : " + b.dataset.p);
  }));
  $("#r-taille").addEventListener("input", (e) => changer({ taille: +e.target.value }, false));
}

const OR = (a) => `rgba(${THEME.rgb},${a})`, BL = (a) => `rgba(255,255,255,${a})`;
const alea = (a, b) => a + Math.random() * (b - a);

/* ════════════════════════ Les fonds animés ════════════════════════
   Chaque fond : init(L, H, densité) → état ; dessine(x, état, L, H, dt, souris) */
const FONDS = {
  constellation: {
    nom: "Constellation", desc: "points reliés qui fuient la souris",
    init(L, H, d) {
      const n = Math.max(28, Math.round(Math.min(220, (L * H) / 14000) * d));
      return Array.from({ length: n }, () => ({ x: alea(0, L), y: alea(0, H), vx: alea(-.35, .35), vy: alea(-.35, .35), r: alea(.6, 2.1), o: Math.random() < .25 }));
    },
    dessine(x, pts, L, H, dt, m) {
      x.clearRect(0, 0, L, H);
      const D = Math.min(140, L / 6);
      for (const p of pts) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0 || p.x > L) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
        const dx = p.x - m.x, dy = p.y - m.y, d = Math.hypot(dx, dy);
        if (d < 160 && d > 0) { p.x += dx / d * 1.2 * dt; p.y += dy / d * 1.2 * dt; }
        x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fillStyle = p.o ? OR(.9) : BL(.55); x.fill();
      }
      x.lineWidth = .8;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < D) { x.strokeStyle = OR((1 - d / D) * .22); x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); }
      }
    },
  },
  aurore: {
    nom: "Aurore", desc: "voiles orange qui ondulent",
    init(L, H, d) { return { t: 0, n: Math.max(3, Math.round(5 * d)) }; },
    dessine(x, e, L, H, dt) {
      e.t += .004 * dt;
      x.globalCompositeOperation = "source-over";
      x.fillStyle = "#070707"; x.fillRect(0, 0, L, H);
      x.globalCompositeOperation = "lighter";
      for (let i = 0; i < e.n; i++) {
        const cx = L * (.5 + .42 * Math.sin(e.t * (0.7 + i * .23) + i * 2.1));
        const cy = H * (.5 + .38 * Math.cos(e.t * (0.5 + i * .17) + i * 1.3));
        const r = Math.max(L, H) * (.28 + .1 * Math.sin(e.t + i));
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        const c = i % 3 === 0 ? "255,170,80" : i % 3 === 1 ? "255,90,10" : "255,122,24";
        g.addColorStop(0, `rgba(${c},.28)`); g.addColorStop(1, "rgba(0,0,0,0)");
        x.fillStyle = g; x.fillRect(0, 0, L, H);
      }
      x.globalCompositeOperation = "source-over";
    },
  },
  etoiles: {
    nom: "Hyperespace", desc: "étoiles qui foncent vers toi",
    init(L, H, d) {
      return Array.from({ length: Math.round(260 * d) }, () => ({ x: alea(-1, 1), y: alea(-1, 1), z: alea(.05, 1), o: Math.random() < .3 }));
    },
    dessine(x, st, L, H, dt, m) {
      x.fillStyle = "rgba(7,7,7,.35)"; x.fillRect(0, 0, L, H);
      const cx = L / 2 + (m.x > -999 ? (m.x - L / 2) * .05 : 0), cy = H / 2 + (m.y > -999 ? (m.y - H / 2) * .05 : 0);
      const k = Math.max(L, H) * .5;
      for (const s of st) {
        const px = cx + s.x / s.z * k, py = cy + s.y / s.z * k;
        s.z -= .006 * dt;
        if (s.z <= .02) { s.x = alea(-1, 1); s.y = alea(-1, 1); s.z = 1; continue; }
        const nx = cx + s.x / s.z * k, ny = cy + s.y / s.z * k;
        if (nx < 0 || nx > L || ny < 0 || ny > H) { s.z = 1; s.x = alea(-1, 1); s.y = alea(-1, 1); continue; }
        x.strokeStyle = s.o ? OR(1 - s.z) : BL(1 - s.z);
        x.lineWidth = (1 - s.z) * 2.4 + .3;
        x.beginPath(); x.moveTo(px, py); x.lineTo(nx, ny); x.stroke();
      }
    },
  },
  pluie: {
    nom: "Pluie de code", desc: "caractères qui tombent",
    init(L, H, d) {
      const t = Math.max(10, Math.round(16 / Math.sqrt(d)));
      return { t, col: Array.from({ length: Math.ceil(L / t) }, () => alea(-H / t, 0)), acc: 0 };
    },
    dessine(x, e, L, H, dt) {
      e.acc += dt;
      if (e.acc < 2.2) return; e.acc = 0;
      x.fillStyle = "rgba(7,7,7,.12)"; x.fillRect(0, 0, L, H);
      x.font = `${e.t}px ui-monospace, monospace`;
      const car = "LEXOS01{}<>/=+*#ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ";
      e.col.forEach((y, i) => {
        const c = car[Math.floor(Math.random() * car.length)];
        x.fillStyle = Math.random() < .08 ? BL(.95) : OR(.85);
        x.fillText(c, i * e.t, y * e.t);
        e.col[i] = y * e.t > H && Math.random() > .975 ? 0 : y + 1;
      });
    },
  },
  vagues: {
    nom: "Vagues", desc: "lignes qui ondulent",
    init(L, H, d) { return { t: 0, n: Math.max(4, Math.round(9 * d)) }; },
    dessine(x, e, L, H, dt, m) {
      e.t += .012 * dt;
      x.clearRect(0, 0, L, H);
      for (let i = 0; i < e.n; i++) {
        const base = H * (.25 + .6 * i / e.n), amp = H * .05 * (1 + Math.sin(e.t * .3 + i));
        x.beginPath();
        for (let px = 0; px <= L; px += 8) {
          const prox = m.x > -999 ? Math.exp(-((px - m.x) ** 2) / 20000) * 30 * Math.sign(m.y - base || 1) : 0;
          const py = base + Math.sin(px * .006 + e.t + i * .7) * amp + Math.sin(px * .013 - e.t * 1.3) * amp * .4 - prox;
          px ? x.lineTo(px, py) : x.moveTo(px, py);
        }
        x.strokeStyle = i % 3 === 1 ? BL(.18) : OR(.15 + .25 * (i / e.n));
        x.lineWidth = 1.5; x.stroke();
      }
    },
  },
  braises: {
    nom: "Braises", desc: "étincelles qui montent",
    init(L, H, d) {
      return Array.from({ length: Math.round(140 * d) }, () => ({ x: alea(0, L), y: alea(0, H), v: alea(.3, 1.3), r: alea(.6, 2.6), p: alea(0, 6) }));
    },
    dessine(x, b, L, H, dt) {
      x.clearRect(0, 0, L, H);
      const g = x.createLinearGradient(0, H, 0, H * .5);
      g.addColorStop(0, OR(.18)); g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g; x.fillRect(0, H * .5, L, H * .5);
      for (const e of b) {
        e.y -= e.v * dt; e.p += .05 * dt; e.x += Math.sin(e.p) * .4 * dt;
        if (e.y < -10) { e.y = H + 10; e.x = alea(0, L); }
        const a = Math.max(0, Math.min(1, e.y / H)) * (.6 + .4 * Math.sin(e.p * 3));
        x.beginPath(); x.arc(e.x, e.y, e.r, 0, 7);
        x.fillStyle = e.r > 2.2 ? BL(a) : OR(a); x.shadowColor = THEME.hex; x.shadowBlur = 8; x.fill();
      }
      x.shadowBlur = 0;
    },
  },
  aucun: {
    nom: "Noir pur", desc: "aucune animation",
    init() { return null; },
    dessine(x, e, L, H) { x.clearRect(0, 0, L, H); },
  },
};

/* ════════════════════════ Moteur d'animation (plein écran) ════════════════════════ */
const toile = $("#fond"), ctx = toile.getContext("2d");
const PLEIN = { L: 0, H: 0, etat: null, anim: null };
const calme = matchMedia("(prefers-reduced-motion: reduce)").matches;

function preparerPlein() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  toile.width = innerWidth * dpr; toile.height = innerHeight * dpr;
  toile.style.width = innerWidth + "px"; toile.style.height = innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  PLEIN.L = innerWidth; PLEIN.H = innerHeight;
  PLEIN.anim = FONDS[P.anim] ? P.anim : "constellation";
  ctx.clearRect(0, 0, PLEIN.L, PLEIN.H);
  PLEIN.etat = FONDS[PLEIN.anim].init(PLEIN.L, PLEIN.H, P.densite / 100);
}
addEventListener("resize", preparerPlein);
addEventListener("mousemove", (e) => {
  SOURIS.x = e.clientX; SOURIS.y = e.clientY;
  const g = $("#curseur"); g.style.left = e.clientX + "px"; g.style.top = e.clientY + "px";
});
document.addEventListener("mouseleave", () => { SOURIS.x = SOURIS.y = -9999; });

let avant = performance.now();
function boucle(t) {
  const dt = Math.min(4, (t - avant) / 16.67) * (P.vitesse / 100); avant = t;
  if (!document.hidden) {
    FONDS[PLEIN.anim].dessine(ctx, PLEIN.etat, PLEIN.L, PLEIN.H, dt, SOURIS);
    if (vueParametresVisible()) dessinerApercus(dt);
  }
  if (!calme) requestAnimationFrame(boucle);
}

/* ════════════════════════ Appliquer les paramètres ════════════════════════ */
function appliquer(reinit = true) {
  appliquerTheme();
  const img = $("#fond-image");
  img.style.backgroundImage = P.image ? `url("/fonds/${encodeURIComponent(P.image)}")` : "none";
  img.style.filter = `blur(${P.flou}px)`;
  img.style.inset = P.flou ? `-${P.flou * 2}px` : "0";
  img.classList.toggle("zoom", P.zoom && !!P.image);
  $("#fond-voile").style.opacity = P.image ? P.voile / 100 : 0;
  toile.style.opacity = P.anim === "aucun" ? 0 : P.image ? .85 : 1;
  $("#orbes").style.display = P.orbes ? "" : "none";
  $(".grille").style.display = P.grille ? "" : "none";
  $("#curseur").style.display = P.curseur ? "" : "none";
  document.documentElement.style.setProperty("--vitesse-fond", Math.max(.1, P.vitesse / 100));
  if (reinit) preparerPlein();
  $$("#fonds-animes .fond-carte").forEach((c) => c.classList.toggle("choisi", c.dataset.anim === P.anim));
  $$("#fonds-images .fond-carte[data-image]").forEach((c) => c.classList.toggle("choisi", c.dataset.image === P.image));
  for (const [id, cle, suffixe] of [["r-taille", "taille", "%"], ["r-voile", "voile", "%"], ["r-flou", "flou", " px"], ["r-vitesse", "vitesse", "%"], ["r-densite", "densite", "%"]]) {
    const r = $("#" + id); r.value = P[cle]; r.nextElementSibling.textContent = P[cle] + suffixe;
    r.style.setProperty("--pct", ((P[cle] - r.min) / (r.max - r.min)) * 100 + "%");
  }
  for (const k of ["orbes", "grille", "curseur", "zoom"]) $("#r-" + k).checked = P[k];
}

let minuteurSauve = null;
function sauverParametres() {
  mem.ecrire("lexos-parametres", JSON.stringify(P));
  clearTimeout(minuteurSauve);
  minuteurSauve = setTimeout(() => fetch("/moteur/parametres", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(P),
  }).catch(() => {}), 400);
}
function changer(modif, reinit = true) { Object.assign(P, modif); appliquer(reinit); sauverParametres(); }

/* ════════════════════════ Vue Paramètres : cartes + aperçus ════════════════════════ */
const APERCUS = [];
function vueParametresVisible() { return $("#vue-parametres").classList.contains("active"); }

function construireCartes() {
  $("#fonds-animes").innerHTML = Object.entries(FONDS).map(([id, f], i) => `
    <button type="button" class="fond-carte" data-anim="${id}" style="animation-delay:${i * 60}ms">
      <div class="fond-apercu"><canvas width="240" height="135"></canvas><span class="coche">✔</span></div>
      <b>${f.nom}</b><small>${f.desc}</small></button>`).join("");
  APERCUS.length = 0;
  $$("#fonds-animes .fond-carte").forEach((c) => {
    const cv = $("canvas", c), x = cv.getContext("2d"), f = FONDS[c.dataset.anim];
    APERCUS.push({ x, f, L: 240, H: 135, etat: f.init(240, 135, .6), m: { x: -9999, y: -9999 } });
    const a = APERCUS[APERCUS.length - 1];
    cv.addEventListener("mousemove", (e) => { const r = cv.getBoundingClientRect(); a.m.x = (e.clientX - r.left) * 240 / r.width; a.m.y = (e.clientY - r.top) * 135 / r.height; });
    cv.addEventListener("mouseleave", () => { a.m.x = a.m.y = -9999; });
    c.addEventListener("click", () => { changer({ anim: c.dataset.anim }); etincelles(c, 16); toast("Fond : " + f.nom); });
  });
}
function dessinerApercus(dt) {
  for (const a of APERCUS) {
    if (a.f === FONDS.aucun) { a.x.fillStyle = "#070707"; a.x.fillRect(0, 0, a.L, a.H); continue; }
    a.x.save(); if (a.f !== FONDS.aurore && a.f !== FONDS.etoiles && a.f !== FONDS.pluie) { a.x.fillStyle = "#0a0a0b"; }
    a.f.dessine(a.x, a.etat, a.L, a.H, dt, a.m); a.x.restore();
  }
}

async function chargerImages() {
  let noms = [];
  try { noms = await api("/moteur/fonds"); } catch {}
  $$("#fonds-images .fond-carte[data-image]").forEach((c) => c.remove());
  const ajout = $(".fond-ajout");
  const aucune = document.createElement("button");
  aucune.type = "button"; aucune.className = "fond-carte"; aucune.dataset.image = "";
  aucune.innerHTML = `<div class="fond-apercu vide-img"><span>∅</span><span class="coche">✔</span></div><b>Aucune image</b><small>seulement l'animation</small>`;
  ajout.before(aucune);
  noms.forEach((n, i) => {
    const c = document.createElement("div");
    c.className = "fond-carte"; c.dataset.image = n; c.style.animationDelay = (i + 1) * 60 + "ms"; c.tabIndex = 0;
    c.innerHTML = `<div class="fond-apercu"><img src="/fonds/${encodeURIComponent(n)}" alt=""><span class="coche">✔</span>
      <button type="button" class="fond-suppr" title="Supprimer">✕</button></div><b>Image ${i + 1}</b><small>sur la clé</small>`;
    ajout.before(c);
  });
  $$("#fonds-images .fond-carte[data-image]").forEach((c) => c.addEventListener("click", async (e) => {
    if (e.target.closest(".fond-suppr")) {
      e.stopPropagation();
      c.classList.add("sort");
      await fetch("/moteur/fonds/" + encodeURIComponent(c.dataset.image), { method: "DELETE" }).catch(() => {});
      if (P.image === c.dataset.image) changer({ image: "" }, false);
      setTimeout(chargerImages, 350);
      return;
    }
    changer({ image: c.dataset.image }, false); etincelles(c, 16);
  }));
  appliquer(false);
}

$("#fond-fichier").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  const carte = $(".fond-ajout"); carte.classList.add("chargement");
  try {
    const data = await new Promise((r, x) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.onerror = x; fr.readAsDataURL(f); });
    const res = await api("/moteur/fonds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: f.type, data }) });
    await chargerImages();
    changer({ image: res.nom }, false);
    toast("Image ajoutée sur la clé ✔"); etincelles(carte, 30);
  } catch (err) { toast("Image refusée : " + err.message, true); }
  finally { carte.classList.remove("chargement"); }
});

for (const [id, cle, reinit] of [["r-voile", "voile", false], ["r-flou", "flou", false], ["r-vitesse", "vitesse", false], ["r-densite", "densite", true]]) {
  $("#" + id).addEventListener("input", (e) => changer({ [cle]: +e.target.value }, reinit && false));
  if (reinit) $("#" + id).addEventListener("change", () => preparerPlein());
}
for (const k of ["orbes", "grille", "curseur", "zoom"]) $("#r-" + k).addEventListener("change", (e) => changer({ [k]: e.target.checked }, false));
$("#r-defaut").addEventListener("click", () => { changer({ ...PAR_DEFAUT }); toast("Paramètres remis par défaut"); });

$$(".onglet").forEach((o) => o.addEventListener("click", () => { if (o.dataset.vue === "parametres") chargerImages(); }));

/* ════════════════════════ Démarrage ════════════════════════ */
(async () => {
  try { Object.assign(P, JSON.parse(mem.lire("lexos-parametres", "{}"))); } catch {}
  construireTheme();
  construireCartes();
  appliquer();
  requestAnimationFrame(boucle);
  try {
    const p = await api("/moteur/parametres");          // ceux de la clé gagnent
    if (p && Object.keys(p).length) { Object.assign(P, PAR_DEFAUT, p); appliquer(); }
  } catch {}
})();
