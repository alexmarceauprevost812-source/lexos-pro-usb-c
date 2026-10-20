/* LexOS · ☁️ IA en ligne — chacun met SA clé API (Claude, ChatGPT, Gemini, OpenRouter, Groq, Mistral)
   + compteur du mois (jetons ET dollars) avec limites pour ne jamais dépasser son budget.
   Les clés sont gardées chiffrées dans le coffre ; elles ne reviennent jamais dans le navigateur. */
"use strict";

const NU = { etat: null, liste: {}, ouvert: "" };
const ICONES_NUAGE = { anthropic: "✳️", openai: "🤖", gemini: "✨", openrouter: "🔀", groq: "⚡", mistral: "🌬️" };
const fmtJetons = (n) => n >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + " M" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + " k" : String(n || 0);
const fmtDollars = (n) => (n || 0).toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: n && n < 0.1 ? 4 : 2 }) + " $";

function ouvrirNuage() {
  $("#nuage").hidden = false;
  $(".nu-icone").classList.remove("flotte"); void $(".nu-icone").offsetWidth; $(".nu-icone").classList.add("flotte");
  chargerNuage();
}
function fermerNuage() {
  $(".nu-boite").classList.add("sort");
  setTimeout(() => { $("#nuage").hidden = true; $(".nu-boite").classList.remove("sort"); }, 300);
}
$("#nu-fermer").addEventListener("click", fermerNuage);
$("#nuage").addEventListener("click", (e) => { if (e.target.id === "nuage") fermerNuage(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#nuage").hidden) fermerNuage(); });

async function chargerNuage() {
  try { NU.etat = await api("/moteur/nuage"); } catch (e) { return toast("IA en ligne : " + e.message, true); }
  rendreNuage();
}
async function configNuage(changements) {
  const r = await fetch("/moteur/nuage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "config", ...changements }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erreur || "Erreur " + r.status);
  NU.etat = d; rendreNuage();
  if (typeof chargerModeles === "function") chargerModeles();     // les menus voient les nouveaux modèles
}

/* ── Le mot de passe maître (le même que pour 🔑 Variables) ── */
function mdpNuage() {
  if (typeof ENV !== "undefined" && ENV.mdp) return ENV.mdp;
  return $("#nu-mdp").value;
}
async function cleNuage(f, valeur) {
  const mdp = mdpNuage();
  if (!mdp) { $("#nu-verrou").classList.remove("secoue"); void $("#nu-verrou").offsetWidth; $("#nu-verrou").classList.add("secoue"); $("#nu-mdp").focus(); throw new Error("entre ton mot de passe maître en haut"); }
  const r = await fetch("/moteur/env", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mdp, portee: "global", env: "tous", action: valeur === null ? "retirer" : "definir", nom: f.variable, valeur: valeur ?? "" }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erreur || "Erreur " + r.status);
  if (typeof ENV !== "undefined" && !ENV.mdp) { ENV.mdp = mdp; clearTimeout(ENV.minuteur); ENV.minuteur = setTimeout(oublierMdpEnv, 10 * 60000); }
  $("#nu-mdp").value = "";
}

/* ── Affichage ── */
function jauge(id, valeur, limite, texte, sous) {
  const pct = limite ? Math.min(1, valeur / limite) : 0;
  const c = 2 * Math.PI * 52;
  const el = $(id);
  el.classList.toggle("alerte", pct >= .8 && pct < 1); el.classList.toggle("pleine", pct >= 1);
  el.innerHTML = `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="fond"/>
    <circle cx="60" cy="60" r="52" class="barre" style="stroke-dasharray:${c};stroke-dashoffset:${c}"/></svg>
    <div class="nu-jauge-txt"><b>${texte}</b><small>${sous}</small></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => { $(".barre", el).style.strokeDashoffset = limite ? c * (1 - pct) : c * .999; }));
}

function rendreNuage() {
  const e = NU.etat; if (!e) return;
  const c = e.compteur, r = e.resume;
  const mois = new Date(c.mois + "-02").toLocaleDateString("fr-CA", { month: "long", year: "numeric" });
  $("#nu-mois").textContent = mois;
  jauge("#nu-jauge-jetons", r.jetons, r.limite_jetons, fmtJetons(r.jetons), r.limite_jetons ? "sur " + fmtJetons(r.limite_jetons) + " jetons" : "jetons · pas de limite");
  jauge("#nu-jauge-dollars", r.dollars, r.limite_dollars, fmtDollars(r.dollars), r.limite_dollars ? "sur " + fmtDollars(r.limite_dollars) : "estimé · pas de limite");
  $("#nu-etat").className = "nu-etat " + (r.bloque ? "pleine" : r.alerte ? "alerte" : "");
  $("#nu-etat").textContent = r.bloque ? "🛑 Limite atteinte : les modèles en ligne sont en pause jusqu'au mois prochain."
    : r.alerte ? `⚠️ Attention : ${r.pourcent} % de ta limite est utilisé.` : `${c.requetes} demande${c.requetes > 1 ? "s" : ""} ce mois-ci · ${fmtJetons(c.entree)} envoyés · ${fmtJetons(c.sortie)} reçus`;
  if (document.activeElement?.id !== "nu-lim-jetons") $("#nu-lim-jetons").value = e.limites.jetons || "";
  if (document.activeElement?.id !== "nu-lim-dollars") $("#nu-lim-dollars").value = e.limites.dollars || "";

  // Verrou : caché si le coffre des 🔑 Variables est déjà ouvert
  $("#nu-verrou").hidden = typeof ENV !== "undefined" && !!ENV.mdp;

  // Fournisseurs
  $("#nu-fournisseurs").innerHTML = e.fournisseurs.map((f, i) => `
    <div class="nu-carte ${f.cle ? "branche" : ""} ${NU.ouvert === f.id ? "ouverte" : ""}" data-f="${f.id}" style="animation-delay:${i * 60}ms">
      <div class="nu-carte-tete"><span class="nu-logo">${ICONES_NUAGE[f.id] || "☁️"}</span>
        <div><b>${echapper(f.nom)}</b><small>${f.cle ? "🟢 clé ajoutée" : "⚪ pas de clé"}</small></div></div>
      ${f.cle ? `<div class="nu-boutons">
          <button class="btn btn-plein mini" data-lister>📋 Choisir des modèles</button>
          <button class="btn btn-contour mini" data-changer>✏️ Changer</button>
          <button class="btn-icone" data-retirer title="Retirer la clé">🗑</button></div>`
        : `<button class="btn btn-contour mini nu-lien" data-site="${echapper(f.site)}">🔗 Se connecter et prendre ma clé</button>`}
      <form class="nu-ajout" ${f.cle && NU.ouvert !== "cle-" + f.id ? "hidden" : ""} autocomplete="off">
        <div class="champ"><input type="password" placeholder="Colle ta clé ${echapper(f.variable)}" spellcheck="false" autocomplete="off"></div>
        <button class="btn btn-plein mini">💾</button>
      </form>
      <div class="nu-liste" ${NU.ouvert === f.id ? "" : "hidden"}></div>
    </div>`).join("");
  if (NU.ouvert && NU.liste[NU.ouvert]) rendreListe(NU.ouvert);

  // Mes modèles en ligne + prix
  const mes = e.modeles;
  $("#nu-mes").innerHTML = mes.length ? mes.map((m, i) => {
    const p = e.prix[m] || ["", ""], u = c.modeles[m];
    const f = m.slice(6).split("/")[0];
    return `<li data-m="${echapper(m)}" style="animation-delay:${i * 40}ms">
      <span class="nu-logo petit">${ICONES_NUAGE[f] || "☁️"}</span>
      <span class="nu-nom">${echapper(m.slice(6))}</span>
      <label>entrée <input type="number" min="0" step="0.01" value="${p[0]}" data-prix="0" placeholder="$/M"></label>
      <label>sortie <input type="number" min="0" step="0.01" value="${p[1]}" data-prix="1" placeholder="$/M"></label>
      <span class="nu-usage">${u ? `${fmtJetons(u.entree + u.sortie)} · ${fmtDollars(u.dollars)}` : "—"}</span>
      <button class="btn-icone" data-enlever title="Enlever">✕</button></li>`;
  }).join("") : `<li class="vide">Aucun modèle en ligne. Ajoute une clé, puis « 📋 Choisir des modèles ».</li>`;

  // Images ChatGPT
  if (document.activeElement?.id !== "nu-im-modele") $("#nu-im-modele").value = e.image_modele || "gpt-image-1";
  if (document.activeElement?.id !== "nu-im-prix") $("#nu-im-prix").value = e.image_prix || "";
  $("#nu-images").classList.toggle("eteint", !e.fournisseurs.find((f) => f.id === "openai")?.cle);
}

function rendreListe(fid) {
  const carte = $(`.nu-carte[data-f="${fid}"]`); if (!carte) return;
  const zone = $(".nu-liste", carte), tous = NU.liste[fid] || [];
  const filtre = (zone.dataset.filtre || "").toLowerCase();
  const mes = new Set(NU.etat.modeles);
  const vus = tous.filter((m) => m.toLowerCase().includes(filtre)).slice(0, 150);
  zone.innerHTML = `<input class="nu-cherche" placeholder="🔎 chercher parmi ${tous.length} modèles…" value="${echapper(zone.dataset.filtre || "")}">
    <div class="nu-choix">${vus.map((m) => { const n = `nuage:${fid}/${m}`; return `<button type="button" class="${mes.has(n) ? "pris" : ""}" data-ajouter="${echapper(n)}">${mes.has(n) ? "✔" : "＋"} ${echapper(m)}</button>`; }).join("") || "<small>rien trouvé</small>"}</div>`;
}

/* ── Clics sur les cartes de fournisseurs ── */
$("#nu-fournisseurs").addEventListener("click", async (ev) => {
  const carte = ev.target.closest(".nu-carte"); if (!carte) return;
  const f = NU.etat.fournisseurs.find((x) => x.id === carte.dataset.f);
  const site = ev.target.closest("[data-site]");
  if (site) { window.open(site.dataset.site, "_blank", "noopener"); $("input", $(".nu-ajout", carte)).focus(); return; }
  if (ev.target.closest("[data-changer]")) { NU.ouvert = "cle-" + f.id; rendreNuage(); $(`.nu-carte[data-f="${f.id}"] .nu-ajout input`).focus(); return; }
  if (ev.target.closest("[data-retirer]")) {
    if (!confirm(`Retirer la clé ${f.nom} du coffre ?`)) return;
    try { await cleNuage(f, null); toast(`🗑 Clé ${f.nom} retirée`); carte.classList.add("debranche"); setTimeout(chargerNuage, 350); chargerModeles?.(); }
    catch (e) { toast(e.message, true); }
    return;
  }
  const lister = ev.target.closest("[data-lister]");
  if (lister) {
    if (NU.ouvert === f.id) { NU.ouvert = ""; return rendreNuage(); }
    lister.disabled = true; lister.textContent = "⏳ je demande la liste…";
    try {
      const r = await fetch("/moteur/nuage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "lister", fournisseur: f.id }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.erreur);
      NU.liste[f.id] = d.modeles; NU.ouvert = f.id; rendreNuage();
    } catch (e) { toast(e.message, true); lister.disabled = false; lister.textContent = "📋 Choisir des modèles"; }
    return;
  }
  const aj = ev.target.closest("[data-ajouter]");
  if (aj) {
    const n = aj.dataset.ajouter, mes = NU.etat.modeles;
    const nouv = mes.includes(n) ? mes.filter((x) => x !== n) : [...mes, n];
    aj.classList.add("boing");
    try { await configNuage({ modeles: nouv }); if (!mes.includes(n)) { toast("☁️ " + n.slice(6) + " ajouté aux menus"); etincelles(aj, 12); } }
    catch (e) { toast(e.message, true); }
  }
});
$("#nu-fournisseurs").addEventListener("input", (ev) => {
  if (!ev.target.classList.contains("nu-cherche")) return;
  const zone = ev.target.closest(".nu-liste"); zone.dataset.filtre = ev.target.value;
  const pos = ev.target.selectionStart; rendreListe(zone.closest(".nu-carte").dataset.f);
  const i = $(".nu-cherche", zone); i.focus(); i.setSelectionRange(pos, pos);
});
$("#nu-fournisseurs").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const carte = ev.target.closest(".nu-carte"), f = NU.etat.fournisseurs.find((x) => x.id === carte.dataset.f);
  const v = $("input", ev.target).value.trim();
  if (v.length < 12) return toast("Cette clé a l'air trop courte 🤔", true);
  try {
    await cleNuage(f, v);
    NU.ouvert = ""; toast(`🔑 Clé ${f.nom} gardée dans le coffre`);
    carte.classList.add("branche-anim"); etincelles(carte, 26);
    setTimeout(chargerNuage, 500);
  } catch (e) { toast(e.message, true); }
});

/* ── Mes modèles : prix et retrait ── */
let minuteurPrix = null;
$("#nu-mes").addEventListener("input", (ev) => {
  if (!ev.target.dataset.prix) return;
  clearTimeout(minuteurPrix);
  minuteurPrix = setTimeout(() => {
    const prix = {};
    $$("#nu-mes li[data-m]").forEach((li) => { prix[li.dataset.m] = [+$('[data-prix="0"]', li).value || 0, +$('[data-prix="1"]', li).value || 0]; });
    configNuage({ prix }).then(() => toast("💲 Prix gardés")).catch((e) => toast(e.message, true));
  }, 700);
});
$("#nu-mes").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-enlever]"); if (!b) return;
  const li = b.closest("li"); li.classList.add("sort");
  setTimeout(() => configNuage({ modeles: NU.etat.modeles.filter((m) => m !== li.dataset.m) }).catch((e) => toast(e.message, true)), 300);
});
$("#nu-ajout-manuel").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const v = $("#nu-manuel").value.trim().replace(/^nuage:/, "");
  if (!/^[a-z]+\/.+/.test(v)) return toast("Forme : fournisseur/modèle (ex. openai/gpt-4o-mini)", true);
  configNuage({ modeles: [...NU.etat.modeles, "nuage:" + v] }).then(() => { $("#nu-manuel").value = ""; toast("☁️ ajouté"); }).catch((e) => toast(e.message, true));
});

/* ── Limites, images, remise à zéro ── */
$("#nu-limites").addEventListener("submit", (ev) => {
  ev.preventDefault();
  configNuage({ limites: { jetons: +$("#nu-lim-jetons").value || 0, dollars: +$("#nu-lim-dollars").value || 0 } })
    .then(() => { toast("🛡️ Limites gardées"); etincelles(ev.submitter || $("#nu-limites button"), 16); }).catch((e) => toast(e.message, true));
});
$("#nu-images").addEventListener("submit", (ev) => {
  ev.preventDefault();
  configNuage({ image_modele: $("#nu-im-modele").value.trim() || "gpt-image-1", image_prix: +$("#nu-im-prix").value || 0 })
    .then(() => { toast("🎨 Réglages d'images gardés"); if (typeof trouverModelesImage === "function") trouverModelesImage(); })
    .catch((e) => toast(e.message, true));
});
$("#nu-remettre").addEventListener("click", async () => {
  if (!confirm("Remettre le compteur du mois à zéro ? (Ça n'efface rien chez le fournisseur.)")) return;
  const r = await fetch("/moteur/nuage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remettre" }) });
  NU.etat = await r.json(); rendreNuage(); toast("🔄 Compteur remis à zéro");
});

/* ── Appelé par le Chat / Codex / Images après chaque réponse en ligne ── */
function noterCompteur(r) {
  if (!r) return;
  if (NU.etat) { NU.etat.resume = r; }
  const puce = $("#puce-nuage");
  if (puce) {
    puce.hidden = false;
    puce.textContent = "☁️ " + fmtJetons(r.jetons) + (r.dollars ? " · " + fmtDollars(r.dollars) : "");
    puce.className = "puce " + (r.bloque ? "pleine" : r.alerte ? "alerte" : "");
    puce.classList.remove("flash"); void puce.offsetWidth; puce.classList.add("flash");
  }
  if (r.bloque) toast("🛑 Limite du mois atteinte pour l'IA en ligne.", true);
  else if (r.alerte && !NU.averti) { NU.averti = true; toast(`⚠️ ${r.pourcent} % de ta limite d'IA en ligne est utilisé ce mois-ci.`, true); }
  if (!$("#nuage").hidden) chargerNuage();
}
$("#puce-nuage")?.addEventListener("click", ouvrirNuage);
