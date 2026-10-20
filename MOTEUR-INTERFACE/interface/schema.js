/* LexOS · Moteur d'animation vidéo pour construire des schémas
   Texte simple  →  schéma animé (noir / orange / blanc)  →  vidéo .webm sur la clé */
"use strict";

const SC = {
  toile: $("#sc-toile"), x: $("#sc-toile").getContext("2d"),
  W: 1920, H: 1080,
  scene: null, t: 0, joue: false, vitesse: 1, avant: 0,
  enregistre: false, ctrlIA: null,
};
const EXEMPLE = `titre: LexOS · de la clé à la réponse
[🔌 Clé USB-C] -> [⚙️ Moteur portable] : branche
[⚙️ Moteur portable] -> [🧠 Ollama] : démarre
[🧠 Ollama] -> [📦 Modèles de la clé] : charge
[👤 Alex] -> [💬 Interface] : écrit
[💬 Interface] -> [⚙️ Moteur portable] : envoie
[🧠 Ollama] -> [💬 Interface] : répond en direct`;

/* ════════════════════════ 1. Lire le texte ════════════════════════ */
const FLECHE = /\s*(?:-->|->|=>|→|⟶)\s*/;
function lireTexte(txt) {
  const noeuds = new Map(), liens = [];
  let titre = "";
  const noeud = (brut) => {
    const nom = brut.trim().replace(/^\[|\]$/g, "").trim();
    if (!nom) return null;
    if (!noeuds.has(nom)) noeuds.set(nom, { id: nom, texte: nom, entrants: 0, sortants: 0 });
    return noeuds.get(nom);
  };
  for (let l of txt.split("\n")) {
    l = l.trim().replace(/^[-*•]\s+/, "");
    if (!l || l.startsWith("#") || l.startsWith("```")) continue;
    const mt = l.match(/^(titre|title)\s*:\s*(.+)$/i);
    if (mt) { titre = mt[2].trim(); continue; }
    if (!FLECHE.test(l)) { if (/^\[.+\]$/.test(l)) noeud(l); continue; }
    let etiquette = "";
    const derniere = l.split(FLECHE);
    const fin = derniere[derniere.length - 1];
    const deux = fin.indexOf(":");
    if (deux >= 0 && fin.lastIndexOf("]") < deux) { etiquette = fin.slice(deux + 1).trim(); derniere[derniere.length - 1] = fin.slice(0, deux); }
    const morceaux = derniere.map(noeud);
    for (let i = 0; i < morceaux.length - 1; i++) {
      const a = morceaux[i], b = morceaux[i + 1];
      if (!a || !b || a === b) continue;
      liens.push({ a, b, texte: i === morceaux.length - 2 ? etiquette : "" });
      a.sortants++; b.entrants++;
    }
  }
  return { titre, noeuds: [...noeuds.values()], liens };
}

/* ════════════════════════ 2. Placer les boîtes ════════════════════════ */
function couper(x, texte, max) {
  const mots = texte.split(/\s+/), lignes = [];
  let l = "";
  for (const m of mots) {
    const essai = l ? l + " " + m : m;
    if (x.measureText(essai).width > max && l) { lignes.push(l); l = m; } else l = essai;
  }
  if (l) lignes.push(l);
  return lignes.slice(0, 3);
}

function couches(g) {
  // On ignore les liens qui reviennent en arrière (boucles), puis plus long chemin.
  const suivants = new Map(g.noeuds.map((n) => [n, []]));
  const etat = new Map(), avant = new Set();
  const visite = (n) => {
    etat.set(n, 1);
    for (const L of g.liens.filter((k) => k.a === n)) {
      if (etat.get(L.b) === 1) { avant.add(L); continue; }
      suivants.get(n).push(L.b);
      if (!etat.get(L.b)) visite(L.b);
    }
    etat.set(n, 2);
  };
  [...g.noeuds].sort((a, b) => a.entrants - b.entrants).forEach((n) => { if (!etat.get(n)) visite(n); });
  const rang = new Map(g.noeuds.map((n) => [n, 0]));
  for (let k = 0; k < g.noeuds.length; k++)
    for (const [n, s] of suivants) for (const m of s) if (rang.get(m) < rang.get(n) + 1) rang.set(m, rang.get(n) + 1);
  g.liens.forEach((L) => { L.retour = avant.has(L); });
  return rang;
}

