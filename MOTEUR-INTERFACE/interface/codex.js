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
      if (d.lexos_compteur && typeof noterCompteur === "function") noterCompteur(d.lexos_compteur);
      const m = d.message?.content || "";
      if (m) { tout += m; surMorceau(tout); }
    }
  }
  return tout;
}

function remplirSelectModeles(sel, cle, prefere) {
  const garde = mem.lire(cle, "") || prefere || "";
  const liste = modelesTexte();
  sel.innerHTML = liste.length
    ? liste.map((m) => `<option value="${echapper(m.name)}">${echapper(nomModele(m.name))}</option>`).join("")
    : `<option value="">(aucun modèle de texte)</option>`;
  const choix = [garde, prefere, ...liste.filter((m) => /coder|code/i.test(m.name)).map((m) => m.name)]
    .find((n) => n && liste.some((m) => m.name === n)) || liste.find((m) => !m.nuage)?.name;
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

const couleursEd = $("#cx-couleurs");
let colorierPrevu = false;
function recolorier() {
  if (colorierPrevu) return; colorierPrevu = true;
  requestAnimationFrame(() => {
    colorierPrevu = false;
    couleursEd.innerHTML = colorier(ed.value, langueDe(CX.fichier)) + "\n";
    couleursEd.scrollTop = ed.scrollTop; couleursEd.scrollLeft = ed.scrollLeft;
  });
}
function majLignes() {
  const n = ed.value.split("\n").length;
  lignes.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n");
  lignes.scrollTop = ed.scrollTop;
  recolorier();
}
ed.addEventListener("input", () => { majLignes(); marquerModifie(true); });
ed.addEventListener("scroll", () => { lignes.scrollTop = ed.scrollTop; couleursEd.scrollTop = ed.scrollTop; couleursEd.scrollLeft = ed.scrollLeft; });
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
  if (typeof PLAN !== "undefined" && !PLAN.travaille) PLAN.charger();   // 🧭 plan de marche du projet
}
$("#cx-projet").addEventListener("change", async () => {
  if (CX.modifie && !confirm("Le fichier n'est pas enregistré. Changer de projet quand même ?")) { $("#cx-projet").value = CX.projet; return; }
  CX.projet = $("#cx-projet").value; mem.ecrire("lexos-projet", CX.projet);
  tournerPage(1, () => { CX.fichier = ""; ed.value = ""; majLignes(); marquerModifie(false); $("#cx-nom").textContent = "Aucun fichier"; });
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
  return { py: "🐍", js: "📜", html: "🌐", css: "🎨", json: "🧾", md: "📝", sh: "⚙️", txt: "📄", png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", webp: "🖼️", svg: "🖼️", zip: "📦" }[e] || "📄";
}
$("#cx-fichiers").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-f]");
  if (li) ouvrirFichier(li.dataset.f);
});
/* ── Changer de fichier = tourner une page : dézoom → la page pivote → nouvelle page → zoom ── */
const calmeCx = matchMedia("(prefers-reduced-motion: reduce)").matches;
let pageEnCours = Promise.resolve();
function tournerPage(sens, changer) {
  const f = $(".cx-feuille");
  if (calmeCx || !f.animate) { changer(); return Promise.resolve(); }
  pageEnCours = pageEnCours.then(async () => {
    f.getAnimations().forEach((a) => a.cancel());
    f.classList.add("tourne");
    const opt = (d, e) => ({ duration: d, easing: e, fill: "forwards" });
    await f.animate([{ transform: "scale(1)" }, { transform: "scale(.82)" }], opt(230, "cubic-bezier(.4,0,.2,1)")).finished;
    await f.animate([
      { transform: "scale(.82) rotateY(0deg)", filter: "brightness(1)" },
      { transform: `scale(.82) rotateY(${-92 * sens}deg)`, filter: "brightness(.35)" },
    ], opt(280, "cubic-bezier(.55,0,.9,.5)")).finished;
    changer();
    await f.animate([
      { transform: `scale(.82) rotateY(${92 * sens}deg)`, filter: "brightness(.35)" },
      { transform: "scale(.82) rotateY(0deg)", filter: "brightness(1)" },
    ], opt(320, "cubic-bezier(.15,.6,.3,1)")).finished;
    await f.animate([{ transform: "scale(.82)" }, { transform: "scale(1)" }], opt(300, "cubic-bezier(.3,1.35,.5,1)")).finished;
    f.getAnimations().forEach((a) => a.cancel());
    f.classList.remove("tourne");
  }).catch(() => { f.classList.remove("tourne"); });
  return pageEnCours;
}
function sensVers(chemin) {
  const ordre = $$("#cx-fichiers li[data-f]").map((l) => l.dataset.f);
  const a = ordre.indexOf(CX.fichier), b = ordre.indexOf(chemin);
  return a >= 0 && b >= 0 && b < a ? -1 : 1;
}

