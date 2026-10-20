/* LexOS · Moteur d'interface — logique de l'interface (aucune dépendance) */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const mem = {
  lire(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  ecrire(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const S = {
  etat: null,
  modeles: [],
  conv: null,          // { id, titre, modele, messages: [] }
  images: [],          // base64 en attente
  ctrl: null,          // AbortController de la réponse en cours
};

/* ════════════════════════ Effets : vague, tilt, étincelles ════════════════════════ */
document.addEventListener("pointerdown", (e) => {
  const b = e.target.closest(".btn");
  if (!b) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height);
  const v = document.createElement("span");
  v.className = "vague";
  Object.assign(v.style, { width: s + "px", height: s + "px", left: e.clientX - r.left - s / 2 + "px", top: e.clientY - r.top - s / 2 + "px" });
  b.appendChild(v); setTimeout(() => v.remove(), 650);
});
document.addEventListener("mousemove", (e) => {
  const c = e.target.closest?.(".carte");
  if (!c) return;
  const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
  c.style.transform = `rotateX(${(.5 - py) * 10}deg) rotateY(${(px - .5) * 12}deg) translateZ(6px)`;
  c.style.setProperty("--mx", px * 100 + "%"); c.style.setProperty("--my", py * 100 + "%");
});
document.addEventListener("mouseout", (e) => {
  const c = e.target.closest?.(".carte");
  if (c && !c.contains(e.relatedTarget)) c.style.transform = "";
});
function etincelles(el, n = 18) {
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < n; i++) {
    const s = document.createElement("i");
    s.className = "etincelle";
    if (i % 3 === 0) s.style.background = "#fff";
    s.style.left = cx + "px"; s.style.top = cy + "px";
    document.body.appendChild(s);
    const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 80;
    s.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 },
               { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(0)`, opacity: 0 }],
              { duration: 600 + Math.random() * 400, easing: "cubic-bezier(.2,.8,.3,1)" }).onfinish = () => s.remove();
  }
}

/* ════════════════════════ Toasts ════════════════════════ */
function toast(msg, erreur = false) {
  const t = document.createElement("div");
  t.className = "toast" + (erreur ? " erreur" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.classList.add("sort"); setTimeout(() => t.remove(), 400); }, 4000);
}

/* ════════════════════════ Utilitaires ════════════════════════ */
const echapper = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const octets = (n) => { if (!n && n !== 0) return "—"; const u = ["o", "Ko", "Mo", "Go", "To"]; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toFixed(i > 2 ? 1 : 0).replace(".", ",") + " " + u[i]; };
const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erreur || d.error || "Erreur " + r.status);
  return d;
}

function machineAEcrire(el, texte, vitesse = 38) {
  el.textContent = "";
  let i = 0;
  const t = setInterval(() => { el.textContent = texte.slice(0, ++i); if (i >= texte.length) clearInterval(t); }, vitesse);
}

/* ════════════════════════ Mini Markdown (sûr) ════════════════════════ */
function rendre(md) {
  const blocs = [];
  md = md.replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => {
    blocs.push(`<pre><div class="pre-tete"><span>${echapper(lang || "code")}</span><button class="copier" type="button">Copier</button></div><code>${echapper(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000${blocs.length - 1}\u0000`;
  });
  const enLigne = (s) => echapper(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  const out = [];
  for (const part of md.split(/\n{2,}/)) {
    const p = part.trim();
    if (!p) continue;
    if (/^\u0000\d+\u0000$/.test(p)) { out.push(p); continue; }
    const lignes = p.split("\n");
    if (lignes.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
      const ord = /^\s*\d/.test(lignes[0]);
      out.push(`<${ord ? "ol" : "ul"}>${lignes.map((l) => `<li>${enLigne(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>`).join("")}</${ord ? "ol" : "ul"}>`);
    } else if (/^#{1,4}\s/.test(p)) {
      out.push(`<p><b>${enLigne(p.replace(/^#+\s*/, ""))}</b></p>`);
    } else {
      out.push(`<p>${lignes.map(enLigne).join("<br>")}</p>`);
    }
  }
  return out.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => blocs[+i]);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".copier:not(.appliquer)");
  if (!b) return;
  navigator.clipboard?.writeText(b.closest("pre").querySelector("code").textContent);
  b.textContent = "Copié ✔"; b.classList.add("fait");
  setTimeout(() => { b.textContent = "Copier"; b.classList.remove("fait"); }, 1500);
});

/* ════════════════════════ Démarrage ════════════════════════ */
async function demarrer() {
  const etape = (t, pct) => { $("#boot-etape").textContent = t; $("#boot-progres").style.width = pct + "%"; };
  etape("Vérification de l'accès…", 8); await attendre(500);
  await exigerAcces();
  etape("Recherche de la clé…", 15); await attendre(350);
  try {
    S.etat = await api("/moteur/etat");
    etape("Clé trouvée : " + S.etat.cle, 40); await attendre(450);
  } catch { etape("Clé introuvable…", 40); }
  etape("Réveil du moteur IA…", 65);
  await chargerModeles(); await attendre(350);
  etape("Chargement des conversations…", 85);
  await chargerConvs(); await attendre(350);
  etape("Prêt ✔", 100); await attendre(500);
  $("#boot").classList.add("parti");
  $("#app").classList.add("pret");
  setTimeout(() => $("#boot").remove(), 900);
  machineAEcrire($(".machine"), $(".machine").dataset.texte);
  afficherEtat();
  setInterval(ping, 10000);
}

async function ping() {
  try { const v = await api("/api/version"); marquer(true, "Moteur actif", v.version); }
  catch { marquer(false, "Moteur injoignable"); }
}
function marquer(ok, texte, version) {
  $("#point").className = "point " + (ok ? "ok" : "ko");
  $("#etat-texte").textContent = texte;
  if (version) $("#puce-version").textContent = "Ollama " + version;
}
function afficherEtat() {
  const e = S.etat;
  if (!e) return marquer(false, "Moteur injoignable");
  marquer(true, "Moteur actif", e.ollama);
  $("#etat-pc").textContent = `Sur ${e.pc} · port ${e.port}`;
  // Vue clé
  if (e.disque) {
    const pct = Math.round((1 - e.disque.libre / e.disque.total) * 100);
    $("#jauge").style.strokeDashoffset = 314.16 * (1 - pct / 100);
    let n = 0; const t = setInterval(() => { $("#jauge-pct").textContent = n + "%"; if (n++ >= pct) clearInterval(t); }, 18);
    $("#jauge-detail").textContent = `${octets(e.disque.libre)} libres sur ${octets(e.disque.total)}`;
  }
  const lignes = [
    ["Clé montée à", e.cle], ["PC actuel", e.pc], ["Système", e.systeme],
    ["Moteur Ollama", e.binaire], ["Version", e.ollama], ["Port du moteur", e.port],
    ["Dossier des modèles", e.modeles], ["Conversations", "MOTEUR-INTERFACE/conversations (sur la clé)"],
    ["Interface", "v" + e.version],
  ];
  $("#infos-cle").innerHTML = lignes.map(([k, v], i) => `<div class="info-ligne" style="animation-delay:${i * 60}ms"><span>${echapper(k)}</span><b>${echapper(String(v ?? "—"))}</b></div>`).join("");
  rendreGguf();
}

/* ════════════════════════ Modèles ════════════════════════ */
async function chargerModeles() {
  try {
    const d = await api("/api/tags");
    S.modeles = (d.models || []).sort((a, b) => a.name.localeCompare(b.name));
  } catch { S.modeles = []; }
  const sel = $("#modele");
  const garde = mem.lire("lexos-modele", "") || S.etat?.defaut || "";
  const texte = modelesTexte();
  sel.innerHTML = texte.length
    ? texte.map((m) => `<option value="${echapper(m.name)}">${echapper(m.name)}</option>`).join("")
    : `<option value="">(aucun modèle de texte sur la clé)</option>`;
  if (texte.some((m) => m.name === garde)) sel.value = garde;
  rendreModeles();
}
/* Les modèles d'IMAGE ne savent pas discuter : on les garde hors des menus Chat / Codex */
const RE_MODELE_IMAGE = /z[-_ ]?image|flux|sdxl|stable[-_ ]?diffusion|\bsd3|qwen[-_]?image|hidream/i;
const modelesTexte = () => S.modeles.filter((m) => !RE_MODELE_IMAGE.test(m.name));
function expliquerErreur(msg) {
  if (/unknown model architecture|error loading model/i.test(msg))
    return "Ce modèle ne peut pas être chargé par Ollama (architecture inconnue). Si c'est un modèle d'image en .gguf (fait pour ComfyUI / stable-diffusion.cpp), il ne marche pas dans Ollama : télécharge plutôt x/z-image-turbo dans l'onglet 🎨 Images.";
  if (/does not support (chat|generate)|not support/i.test(msg)) return "Ce modèle ne sait pas discuter. Choisis un modèle de texte (qwen3, llama…).";
  if (/out of memory|cuda|cudaMalloc/i.test(msg)) return "Pas assez de mémoire sur la carte graphique pour ce modèle. Essaie un modèle plus petit.";
  return msg;
}
const RE_DEMANDE_IMAGE = /\b(cr[ée]+r?|g[ée]n[èée]re[rz]?|dessine[rz]?|fais|fai|peins?|montre)[- ]?(moi|nous)?\s+(une?|des|la|le|mon|ma)?\s*(image|dessin|logo|photo|illustration|affiche|ic[oô]ne|portrait|paysage|fond d'[ée]cran)/i;

function rendreModeles() {
  const actuel = $("#modele").value;
  const box = $("#cartes-modeles");
  if (!S.modeles.length) { box.innerHTML = `<div class="vide">Aucun modèle trouvé dans le dossier de modèles de la clé.</div>`; return; }
  box.innerHTML = S.modeles.map((m, i) => {
    const d = m.details || {};
    const tags = [d.parameter_size, d.quantization_level, d.family].filter(Boolean);
    const choisi = m.name === actuel;
    return `<div class="carte ${choisi ? "choisi" : ""}" style="animation-delay:${i * 70}ms">
      ${choisi ? '<span class="badge-actif">● actif</span>' : ""}
      <h3>${echapper(m.name)}</h3>
      <div class="sous">${octets(m.size)} sur la clé</div>
      <div class="tags">${tags.map((t) => `<span class="tag">${echapper(t)}</span>`).join("")}</div>
      <button class="btn ${choisi ? "btn-contour" : "btn-plein"}" data-utiliser="${echapper(m.name)}">${choisi ? "En cours d'utilisation" : "Utiliser ce modèle"}</button>
    </div>`;
  }).join("");
}
$("#cartes-modeles").addEventListener("click", (e) => {
  const b = e.target.closest("[data-utiliser]");
  if (!b) return;
  $("#modele").value = b.dataset.utiliser;
  $("#modele").dispatchEvent(new Event("change"));
  etincelles(b);
});
$("#modele").addEventListener("change", () => {
  mem.ecrire("lexos-modele", $("#modele").value);
  $("#puce-version").classList.remove("flash"); void $("#puce-version").offsetWidth; $("#puce-version").classList.add("flash");
  rendreModeles();
  toast("Modèle : " + $("#modele").value);
});

function rendreGguf() {
  const g = S.etat?.gguf || [];
  const box = $("#cartes-gguf");
  if (!g.length) { box.innerHTML = `<div class="vide">Aucun fichier .gguf trouvé sur la clé.</div>`; return; }
  box.innerHTML = g.map((f, i) => `<div class="carte" style="animation-delay:${i * 70}ms">
      <h3>${echapper(f.nom)}</h3>
      <div class="sous">${octets(f.taille)} · ${echapper(f.chemin)}</div>
      <button class="btn btn-plein" data-importer="${echapper(f.chemin)}">Importer dans le moteur</button>
    </div>`).join("");
}
$("#cartes-gguf").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-importer]");
  if (!b || b.disabled) return;
  b.disabled = true; b.classList.add("chargement"); b.textContent = "Importation… (peut être long)";
  try {
    const r = await api("/moteur/importer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chemin: b.dataset.importer }) });
    toast("Importé ✔ " + r.modele); etincelles(b, 30);
    b.textContent = "Importé ✔";
    await chargerModeles();
  } catch (err) {
    toast("Import impossible : " + err.message, true);
    b.disabled = false; b.textContent = "Réessayer";
  } finally { b.classList.remove("chargement"); }
});

/* ════════════════════════ Onglets ════════════════════════ */
function allerA(vue) {
  $$(".onglet").forEach((o) => o.classList.toggle("actif", o.dataset.vue === vue));
  $$(".vue").forEach((v) => v.classList.toggle("active", v.id === "vue-" + vue));
  const o = $(`.onglet[data-vue="${vue}"]`);
  $(".onglet-indicateur").style.top = o.offsetTop + "px";
  $(".onglet-indicateur").style.height = o.offsetHeight + "px";
  $("#cote").classList.remove("ouvert");
  if (vue === "cle") api("/moteur/etat").then((e) => { S.etat = e; afficherEtat(); }).catch(() => {});
  if (vue === "modeles") rendreModeles();
}
$$(".onglet").forEach((o) => o.addEventListener("click", () => allerA(o.dataset.vue)));
/* Menu de gauche : s'ouvre et se ferme en douceur (bouton ☰ ou Ctrl+B) */
const petitEcran = matchMedia("(max-width: 860px)");
function basculerMenu(forcer) {
  if (petitEcran.matches) { $("#cote").classList.toggle("ouvert", forcer); $("#menu").classList.toggle("ferme", !$("#cote").classList.contains("ouvert")); return; }
  const replie = $("#app").classList.toggle("replie", forcer === undefined ? undefined : !forcer);
  $("#menu").classList.toggle("ferme", replie);
  mem.ecrire("lexos-menu-replie", replie ? "1" : "");
  setTimeout(() => dispatchEvent(new Event("resize")), 560);
}
$("#menu").addEventListener("click", () => basculerMenu());
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); basculerMenu(); } });
if (mem.lire("lexos-menu-replie", "") && !petitEcran.matches) { $("#app").classList.add("replie"); $("#menu").classList.add("ferme"); }
if (petitEcran.matches) $("#menu").classList.add("ferme");