function placer(g, style) {
  const x = SC.x;
  x.font = `600 30px ${THEME.police}`;
  for (const n of g.noeuds) {
    n.lignes = couper(x, n.texte, 300);
    n.l = Math.max(170, Math.max(...n.lignes.map((s) => x.measureText(s).width)) + 64);
    n.h = 40 + n.lignes.length * 38;
  }
  if (style === "cercle") {
    const R = 420;
    g.noeuds.forEach((n, i) => {
      const a = -Math.PI / 2 + (i / g.noeuds.length) * Math.PI * 2;
      n.cx = Math.cos(a) * R; n.cy = Math.sin(a) * R; n.ordre = i;
    });
  } else {
    const rang = couches(g);
    const groupes = [];
    for (const n of g.noeuds) (groupes[rang.get(n)] ||= []).push(n);
    // ordre dans chaque couche : moyenne des parents (moins de croisements)
    groupes.forEach((c, i) => {
      if (!i) return;
      const pos = (n) => { const p = g.liens.filter((L) => L.b === n && !L.retour).map((L) => groupes[rang.get(L.a)]?.indexOf(L.a) ?? 0); return p.length ? p.reduce((s, v) => s + v, 0) / p.length : 0; };
      c.sort((a, b) => pos(a) - pos(b));
    });
    const H = style === "horizontal";
    const pas = H ? Math.max(...g.noeuds.map((n) => n.l)) + 150 : Math.max(...g.noeuds.map((n) => n.h)) + 130;
    let ordre = 0;
    groupes.forEach((c, i) => {
      if (!c) return;
      const tailles = c.map((n) => (H ? n.h : n.l) + (H ? 70 : 60));
      let p = -tailles.reduce((s, v) => s + v, 0) / 2;
      c.forEach((n, j) => {
        const milieu = p + tailles[j] / 2; p += tailles[j];
        if (H) { n.cx = i * pas; n.cy = milieu; } else { n.cx = milieu; n.cy = i * pas; }
        n.ordre = ordre++;
      });
    });
  }
  // Mise à l'échelle pour tout faire entrer dans l'écran 1920×1080
  const minX = Math.min(...g.noeuds.map((n) => n.cx - n.l / 2)), maxX = Math.max(...g.noeuds.map((n) => n.cx + n.l / 2));
  const minY = Math.min(...g.noeuds.map((n) => n.cy - n.h / 2)), maxY = Math.max(...g.noeuds.map((n) => n.cy + n.h / 2));
  const haut = g.titre ? 190 : 90, bas = 110, cote = 110;
  const s = Math.min(1.35, (SC.W - cote * 2) / (maxX - minX || 1), (SC.H - haut - bas) / (maxY - minY || 1));
  const ox = SC.W / 2 - ((minX + maxX) / 2) * s, oy = haut + (SC.H - haut - bas) / 2 - ((minY + maxY) / 2) * s;
  g.echelle = s; g.ox = ox; g.oy = oy;
}