async function ouvrirFichier(chemin) {
  if (chemin === CX.fichier) return;
  if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(chemin)) { window.open(`${urlProjet(CX.projet)}/brut?chemin=${encodeURIComponent(chemin)}`, "_blank"); return; }
  if (CX.modifie && !confirm("Le fichier n'est pas enregistré. L'abandonner ?")) return;
  try {
    const d = await api(`${urlProjet(CX.projet)}/fichier?chemin=${encodeURIComponent(chemin)}`);
    const sens = sensVers(chemin);
    $$("#cx-fichiers li").forEach((l) => l.classList.toggle("actif", l.dataset.f === chemin));
    await tournerPage(sens, () => {
      CX.fichier = chemin; ed.value = d.contenu; ed.scrollTop = 0; majLignes(); marquerModifie(false);
      $("#cx-nom").textContent = chemin;
    });
  } catch (err) { toast(err.message, true); }
}

/* ── Écrire un fichier EN DIRECT dans l'éditeur (le code se tape tout seul) ── */
let fileEcriture = Promise.resolve();
function ecrireEnDirect(chemin, contenu) {
  fileEcriture = fileEcriture.then(async () => {
    if (chemin !== CX.fichier) {
      await tournerPage(sensVers(chemin), () => { CX.fichier = chemin; ed.value = ""; majLignes(); $("#cx-nom").textContent = chemin; });
      $$("#cx-fichiers li").forEach((l) => l.classList.toggle("actif", l.dataset.f === chemin));
    }
    const code = $(".cx-code"); code.classList.add("tape");
    const total = contenu.length, pas = Math.max(8, Math.ceil(total / 70));
    for (let i = 0; i < total; i += pas) {
      ed.value = contenu.slice(0, i + pas); majLignes();
      ed.scrollTop = ed.scrollHeight; lignes.scrollTop = ed.scrollTop;
      await new Promise((r) => requestAnimationFrame(r));
    }
    ed.value = contenu; majLignes(); ed.scrollTop = 0; lignes.scrollTop = 0;
    code.classList.remove("tape"); code.classList.remove("applique"); void ed.offsetWidth; code.classList.add("applique");
    marquerModifie(false); $("#cx-nom").textContent = chemin;
  }).catch(() => {});
  return fileEcriture;
}

/* Conversation Codex repliable (la zone d'écriture reste en bas, au centre) */
$("#cx-replier").addEventListener("click", () => {
  const r = $(".cx-ia").classList.toggle("replie");
  mem.ecrire("lexos-cx-replie", r ? "1" : "");
});
if (mem.lire("lexos-cx-replie", "")) $(".cx-ia").classList.add("replie");
$("#cx-saisie").addEventListener("input", (e) => { const t = e.target; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 180) + "px"; });
$("#cx-saisie").addEventListener("focus", () => { if ($(".cx-fil .cx-msg")) $(".cx-ia").classList.remove("replie"); });

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
  await tournerPage(1, () => { CX.fichier = n.trim(); ed.value = ""; majLignes(); marquerModifie(false); $("#cx-nom").textContent = CX.fichier; });
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
  + "Quand Alex te colle un résultat de terminal, explique l'erreur simplement et donne la prochaine étape. "
  + "Si la demande a plusieurs étapes, commence par ton plan de marche : une étape par ligne au format « - [ ] étape ».";
let cxHistorique = [];

function bulleCx(role, texte) {
  $(".cx-astuce")?.remove();
  $(".cx-ia").classList.remove("replie");
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
      tete.insertBefore(t, [...tete.children].find((x) => x.classList.contains("copier") && !x.classList.contains("appliquer")) || null);
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
    tete.insertBefore(a, [...tete.children].find((x) => x.classList.contains("copier") && !x.classList.contains("appliquer")) || null);
  });
}