/* ════════════════════════ Conversations (sur la clé) ════════════════════════ */
async function chargerConvs() {
  let liste = [];
  try { liste = await api("/moteur/conversations"); } catch {}
  $("#convs").innerHTML = liste.length ? liste.map((c, i) => `<li data-id="${echapper(c.id)}" class="${S.conv?.id === c.id ? "actif" : ""}" style="animation-delay:${i * 45}ms">
      <span class="t">${echapper(c.titre)}</span><button class="x" title="Supprimer" data-suppr="${echapper(c.id)}">✕</button></li>`).join("")
    : `<li style="cursor:default;color:var(--gris)">Aucune encore</li>`;
}
$("#convs").addEventListener("click", async (e) => {
  const x = e.target.closest("[data-suppr]");
  if (x) {
    e.stopPropagation();
    const li = x.closest("li"); li.classList.add("sort");
    await api("/moteur/conversations/" + x.dataset.suppr, { method: "DELETE" }).catch(() => {});
    if (S.conv?.id === x.dataset.suppr) nouvelle();
    setTimeout(chargerConvs, 380);
    return;
  }
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  try {
    S.conv = await api("/moteur/conversations/" + li.dataset.id);
    S.conv.id = li.dataset.id;
    if (S.conv.modele && S.modeles.some((m) => m.name === S.conv.modele)) $("#modele").value = S.conv.modele;
    afficherConv(); allerA("chat"); chargerConvs();
  } catch (err) { toast(err.message, true); }
});
async function sauver() {
  if (!S.conv) return;
  await api("/moteur/conversations/" + S.conv.id, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ titre: S.conv.titre, modele: $("#modele").value, messages: S.conv.messages }),
  }).catch((e) => toast("Sauvegarde sur la clé impossible : " + e.message, true));
  chargerConvs();
}
function nouvelle() {
  S.conv = null;
  $("#fil").innerHTML = "";
  const a = accueilModele.cloneNode(true);
  $("#fil").appendChild(a);
  machineAEcrire($(".machine", a), $(".machine", a).dataset.texte, 30);
  brancherSuggestions();
  chargerConvs(); allerA("chat");
  $("#saisie").focus();
}
const accueilModele = $("#accueil").cloneNode(true);
$("#nouveau").addEventListener("click", (e) => { etincelles(e.currentTarget, 24); nouvelle(); });
function brancherSuggestions() {
  $$(".sugg").forEach((s) => s.addEventListener("click", () => { $("#saisie").value = s.textContent; envoyer(); }));
}
brancherSuggestions();

