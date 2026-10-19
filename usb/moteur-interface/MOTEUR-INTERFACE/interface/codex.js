/* LexOS · Codex + Codex équipe — projets gardés SUR la clé */
"use strict";

const CX = { projet: "", fichier: "", modifie: false, ctrl: null, eqCtrl: null, fichiersEquipe: [] };

/* ════════════════════════ Outils communs ════════════════════════ */
const sansPensee = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();

async function flux(modele, messages, surMorceau, signal) {
  const r = await fetch("/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ model: modele, messages, stream: true, options: { num_ctx: 8192 } }),
  });
  if (!r.ok || !r.body) throw new Error((await r.text()).slice(0, 200) || "Erreur " + r.status);
  const lecteur = r.body.getReader(), dec = new TextDecoder();
  let tampon = "", tout = "";
  for (;;) {
    const { value, done } = await lecteur.read();
    if (done) break;
    tampon += dec.decode(value, { stream: true });
    const lignes = tampon.split("\n"); tampon = lignes.pop();
    for (const l of lignes) {
      if (!l.trim()) continue;
      let d; try { d = JSON.parse(l); } catch { continue; }
      if (d.error) throw new Error(d.error);
      const m = d.message?.content || "";
      if (m) { tout += m; surMorceau(tout); }
    }
  }
  return tout;
}

function remplirSelectModeles(sel, cle, prefere) {
  const garde = mem.lire(cle, "") || prefere || "";
  sel.innerHTML = S.modeles.length
    ? S.modeles.map((m) => `<option value="${echapper(m.name)}">${echapper(m.name)}</option>`).join("")
    : `<option value="">(aucun modèle)</option>`;
  const choix = [garde, prefere, ...S.modeles.filter((m) => /coder|code/i.test(m.name)).map((m) => m.name)]
    .find((n) => n && S.modeles.some((m) => m.name === n));
  if (choix) sel.value = choix;
  sel.onchange = () => mem.ecrire(cle, sel.value);
}

async function listerProjets(...selects) {
  let projets = [];
  try { projets = await api("/moteur/projets"); } catch {}
  if (!projets.length) {
    await api("/moteur/projets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nom: "mon-projet" }) }).catch(() => {});
    projets = ["mon-projet"];
  }
  for (const sel of selects) {
    const avant = sel.value || mem.lire("lexos-projet", "");
    sel.innerHTML = projets.map((p) => `<option value="${echapper(p)}">${echapper(p)}</option>`).join("");
    if (projets.includes(avant)) sel.value = avant;
  }
  return projets;
}
const urlProjet = (p) => "/moteur/projets/" + encodeURIComponent(p);

/* ════════════════════════ CODEX ════════════════════════ */
const ed = $("#cx-texte"), lignes = $("#cx-lignes");

function majLignes() {
  const n = ed.value.split("\n").length;
  lignes.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n");
  lignes.scrollTop = ed.scrollTop;
}
ed.addEventListener("input", () => { majLignes(); marquerModifie(true); });
ed.addEventListener("scroll", () => { lignes.scrollTop = ed.scrollTop; });
ed.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const s = ed.selectionStart;
    ed.setRangeText("    ", s, ed.selectionEnd, "end");
    majLignes(); marquerModifie(true);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); sauverFichier(); }
});
function marquerModifie(v) { CX.modifie = v; $("#cx-modifie").hidden = !v; }

async function ouvrirCodex() {
  remplirSelectModeles($("#cx-modele"), "lexos-modele-codex", S.etat?.codex);
  await listerProjets($("#cx-projet"), $("#eq-projet"));
  if ($("#cx-projet").value !== CX.projet) { CX.projet = $("#cx-projet").value; CX.fichier = ""; }
  await listerFichiers();
}
$("#cx-projet").addEventListener("change", async () => {
  if (CX.modifie && !confirm("Le fichier n'est pas enregistré. Changer de projet quand même ?")) { $("#cx-projet").value = CX.projet; return; }
  CX.projet = $("#cx-projet").value; mem.ecrire("lexos-projet", CX.projet);
  CX.fichier = ""; ed.value = ""; majLignes(); marquerModifie(false); $("#cx-nom").textContent = "Aucun fichier";
  listerFichiers();
});

