/* LexOS · 🧭 Plan de marche du Codex — sur le même écran que le code.
   À droite du Codex : les étapes du plan (cases à cocher), ce que REA fait en direct
   (outils, fichiers écrits, images) et les fichiers touchés. Le code reste au centre.
   Codex et Turbo REA écrivent leur plan au format « - [ ] étape » ; il s'affiche ici. */
"use strict";

const PLAN = {
  etapes: [],        // { texte, etat: "a" | "e" | "f" }
  actions: [],       // { ic, texte, etat: "encours" | "ok" | "rate", duree }
  fichiers: [],      // chemins touchés
  travaille: false,
  question: "",

  cle() { return "lexos-plan-" + (CX.projet || "?"); },
  charger() {
    let d = {};
    try { d = JSON.parse(mem.lire(this.cle(), "{}")); } catch {}
    this.etapes = d.etapes || []; this.actions = d.actions || []; this.fichiers = d.fichiers || []; this.question = d.question || "";
    this.travaille = false; this.rendre();
  },
  sauver() {
    mem.ecrire(this.cle(), JSON.stringify({ etapes: this.etapes, actions: this.actions.slice(-40), fichiers: this.fichiers, question: this.question }));
  },

  // ── cases à cocher « - [ ] … » dans un texte de Codex ou de REA ──
  lireListe(texte) {
    let n = 0;
    const sansCode = String(texte || "").replace(/```[\s\S]*?(```|$)/g, "");
    for (const ligne of sansCode.split("\n")) {
      const m = ligne.match(/^\s*(?:[-*+]|\d+[.)])\s*\[( |x|X)\]\s+(.+?)\s*$/);
      if (!m) continue;
      const texteEtape = m[2].replace(/\*\*/g, "").slice(0, 200), fait = m[1] !== " ";
      const norm = (s) => s.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
      const deja = this.etapes.find((e) => norm(e.texte) === norm(texteEtape));
      if (deja) { if (fait) deja.etat = "f"; }
      else { this.etapes.push({ texte: texteEtape, etat: fait ? "f" : "a" }); n++; }
    }
    if (n || sansCode.includes("[x]")) { this.avancer(); this.rendre(); this.sauver(); }
    return n;
  },
  avancer() {   // pendant que REA travaille, la première étape pas faite est « en cours »
    this.etapes.forEach((e) => { if (e.etat === "e") e.etat = "a"; });
    if (this.travaille) { const e = this.etapes.find((x) => x.etat === "a"); if (e) e.etat = "e"; }
  },

  // ── branché sur le Codex ──
  debut(question, turbo) {
    this.question = question || this.question;
    if (turbo) {
      this.travaille = true; this.actions = [];
      if (this.etapes.length && this.etapes.every((e) => e.etat === "f")) this.etapes = [];   // ancien plan fini : on repart
      montrerPlan(true);
    }
    this.avancer(); this.rendre();
  },
  evenement(ev) {   // événements du flux Turbo REA
    if (ev.type === "pensee") this.lireListe(ev.texte);
    else if (ev.type === "outil") {
      const arg = Object.values(ev.args || {})[0];
      this.actions.push({ ic: IC_OUTIL[ev.nom] || "🔧", texte: (NOM_OUTIL[ev.nom] || ev.nom) + (arg ? " · " + String(arg).slice(0, 80) : ""), etat: "encours" });
    } else if (ev.type === "resultat") {
      const a = [...this.actions].reverse().find((x) => x.etat === "encours");
      if (a) { a.etat = ev.ok ? "ok" : "rate"; a.duree = ev.duree; }
    } else if ((ev.type === "fichier" || ev.type === "image") && ev.chemin && !ev.chemin.endsWith("/")) {
      if (!this.fichiers.includes(ev.chemin)) this.fichiers.push(ev.chemin);
    } else if (ev.type === "etape") this.etapeN = ev.n;
    else if (ev.type === "info") this.actions.push({ ic: "ℹ️", texte: String(ev.texte).replace(/^\S+\s/, "").slice(0, 120), etat: "info" });
    this.rendre();
  },
  fin(texte, ok) {
    this.travaille = false;
    this.actions.forEach((a) => { if (a.etat === "encours") a.etat = "rate"; });
    const avant = this.etapes.filter((e) => e.etat === "f").length;
    this.lireListe(texte);
    // REA a fini sans redonner sa liste : les étapes du plan sont considérées faites
    if (ok && this.etapes.filter((e) => e.etat === "f").length === avant && !/\[ \]/.test(texte || "")) this.etapes.forEach((e) => { e.etat = "f"; });
    this.avancer(); this.rendre(); this.sauver();
  },

  rendre() {
    const fait = this.etapes.filter((e) => e.etat === "f").length, total = this.etapes.length;
    $("#pl-compte").textContent = total ? `${fait}/${total}` : "";
    $("#pl-progres").style.width = total ? (100 * fait / total) + "%" : "0";
    $("#pl-bouton b").textContent = total ? `${fait}/${total}` : "";
    const etat = $("#pl-etat");
    etat.className = "pl-etat" + (this.travaille ? " actif" : "");
    etat.innerHTML = this.travaille
      ? `<i class="t-roue"></i> ⚡ REA travaille${this.etapeN ? " · étape " + this.etapeN : ""}…`
      : total && fait === total ? "✔ Plan terminé" : $("#cx-turbo").checked ? "⚡ Turbo REA prêt : donne-lui une tâche" : "Active ⚡ Turbo REA pour que REA suive le plan tout seul";
    $("#pl-question").textContent = this.question ? "🗣 " + this.question : "";
    $("#pl-question").hidden = !this.question;
    $("#pl-etapes").innerHTML = total
      ? this.etapes.map((e) => `<li class="pl-e ${e.etat}"><span class="pl-coche">${e.etat === "f" ? "✓" : ""}</span><span>${echapper(e.texte)}</span></li>`).join("")
      : `<li class="pl-vide">Le plan apparaîtra ici quand REA ou Codex écrira ses étapes.</li>`;
    const acts = this.actions.slice(-30);
    $("#pl-actions").innerHTML = acts.length
      ? acts.map((a) => `<li class="pl-a ${a.etat}"><span class="pl-ic">${a.ic}</span><span class="pl-at">${echapper(a.texte)}</span><span class="pl-d">${a.etat === "encours" ? '<i class="t-roue"></i>' : a.etat === "ok" ? "✔ " + (a.duree ?? "") + " s" : a.etat === "rate" ? "✖" : ""}</span></li>`).join("")
      : `<li class="pl-vide">Rien pour l'instant.</li>`;
    $("#pl-fichiers").innerHTML = this.fichiers.length
      ? this.fichiers.map((f) => `<button type="button" data-f="${echapper(f)}" title="Ouvrir dans l'éditeur">${icone(f)} ${echapper(f)}</button>`).join("")
      : `<span class="pl-vide">Aucun fichier touché.</span>`;
    $$("#pl-fichiers [data-f]").forEach((b) => b.addEventListener("click", () => ouvrirFichier(b.dataset.f)));
    const liste = $("#pl-actions"); liste.scrollTop = liste.scrollHeight;
  },
};

