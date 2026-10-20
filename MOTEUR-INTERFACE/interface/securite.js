/* LexOS · Mot de passe de l'utilisateur — écran de verrou, verrouillage auto, changement */
"use strict";

const _q = (s) => document.querySelector(s);
const SEC = { attente: null, resoudre: null, mode: "entrer", minuteur: null, derniereActivite: Date.now(), etat: null };

/* Si une requête répond « verrouillé » (session perdue, moteur redémarré), on remontre le verrou */
const _fetchOriginal = window.fetch.bind(window);
window.fetch = async (...args) => {
  const r = await _fetchOriginal(...args);
  if (r.status === 401 && !String(args[0]).includes("/moteur/acces/")) montrerVerrou();
  return r;
};

async function etatAcces() {
  try { return await (await _fetchOriginal("/moteur/acces/etat", { cache: "no-store" })).json(); }
  catch { return { configure: true, connecte: false }; }
}

/* Appelé au démarrage : ne rend la main qu'une fois déverrouillé */
async function exigerAcces() {
  SEC.etat = await etatAcces();
  if (SEC.etat.connecte) return;
  await montrerVerrou();
}

function montrerVerrou() {
  if (SEC.attente) return SEC.attente;
  const creation = SEC.etat && !SEC.etat.configure;
  SEC.mode = creation ? "creer" : "entrer";
  _q("#verrou-titre").textContent = creation ? "Crée ton mot de passe" : "LexOS est verrouillé";
  _q("#verrou-sous").textContent = creation
    ? "Il protège tes conversations, projets et clés. 8 caractères minimum."
    : "Entre ton mot de passe pour continuer.";
  _q("#champ2").hidden = !creation;
  _q("#force").hidden = !creation;
  _q("#verrou-note").hidden = creation;
  _q("#mdp1").autocomplete = creation ? "new-password" : "current-password";
  _q("#verrou-go").textContent = creation ? "🔐 Créer et entrer" : "🔓 Déverrouiller";
  _q("#mdp1").value = ""; _q("#mdp2").value = ""; _q("#verrou-msg").textContent = "";
  const v = _q("#verrou");
  v.hidden = false; v.classList.remove("ouvert", "parti");
  _q("#cadenas").classList.remove("ouvert");
  document.body.classList.add("verrouille");
  setTimeout(() => _q("#mdp1").focus(), 450);
  SEC.attente = new Promise((r) => { SEC.resoudre = r; });
  return SEC.attente;
}

function cacherVerrou() {
  const v = _q("#verrou");
  _q("#cadenas").classList.add("ouvert");
  v.classList.add("ouvert");
  setTimeout(() => { v.classList.add("parti"); document.body.classList.remove("verrouille"); }, 650);
  setTimeout(() => { v.hidden = true; v.classList.remove("ouvert", "parti"); }, 1400);
  SEC.derniereActivite = Date.now();
  const r = SEC.resoudre; SEC.attente = null; SEC.resoudre = null;
  window.dispatchEvent(new Event("lexos:deverrouille"));
  r && r();
}

function erreurVerrou(msg) {
  const b = _q(".verrou-boite");
  _q("#verrou-msg").textContent = msg;
  b.classList.remove("erreur"); void b.offsetWidth; b.classList.add("erreur");
  _q("#mdp1").select();
}

/* Force du mot de passe (création) */
function force(m) {
  let s = 0;
  if (m.length >= 8) s++; if (m.length >= 12) s++; if (m.length >= 16) s++;
  if (/[a-z]/.test(m) && /[A-Z]/.test(m)) s++; if (/\d/.test(m)) s++; if (/[^A-Za-z0-9]/.test(m)) s++;
  return Math.min(4, Math.floor(s * 4 / 6 + (m.length >= 8 ? .5 : 0)));
}
_q("#mdp1").addEventListener("input", (e) => {
  if (SEC.mode !== "creer") return;
  const n = force(e.target.value), noms = ["trop court", "faible", "moyen", "bon", "excellent 💪"];
  _q("#force-i").style.width = (e.target.value ? 12 + n * 22 : 0) + "%";
  _q("#force-i").dataset.n = n; _q("#force-txt").textContent = e.target.value ? noms[n] : "";
});
document.querySelectorAll(".oeil").forEach((b) => b.addEventListener("click", () => {
  const i = document.getElementById(b.dataset.cible);
  i.type = i.type === "password" ? "text" : "password";
  b.classList.toggle("actif", i.type === "text"); i.focus();
}));