async function listerFichiers() {
  let f = [];
  try { f = await api(urlProjet(CX.projet) + "/fichiers"); } catch {}
  $("#cx-fichiers").innerHTML = f.length
    ? f.map((x, i) => `<li data-f="${echapper(x.chemin)}" class="${x.chemin === CX.fichier ? "actif" : ""}" style="animation-delay:${i * 35}ms"><span>${icone(x.chemin)}</span>${echapper(x.chemin)}</li>`).join("")
    : `<li class="vide-mini">Projet vide — crée un fichier ou lance le Codex équipe.</li>`;
}
function icone(n) {
  const e = n.split(".").pop().toLowerCase();
  return { py: "🐍", js: "📜", html: "🌐", css: "🎨", json: "🧾", md: "📝", sh: "⚙️", txt: "📄" }[e] || "📄";
}
$("#cx-fichiers").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-f]");
  if (li) ouvrirFichier(li.dataset.f);
});
async function ouvrirFichier(chemin) {
  if (CX.modifie && !confirm("Le fichier n'est pas enregistré. L'abandonner ?")) return;
  try {
    const d = await api(`${urlProjet(CX.projet)}/fichier?chemin=${encodeURIComponent(chemin)}`);
    CX.fichier = chemin; ed.value = d.contenu; majLignes(); marquerModifie(false);
    $("#cx-nom").textContent = chemin;
    $(".cx-code").classList.remove("arrive"); void ed.offsetWidth; $(".cx-code").classList.add("arrive");
    $$("#cx-fichiers li").forEach((l) => l.classList.toggle("actif", l.dataset.f === chemin));
  } catch (err) { toast(err.message, true); }
}
async function sauverFichier() {
  if (!CX.fichier) {
    const n = prompt("Nom du nouveau fichier (ex. : main.py) :");
    if (!n) return;
    CX.fichier = n.trim(); $("#cx-nom").textContent = CX.fichier;
  }
  try {
    await api(urlProjet(CX.projet) + "/fichier", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chemin: CX.fichier, contenu: ed.value }) });
    marquerModifie(false); toast("Enregistré sur la clé ✔ " + CX.fichier); etincelles($("#cx-sauver"), 20);
    listerFichiers();
  } catch (err) { toast("Enregistrement impossible : " + err.message, true); }
}
$("#cx-sauver").addEventListener("click", sauverFichier);
$("#cx-nouveau-fichier").addEventListener("click", async () => {
  if (CX.modifie && !confirm("Le fichier n'est pas enregistré. L'abandonner ?")) return;
  const n = prompt("Nom du nouveau fichier (ex. : main.py, web/index.html) :");
  if (!n) return;
  CX.fichier = n.trim(); ed.value = ""; majLignes(); $("#cx-nom").textContent = CX.fichier;
  await sauverFichier(); ed.focus();
});
$("#cx-nouveau-projet").addEventListener("click", async () => {
  const n = prompt("Nom du nouveau projet (lettres, chiffres, - _ .) :");
  if (!n) return;
  try {
    const r = await api("/moteur/projets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nom: n.trim() }) });
    mem.ecrire("lexos-projet", r.nom);
    await listerProjets($("#cx-projet"), $("#eq-projet"));
    $("#cx-projet").value = r.nom; $("#cx-projet").dispatchEvent(new Event("change"));
    toast("Projet créé sur la clé ✔ " + r.nom);
  } catch (err) { toast(err.message, true); }
});

/* Codex : discussion à propos du fichier ouvert */
const CX_SYSTEME = "Tu es Codex, un assistant de programmation qui roule en local sur la clé LexOS d'Alex. "
  + "Réponds en français québécois simple et direct. Quand tu modifies ou écris du code, donne TOUJOURS le fichier COMPLET "
  + "dans un seul bloc ```langage … ``` pour qu'on puisse l'appliquer d'un clic. Sois concis dans tes explications. "
  + "Tu ne peux PAS exécuter de commandes : c'est Alex qui les tape dans son terminal, déjà placé dans le dossier du projet. "
  + "Quand il faut une commande, mets-la dans un bloc ```bash séparé (une commande par ligne, sans sudo si possible). "
  + "Quand Alex te colle un résultat de terminal, explique l'erreur simplement et donne la prochaine étape.";
let cxHistorique = [];

function bulleCx(role, texte) {
  $(".cx-astuce")?.remove();
  const b = document.createElement("div");
  b.className = "cx-msg " + role;
  b.innerHTML = role === "moi" ? `<p>${echapper(texte)}</p>` : "";
  $("#cx-fil").appendChild(b);
  $("#cx-fil").scrollTop = $("#cx-fil").scrollHeight;
  return b;
}
/* ── Terminal « à la main » : on copie, Alex colle et lance lui-même ── */
const LANG_TERMINAL = /^(bash|sh|shell|zsh|console|terminal|cmd|bat|powershell|ps1?)$/i;
const SUR_WINDOWS = () => /windows/i.test(S.etat?.systeme || "");

async function copierTexte(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch {
    const z = document.createElement("textarea");
    z.value = t; z.style.position = "fixed"; z.style.opacity = "0";
    document.body.appendChild(z); z.select();
    const ok = document.execCommand("copy"); z.remove(); return ok;
  }
}
function retourCopie(btn, texte = "Copié ✔") {
  const avant = btn.textContent;
  btn.textContent = texte; btn.classList.add("fait"); etincelles(btn, 14);
  setTimeout(() => { btn.textContent = avant; btn.classList.remove("fait"); }, 1600);
}
function cheminProjet() {
  if (!S.etat?.cle || !CX.projet) return "";
  const sep = SUR_WINDOWS() ? "\\" : "/";
  return [S.etat.cle, "MOTEUR-INTERFACE", "projets", CX.projet].join(sep);
}
function commandeCd(projet = CX.projet) {
  const ancien = CX.projet; CX.projet = projet;
  const c = cheminProjet(); CX.projet = ancien;
  return SUR_WINDOWS() ? `cd /d "${c}"` : `cd "${c}"`;
}
function commandeLancer(fichier) {
  const ext = (fichier.split(".").pop() || "").toLowerCase(), f = `"${fichier}"`, w = SUR_WINDOWS();
  return { py: (w ? "py " : "python3 ") + f, js: "node " + f, sh: "bash " + f, rb: "ruby " + f, php: "php " + f,
           html: (w ? "start \"\" " : "xdg-open ") + f, bat: f, ps1: "powershell -File " + f }[ext] || "";
}

$("#cx-chemin").addEventListener("click", async (e) => {
  const bouton = e.currentTarget;
  if (!CX.projet) return toast("Choisis d'abord un projet.", true);
  await copierTexte(commandeCd());
  retourCopie(bouton);
  toast("Colle ça dans ton terminal (Ctrl+Maj+V) pour aller dans le projet 📂");
});
$("#cx-lancer").addEventListener("click", async (e) => {
  const bouton = e.currentTarget;
  if (!CX.fichier) return toast("Ouvre d'abord un fichier.", true);
  const cmd = commandeLancer(CX.fichier);
  if (!cmd) return toast("Je ne sais pas comment lancer ce type de fichier.", true);
  if (CX.modifie) await sauverFichier();
  await copierTexte(`${commandeCd()} && ${cmd}`);
  retourCopie(bouton);
  toast("Commande copiée — colle-la dans ton terminal, puis recolle le résultat ici 📥");
});

/* ── Recoller ce que le terminal a affiché ── */
$("#cx-resultat").addEventListener("click", () => {
  const p = $("#cx-coller"); p.hidden = !p.hidden;
  if (!p.hidden) $("#cx-coller-texte").focus();
});
$("#cx-coller-auto").addEventListener("click", async () => {
  try { $("#cx-coller-texte").value = await navigator.clipboard.readText(); $("#cx-coller-texte").focus(); }
  catch { toast("Colle avec Ctrl+V dans la boîte 👇"); $("#cx-coller-texte").focus(); }
});
$("#cx-coller-envoyer").addEventListener("click", () => {
  const t = $("#cx-coller-texte").value.trim();
  if (!t) return toast("Colle d'abord ce que ton terminal a affiché.", true);
  $("#cx-coller-texte").value = ""; $("#cx-coller").hidden = true;
  demanderCodex("Voici ce que mon terminal a affiché :\n```\n" + t.slice(-12000) + "\n```\nExplique-moi ce qui se passe et dis-moi quoi faire ensuite.");
});

function boutonsAppliquer(b) {
  $$("pre", b).forEach((pre) => {
    const tete = $(".pre-tete", pre);
    if (!tete || $(".appliquer", tete)) return;
    const lang = $("span", tete)?.textContent || "";
    if (LANG_TERMINAL.test(lang)) {                      // commande → copier pour le terminal
      const t = document.createElement("button");
      t.type = "button"; t.className = "copier appliquer term-copie"; t.textContent = "📋 Copier pour le terminal";
      t.onclick = async () => {
        const cmd = $("code", pre).textContent.split("\n").map((l) => l.replace(/^\s*[$>]\s?/, "")).join("\n").trim();
        await copierTexte(cmd); retourCopie(t);
        toast("Colle-la dans ton terminal, puis recolle le résultat avec 📥");
      };
      tete.insertBefore(t, $(".copier:not(.appliquer)", tete));
      return;
    }
    const a = document.createElement("button");
    a.type = "button"; a.className = "copier appliquer"; a.textContent = "↳ Appliquer";
    a.onclick = () => {
      ed.value = $("code", pre).textContent; majLignes(); marquerModifie(true);
      if (!CX.fichier) $("#cx-nom").textContent = "nouveau fichier (pas encore enregistré)";
      $(".cx-code").classList.remove("applique"); void ed.offsetWidth; $(".cx-code").classList.add("applique");
      etincelles(a, 16); toast("Code appliqué — n'oublie pas d'enregistrer 💾");
    };
    tete.insertBefore(a, $(".copier:not(.appliquer)", tete));
  });
}

async function demanderCodex(question) {
  const modele = $("#cx-modele").value;
  if (!question || CX.ctrl) return;
  if (!modele) return toast("Aucun modèle — regarde l'onglet Modèles.", true);
  bulleCx("moi", question);
  const contexte = CX.fichier || ed.value
    ? `Fichier ouvert : ${CX.fichier || "(sans nom)"}\n\`\`\`\n${ed.value.slice(0, 24000)}\n\`\`\`\n\nDemande : ${question}`
    : question;
  const messages = [{ role: "system", content: CX_SYSTEME }, ...cxHistorique.slice(-6), { role: "user", content: contexte }];
  const b = bulleCx("ia", ""); b.classList.add("ecrit");
  b.innerHTML = `<span class="points"><i></i><i></i><i></i></span>`;
  CX.ctrl = new AbortController(); $("#cx-stop").hidden = false;
  let rep = "";
  try {
    rep = await flux(modele, messages, (t) => {
      b.innerHTML = rendre(sansPensee(t)) || `<span class="points"><i></i><i></i><i></i></span>`;
      $("#cx-fil").scrollTop = $("#cx-fil").scrollHeight;
    }, CX.ctrl.signal);
  } catch (err) {
    if (err.name !== "AbortError") toast("Codex n'a pas pu répondre : " + err.message, true);
  } finally {
    CX.ctrl = null; $("#cx-stop").hidden = true; b.classList.remove("ecrit");
    b.innerHTML = rendre(sansPensee(rep) || "*(arrêté)*"); boutonsAppliquer(b);
    cxHistorique.push({ role: "user", content: question }, { role: "assistant", content: sansPensee(rep) });
  }
}
$("#cx-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#cx-saisie").value.trim(); $("#cx-saisie").value = "";
  etincelles($("#cx-form .rond"), 14); demanderCodex(q);
});
$("#cx-saisie").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#cx-form").requestSubmit(); } });
$("#cx-stop").addEventListener("click", () => CX.ctrl?.abort());
$$("[data-cx]").forEach((b) => b.addEventListener("click", () => demanderCodex(b.dataset.cx)));