// « [x] étape » / « [ ] étape » dans une bulle → vraies cases
function cocherCases(el) {
  if (!el) return;
  for (const li of el.querySelectorAll("li")) {
    const m = li.textContent.match(/^\s*\[( |x|X)\]\s*/);
    if (!m) continue;
    const t = [...li.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (t) t.textContent = t.textContent.replace(/^\s*\[( |x|X)\]\s*/, "");
    li.classList.add("pl-case"); if (m[1] !== " ") li.classList.add("fait");
  }
}

function montrerPlan(on) {
  $(".cx-grille").classList.toggle("avec-plan", on);
  $("#pl-bouton").classList.toggle("actif", on);
  mem.ecrire("lexos-plan-visible", on ? "1" : "0");
}
$("#pl-bouton").addEventListener("click", () => montrerPlan(!$(".cx-grille").classList.contains("avec-plan")));
$("#pl-fermer").addEventListener("click", () => montrerPlan(false));
$("#pl-nouveau").addEventListener("click", () => {
  if (PLAN.travaille) return toast("REA travaille encore : arrête-le d'abord (■ Stop).", true);
  PLAN.etapes = []; PLAN.actions = []; PLAN.fichiers = []; PLAN.question = ""; PLAN.sauver(); PLAN.rendre();
});
$("#cx-projet").addEventListener("change", () => PLAN.charger());
$("#cx-turbo").addEventListener("change", (e) => { if (e.target.checked) montrerPlan(true); PLAN.rendre(); });
montrerPlan(mem.lire("lexos-plan-visible", "1") === "1" || $("#cx-turbo").checked);
PLAN.charger();