function afficherConv() {
  $("#fil").innerHTML = "";
  for (const m of S.conv.messages) ajouterMsg(m.role, m.content, m.images);
  $("#fil").scrollTop = $("#fil").scrollHeight;
}

/* ════════════════════════ Messages ════════════════════════ */
function ajouterMsg(role, contenu, images) {
  $("#accueil")?.remove();
  const ia = role === "assistant";
  const m = document.createElement("div");
  m.className = "msg " + (ia ? "ia" : "moi");
  const av = ia ? `<div class="avatar"><img src="logo.png" alt=""></div>` : `<div class="avatar">A</div>`;
  m.innerHTML = `${av}<div class="corps"><div class="texte"></div></div>`;
  const t = $(".texte", m);
  if (ia) remplirIA(t, contenu || "");
  else {
    (images || []).forEach((b) => { const i = document.createElement("img"); i.className = "jointe"; i.src = "data:image/*;base64," + b; t.appendChild(i); });
    const p = document.createElement("p"); p.textContent = contenu; t.appendChild(p);
  }
  $("#fil").appendChild(m);
  $("#fil").scrollTop = $("#fil").scrollHeight;
  return m;
}
function remplirIA(t, texte, pense = "") {
  const m = texte.match(/^\s*<think>([\s\S]*?)(<\/think>|$)/);
  if (m) { pense = (pense + m[1]).trim(); texte = texte.slice(m[0].length); }
  t.innerHTML = (pense ? `<details class="pense"><summary>Réflexion de l'IA</summary>${rendre(pense)}</details>` : "")
    + (texte.trim() ? rendre(texte) : (pense ? "" : `<span class="points"><i></i><i></i><i></i></span>`));
}