/* ════════════════════════ CODEX ÉQUIPE ════════════════════════ */
const AGENTS = [
  { id: "architecte", nom: "Architecte", icone: "🧭", role: "planifie le programme", cle: "chat",
    systeme: "Tu es l'ARCHITECTE d'une équipe de programmeurs IA. À partir de la demande, écris un plan court en français : "
      + "1) ce que fait le programme, 2) le langage choisi (Python par défaut), 3) la LISTE EXACTE des fichiers à créer avec le rôle de chacun, "
      + "4) les étapes. Pas de code. Reste simple : le moins de fichiers possible." },
  { id: "codeur", nom: "Codeur", icone: "⌨️", role: "écrit tout le code", cle: "codex",
    systeme: "Tu es le CODEUR d'une équipe. Écris le code COMPLET et fonctionnel de CHAQUE fichier du plan. "
      + "Format OBLIGATOIRE pour chaque fichier, sans exception :\n### FICHIER: chemin/du/fichier.ext\n```langage\n…code complet…\n```\n"
      + "Aucun « … » ni partie à compléter. Commentaires en français." },
  { id: "reviseur", nom: "Réviseur", icone: "🔍", role: "teste et critique", cle: "chat",
    systeme: "Tu es le RÉVISEUR d'une équipe. Lis le code attentivement et cherche les bogues, oublis, erreurs d'import, cas non gérés. "
      + "Donne une liste courte et précise des corrections à faire. Si le code est correct et complet, réponds en commençant par le mot APPROUVÉ." },
];

