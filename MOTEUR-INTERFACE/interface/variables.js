/* LexOS · 🔑 Variables d'environnement, façon Vercel
   🌍 globales (tous les projets) + 📁 par projet × environnement (Tous / Développement / Production)
   Tout est chiffré dans le coffre (.env.coffre) avec le mot de passe maître. */
"use strict";

const ENV = { mdp: "", minuteur: null, donnees: { globales: [], projets: {} }, projets: [], portee: "global", env: "tous" };
const NOM_ENV = { tous: "Tous", dev: "Développement", prod: "Production" };

function ouvrirEnv(portee) {
  $("#env").hidden = false;
  $(".env-cle").classList.remove("tourne"); void $(".env-cle").offsetWidth; $(".env-cle").classList.add("tourne");
  if (typeof portee === "string") ENV.portee = portee;
  else if (typeof CX !== "undefined" && CX.projet && $("#vue-codex").classList.contains("active")) ENV.portee = CX.projet;
  if (ENV.mdp) { montrerContenuEnv(); chargerEnv(); }
  else { $("#env-deverrouiller").hidden = false; $("#env-contenu").hidden = true; setTimeout(() => $("#env-mdp").focus(), 300); }
}
function fermerEnv() {
  $(".env-boite").classList.add("sort");
  setTimeout(() => { $("#env").hidden = true; $(".env-boite").classList.remove("sort"); }, 300);
}
function oublierMdpEnv() { ENV.mdp = ""; clearTimeout(ENV.minuteur); }
function montrerContenuEnv() { $("#env-deverrouiller").hidden = true; $("#env-contenu").hidden = false; }

async function appelEnv(corps) {
  const r = await fetch("/moteur/env", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mdp: ENV.mdp, portee: ENV.portee, env: ENV.portee === "global" ? "tous" : ENV.env, ...corps }) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 403) { oublierMdpEnv(); $("#env-deverrouiller").hidden = false; $("#env-contenu").hidden = true; }
  if (!r.ok) throw new Error(d.erreur || "Erreur " + r.status);
  if (d.globales) ENV.donnees = { globales: d.globales, projets: d.projets || {} };
  return d;
}

$("#env-deverrouiller").addEventListener("submit", async (e) => {
  e.preventDefault();
  ENV.mdp = $("#env-mdp").value;
  try {
    await appelEnv({ action: "liste", portee: "global" });
    $("#env-mdp").value = ""; $("#env-msg").textContent = ""; $(".env-boite").classList.remove("erreur");
    clearTimeout(ENV.minuteur); ENV.minuteur = setTimeout(oublierMdpEnv, 10 * 60000);   // oublié après 10 min
    montrerContenuEnv(); await chargerEnv();
    etincelles($(".env-cle"), 20);
  } catch (err) {
    ENV.mdp = "";
    $("#env-msg").textContent = err.message;
    $(".env-boite").classList.remove("erreur"); void $(".env-boite").offsetWidth; $(".env-boite").classList.add("erreur");
  }
});

async function chargerEnv() {
  try { ENV.projets = await api("/moteur/projets"); } catch { ENV.projets = []; }
  if (ENV.portee !== "global" && !ENV.projets.includes(ENV.portee)) ENV.portee = "global";
  try { await appelEnv({ action: "liste", portee: "global" }); } catch (err) { return toast(err.message, true); }
  rendreEnv();
}

function rendreEnv() {
  // Portées : 🌍 global + un onglet par projet (avec le nombre de variables)
  const nb = (p) => (ENV.donnees.projets[p] || []).length;
  $("#env-portees").innerHTML = [`<button type="button" data-p="global" class="${ENV.portee === "global" ? "actif" : ""}">🌍 Globales <b>${ENV.donnees.globales.length}</b></button>`]
    .concat(ENV.projets.map((p) => `<button type="button" data-p="${echapper(p)}" class="${ENV.portee === p ? "actif" : ""}">📁 ${echapper(p)} <b>${nb(p)}</b></button>`)).join("");
  const projet = ENV.portee !== "global";
  $("#env-envs").hidden = !projet; $("#env-bas").hidden = !projet;
  $$("#env-envs button").forEach((b) => b.classList.toggle("actif", b.dataset.e === ENV.env));
  placerGlisse();
  $("#env-aide").innerHTML = projet
    ? `Variables de <b>📁 ${echapper(ENV.portee)}</b> pour <b>${NOM_ENV[ENV.env]}</b>. Elles s'ajoutent aux 🌍 globales (et les remplacent si même nom).`
    : `Les <b>🌍 globales</b> sont pour tous les projets (et chargées dans le moteur LexOS).`;
  // Liste
  let liste;
  if (!projet) liste = ENV.donnees.globales.map((n) => ({ nom: n, env: "tous" }));
  else liste = (ENV.donnees.projets[ENV.portee] || []).filter((v) => ENV.env === "tous" || v.env === ENV.env || v.env === "tous");
  $("#env-liste").innerHTML = liste.length ? liste.map((v, i) => `<li data-nom="${echapper(v.nom)}" data-env="${v.env}" style="animation-delay:${i * 45}ms">
      <code class="env-nom">${echapper(v.nom)}</code>
      ${projet ? `<span class="env-badge e-${v.env}">${NOM_ENV[v.env]}</span>` : ""}
      <span class="env-val">••••••••••</span>
      <button type="button" class="btn-icone" data-a="voir" title="Voir">👁</button>
      <button type="button" class="btn-icone" data-a="copier" title="Copier la valeur">📋</button>
      <button type="button" class="btn-icone" data-a="export" title="Copier « export NOM=… » pour le terminal">⌨️</button>
      <button type="button" class="btn-icone" data-a="modifier" title="Modifier">✏️</button>
      <button type="button" class="btn-icone" data-a="retirer" title="Supprimer">🗑</button></li>`).join("")
    : `<li class="env-vide">${projet ? `Aucune variable pour ${echapper(ENV.portee)} (${NOM_ENV[ENV.env]}).` : "Aucune variable globale."} Ajoute-en une ci-dessus 👆</li>`;
}
function placerGlisse() {
  const b = $("#env-envs button.actif"), g = $(".env-envs-glisse");
  if (b && g) { g.style.left = b.offsetLeft + "px"; g.style.width = b.offsetWidth + "px"; }
}