const LANG_EXT = { python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts", html: "html", css: "css", json: "json", markdown: "md", md: "md", java: "java", c: "c", cpp: "cpp", rust: "rs", go: "go", php: "php", ruby: "rb", sql: "sql" };
const RE_FICHIER_BLOC = /(?:^|\n)#{1,4}\s*(?:FICHIER|FILE|Fichier)\s*:?\s*`?([^\n`]+?)`?\s*\n+```[^\n]*\n([\s\S]*?)(?:```|$)/g;
function blocPrincipal(texte) {          // premier bloc de code qui n'est pas une commande (même pas fini)
  const re = /```([\w+-]*)[^\n]*\n([\s\S]*?)(```|$)/g;
  for (let m; (m = re.exec(texte));) if (!LANG_TERMINAL.test(m[1] || "")) return { lang: (m[1] || "").toLowerCase(), code: m[2], fini: !!m[3] };
  return null;
}
function cacherCodeDansBulle(b, nom) {        // le code est dans l'éditeur : on ne le répète pas en bas
  $$("pre", b).forEach((pre) => {
    const lang = $(".pre-tete span", pre)?.textContent || "";
    if (LANG_TERMINAL.test(lang)) return;
    const puce = document.createElement("div"); puce.className = "puce-ecrit";
    puce.innerHTML = `✍️ code écrit dans l'éditeur <b>${echapper(nom || CX.fichier || "")}</b> ↑`;
    pre.replaceWith(puce);
  });
}
async function nomLibre(ext) {
  let f = []; try { f = (await api(urlProjet(CX.projet) + "/fichiers")).map((x) => x.chemin); } catch {}
  for (let i = 1; ; i++) { const n = i === 1 ? `nouveau.${ext}` : `nouveau-${i}.${ext}`; if (!f.includes(n)) return n; }
}