function rendreAgents() {
  $("#eq-agents").innerHTML = AGENTS.map((a, i) => `
    <div class="carte agent" id="ag-${a.id}" style="animation-delay:${i * 90}ms">
      <div class="agent-tete"><div class="agent-icone">${a.icone}</div>
        <div><h3>${a.nom}</h3><div class="sous">${a.role}</div></div></div>
      <div class="agent-etat"><span class="point"></span><span class="txt">en attente</span></div>
      <select class="ag-modele" data-agent="${a.id}"></select>
    </div>${i < AGENTS.length - 1 ? '<div class="agent-fleche"><span></span></div>' : ""}`).join("");
  $$(".ag-modele").forEach((sel) => {
    const a = AGENTS.find((x) => x.id === sel.dataset.agent);
    remplirSelectModeles(sel, "lexos-agent-" + a.id, a.cle === "codex" ? S.etat?.codex : S.etat?.defaut);
  });
}
function etatAgent(id, etat, texte) {
  const c = $("#ag-" + id);
  c.classList.remove("travaille", "fini", "erreur"); if (etat) c.classList.add(etat);
  $(".agent-etat .txt", c).textContent = texte;
  $(".agent-etat .point", c).className = "point" + (etat === "travaille" || etat === "fini" ? " ok" : etat === "erreur" ? " ko" : "");
}