$("#env-portees").addEventListener("click", (e) => {
  const b = e.target.closest("[data-p]"); if (!b) return;
  ENV.portee = b.dataset.p; rendreEnv();
  $("#env-liste").classList.remove("change"); void $("#env-liste").offsetWidth; $("#env-liste").classList.add("change");
});
$("#env-envs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-e]"); if (!b) return;
  ENV.env = b.dataset.e; rendreEnv();
});

$("#env-ajout").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nom = $("#env-nom").value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_"), valeur = $("#env-valeur").value;
  if (!nom) return $("#env-nom").focus();
  try {
    await appelEnv({ action: "definir", nom, valeur });
    $("#env-nom").value = ""; $("#env-valeur").value = "";
    rendreEnv();
    toast(`🔑 ${nom} enregistrée (chiffrée) · ${ENV.portee === "global" ? "🌍 globale" : `📁 ${ENV.portee} · ${NOM_ENV[ENV.env]}`}`);
    const li = $(`#env-liste li[data-nom="${CSS.escape(nom)}"]`); if (li) { li.classList.add("nouveau"); etincelles(li, 18); }
  } catch (err) { toast(err.message, true); }
});

$("#env-liste").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  const li = b.closest("li"), nom = li.dataset.nom, a = b.dataset.a, env = li.dataset.env;
  try {
    if (a === "retirer") {
      if (!confirm(`Supprimer la variable ${nom} ?`)) return;
      li.classList.add("sort");
      await appelEnv({ action: "retirer", nom, env });
      return setTimeout(rendreEnv, 300);
    }
    if (a === "modifier") {
      if (ENV.portee !== "global") { ENV.env = env; rendreEnv(); }
      $("#env-nom").value = nom; $("#env-valeur").value = ""; $("#env-valeur").focus();
      return toast("Entre la nouvelle valeur puis « ＋ Ajouter »");
    }
    const { valeur } = await appelEnv({ action: "lire", nom, env });
    if (a === "voir") {
      const v = $(".env-val", li);
      if (v.classList.toggle("visible")) { v.textContent = valeur; setTimeout(() => { v.textContent = "••••••••••"; v.classList.remove("visible"); }, 15000); }
      else v.textContent = "••••••••••";
    } else if (a === "copier") {
      await copierTexte(valeur); retourCopie(b, "✔"); toast("Valeur copiée (pense à vider ton presse-papiers après)");
    } else if (a === "export") {
      await copierTexte(SUR_WINDOWS() ? `set ${nom}=${valeur}` : `export ${nom}='${valeur.replace(/'/g, "'\\''")}'`); retourCopie(b, "✔");
      toast("Commande copiée : colle-la dans ton terminal");
    }
  } catch (err) { toast(err.message, true); }
});

// « vercel env pull » : écrit .env ou .env.production dans le projet
$$("[data-tirer-env]").forEach((b) => b.addEventListener("click", async () => {
  const env = b.dataset.tirerEnv, fichier = env === "prod" ? ".env.production" : ".env";
  if (!confirm(`Écrire ${ENV.portee}/${fichier} EN CLAIR (globales + projet + ${NOM_ENV[env]}) ?\nIl sera ajouté au .gitignore.`)) return;
  try {
    const r = await appelEnv({ action: "tirer", env });
    toast(`📄 ${r.fichier} écrit (${r.n} variable(s))`); etincelles(b, 22);
    if (typeof listerFichiers === "function" && CX.projet === ENV.portee) listerFichiers();
  } catch (err) { toast(err.message, true); }
}));

$("#ouvrir-env").addEventListener("click", () => ouvrirEnv());
$$("[data-env]").forEach((b) => b.addEventListener("click", () => ouvrirEnv(CX.projet || "global")));
$("#env-fermer").addEventListener("click", fermerEnv);
$("#env").addEventListener("click", (e) => { if (e.target.id === "env") fermerEnv(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#env").hidden) fermerEnv(); });
addEventListener("resize", placerGlisse);
$("#verrouiller")?.addEventListener("click", oublierMdpEnv);      // verrouiller = oublier le mot de passe du coffre