/* ════════════════════════ 3. Le minutage (comme un montage vidéo) ════════════════════════ */
const D_NOEUD = .75, D_LIEN = .7, D_TITRE = 1.2, D_FIN = 4.5;
function minuter(g) {
  const ordre = [...g.noeuds].sort((a, b) => a.ordre - b.ordre);
  ordre.forEach((n, i) => { n.t0 = D_TITRE + i * D_NOEUD; });
  for (const L of g.liens) L.t0 = Math.max(L.a.t0, L.b.t0) + .35;
  // courbes (échantillonnées) entre les bords des boîtes
  for (const L of g.liens) L.pts = courbe(L, g);
  g.construit = Math.max(D_TITRE + 1, ...g.noeuds.map((n) => n.t0 + .7), ...g.liens.map((L) => L.t0 + D_LIEN)) + .3;
  g.duree = g.construit + D_FIN;
}
function bord(n, vx, vy) {
  const sx = (n.l / 2) / Math.abs(vx || 1e-6), sy = (n.h / 2) / Math.abs(vy || 1e-6), k = Math.min(sx, sy);
  return [n.cx + vx * k, n.cy + vy * k];
}
function courbe(L, g) {
  const a = L.a, b = L.b, dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy) || 1;
  const [x0, y0] = bord(a, dx / d, dy / d), [x3, y3] = bord(b, -dx / d, -dy / d);
  let c1, c2;
  const style = $("#sc-style").value;
  if (L.retour) {                                        // boucle : grande courbe par-dessous
    const off = 160 + d * .25, nx = -dy / d, ny = dx / d;
    c1 = [x0 + nx * off, y0 + ny * off]; c2 = [x3 + nx * off, y3 + ny * off];
  } else if (style === "horizontal") { c1 = [x0 + (x3 - x0) * .5, y0]; c2 = [x3 - (x3 - x0) * .5, y3]; }
  else if (style === "vertical") { c1 = [x0, y0 + (y3 - y0) * .5]; c2 = [x3, y3 - (y3 - y0) * .5]; }
  else { c1 = [x0 + dx * .3 - dy * .15, y0 + dy * .3 + dx * .15]; c2 = [x3 - dx * .3 - dy * .15, y3 - dy * .3 + dx * .15]; }
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60, u = 1 - t;
    pts.push([u * u * u * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * x3,
              u * u * u * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * y3]);
  }
  return pts;
}

/* ════════════════════════ 4. Dessiner une image (frame) au temps t ════════════════════════ */
const borne = (v) => Math.max(0, Math.min(1, v));
const sortie = (p) => 1 - Math.pow(1 - p, 3);
const rebond = (p) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
function rectArrondi(x, a, b, l, h, r) {
  x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + l, b, a + l, b + h, r); x.arcTo(a + l, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + l, b, r); x.closePath();
}