function etapePiste(agent, titre) {
  const e = document.createElement("details");
  e.className = "eq-etape"; e.open = true;
  e.innerHTML = `<summary><span class="eq-ic">${agent.icone}</span><b>${echapper(agent.nom)}</b><span class="eq-titre">${echapper(titre)}</span><span class="eq-chrono">0 s</span></summary><div class="texte eq-corps"><span class="points"><i></i><i></i><i></i></span></div>`;
  $("#eq-piste").appendChild(e);
  e.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return e;
}

async function faireTravailler(agent, titre, contenu) {
  const modele = $(`.ag-modele[data-agent="${agent.id}"]`).value;
  if (!modele) throw new Error("aucun modèle choisi pour " + agent.nom);
  etatAgent(agent.id, "travaille", "travaille… (" + modele + ")");
  const etape = etapePiste(agent, titre), corps = $(".eq-corps", etape), chrono = $(".eq-chrono", etape);
  const debut = performance.now();
  const minuterie = setInterval(() => { chrono.textContent = Math.round((performance.now() - debut) / 1000) + " s"; }, 500);
  let dernier = 0;
  try {
    const t = await flux(modele, [{ role: "system", content: agent.systeme }, { role: "user", content: contenu }], (txt) => {
      const n = performance.now(); if (n - dernier < 80) return; dernier = n;
      corps.innerHTML = rendre(sansPensee(txt)) || `<span class="points"><i></i><i></i><i></i></span>`;
    }, CX.eqCtrl.signal);
    const propre = sansPensee(t);
    corps.innerHTML = rendre(propre);
    etatAgent(agent.id, "fini", "terminé ✔");
    if (propre.length > 1200) etape.open = false;
    return propre;
  } catch (err) {
    etatAgent(agent.id, "erreur", err.name === "AbortError" ? "arrêté" : "erreur");
    throw err;
  } finally { clearInterval(minuterie); }
}