async function demanderCodex(question) {
  const modele = $("#cx-modele").value;
  if (!question || CX.ctrl) return;
  if (!modele) return toast("Aucun modèle — regarde l'onglet Modèles.", true);
  const direct = $("#cx-direct").checked;
  bulleCx("moi", question);
  const contexte = CX.fichier || ed.value
    ? `Fichier ouvert : ${CX.fichier || "(sans nom)"}\n\`\`\`\n${ed.value.slice(0, 24000)}\n\`\`\`\n\nDemande : ${question}`
    : question;
  const systeme = CX_SYSTEME + (direct ? " IMPORTANT : ton code est écrit directement dans l'éditeur d'Alex. Donne le fichier COMPLET dans UN SEUL bloc de code (ou, pour plusieurs fichiers, un bloc par fichier précédé de « ### FICHIER: chemin »)." : "");
  const messages = [{ role: "system", content: systeme }, ...cxHistorique.slice(-6), { role: "user", content: contexte }];
  const b = bulleCx("ia", ""); b.classList.add("ecrit");
  b.innerHTML = `<span class="points"><i></i><i></i><i></i></span>`;
  CX.ctrl = new AbortController(); $("#cx-stop").hidden = false;
  let rep = "", avantEd = ed.value, enDirect = false;
  const multi = () => /#{1,4}\s*(?:FICHIER|FILE)\s*:/i.test(rep);
  try {
    rep = await flux(modele, messages, (t) => {
      rep = sansPensee(t);
      b.innerHTML = rendre(rep) || `<span class="points"><i></i><i></i><i></i></span>`;
      if (direct && !multi()) {
        const bloc = blocPrincipal(rep);
        if (bloc) {
          if (!enDirect) { enDirect = true; $(".cx-code").classList.add("tape"); }
          ed.value = bloc.code; majLignes(); ed.scrollTop = ed.scrollHeight; lignes.scrollTop = ed.scrollTop;
          cacherCodeDansBulle(b);
        }
      }
      $("#cx-fil").scrollTop = $("#cx-fil").scrollHeight;
    }, CX.ctrl.signal);
    rep = sansPensee(rep);
  } catch (err) {
    if (err.name !== "AbortError") toast("Codex n'a pas pu répondre : " + err.message, true);
    if (enDirect && err.name === "AbortError") { ed.value = avantEd; majLignes(); enDirect = false; toast("Arrêté : l'éditeur est revenu comme avant."); }
  } finally {
    CX.ctrl = null; $("#cx-stop").hidden = true; b.classList.remove("ecrit");
    $(".cx-code").classList.remove("tape");
    b.innerHTML = rendre(rep || "*(arrêté)*"); boutonsAppliquer(b); if (typeof cocherCases === "function") cocherCases(b);
    // Écriture directe : on enregistre sur la clé
    if (direct && rep) {
      if (multi()) {
        const faits = [];
        for (const m of rep.matchAll(RE_FICHIER_BLOC)) {
          const chemin = m[1].trim().replace(/^\*+|\*+$/g, "");
          try { await api(urlProjet(CX.projet) + "/fichier", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chemin, contenu: m[2] }) }); faits.push([chemin, m[2]]); } catch {}
        }
        for (const [chemin, contenu] of faits) await ecrireEnDirect(chemin, contenu);
        if (faits.length) { listerFichiers(); toast(`✍️ ${faits.length} fichier(s) écrit(s) sur la clé`); cacherCodeDansBulle(b); }
      } else if (enDirect) {
        const bloc = blocPrincipal(rep);
        if (bloc) {
          if (!CX.fichier) { CX.fichier = await nomLibre(LANG_EXT[bloc.lang] || "txt"); $("#cx-nom").textContent = CX.fichier; }
          ed.value = bloc.code; majLignes(); ed.scrollTop = 0;
          await sauverFichier();
          $(".cx-code").classList.remove("applique"); void ed.offsetWidth; $(".cx-code").classList.add("applique");
          cacherCodeDansBulle(b);
        }
      }
    }
    cxHistorique.push({ role: "user", content: question }, { role: "assistant", content: rep });
    if (rep && typeof PLAN !== "undefined") { PLAN.question = question.slice(0, 200); PLAN.lireListe(rep); }
  }
}
$("#cx-direct").checked = mem.lire("lexos-direct", "1") === "1";
$("#cx-direct").addEventListener("change", (e) => { mem.ecrire("lexos-direct", e.target.checked ? "1" : "0"); if (e.target.checked) etincelles($(".turbo.direct"), 16); });
$("#cx-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (CX.ctrl) return;
  const q = $("#cx-saisie").value.trim();
  if (!q && !PIECES.length) return;
  $("#cx-saisie").value = ""; $("#cx-saisie").style.height = "auto";
  etincelles($("#cx-form .rond"), 14);
  const pieces = await envoyerPieces();
  if ($("#cx-turbo").checked) return demanderTurbo(q, pieces);
  const mention = pieces.length ? "\n\n(J'ai ajouté au projet : " + pieces.map((p) => p.chemin).join(", ") + ")" : "";
  if (q || mention) demanderCodex((q || "Voici des fichiers que j'ai ajoutés.") + mention);
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

/* ════════════════════════ STUDIO : voir tous ses projets ════════════════════════ */
const STUDIO = { projets: [], jeton: "", ouvert: "" };
const COULEUR_LANG = { py: "#3b82f6", js: "#facc15", html: "#f97316", css: "#a855f7", json: "#94a3b8", md: "#e5e7eb",
  sh: "#22c55e", ts: "#38bdf8", jsx: "#22d3ee", txt: "#9ca3af", png: "#ec4899", jpg: "#ec4899", svg: "#f472b6" };
const ilYa = (t) => { const s = (Date.now() / 1000 - t) | 0; if (s < 60) return "à l'instant"; if (s < 3600) return `il y a ${s / 60 | 0} min`; if (s < 86400) return `il y a ${s / 3600 | 0} h`; return `il y a ${s / 86400 | 0} j`; };

async function ouvrirStudio() {
  const st = $("#studio");
  st.hidden = false; st.classList.remove("sort"); $(".cx-grille").classList.add("recule");
  try { STUDIO.jeton = (await api("/moteur/apercu-jeton")).jeton; } catch {}
  await chargerStudio();
}
function fermerStudio() {
  const st = $("#studio");
  st.classList.add("sort"); $(".cx-grille").classList.remove("recule");
  setTimeout(() => { st.hidden = true; st.classList.remove("sort"); }, 420);
}
async function chargerStudio() {
  try { STUDIO.projets = await api("/moteur/studio"); } catch (e) { STUDIO.projets = []; toast(e.message, true); }
  rendreStudio();
}
function rendreStudio() {
  const f = $("#studio-cherche").value.trim().toLowerCase();
  const liste = STUDIO.projets.filter((p) => !f || p.nom.toLowerCase().includes(f) || p.liste.some((x) => x.toLowerCase().includes(f)));
  $("#studio-cartes").innerHTML = liste.length ? liste.map((p, i) => {
    const tot = Object.values(p.langages).reduce((a, b) => a + b, 0) || 1;
    const langs = Object.entries(p.langages).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return `<div class="carte studio-carte ${p.nom === CX.projet ? "actif" : ""}" style="animation-delay:${i * 70}ms" data-p="${echapper(p.nom)}">
      <div class="sc-entete"><div class="sc-icone">${p.web ? "🌐" : p.principal?.endsWith(".py") ? "🐍" : "📁"}</div>
        <div><h3>${echapper(p.nom)}</h3><div class="sous">${p.fichiers} fichier(s) · ${octets(p.taille)} · ${ilYa(p.maj)}</div></div></div>
      <div class="barre-langs">${langs.map(([l, n]) => `<i style="flex:${n};background:${COULEUR_LANG[l] || "var(--orange)"}" title="${echapper(l)} : ${n}"></i>`).join("")}</div>
      <div class="tags">${langs.map(([l, n]) => `<span class="tag">.${echapper(l)} ${Math.round(n / tot * 100)}%</span>`).join("")}</div>
      ${p.resume ? `<p class="sc-resume">${echapper(p.resume.replace(/[#*`>]/g, "").slice(0, 160))}…</p>` : ""}
      <ul class="sc-fichiers">${p.liste.slice(0, 6).map((x) => `<li data-f="${echapper(x)}">${icone(x)} ${echapper(x)}</li>`).join("")}${p.fichiers > 6 ? `<li class="plus">+ ${p.fichiers - 6} autre(s)</li>` : ""}</ul>
      <div class="sc-btns">
        <button class="btn btn-plein mini" data-act="ouvrir">✏️ Ouvrir</button>
        <button class="btn btn-contour mini" data-act="env" title="Variables d'environnement de ce projet">🔑</button>
        ${p.web ? `<button class="btn btn-contour mini" data-act="apercu">👁 Aperçu</button>` : ""}
        ${p.principal && commandeLancer(p.principal) ? `<button class="btn btn-contour mini" data-act="lancer">▶ Commande</button>` : ""}
      </div></div>`;
  }).join("") : `<div class="vide">Aucun projet${f ? " trouvé" : " encore — crée-en un ou lance le Codex équipe"}.</div>`;
}
$("#studio-cartes").addEventListener("click", async (e) => {
  const carte = e.target.closest(".studio-carte");
  if (!carte) return;
  const p = STUDIO.projets.find((x) => x.nom === carte.dataset.p);
  const act = e.target.closest("[data-act]")?.dataset.act, fichier = e.target.closest("li[data-f]")?.dataset.f;
  if (act === "apercu") return montrerApercu(p, carte);
  if (act === "env") return ouvrirEnv(p.nom);
  if (act === "lancer") {
    const b = e.target.closest("button");
    await copierTexte(`${commandeCd(p.nom)} && ${commandeLancer(p.principal)}`); retourCopie(b);
    return toast("Commande copiée — colle-la dans ton terminal ✔");
  }
  if (act === "ouvrir" || fichier) {
    etincelles(carte, 22);
    carte.classList.add("choisie");
    $("#cx-projet").value = p.nom;
    if (CX.projet !== p.nom) {
      if (CX.modifie && !confirm("Le fichier n'est pas enregistré. Changer de projet quand même ?")) return;
      CX.projet = p.nom; mem.ecrire("lexos-projet", p.nom); CX.fichier = ""; marquerModifie(false);
      await listerFichiers();
    }
    setTimeout(() => { fermerStudio(); const f = fichier || p.principal; if (f) setTimeout(() => ouvrirFichier(f), 300); }, 380);
  }
});
function montrerApercu(p, carte) {
  if (!STUDIO.jeton) return toast("Aperçu indisponible (reconnecte-toi).", true);
  STUDIO.ouvert = p;
  const url = `/apercu/${encodeURIComponent(STUDIO.jeton)}/${encodeURIComponent(p.nom)}/${p.web.split("/").map(encodeURIComponent).join("/")}`;
  $("#apercu-cadre").src = url;
  $("#apercu-adresse").textContent = `${p.nom}/${p.web}`;
  $("#studio-apercu").hidden = false;
  $(".studio-corps").classList.add("avec-apercu");
  $$(".studio-carte").forEach((c) => c.classList.toggle("en-apercu", c === carte));
}
$("#apercu-fermer").addEventListener("click", () => {
  $("#studio-apercu").classList.add("sort");
  setTimeout(() => { $("#studio-apercu").hidden = true; $("#studio-apercu").classList.remove("sort"); $("#apercu-cadre").src = "about:blank"; $(".studio-corps").classList.remove("avec-apercu"); }, 380);
  $$(".studio-carte").forEach((c) => c.classList.remove("en-apercu"));
});
$("#apercu-recharger").addEventListener("click", (e) => { const c = $("#apercu-cadre"); c.src = c.src; e.currentTarget.animate([{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], 500); });
$("#apercu-tel").addEventListener("click", () => $(".apercu-scene").classList.add("tel"));
$("#apercu-ordi").addEventListener("click", () => $(".apercu-scene").classList.remove("tel"));
$("#apercu-fenetre").addEventListener("click", () => window.open($("#apercu-cadre").src, "_blank", "noopener"));
$("#cx-studio").addEventListener("click", (e) => { etincelles(e.currentTarget, 16); ouvrirStudio(); });
$("#studio-fermer").addEventListener("click", fermerStudio);
$("#studio-cherche").addEventListener("input", rendreStudio);
$("#studio-nouveau").addEventListener("click", async () => { $("#cx-nouveau-projet").click(); setTimeout(chargerStudio, 900); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#studio").hidden) fermerStudio(); });


/* ════════════════════════ ＋ AJOUTER (images, fichiers) ════════════════════════ */
const PIECES = [];   // { nom, type, data(b64), apercu }
$("#cx-plus").addEventListener("click", (e) => {
  e.stopPropagation();
  const ouvert = $(".cx-plus-zone").classList.toggle("ouvert");
  if (ouvert) etincelles($("#cx-plus"), 10);
});
document.addEventListener("click", (e) => { if (!e.target.closest(".cx-plus-zone")) $(".cx-plus-zone")?.classList.remove("ouvert"); });
async function ajouterPieces(liste) {
  for (const f of liste) {
    if (f.size > 25e6) { toast(`${f.name} : trop gros (25 Mo max)`, true); continue; }
    const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(f); });
    PIECES.push({ nom: f.name.replace(/[^\w.\- ]+/g, "_"), type: f.type, data, image: f.type.startsWith("image/") });
  }
  $(".cx-plus-zone").classList.remove("ouvert");
  rendrePieces();
}
$("#cx-fichier-img").addEventListener("change", (e) => { ajouterPieces([...e.target.files]); e.target.value = ""; });
$("#cx-fichier-doc").addEventListener("change", (e) => { ajouterPieces([...e.target.files]); e.target.value = ""; });
function rendrePieces() {
  $("#cx-pieces").innerHTML = PIECES.map((p, i) => `<div class="cx-piece" style="animation-delay:${i * 60}ms">
      ${p.image ? `<img src="data:${p.type};base64,${p.data}" alt="">` : `<span class="cx-piece-ic">📄</span>`}
      <span class="cx-piece-nom">${echapper(p.nom)}</span><button type="button" data-i="${i}" title="Retirer">✕</button></div>`).join("");
}
$("#cx-pieces").addEventListener("click", (e) => {
  const b = e.target.closest("[data-i]"); if (!b) return;
  const el = b.closest(".cx-piece"); el.classList.add("sort");
  setTimeout(() => { PIECES.splice(+b.dataset.i, 1); rendrePieces(); }, 250);
});
// glisser-déposer des images directement sur la zone d'écriture
["dragover", "dragenter"].forEach((ev) => $(".cx-bas").addEventListener(ev, (e) => { e.preventDefault(); $(".cx-bas").classList.add("depot"); }));
["dragleave", "drop"].forEach((ev) => $(".cx-bas").addEventListener(ev, (e) => { e.preventDefault(); $(".cx-bas").classList.remove("depot"); }));
$(".cx-bas").addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) ajouterPieces([...e.dataTransfer.files]); });
// coller une image (Ctrl+V)
$("#cx-saisie").addEventListener("paste", (e) => {
  const f = [...(e.clipboardData?.files || [])];
  if (f.length) { e.preventDefault(); ajouterPieces(f); }
});

async function envoyerPieces() {
  if (!PIECES.length) return [];
  if (!CX.projet) { toast("Choisis d'abord un projet.", true); return []; }
  const faits = [];
  for (const p of PIECES.splice(0)) {
    try {
      const r = await api(urlProjet(CX.projet) + "/televerser", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chemin: (p.image ? "images/" : "") + p.nom, data: p.data }) });
      faits.push({ chemin: r.chemin, image: p.image, data: p.data, type: p.type });
    } catch (err) { toast(`${p.nom} : ${err.message}`, true); }
  }
  rendrePieces(); listerFichiers();
  return faits;
}

$("#cx-plus-creer").addEventListener("click", () => {
  $(".cx-plus-zone").classList.remove("ouvert"); $("#cx-turbo").checked = true; majTurbo();
  $("#cx-saisie").value = "Crée une image : "; $("#cx-saisie").focus();
});
$("#cx-plus-cloner").addEventListener("click", () => { $(".cx-plus-zone").classList.remove("ouvert"); ouvrirClone(); });

/* ════════════════════════ ⚡ TURBO REA ════════════════════════ */
function majTurbo() {
  const on = $("#cx-turbo").checked;
  $(".cx-ia").classList.toggle("turbo-on", on);
  $("#cx-saisie").placeholder = on ? "⚡ Turbo REA : « crée un site avec un logo », « clone ce dépôt »…"
    : "Demande à Codex…  (Entrée = envoyer · Maj+Entrée = ligne)";
  mem.ecrire("lexos-turbo", on ? "1" : "");
}
$("#cx-turbo").addEventListener("change", (e) => { majTurbo(); if (e.target.checked) { etincelles($(".turbo"), 22); toast("⚡ Turbo REA activé : REA travaille tout seul dans le projet"); } });
$("#cx-turbo").checked = !!mem.lire("lexos-turbo", ""); majTurbo();

const IC_OUTIL = { web_search: "🔎", fetch_page: "🌐", list_files: "📂", read_file: "📖", write_file: "✍️", describe_image: "👁", create_image: "🎨", clone_github: "📦" };
const NOM_OUTIL = { web_search: "cherche sur le web", fetch_page: "lit une page", list_files: "regarde les fichiers", read_file: "lit", write_file: "écrit", describe_image: "regarde l'image", create_image: "crée une image", clone_github: "clone le dépôt" };
const urlBrut = (chemin) => `${urlProjet(CX.projet)}/brut?chemin=${encodeURIComponent(chemin)}`;

async function demanderTurbo(question, pieces) {
  const modele = $("#cx-modele").value;
  if (!modele) return toast("Aucun modèle — regarde l'onglet Modèles.", true);
  if (!CX.projet) return toast("Choisis d'abord un projet.", true);
  let texte = question;
  if (pieces.length) texte += "\n\n(J'ai ajouté au projet : " + pieces.map((p) => p.chemin).join(", ") + ")";
  const moi = bulleCx("moi", question || "(fichiers ajoutés)");
  pieces.filter((p) => p.image).forEach((p) => { const i = document.createElement("img"); i.className = "cx-img"; i.src = `data:${p.type};base64,${p.data}`; moi.prepend(i); });
  PLAN.debut(question, true);
  const b = bulleCx("ia", ""); b.classList.add("ecrit", "turbo-bulle");
  b.innerHTML = `<div class="turbo-tete">⚡ <b>Turbo REA</b> <span class="turbo-etape">démarre…</span></div><ol class="turbo-fil"></ol><div class="turbo-final"></div>`;
  const fil = $(".turbo-fil", b), etape = $(".turbo-etape", b);
  const defile = () => { $("#cx-fil").scrollTop = $("#cx-fil").scrollHeight; };
  CX.ctrl = new AbortController(); $("#cx-stop").hidden = false;
  let fin = "", enCours = null; const ecritsTurbo = [];
  if (typeof trouverModelesImage === "function" && !IM.cherche) await trouverModelesImage();
  const imageModele = (typeof IM !== "undefined" && (IM.modeles?.includes(mem.lire("lexos-modele-image", "")) ? mem.lire("lexos-modele-image", "") : IM.modeles?.find((m) => m !== "nuage-image"))) || "";
  try {
    const r = await fetch("/moteur/rea", { method: "POST", headers: { "Content-Type": "application/json" }, signal: CX.ctrl.signal,
      body: JSON.stringify({ projet: CX.projet, modele, message: texte, historique: cxHistorique.slice(-8), modele_image: imageModele,
        ouvert: CX.fichier || null, ouvert_contenu: CX.fichier ? ed.value : "" }) });
    if (!r.ok || !r.body) throw new Error((await r.text()).slice(0, 200));
    const lecteur = r.body.getReader(), dec = new TextDecoder();
    let tampon = "";
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      tampon += dec.decode(value, { stream: true });
      const lignes = tampon.split("\n"); tampon = lignes.pop();
      for (const l of lignes) {
        let ev; try { ev = JSON.parse(l); } catch { continue; }
        PLAN.evenement(ev);
        if (ev.type === "etape") etape.textContent = `étape ${ev.n}`;
        else if (ev.type === "pensee") { const li = document.createElement("li"); li.className = "t-pensee"; li.textContent = "💭 " + ev.texte; fil.appendChild(li); }
        else if (ev.type === "info") { const li = document.createElement("li"); li.className = "t-info"; li.textContent = ev.texte; fil.appendChild(li); }
        else if (ev.type === "outil") {
          enCours = document.createElement("li"); enCours.className = "t-outil encours";
          const arg = Object.values(ev.args || {})[0];
          enCours.innerHTML = `<span class="t-ic">${IC_OUTIL[ev.nom] || "🔧"}</span><span>${echapper(NOM_OUTIL[ev.nom] || ev.nom)} ${arg ? `<code>${echapper(String(arg))}</code>` : ""}</span><span class="t-etat"><i class="t-roue"></i></span>`;
          fil.appendChild(enCours);
        }
        else if (ev.type === "resultat" && enCours) {
          enCours.classList.remove("encours"); enCours.classList.add(ev.ok ? "ok" : "rate");
          $(".t-etat", enCours).textContent = (ev.ok ? "✔ " : "✖ ") + ev.duree + " s";
          if (!ev.ok) enCours.title = ev.apercu;
        }
        else if (ev.type === "fichier") {
          listerFichiers();
          if (typeof ev.contenu === "string" && !ev.chemin.endsWith("/")) {
            if (CX.modifie && ev.chemin !== CX.fichier) await sauverFichier();
            ecrireEnDirect(ev.chemin, ev.contenu); ecritsTurbo.push(ev.chemin);
            const li = document.createElement("li"); li.className = "t-info"; li.textContent = `✍️ écrit en direct dans l'éditeur : ${ev.chemin}`; fil.appendChild(li);
          }
        }
        else if (ev.type === "image") {
          const li = document.createElement("li"); li.className = "t-image";
          li.innerHTML = `<img src="${urlBrut(ev.chemin)}&t=${Date.now()}" alt=""><span>🎨 ${echapper(ev.chemin)}</span>`;
          fil.appendChild(li); listerFichiers(); etincelles(li, 30);
        }
        else if (ev.type === "fin") fin = ev.texte;
        else if (ev.type === "erreur") throw new Error(ev.texte);
        defile();
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") { toast("Turbo REA : " + err.message, true); fin = fin || "⚠️ " + err.message; }
    else fin = fin || "*(arrêté)*";
  } finally {
    CX.ctrl = null; $("#cx-stop").hidden = true; b.classList.remove("ecrit");
    $$(".encours", b).forEach((x) => { x.classList.remove("encours"); $(".t-etat", x).textContent = "—"; });
    etape.textContent = "terminé ✔";
    PLAN.fin(sansPensee(fin), !/^⚠️|\(arrêté\)/.test(fin));
    $(".turbo-final", b).innerHTML = rendre(sansPensee(fin)); boutonsAppliquer(b); cocherCases(b);
    if (ecritsTurbo.length) cacherCodeDansBulle($(".turbo-final", b), ecritsTurbo.join(", "));
    cxHistorique.push({ role: "user", content: texte }, { role: "assistant", content: sansPensee(fin) });
    defile();
  }
}