function dessiner(t) {
  const x = SC.x, W = SC.W, H = SC.H, g = SC.scene;
  // fond : noir, halos orange qui bougent, grille
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.fillStyle = "#070707"; x.fillRect(0, 0, W, H);
  for (const [px, py, r, a] of [[.15 + .05 * Math.sin(t * .3), .2, 700, .16], [.85, .85 + .04 * Math.cos(t * .25), 800, .14], [.6 + .08 * Math.sin(t * .2), .5, 500, .06]]) {
    const gr = x.createRadialGradient(px * W, py * H, 0, px * W, py * H, r);
    gr.addColorStop(0, `rgba(${THEME.rgb},${a})`); gr.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
  }
  x.strokeStyle = "rgba(255,255,255,.035)"; x.lineWidth = 1;
  const dec = (t * 12) % 60;
  for (let i = -60; i < W + 60; i += 60) { x.beginPath(); x.moveTo(i + dec, 0); x.lineTo(i + dec, H); x.stroke(); }
  for (let j = -60; j < H + 60; j += 60) { x.beginPath(); x.moveTo(0, j + dec); x.lineTo(W, j + dec); x.stroke(); }
  if (!g || !g.noeuds.length) {
    x.fillStyle = "#9a9aa2"; x.font = `500 40px ${THEME.police}`; x.textAlign = "center";
    x.fillText("Décris ou écris un schéma à gauche, puis ▶", W / 2, H / 2); return;
  }
  // titre
  if (g.titre) {
    const p = sortie(borne(t / 1));
    x.globalAlpha = p; x.fillStyle = "#ffffff"; x.textAlign = "center"; x.textBaseline = "alphabetic";
    x.font = `700 64px ${THEME.police}`;
    x.fillText(g.titre, W / 2, 96 + (1 - p) * -30);
    const lw = Math.min(x.measureText(g.titre).width, 1500) * sortie(borne((t - .3) / .9));
    const gr = x.createLinearGradient(W / 2 - lw / 2, 0, W / 2 + lw / 2, 0);
    gr.addColorStop(0, `rgba(${THEME.rgb},0)`); gr.addColorStop(.5, THEME.hex); gr.addColorStop(1, `rgba(${THEME.rgb},0)`);
    x.fillStyle = gr; x.fillRect(W / 2 - lw / 2, 122, lw, 5);
    x.globalAlpha = 1;
  }
  x.setTransform(g.echelle, 0, 0, g.echelle, g.ox, g.oy);
  const s = g.echelle;
  // liens (en dessous des boîtes)
  for (const L of g.liens) {
    const p = sortie(borne((t - L.t0) / D_LIEN));
    if (p <= 0) continue;
    const n = Math.max(1, Math.round(p * 60)), pts = L.pts;
    x.lineCap = "round"; x.lineJoin = "round";
    x.shadowColor = THEME.hex; x.shadowBlur = 18 / s;
    x.strokeStyle = L.retour ? "rgba(255,255,255,.55)" : `rgba(${THEME.rgb},.9)`;
    x.lineWidth = 4 / s; x.setLineDash(L.retour ? [14 / s, 12 / s] : []);
    x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i <= n; i++) x.lineTo(pts[i][0], pts[i][1]);
    x.stroke(); x.setLineDash([]); x.shadowBlur = 0;
    // tête de la flèche (avance avec le trait)
    const [hx, hy] = pts[n], [px, py] = pts[Math.max(0, n - 3)], an = Math.atan2(hy - py, hx - px), k = 22 / s;
    x.fillStyle = L.retour ? "#ffffff" : THEME.hex;
    x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx - k * Math.cos(an - .45), hy - k * Math.sin(an - .45));
    x.lineTo(hx - k * Math.cos(an + .45), hy - k * Math.sin(an + .45)); x.closePath(); x.fill();
    // le courant : des billes qui circulent une fois le lien construit
    if (p >= 1) for (let b = 0; b < 3; b++) {
      const u = ((t - L.t0 - D_LIEN) * .45 + b / 3) % 1, q = pts[Math.floor(u * 60)];
      x.beginPath(); x.arc(q[0], q[1], 6 / s, 0, 7);
      x.fillStyle = b === 0 ? "#ffffff" : THEME.clair; x.shadowColor = THEME.hex; x.shadowBlur = 16 / s; x.fill(); x.shadowBlur = 0;
    }
    // étiquette
    if (L.texte) {
      const pe = sortie(borne((t - L.t0 - D_LIEN * .6) / .5));
      if (pe > 0) {
        const m = pts[30];
        x.font = `500 ${22 / Math.max(s, .6)}px ${THEME.police}`;
        x.textAlign = "center"; x.textBaseline = "middle";
        const lw = x.measureText(L.texte).width + 28 / s, lh = 38 / Math.max(s, .6);
        x.globalAlpha = pe;
        rectArrondi(x, m[0] - lw / 2, m[1] - lh / 2 - (1 - pe) * 14, lw, lh, lh / 2);
        x.fillStyle = "rgba(14,14,15,.92)"; x.fill(); x.strokeStyle = `rgba(${THEME.rgb},.6)`; x.lineWidth = 1.5 / s; x.stroke();
        x.fillStyle = "#ffffff"; x.fillText(L.texte, m[0], m[1] - (1 - pe) * 14);
        x.globalAlpha = 1;
      }
    }
  }
  // boîtes
  for (const n of g.noeuds) {
    const p = borne((t - n.t0) / .6);
    if (p <= 0) continue;
    const e = rebond(p), source = n.entrants === 0 && n.sortants > 0;
    // onde au moment d'apparaître
    if (p < 1 || t - n.t0 < 1.2) {
      const o = borne((t - n.t0) / 1.2);
      x.strokeStyle = `rgba(${THEME.rgb},${(1 - o) * .7})`; x.lineWidth = 3 / s;
      rectArrondi(x, n.cx - n.l / 2 - o * 60, n.cy - n.h / 2 - o * 60, n.l + o * 120, n.h + o * 120, 22 + o * 40); x.stroke();
    }
    x.save();
    x.translate(n.cx, n.cy); x.scale(e, e); x.globalAlpha = borne(p * 1.6);
    const pouls = .5 + .5 * Math.sin(t * 2.4 + n.ordre);
    x.shadowColor = THEME.hex; x.shadowBlur = (source ? 40 : 22) + pouls * 14;
    rectArrondi(x, -n.l / 2, -n.h / 2, n.l, n.h, 22);
    if (source) {
      const gr = x.createLinearGradient(-n.l / 2, -n.h / 2, n.l / 2, n.h / 2);
      gr.addColorStop(0, THEME.clair); gr.addColorStop(1, THEME.fonce); x.fillStyle = gr;
    } else x.fillStyle = "#121213";
    x.fill(); x.shadowBlur = 0;
    x.lineWidth = 3; x.strokeStyle = source ? THEME.clair : THEME.hex; x.stroke();
    // reflet qui balaie la boîte à son arrivée
    if (p < 1) {
      x.save(); x.clip();
      const bx = -n.l / 2 + (n.l + 200) * p - 100;
      const gr = x.createLinearGradient(bx - 60, 0, bx + 60, 0);
      gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(.5, "rgba(255,255,255,.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = gr; x.fillRect(-n.l / 2, -n.h / 2, n.l, n.h); x.restore();
    }
    x.fillStyle = "#ffffff"; x.textAlign = "center"; x.textBaseline = "middle";
    x.font = `600 30px ${THEME.police}`;
    n.lignes.forEach((l, i) => x.fillText(l, 0, (i - (n.lignes.length - 1) / 2) * 38));
    x.restore();
  }
  // signature
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = borne((t - 1) / 1) * .7;
  x.fillStyle = THEME.hex; x.font = `600 24px ${THEME.police}`; x.textAlign = "right"; x.textBaseline = "alphabetic";
  x.fillText("LexOS · Produit du Québec", W - 50, H - 44);
  x.globalAlpha = 1;
}