function extraireFichiers(texte) {
  const out = [], re = /###\s*FICHIER\s*:\s*`?([^\n`]+?)`?\s*\n+```[^\n]*\n([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(texte))) out.push({ chemin: m[1].trim().replace(/^\/+/, ""), contenu: m[2].replace(/\n$/, "") + "\n" });
  if (!out.length) {                                      // repli : premier bloc de code
    const b = texte.match(/```(\w*)\n([\s\S]*?)```/);
    if (b) out.push({ chemin: "main." + ({ python: "py", py: "py", javascript: "js", js: "js", html: "html", bash: "sh", sh: "sh" }[b[1].toLowerCase()] || "txt"), contenu: b[2] });
  }
  return out;
}

async function lancerEquipe() {
  const demande = $("#eq-saisie").value.trim();
  if (!demande) { $("#eq-form").classList.remove("secoue"); void $("#eq-form").offsetWidth; $("#eq-form").classList.add("secoue"); return; }
  if (CX.eqCtrl) return;
  CX.eqCtrl = new AbortController();
  $("#eq-go").hidden = true; $("#eq-stop").hidden = false;
  $("#eq-piste").innerHTML = ""; $("#eq-resultat").innerHTML = "";
  AGENTS.forEach((a) => etatAgent(a.id, "", "en attente"));
  $("#eq-agents").classList.add("en-route");
  etincelles($("#eq-go"), 30);
  const [arch, codeur, rev] = AGENTS;
  const rondes = +$("#eq-rondes").value;
  try {
    const plan = await faireTravailler(arch, "fait le plan", demande);
    let code = await faireTravailler(codeur, "écrit le code", `DEMANDE :\n${demande}\n\nPLAN DE L'ARCHITECTE :\n${plan}`);
    for (let r = 1; r <= rondes; r++) {
      etatAgent(codeur.id, "fini", "attend la révision");
      const critique = await faireTravailler(rev, `révision ${r}/${rondes}`, `DEMANDE :\n${demande}\n\nCODE :\n${code}`);
      if (/^\W*APPROUV/i.test(critique)) { toast("Le Réviseur approuve le code ✔"); break; }
      code = await faireTravailler(codeur, `corrige (ronde ${r})`,
        `DEMANDE :\n${demande}\n\nTON CODE :\n${code}\n\nCORRECTIONS DEMANDÉES PAR LE RÉVISEUR :\n${critique}\n\nRéécris TOUS les fichiers au complet, corrigés, dans le format obligatoire.`);
    }
    CX.fichiersEquipe = extraireFichiers(code);
    afficherResultat();
  } catch (err) {
    if (err.name !== "AbortError") toast("L'équipe a eu un problème : " + err.message, true);
    else toast("Équipe arrêtée.");
  } finally {
    CX.eqCtrl = null; $("#eq-go").hidden = false; $("#eq-stop").hidden = true;
    $("#eq-agents").classList.remove("en-route");
  }
}