let compteRebours = null;
function bloquer(sec) {
  const go = _q("#verrou-go"); go.disabled = true;
  clearInterval(compteRebours);
  let r = sec;
  const maj = () => { _q("#verrou-msg").textContent = `Trop d'essais. Réessaie dans ${r} s ⏳`; if (r-- <= 0) { clearInterval(compteRebours); go.disabled = false; _q("#verrou-msg").textContent = ""; } };
  maj(); compteRebours = setInterval(maj, 1000);
}

_q("#verrou-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mdp = _q("#mdp1").value, go = _q("#verrou-go");
  if (!mdp) return erreurVerrou("Écris ton mot de passe.");
  if (SEC.mode === "creer") {
    if (mdp.length < 8) return erreurVerrou("Minimum 8 caractères.");
    if (mdp !== _q("#mdp2").value) return erreurVerrou("Les deux mots de passe ne sont pas pareils.");
  }
  go.disabled = true; go.classList.add("chargement");
  try {
    const r = await _fetchOriginal(`/moteur/acces/${SEC.mode}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mdp }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { SEC.etat = { ...(SEC.etat || {}), configure: true, connecte: true }; cacherVerrou(); return; }
    if (d.attente) bloquer(d.attente); else erreurVerrou(d.erreur || "Erreur " + r.status);
  } catch { erreurVerrou("Le moteur ne répond pas."); }
  finally { go.classList.remove("chargement"); if (!_q("#verrou-msg").textContent.startsWith("Trop")) go.disabled = false; }
});

/* Bouton « Verrouiller » + verrouillage automatique */
async function verrouillerMaintenant() {
  await _fetchOriginal("/moteur/acces/sortir", { method: "POST" }).catch(() => {});
  SEC.etat = { ...(SEC.etat || {}), configure: true, connecte: false };
  montrerVerrou();
}
_q("#verrouiller").addEventListener("click", verrouillerMaintenant);
["mousemove", "keydown", "pointerdown", "wheel"].forEach((ev) => addEventListener(ev, () => { SEC.derniereActivite = Date.now(); }, { passive: true }));
function lireAuto() { try { return +(localStorage.getItem("lexos-auto-verrou") ?? 15); } catch { return 15; } }
_q("#auto-verrou").value = String(lireAuto());
_q("#auto-verrou").addEventListener("change", (e) => { try { localStorage.setItem("lexos-auto-verrou", e.target.value); } catch {} });
setInterval(() => {
  const min = +_q("#auto-verrou").value;
  if (min && !SEC.attente && Date.now() - SEC.derniereActivite > min * 60000) verrouillerMaintenant();
}, 15000);

/* Paramètres → changer le mot de passe */
_q("#changer-mdp").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ancien = _q("#mdp-ancien").value, nouveau = _q("#mdp-nouveau").value;
  const dire = (m, err) => (typeof toast === "function" ? toast(m, err) : alert(m));
  if (nouveau.length < 8) return dire("Le nouveau mot de passe doit avoir 8 caractères minimum.", true);
  if (nouveau !== _q("#mdp-confirme").value) return dire("Les deux nouveaux mots de passe ne sont pas pareils.", true);
  const r = await _fetchOriginal("/moteur/acces/changer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ancien, nouveau }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return dire("Pas changé : " + (d.erreur || r.status), true);
  ["#mdp-ancien", "#mdp-nouveau", "#mdp-confirme"].forEach((s) => { _q(s).value = ""; });
  dire("Mot de passe changé ✔" + (SEC.etat?.coffre ? " (le coffre des clés aussi)" : ""));
});
async function majInfoCoffre() {
  const e = await etatAcces(); SEC.etat = { ...SEC.etat, ...e };
  _q("#sec-coffre").innerHTML = !e.coffre
    ? "Aucun coffre sur la clé. Pour chiffrer tes clés API : <code>python3 coffre.py creer</code> dans le dossier MOTEUR-INTERFACE, avec le <b>même</b> mot de passe."
    : e.cryptographie ? "✔ Coffre <code>.env.coffre</code> trouvé : il s'ouvre avec ton mot de passe, les clés sont chargées en mémoire seulement."
    : "⚠️ Coffre trouvé, mais le module <code>cryptography</code> manque sur ce PC (<code>pip install cryptography</code>) : les clés ne sont pas chargées.";
}
document.querySelectorAll('.onglet[data-vue="parametres"]').forEach((o) => o.addEventListener("click", majInfoCoffre));