/* ════════════════════════ 5. Lecture (comme un lecteur vidéo) ════════════════════════ */
function construire(auto = true) {
  const g = lireTexte($("#sc-texte").value);
  if (g.noeuds.length) { placer(g, $("#sc-style").value); minuter(g); }
  SC.scene = g; SC.t = 0;
  $("#sc-temps").max = Math.round((g.duree || 1) * 100);
  if (auto && g.noeuds.length) jouer(true); else dessiner(0);
}
function jouer(oui) {
  SC.joue = oui; $("#sc-jouer").textContent = oui ? "❚❚" : "▶";
  if (oui && SC.scene?.duree && SC.t >= SC.scene.duree) SC.t = 0;
  SC.avant = performance.now();
}
function boucleSc(m) {
  const visible = $("#vue-schemas").classList.contains("active") || SC.enregistre;
  if (visible) {
    const dt = (m - SC.avant) / 1000; SC.avant = m;
    if (SC.joue && SC.scene?.duree) {
      SC.t += dt * (SC.enregistre ? 1 : SC.vitesse);
      if (SC.t >= SC.scene.duree) {
        if (SC.enregistre) { SC.t = SC.scene.duree; finEnregistrement(); }
        else SC.t = SC.scene.construit + ((SC.t - SC.scene.construit) % D_FIN);   // le courant continue
      }
    }
    dessiner(SC.t);
    $("#sc-temps").value = Math.round(Math.min(SC.t, SC.scene?.duree || 0) * 100);
    $("#sc-temps").style.setProperty("--pct", (SC.scene?.duree ? Math.min(1, SC.t / SC.scene.duree) * 100 : 0) + "%");
    $("#sc-chrono").textContent = SC.t.toFixed(1).replace(".", ",") + " s / " + (SC.scene?.duree || 0).toFixed(1).replace(".", ",") + " s";
  } else SC.avant = m;
  requestAnimationFrame(boucleSc);
}
$("#sc-jouer").addEventListener("click", () => { if (!SC.scene?.noeuds.length) construire(); else jouer(!SC.joue); });
$("#sc-recommencer").addEventListener("click", () => { SC.t = 0; jouer(true); });
$("#sc-temps").addEventListener("input", (e) => { SC.t = e.target.value / 100; jouer(false); });
$("#sc-vitesse").addEventListener("change", (e) => { SC.vitesse = +e.target.value; });
$("#sc-style").addEventListener("change", () => construire());
$("#sc-animer").addEventListener("click", (e) => { construire(); etincelles(e.currentTarget, 16); });
let minuteurTexte = null;
$("#sc-texte").addEventListener("input", () => { clearTimeout(minuteurTexte); minuteurTexte = setTimeout(() => construire(false), 700); });