function afficherResultat() {
  const f = CX.fichiersEquipe;
  if (!f.length) { $("#eq-resultat").innerHTML = `<div class="vide">L'équipe n'a pas produit de fichier lisible. Essaie un modèle Codex plus gros.</div>`; return; }
  $("#eq-resultat").innerHTML = `
    <div class="eq-fin">
      <h2 class="titre-vue">🎉 Livraison de l'équipe <small>${f.length} fichier(s)</small></h2>
      <div class="eq-fichiers">${f.map((x, i) => `<div class="carte" style="animation-delay:${i * 80}ms"><h3>${icone(x.chemin)} ${echapper(x.chemin)}</h3><div class="sous">${x.contenu.split("\n").length} lignes</div></div>`).join("")}</div>
      <button class="btn btn-plein brille" id="eq-enregistrer">💾 Enregistrer tout dans « ${echapper($("#eq-projet").value)} »</button>
    </div>`;
  $("#eq-enregistrer").onclick = enregistrerEquipe;
  $("#eq-resultat").scrollIntoView({ behavior: "smooth" });
}
async function enregistrerEquipe() {
  const p = $("#eq-projet").value, b = $("#eq-enregistrer");
  b.disabled = true; b.classList.add("chargement");
  try {
    for (const f of CX.fichiersEquipe)
      await api(urlProjet(p) + "/fichier", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    b.textContent = "Enregistré sur la clé ✔"; etincelles(b, 40);
    const principal = CX.fichiersEquipe.find((f) => /(^|\/)(main|app|index)\.\w+$/i.test(f.chemin)) || CX.fichiersEquipe[0];
    const lancer = commandeLancer(principal.chemin);
    if (lancer) {
      const t = document.createElement("button");
      t.className = "btn btn-contour"; t.style.marginLeft = "10px";
      t.textContent = "📋 Commande pour tester dans ton terminal";
      t.onclick = async () => { await copierTexte(`${commandeCd(p)} && ${lancer}`); retourCopie(t); toast("Colle-la dans ton terminal ✔"); };
      b.after(t);
    }
    toast(`${CX.fichiersEquipe.length} fichier(s) enregistrés dans ${p} — ouvre-les dans Codex`);
    CX.projet = ""; mem.ecrire("lexos-projet", p);
  } catch (err) { toast(err.message, true); b.disabled = false; }
  finally { b.classList.remove("chargement"); }
}
$("#eq-form").addEventListener("submit", (e) => { e.preventDefault(); lancerEquipe(); });
$("#eq-stop").addEventListener("click", () => CX.eqCtrl?.abort());

/* ════════════════════════ Ouverture des onglets ════════════════════════ */
$$(".onglet").forEach((o) => o.addEventListener("click", () => {
  if (o.dataset.vue === "codex") ouvrirCodex();
  if (o.dataset.vue === "equipe") { if (!CX.eqCtrl) rendreAgents(); listerProjets($("#cx-projet"), $("#eq-projet")); }
}));
majLignes();