/* ════════════════════════ Envoi + réponse en direct ════════════════════════ */
const saisie = $("#saisie");
saisie.addEventListener("input", () => { saisie.style.height = "auto"; saisie.style.height = Math.min(saisie.scrollHeight, 220) + "px"; });
saisie.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envoyer(); } });
$("#composer").addEventListener("submit", (e) => { e.preventDefault(); envoyer(); });
$("#stop").addEventListener("click", () => S.ctrl?.abort());

$("#fichier").addEventListener("change", async (e) => {
  for (const f of e.target.files) {
    const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(f); });
    S.images.push(b64);
  }
  e.target.value = "";
  rendrePieces();
});
function rendrePieces() {
  $("#pieces").innerHTML = S.images.map((b, i) => `<div class="piece"><img src="data:image/*;base64,${b}" alt=""><button type="button" data-i="${i}">✕</button></div>`).join("");
}
$("#pieces").addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) { S.images.splice(+b.dataset.i, 1); rendrePieces(); } });

async function envoyer() {
  const texte = saisie.value.trim();
  const modele = $("#modele").value;
  if (!texte || S.ctrl) { $(".boite").classList.remove("secoue"); void $(".boite").offsetWidth; $(".boite").classList.add("secoue"); return; }
  if (!modele) return toast("Aucun modèle sur la clé — regarde l'onglet Modèles.", true);

  const btn = $("#envoyer");
  btn.classList.remove("parti"); void btn.offsetWidth; btn.classList.add("parti");
  etincelles(btn);

  if (!S.conv) S.conv = { id: nouvelId(), titre: texte.slice(0, 48), messages: [] };
  if (RE_DEMANDE_IMAGE.test(texte) && typeof imageDansChat === "function") {
    saisie.value = ""; saisie.style.height = "auto";
    return imageDansChat(texte);
  }
  const images = S.images.splice(0); rendrePieces();
  const msgUser = { role: "user", content: texte };
  if (images.length) msgUser.images = images;
  S.conv.messages.push(msgUser);
  ajouterMsg("user", texte, images);
  saisie.value = ""; saisie.style.height = "auto";

  const bulle = ajouterMsg("assistant", "");
  bulle.classList.add("ecrit");
  const t = $(".texte", bulle);
  let rep = "", pense = "", mots = 0;
  const debut = performance.now();
  S.ctrl = new AbortController();
  $("#stop").hidden = false; btn.hidden = true;

  try {
    const r = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: S.ctrl.signal,
      body: JSON.stringify({ model: modele, messages: S.conv.messages, stream: true }),
    });
    if (!r.ok || !r.body) throw new Error((await r.text()).slice(0, 200) || "Erreur " + r.status);
    const lecteur = r.body.getReader(), dec = new TextDecoder();
    let tampon = "", dernier = 0;
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      tampon += dec.decode(value, { stream: true });
      const lignes = tampon.split("\n"); tampon = lignes.pop();
      for (const l of lignes) {
        if (!l.trim()) continue;
        let d; try { d = JSON.parse(l); } catch { continue; }
        if (d.error) throw new Error(d.error);
        const morceau = d.message?.content || "";
        pense += d.message?.thinking || "";
        rep += morceau; mots += morceau.split(/\s+/).filter(Boolean).length;
      }
      const maintenant = performance.now();
      if (maintenant - dernier > 50) {
        dernier = maintenant;
        const bas = $("#fil").scrollHeight - $("#fil").scrollTop - $("#fil").clientHeight < 120;
        remplirIA(t, rep, pense);
        if (bas) $("#fil").scrollTop = $("#fil").scrollHeight;
        $("#puce-vitesse").textContent = Math.round(mots / ((maintenant - debut) / 1000)) + " mots/s";
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") { const m = expliquerErreur(err.message); toast("L'IA n'a pas pu répondre : " + m, true); if (!rep) rep = "⚠️ " + m; }
    else rep += rep ? "\n\n*(arrêté)*" : "*(arrêté)*";
  } finally {
    S.ctrl = null; $("#stop").hidden = true; btn.hidden = false;
    bulle.classList.remove("ecrit");
    remplirIA(t, rep, pense);
    const s = ((performance.now() - debut) / 1000).toFixed(1);
    const meta = document.createElement("div"); meta.className = "meta";
    meta.textContent = `${modele} · ${s} s`;
    t.parentElement.appendChild(meta);
    $("#fil").scrollTop = $("#fil").scrollHeight;
    S.conv.messages.push({ role: "assistant", content: rep });
    sauver();
    saisie.focus();
  }
}

/* ════════════════════════ Éteindre ════════════════════════ */
$("#eteindre").addEventListener("click", () => { $("#modal").hidden = false; });
$("#modal-non").addEventListener("click", () => { $("#modal").hidden = true; });
$("#modal-oui").addEventListener("click", async () => {
  S.ctrl?.abort();
  await fetch("/moteur/arreter", { method: "POST" }).catch(() => {});
  $("#modal").hidden = true; $("#fin").hidden = false;
  $("#app").style.filter = "blur(8px)";
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#modal").hidden = true; });

demarrer().then(() => allerA("chat"));