/* ════════════════════════ 6. L'IA écrit le schéma ════════════════════════ */
const SC_SYSTEME = "Tu fabriques des schémas. Réponds UNIQUEMENT avec le texte du schéma, sans explication, sans bloc de code. "
  + "Format exact :\ntitre: Le titre\n[Boîte A] -> [Boîte B] : action courte\n"
  + "Une flèche par ligne, 4 à 12 boîtes, noms courts (1 à 4 mots) commençant par un emoji, étiquettes de 1 à 3 mots, en français.";
$("#sc-generer").addEventListener("click", async (e) => {
  const demande = $("#sc-demande").value.trim(), modele = $("#sc-modele").value, btn = e.currentTarget;
  if (!demande) return toast("Décris d'abord ton schéma ✍️", true);
  if (!modele) return toast("Aucun modèle — regarde l'onglet Modèles.", true);
  if (SC.ctrlIA) { SC.ctrlIA.abort(); return; }
  SC.ctrlIA = new AbortController();
  btn.textContent = "■ Arrêter"; btn.classList.add("chargement"); etincelles(btn, 20);
  $("#sc-texte").value = "";
  try {
    const t = await flux(modele, [{ role: "system", content: SC_SYSTEME }, { role: "user", content: demande }], (txt) => {
      $("#sc-texte").value = sansPensee(txt).replace(/```\w*/g, "").trim();
      $("#sc-texte").scrollTop = $("#sc-texte").scrollHeight;
    }, SC.ctrlIA.signal);
    $("#sc-texte").value = sansPensee(t).replace(/```\w*/g, "").trim();
    if (!$("#sc-nom").value) $("#sc-nom").value = demande.slice(0, 40).replace(/[^A-Za-z0-9 _.'-]/g, "").trim();
    construire();
    if (!SC.scene.noeuds.length) toast("L'IA n'a pas suivi le format — essaie un autre modèle ou corrige le texte.", true);
  } catch (err) { if (err.name !== "AbortError") toast("Génération impossible : " + err.message, true); }
  finally { SC.ctrlIA = null; btn.textContent = "✨ Générer"; btn.classList.remove("chargement"); }
});

/* ════════════════════════ 7. Vidéo + image + sauvegarde sur la clé ════════════════════════ */
const nomSchema = () => ($("#sc-nom").value.trim() || "schema").replace(/[^A-Za-z0-9 _.'-]/g, "").slice(0, 60) || "schema";
const enB64 = (blob) => new Promise((r, x) => { const f = new FileReader(); f.onload = () => r(f.result.split(",")[1]); f.onerror = x; f.readAsDataURL(blob); });
async function envoyerSchema(sorte, contenu) {
  const corps = { nom: nomSchema(), sorte };
  if (sorte === "txt") corps.texte = contenu; else corps.data = await enB64(contenu);
  return api("/moteur/schemas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
}

let enregistreur = null, morceaux = [];
$("#sc-video").addEventListener("click", () => {
  if (!SC.scene?.noeuds.length) return toast("Anime d'abord un schéma ▶", true);
  if (SC.enregistre) return;
  const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => window.MediaRecorder?.isTypeSupported(m));
  if (!type) return toast("Ce navigateur ne sait pas enregistrer de vidéo.", true);
  morceaux = [];
  enregistreur = new MediaRecorder(SC.toile.captureStream(60), { mimeType: type, videoBitsPerSecond: 10_000_000 });
  enregistreur.ondataavailable = (e) => e.data.size && morceaux.push(e.data);
  enregistreur.onstop = async () => {
    const blob = new Blob(morceaux, { type: "video/webm" });
    $("#sc-info").textContent = "Copie de la vidéo sur la clé…";
    try {
      await envoyerSchema("txt", $("#sc-texte").value);
      const r = await envoyerSchema("webm", blob);
      toast("🎬 Vidéo enregistrée sur la clé : " + r.fichier);
      $("#sc-info").innerHTML = `✔ <a href="/schemas/${encodeURIComponent(r.fichier)}" target="_blank">${echapper(r.fichier)}</a> — dans MOTEUR-INTERFACE/schemas sur la clé`;
      listerSchemas();
    } catch (err) { toast("Vidéo non enregistrée : " + err.message, true); $("#sc-info").textContent = ""; }
  };
  SC.enregistre = true; $("#sc-rec").hidden = false; $(".sc-ecran").classList.add("rec");
  $("#sc-video").disabled = true; $("#sc-video").textContent = "● Enregistrement…";
  SC.t = 0; jouer(true);
  enregistreur.start(250);
});
function finEnregistrement() {
  SC.enregistre = false; jouer(false);
  $("#sc-rec").hidden = true; $(".sc-ecran").classList.remove("rec");
  $("#sc-video").disabled = false; $("#sc-video").textContent = "🎬 Enregistrer la vidéo";
  setTimeout(() => enregistreur?.state === "recording" && enregistreur.stop(), 300);
}
$("#sc-image").addEventListener("click", async (e) => {
  if (!SC.scene?.noeuds.length) return toast("Anime d'abord un schéma ▶", true);
  const btn = e.currentTarget;
  const garde = SC.t; dessiner(SC.scene.construit + 1.2);
  const blob = await new Promise((r) => SC.toile.toBlob(r, "image/png"));
  SC.t = garde;
  try {
    await envoyerSchema("txt", $("#sc-texte").value);
    const r = await envoyerSchema("png", blob);
    toast("🖼️ Image enregistrée sur la clé : " + r.fichier); etincelles(btn, 20); listerSchemas();
  } catch (err) { toast(err.message, true); }
});
$("#sc-sauver").addEventListener("click", async (e) => {
  try { await envoyerSchema("txt", $("#sc-texte").value); toast("Schéma enregistré sur la clé ✔"); etincelles(e.currentTarget, 14); listerSchemas(); }
  catch (err) { toast(err.message, true); }
});

async function listerSchemas() {
  let l = [];
  try { l = await api("/moteur/schemas"); } catch {}
  $("#sc-liste").innerHTML = l.length ? l.map((s, i) => `<li data-nom="${echapper(s.nom)}" style="animation-delay:${i * 40}ms">
      <span class="t">${echapper(s.nom)}</span>
      ${s.webm ? `<a href="/schemas/${encodeURIComponent(s.nom)}.webm" target="_blank" title="Voir la vidéo">🎬</a>` : ""}
      ${s.png ? `<a href="/schemas/${encodeURIComponent(s.nom)}.png" target="_blank" title="Voir l'image">🖼️</a>` : ""}
      <button class="x" data-suppr="${echapper(s.nom)}" title="Supprimer">✕</button></li>`).join("")
    : `<li class="vide-mini">Aucun schéma encore.</li>`;
}
$("#sc-liste").addEventListener("click", async (e) => {
  if (e.target.closest("a")) return;
  const x = e.target.closest("[data-suppr]");
  if (x) {
    if (!confirm(`Supprimer « ${x.dataset.suppr} » (texte, image et vidéo) ?`)) return;
    await fetch("/moteur/schemas/" + encodeURIComponent(x.dataset.suppr), { method: "DELETE" }).catch(() => {});
    return listerSchemas();
  }
  const li = e.target.closest("li[data-nom]");
  if (!li) return;
  try {
    const r = await fetch(`/schemas/${encodeURIComponent(li.dataset.nom)}.txt`);
    if (!r.ok) throw new Error("texte du schéma introuvable");
    $("#sc-texte").value = await r.text(); $("#sc-nom").value = li.dataset.nom;
    construire();
  } catch (err) { toast(err.message, true); }
});

/* ════════════════════════ Démarrage ════════════════════════ */
$("#sc-texte").value = EXEMPLE;
$$(".onglet").forEach((o) => o.addEventListener("click", () => {
  if (o.dataset.vue !== "schemas") return;
  remplirSelectModeles($("#sc-modele"), "lexos-modele-schema", S.etat?.defaut);
  listerSchemas();
  if (!SC.scene) construire();
}));
requestAnimationFrame((m) => { SC.avant = m; requestAnimationFrame(boucleSc); });
