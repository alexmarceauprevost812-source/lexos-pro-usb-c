/* LexOS · 🖥️ Bureau — un vrai petit bureau avec des fenêtres et des outils IA locaux.
   Outils : Texte IA, Notes, Tâches, Documents, Photo, Calculatrice, Convertisseur,
   Minuterie/Pomodoro, Presse-papiers, Capture d'écran. Notes et tâches gardées SUR la clé. */
"use strict";

const BU = { z: 20, fen: new Map(), ouvert: false, notes: null, taches: null, presse: [], vision: undefined };

/* ════════════════════════ L'IA du bureau ════════════════════════ */
function modeleTexte() {
  const m = $("#modele")?.value;
  return m || modelesTexte()[0]?.name || "";
}
async function iaBureau(systeme, texte, sortie, signal) {
  const modele = modeleTexte();
  if (!modele) throw new Error("aucun modèle de texte sur la clé");
  sortie.classList.add("bu-ecrit");
  sortie.innerHTML = `<span class="points"><i></i><i></i><i></i></span>`;
  try {
    const rep = await flux(modele, [{ role: "system", content: systeme + " Réponds en français québécois simple. Pas de préambule." },
                                    { role: "user", content: texte }],
      (t) => { sortie.innerHTML = rendre(sansPensee(t)) || `<span class="points"><i></i><i></i><i></i></span>`; sortie.scrollTop = sortie.scrollHeight; }, signal);
    sortie.innerHTML = rendre(sansPensee(rep));
    return sansPensee(rep);
  } finally { sortie.classList.remove("bu-ecrit"); }
}
async function modeleVision() {
  if (BU.vision !== undefined) return BU.vision;
  BU.vision = null;
  for (const m of modelesTexte()) {
    try {
      const d = await api("/api/show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: m.name }) });
      if ((d.capabilities || []).includes("vision")) { BU.vision = m.name; break; }
    } catch {}
  }
  return BU.vision;
}
async function iaVoit(b64, question, sortie) {
  const modele = await modeleVision();
  if (!modele) { sortie.innerHTML = rendre("Aucun modèle qui voit les images sur la clé. Télécharge par exemple **gemma3:4b** ou **qwen2.5vl:7b**."); return; }
  sortie.classList.add("bu-ecrit"); sortie.innerHTML = `<span class="points"><i></i><i></i><i></i></span>`;
  try {
    const rep = await flux(modele, [{ role: "user", content: question + " Réponds en français.", images: [b64] }],
      (t) => { sortie.innerHTML = rendre(sansPensee(t)); });
    sortie.innerHTML = rendre(sansPensee(rep)) + `<p class="bu-petit">vu par ${echapper(modele)}</p>`;
  } catch (e) { sortie.innerHTML = rendre("⚠️ " + expliquerErreur(e.message)); }
  finally { sortie.classList.remove("bu-ecrit"); }
}
const sauverBureau = (cle, v) => fetch("/moteur/bureau/" + cle, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) }).catch(() => {});
const chargerBureau = async (cle, defaut) => { try { return (await api("/moteur/bureau/" + cle)) ?? defaut; } catch { return defaut; } };
const html = (s, ...v) => s.reduce((a, x, i) => a + x + (i < v.length ? v[i] : ""), "");

/* ════════════════════════ Les applications ════════════════════════ */
const APPS = {
  texte: { nom: "Texte IA", icone: "✍️", l: 640, h: 520, ouvrir(c) {
    c.innerHTML = `<div class="bu-col">
      <textarea class="bu-zone" placeholder="Colle ou écris ton texte ici…"></textarea>
      <div class="bu-actions">
        <button class="btn btn-plein mini" data-t="resumer">📝 Résumer</button>
        <button class="btn btn-contour mini" data-t="corriger">✅ Corriger le français</button>
        <button class="btn btn-contour mini" data-t="reecrire">🔁 Réécrire</button>
        <select class="bu-ton"><option value="plus clair">plus clair</option><option value="professionnel">professionnel</option><option value="amical">amical</option><option value="plus court">plus court</option><option value="québécois">bien québécois</option></select>
        <button class="btn btn-contour mini" data-t="expliquer">💡 Expliquer simplement</button>
        <button class="btn btn-contour mini" data-t="traduire">🌍 Traduire en</button>
        <select class="bu-langue"><option>anglais</option><option>français</option><option>espagnol</option><option>allemand</option><option>italien</option><option>portugais</option><option>japonais</option><option>chinois</option><option>arabe</option></select>
      </div>
      <div class="bu-sortie texte"></div>
      <div class="bu-actions"><button class="btn btn-contour mini" data-copier-sortie>📋 Copier le résultat</button><button class="btn btn-contour mini" data-remplacer>⬆ Mettre à la place du texte</button></div>
    </div>`;
    const zone = $(".bu-zone", c), sortie = $(".bu-sortie", c);
    const consignes = {
      resumer: () => "Résume ce texte en quelques points clairs.",
      corriger: () => "Corrige l'orthographe, la grammaire et la ponctuation de ce texte. Rends SEULEMENT le texte corrigé.",
      reecrire: () => `Réécris ce texte de façon ${$(".bu-ton", c).value}. Rends seulement le nouveau texte.`,
      expliquer: () => "Explique ce texte simplement, comme à un ami, avec un exemple.",
      traduire: () => `Traduis ce texte en ${$(".bu-langue", c).value}. Rends seulement la traduction.`,
    };
    c.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-t]");
      if (b) {
        if (!zone.value.trim()) return zone.focus();
        etincelles(b, 10);
        try { await iaBureau(consignes[b.dataset.t](), zone.value.slice(0, 30000), sortie); } catch (err) { sortie.innerHTML = rendre("⚠️ " + expliquerErreur(err.message)); }
      }
      if (e.target.closest("[data-copier-sortie]")) { copierTexte(sortie.innerText); toast("Copié ✔"); }
      if (e.target.closest("[data-remplacer]") && sortie.innerText.trim()) { zone.value = sortie.innerText; toast("Texte remplacé"); }
    });
  } },

  notes: { nom: "Notes", icone: "📝", l: 760, h: 520, async ouvrir(c) {
    BU.notes = BU.notes || await chargerBureau("notes", []);
    c.innerHTML = `<div class="bu-notes"><aside><button class="btn btn-plein mini" data-n="nouvelle">＋ Nouvelle note</button><ul class="bu-liste-notes"></ul></aside>
      <section><input class="bu-titre-note" placeholder="Titre"><textarea class="bu-zone bu-note" placeholder="Écris ta note… (gardée sur la clé)"></textarea>
      <div class="bu-actions"><button class="btn btn-contour mini" data-ia="resumer">✨ Résumer</button><button class="btn btn-contour mini" data-ia="organiser">🗂️ Organiser</button><button class="btn btn-contour mini" data-ia="taches">✅ En tâches</button><span class="bu-petit bu-etat-note"></span><button class="btn-icone" data-n="supprimer" title="Supprimer la note">🗑</button></div>
      <div class="bu-sortie" hidden></div></section></div>`;
    let actuelle = BU.notes[0]?.id || null, minut = null;
    const liste = $(".bu-liste-notes", c), titre = $(".bu-titre-note", c), zone = $(".bu-note", c), sortie = $(".bu-sortie", c);
    const rendreNotes = () => {
      liste.innerHTML = BU.notes.length ? BU.notes.map((n) => `<li data-id="${n.id}" class="${n.id === actuelle ? "actif" : ""}"><b>${echapper(n.titre || "Sans titre")}</b><small>${echapper((n.texte || "").slice(0, 60))}</small></li>`).join("") : `<li class="vide-mini">Aucune note</li>`;
      const n = BU.notes.find((x) => x.id === actuelle);
      titre.value = n?.titre || ""; zone.value = n?.texte || ""; titre.disabled = zone.disabled = !n;
    };
    const enregistrer = () => { clearTimeout(minut); $(".bu-etat-note", c).textContent = "…"; minut = setTimeout(async () => { await sauverBureau("notes", BU.notes); $(".bu-etat-note", c).textContent = "✔ gardée sur la clé"; }, 600); };
    const majNote = () => { const n = BU.notes.find((x) => x.id === actuelle); if (!n) return; n.titre = titre.value; n.texte = zone.value; n.maj = Date.now(); enregistrer(); const li = $(`li[data-id="${n.id}"]`, liste); if (li) li.innerHTML = `<b>${echapper(n.titre || "Sans titre")}</b><small>${echapper(n.texte.slice(0, 60))}</small>`; };
    titre.addEventListener("input", majNote); zone.addEventListener("input", majNote);
    c.addEventListener("click", async (e) => {
      const li = e.target.closest(".bu-liste-notes li[data-id]");
      if (li) { actuelle = li.dataset.id; rendreNotes(); sortie.hidden = true; }
      const n = e.target.closest("[data-n]")?.dataset.n;
      if (n === "nouvelle") { const x = { id: Date.now().toString(36), titre: "", texte: "", maj: Date.now() }; BU.notes.unshift(x); actuelle = x.id; rendreNotes(); titre.focus(); enregistrer(); }
      if (n === "supprimer" && actuelle && confirm("Supprimer cette note ?")) { BU.notes = BU.notes.filter((x) => x.id !== actuelle); actuelle = BU.notes[0]?.id || null; rendreNotes(); enregistrer(); }
      const ia = e.target.closest("[data-ia]")?.dataset.ia;
      if (ia && zone.value.trim()) {
        sortie.hidden = false;
        const consigne = { resumer: "Résume cette note en points clairs.", organiser: "Réorganise cette note : titres, listes, regroupe les idées. Garde toute l'information.", taches: "Transforme cette note en liste de tâches concrètes, une par ligne, qui commence par « - »." }[ia];
        try {
          const rep = await iaBureau(consigne, zone.value, sortie);
          sortie.insertAdjacentHTML("beforeend", `<div class="bu-actions"><button class="btn btn-plein mini" data-garder>⬆ Remplacer la note</button>${ia === "taches" ? `<button class="btn btn-contour mini" data-vers-taches>✅ Envoyer dans Tâches</button>` : ""}</div>`);
          $("[data-garder]", sortie).onclick = () => { zone.value = rep; majNote(); sortie.hidden = true; };
          const vt = $("[data-vers-taches]", sortie); if (vt) vt.onclick = () => ajouterTaches(rep);
        } catch (err) { sortie.innerHTML = rendre("⚠️ " + expliquerErreur(err.message)); }
      }
    });
    rendreNotes();
  } },

  taches: { nom: "Tâches", icone: "✅", l: 520, h: 560, async ouvrir(c) {
    BU.taches = BU.taches || await chargerBureau("taches", []);
    c.innerHTML = `<div class="bu-col"><form class="bu-ajout-tache"><input placeholder="Nouvelle tâche…"><button class="btn btn-plein mini">＋</button></form>
      <div class="bu-progres-taches"><div class="force-barre"><i></i></div><span></span></div>
      <ul class="bu-taches"></ul>
      <div class="bu-actions"><input class="bu-objectif" placeholder="🪄 Un objectif (ex. lancer mon site LexOS)"><button class="btn btn-contour mini" data-decouper>🪄 Découper en tâches</button><button class="btn-icone" data-vider title="Enlever les tâches finies">🧹</button></div>
      <div class="bu-sortie" hidden></div></div>`;
    BU.majTaches = () => {
      const fait = BU.taches.filter((t) => t.fait).length;
      $(".bu-taches", c).innerHTML = BU.taches.length ? BU.taches.map((t) => `<li data-id="${t.id}" class="${t.fait ? "fait" : ""}"><label><input type="checkbox" ${t.fait ? "checked" : ""}><span>${echapper(t.texte)}</span></label><button class="btn-icone" data-sup>✕</button></li>`).join("") : `<li class="vide-mini">Rien à faire 🎉</li>`;
      $(".bu-progres-taches i", c).style.width = (BU.taches.length ? fait / BU.taches.length * 100 : 0) + "%";
      $(".bu-progres-taches span", c).textContent = `${fait} / ${BU.taches.length} faites`;
      sauverBureau("taches", BU.taches);
    };
    $(".bu-ajout-tache", c).addEventListener("submit", (e) => { e.preventDefault(); const i = $("input", e.target); if (!i.value.trim()) return; BU.taches.unshift({ id: Date.now().toString(36), texte: i.value.trim(), fait: false }); i.value = ""; BU.majTaches(); });
    c.addEventListener("change", (e) => { const li = e.target.closest("li[data-id]"); if (!li) return; const t = BU.taches.find((x) => x.id === li.dataset.id); t.fait = e.target.checked; if (t.fait) etincelles(li, 14); BU.majTaches(); });
    c.addEventListener("click", async (e) => {
      if (e.target.closest("[data-sup]")) { const id = e.target.closest("li").dataset.id; BU.taches = BU.taches.filter((x) => x.id !== id); BU.majTaches(); }
      if (e.target.closest("[data-vider]")) { BU.taches = BU.taches.filter((x) => !x.fait); BU.majTaches(); }
      if (e.target.closest("[data-decouper]")) {
        const obj = $(".bu-objectif", c).value.trim(); if (!obj) return $(".bu-objectif", c).focus();
        const s = $(".bu-sortie", c); s.hidden = false;
        try { const rep = await iaBureau("Découpe cet objectif en 4 à 8 tâches concrètes et courtes, une par ligne, chacune commence par « - ». Rien d'autre.", obj, s); ajouterTaches(rep); s.hidden = true; $(".bu-objectif", c).value = ""; }
        catch (err) { s.innerHTML = rendre("⚠️ " + expliquerErreur(err.message)); }
      }
    });
    BU.majTaches();
  } },

  documents: { nom: "Documents", icone: "📄", l: 760, h: 580, ouvrir(c) {
    c.innerHTML = `<div class="bu-col"><label class="bu-deposer"><input type="file" hidden accept=".txt,.md,.csv,.json,.html,.htm,.xml,.py,.js,.css,.log,.ini,.yaml,.yml,.sh,text/*"><span>📄 Clique ou glisse un document texte ici</span><small>txt, md, csv, json, html, code… (PDF : copie-colle son texte)</small></label>
      <div class="bu-doc-info"></div>
      <div class="bu-actions"><button class="btn btn-contour mini" data-d="resumer">📝 Résumer</button><button class="btn btn-contour mini" data-d="points">📌 Points importants</button><button class="btn btn-contour mini" data-d="questions">❓ Questions de révision</button></div>
      <div class="bu-sortie doc"></div>
      <form class="bu-question"><input placeholder="Pose une question sur le document…"><button class="btn btn-plein mini">Demander</button></form></div>`;
    let doc = "", nom = "";
    const charger = async (f) => {
      if (f.size > 3e6) return toast("Document trop gros (3 Mo max)", true);
      doc = await f.text(); nom = f.name;
      $(".bu-doc-info", c).innerHTML = `<b>📄 ${echapper(nom)}</b> · ${doc.length.toLocaleString("fr-CA")} caractères${doc.length > 40000 ? " (l'IA lit les 40 000 premiers)" : ""}`;
      $(".bu-deposer", c).classList.add("charge"); etincelles($(".bu-deposer", c), 16);
    };
    $("input[type=file]", c).addEventListener("change", (e) => e.target.files[0] && charger(e.target.files[0]));
    const z = $(".bu-deposer", c);
    ["dragover", "dragenter"].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.add("survol"); }));
    ["dragleave", "drop"].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.remove("survol"); }));
    z.addEventListener("drop", (e) => e.dataTransfer.files[0] && charger(e.dataTransfer.files[0]));
    const demander = async (consigne) => {
      if (!doc) return toast("Ouvre d'abord un document", true);
      try { await iaBureau(consigne, `Document « ${nom} » :\n"""\n${doc.slice(0, 40000)}\n"""`, $(".bu-sortie", c)); } catch (err) { $(".bu-sortie", c).innerHTML = rendre("⚠️ " + expliquerErreur(err.message)); }
    };
    c.addEventListener("click", (e) => { const d = e.target.closest("[data-d]")?.dataset.d; if (d) demander({ resumer: "Résume ce document.", points: "Donne les points les plus importants de ce document, en liste.", questions: "Écris 5 questions de révision (avec réponses) sur ce document." }[d]); });
    $(".bu-question", c).addEventListener("submit", (e) => { e.preventDefault(); const q = $("input", e.target).value.trim(); if (q) demander(`Réponds à cette question en te basant SEULEMENT sur le document : ${q}`); });
  } },

  photo: { nom: "Photo", icone: "🖼️", l: 640, h: 600, ouvrir(c) {
    c.innerHTML = `<div class="bu-col"><label class="bu-deposer photo"><input type="file" hidden accept="image/*"><img alt="" hidden><span>🖼️ Clique ou glisse une photo</span></label>
      <div class="bu-actions"><button class="btn btn-plein mini" data-p="Décris cette image en détail.">👁 Décrire</button><button class="btn btn-contour mini" data-p="Lis et recopie tout le texte visible dans cette image.">🔤 Lire le texte</button><button class="btn btn-contour mini" data-p="Analyse cette image : objets, couleurs, ambiance, et ce qu'on pourrait améliorer.">🔍 Analyser</button></div>
      <form class="bu-question"><input placeholder="Pose une question sur la photo…"><button class="btn btn-plein mini">Demander</button></form>
      <div class="bu-sortie"></div></div>`;
    let b64 = "";
    const charger = (f) => { const fr = new FileReader(); fr.onload = () => { b64 = fr.result.split(",")[1]; const img = $("img", c); img.src = fr.result; img.hidden = false; $(".bu-deposer span", c).hidden = true; }; fr.readAsDataURL(f); };
    $("input[type=file]", c).addEventListener("change", (e) => e.target.files[0] && charger(e.target.files[0]));
    $(".bu-deposer", c).addEventListener("dragover", (e) => e.preventDefault());
    $(".bu-deposer", c).addEventListener("drop", (e) => { e.preventDefault(); e.dataTransfer.files[0] && charger(e.dataTransfer.files[0]); });
    BU.photoCharger = (b) => { b64 = b; const img = $("img", c); img.src = "data:image/png;base64," + b; img.hidden = false; $(".bu-deposer span", c).hidden = true; };
    c.addEventListener("click", (e) => { const p = e.target.closest("[data-p]")?.dataset.p; if (p) { if (!b64) return toast("Choisis d'abord une photo", true); iaVoit(b64, p, $(".bu-sortie", c)); } });
    $(".bu-question", c).addEventListener("submit", (e) => { e.preventDefault(); const q = $("input", e.target).value.trim(); if (q && b64) iaVoit(b64, q, $(".bu-sortie", c)); });
  } },

  calculatrice: { nom: "Calculatrice", icone: "🧮", l: 340, h: 520, ouvrir(c) {
    const touches = ["C", "(", ")", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "0", ".", "%", "="];
    c.innerHTML = `<div class="bu-calc"><div class="bu-calc-histo"></div><input class="bu-calc-ecran" value="" placeholder="0" spellcheck="false"><div class="bu-calc-res">=</div>
      <div class="bu-calc-touches">${touches.map((t) => `<button class="${/[=]/.test(t) ? "egal" : /[÷×−+%()C]/.test(t) ? "op" : ""}">${t}</button>`).join("")}</div>
      <small class="bu-petit">Aussi : sqrt( ) sin( ) cos( ) log( ) pi ^</small></div>`;
    const ecran = $(".bu-calc-ecran", c), res = $(".bu-calc-res", c), histo = $(".bu-calc-histo", c);
    const calculer = (s) => {
      const e = s.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/,/g, ".").replace(/\^/g, "**").replace(/(\d+(?:\.\d+)?)%/g, "($1/100)");
      if (/[^0-9+\-*/().\s*a-z]/i.test(e)) throw new Error("caractère non permis");
      const mots = e.match(/[a-z]+/gi) || [];
      const ok = { sqrt: 1, sin: 1, cos: 1, tan: 1, log: 1, ln: 1, abs: 1, round: 1, pi: 1, e: 1, floor: 1, ceil: 1 };
      if (mots.some((m) => !ok[m.toLowerCase()])) throw new Error("fonction inconnue");
      const js = e.replace(/\bln\(/gi, "Math.log(").replace(/\blog\(/gi, "Math.log10(").replace(/\bpi\b/gi, "Math.PI").replace(/\be\b/g, "Math.E").replace(/\b(sqrt|sin|cos|tan|abs|round|floor|ceil)\(/gi, (m, f) => `Math.${f.toLowerCase()}(`);
      const v = Function(`"use strict";return (${js || 0})`)();
      if (typeof v !== "number" || !isFinite(v)) throw new Error("résultat impossible");
      return +v.toPrecision(12);
    };
    const maj = () => { try { res.textContent = ecran.value ? "= " + calculer(ecran.value).toLocaleString("fr-CA", { maximumFractionDigits: 10 }) : "="; res.classList.remove("erreur"); } catch { res.classList.add("erreur"); } };
    const egal = () => { try { const v = calculer(ecran.value); histo.insertAdjacentHTML("afterbegin", `<div>${echapper(ecran.value)} = <b>${v}</b></div>`); ecran.value = String(v); res.textContent = "="; ecran.classList.remove("pop"); void ecran.offsetWidth; ecran.classList.add("pop"); } catch (e) { res.textContent = "⚠ " + e.message; res.classList.add("erreur"); } };
    c.addEventListener("click", (e) => { const b = e.target.closest(".bu-calc-touches button"); if (!b) return; const t = b.textContent; if (t === "C") ecran.value = ""; else if (t === "=") return egal(); else ecran.value += t; maj(); });
    ecran.addEventListener("input", maj); ecran.addEventListener("keydown", (e) => { if (e.key === "Enter") egal(); if (e.key === "Escape") { ecran.value = ""; maj(); } });
    setTimeout(() => ecran.focus(), 300);
  } },

  convertisseur: { nom: "Convertisseur", icone: "🔁", l: 460, h: 420, ouvrir(c) {
    const U = {
      Longueur: { m: 1, km: 1000, cm: .01, mm: .001, mi: 1609.344, pi: .3048, po: .0254, verge: .9144 },
      Masse: { kg: 1, g: .001, mg: 1e-6, lb: .45359237, oz: .028349523, tonne: 1000 },
      Volume: { L: 1, mL: .001, "m³": 1000, "gal (US)": 3.78541, "tasse": .25, "c. à soupe": .0147868 },
      Vitesse: { "km/h": 1, "m/s": 3.6, "mi/h": 1.609344, noeud: 1.852 },
      Données: { o: 1, Ko: 1024, Mo: 1024 ** 2, Go: 1024 ** 3, To: 1024 ** 4, bit: .125 },
      Temps: { s: 1, min: 60, h: 3600, jour: 86400, semaine: 604800 },
      Température: { "°C": "c", "°F": "f", K: "k" },
    };
    c.innerHTML = `<div class="bu-col bu-conv"><select class="bu-cat">${Object.keys(U).map((k) => `<option>${k}</option>`).join("")}</select>
      <div class="bu-conv-ligne"><input class="bu-v1" value="1" inputmode="decimal"><select class="bu-u1"></select></div>
      <button class="btn-icone bu-inverser" title="Inverser">⇅</button>
      <div class="bu-conv-ligne"><input class="bu-v2" readonly><select class="bu-u2"></select></div></div>`;
    const cat = $(".bu-cat", c), u1 = $(".bu-u1", c), u2 = $(".bu-u2", c), v1 = $(".bu-v1", c), v2 = $(".bu-v2", c);
    const remplir = () => { const k = Object.keys(U[cat.value]); u1.innerHTML = u2.innerHTML = k.map((x) => `<option>${x}</option>`).join(""); u2.selectedIndex = Math.min(1, k.length - 1); conv(); };
    const conv = () => {
      const x = parseFloat(v1.value.replace(",", ".")); if (isNaN(x)) { v2.value = ""; return; }
      let r;
      if (cat.value === "Température") { const a = U.Température[u1.value], b = U.Température[u2.value]; const C = a === "c" ? x : a === "f" ? (x - 32) * 5 / 9 : x - 273.15; r = b === "c" ? C : b === "f" ? C * 9 / 5 + 32 : C + 273.15; }
      else r = x * U[cat.value][u1.value] / U[cat.value][u2.value];
      v2.value = (+r.toPrecision(10)).toLocaleString("fr-CA", { maximumFractionDigits: 8 });
      v2.classList.remove("pop"); void v2.offsetWidth; v2.classList.add("pop");
    };
    cat.addEventListener("change", remplir); [u1, u2].forEach((s) => s.addEventListener("change", conv)); v1.addEventListener("input", conv);
    $(".bu-inverser", c).addEventListener("click", (e) => { const i = u1.selectedIndex; u1.selectedIndex = u2.selectedIndex; u2.selectedIndex = i; conv(); e.currentTarget.animate([{ transform: "rotate(0)" }, { transform: "rotate(180deg)" }], 300); });
    remplir();
  } },

  minuterie: { nom: "Minuterie", icone: "⏱️", l: 380, h: 480, ouvrir(c) {
    c.innerHTML = `<div class="bu-col bu-minut"><div class="bu-modes"><button data-m="25" data-nom="Travail" class="actif">🍅 25 min</button><button data-m="5" data-nom="Pause">☕ 5 min</button><button data-m="15" data-nom="Longue pause">🛋 15 min</button></div>
      <div class="bu-anneau"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="jauge-fond"/><circle cx="60" cy="60" r="52" class="bu-arc"/></svg><div><b class="bu-temps">25:00</b><small class="bu-nom-mode">Travail</small></div></div>
      <div class="bu-actions centre"><input class="bu-min" type="number" min="1" max="600" value="25" title="minutes"><button class="btn btn-plein mini bu-go">▶ Démarrer</button><button class="btn btn-contour mini bu-raz">↺</button></div>
      <small class="bu-petit bu-cycles">Pomodoros finis : 0</small></div>`;
    let total = 25 * 60, reste = total, minut = null, cycles = 0, nomMode = "Travail";
    const aff = () => { const m = Math.floor(reste / 60), s = reste % 60; $(".bu-temps", c).textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; $(".bu-arc", c).style.strokeDashoffset = 326.7 * (1 - reste / total); };
    const sonner = () => { try { const a = new AudioContext(); [0, .25, .5].forEach((t, i) => { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = 660 + i * 220; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(.25, a.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + t + .22); o.start(a.currentTime + t); o.stop(a.currentTime + t + .25); }); } catch {} };
    const fini = () => { clearInterval(minut); minut = null; $(".bu-go", c).textContent = "▶ Démarrer"; sonner(); toast(`⏱️ ${nomMode} terminé !`); if (nomMode === "Travail") { cycles++; $(".bu-cycles", c).textContent = `Pomodoros finis : ${cycles}`; } etincelles($(".bu-anneau", c), 40); try { new Notification("LexOS", { body: `${nomMode} terminé !` }); } catch {} BU.fen.get("minuterie")?.el.classList.add("sonne"); setTimeout(() => BU.fen.get("minuterie")?.el.classList.remove("sonne"), 3000); };
    const regler = (min, nom) => { clearInterval(minut); minut = null; total = reste = Math.round(min * 60); nomMode = nom || "Minuterie"; $(".bu-nom-mode", c).textContent = nomMode; $(".bu-go", c).textContent = "▶ Démarrer"; aff(); };
    c.addEventListener("click", (e) => {
      const m = e.target.closest("[data-m]");
      if (m) { $$("[data-m]", c).forEach((x) => x.classList.toggle("actif", x === m)); $(".bu-min", c).value = m.dataset.m; regler(+m.dataset.m, m.dataset.nom); }
      if (e.target.closest(".bu-go")) {
        if (minut) { clearInterval(minut); minut = null; e.target.textContent = "▶ Reprendre"; return; }
        try { Notification.requestPermission?.(); } catch {}
        e.target.textContent = "❚❚ Pause";
        minut = setInterval(() => { reste--; aff(); if (reste <= 0) fini(); }, 1000);
      }
      if (e.target.closest(".bu-raz")) regler(+$(".bu-min", c).value, nomMode);
    });
    $(".bu-min", c).addEventListener("change", (e) => regler(+e.target.value || 1, "Minuterie"));
    aff();
  } },

  presse: { nom: "Presse-papiers", icone: "📋", l: 460, h: 480, ouvrir(c) {
    c.innerHTML = `<div class="bu-col"><div class="bu-actions"><button class="btn btn-plein mini" data-lire>📥 Lire le presse-papiers</button><button class="btn btn-contour mini" data-vider>🧹 Vider</button></div>
      <small class="bu-petit">Tout ce que tu copies dans LexOS est gardé ici (en mémoire seulement, pas sur la clé). Clique pour recopier.</small><ul class="bu-presse"></ul></div>`;
    BU.majPresse = () => { $(".bu-presse", c).innerHTML = BU.presse.length ? BU.presse.map((t, i) => `<li data-i="${i}" title="Cliquer pour copier">${echapper(t.slice(0, 300))}${t.length > 300 ? "…" : ""}</li>`).join("") : `<li class="vide-mini">Rien encore</li>`; };
    c.addEventListener("click", async (e) => {
      const li = e.target.closest("li[data-i]"); if (li) { await copierTexte(BU.presse[+li.dataset.i]); li.classList.add("copie"); setTimeout(() => li.classList.remove("copie"), 700); toast("Recopié ✔"); }
      if (e.target.closest("[data-lire]")) { try { ajouterPresse(await navigator.clipboard.readText()); } catch { toast("Le navigateur bloque la lecture : fais Ctrl+V dans une zone de texte.", true); } }
      if (e.target.closest("[data-vider]")) { BU.presse = []; BU.majPresse(); }
    });
    BU.majPresse();
  } },

  capture: { nom: "Capture d'écran", icone: "📸", l: 700, h: 560, ouvrir(c) {
    c.innerHTML = `<div class="bu-col"><div class="bu-actions"><button class="btn btn-plein mini" data-cap>📸 Prendre une capture</button><span class="bu-petit">Choisis l'écran ou la fenêtre à capturer.</span></div>
      <div class="bu-capture"><img alt="" hidden><span>Aucune capture</span></div>
      <div class="bu-actions"><button class="btn btn-contour mini" data-c="galerie">💾 Garder dans la galerie</button><button class="btn btn-contour mini" data-c="ia">👁 Décrire avec l'IA</button><button class="btn btn-contour mini" data-c="photo">🖼️ Ouvrir dans Photo</button></div>
      <div class="bu-sortie"></div></div>`;
    let b64 = "";
    c.addEventListener("click", async (e) => {
      if (e.target.closest("[data-cap]")) {
        try {
          const flux = await navigator.mediaDevices.getDisplayMedia({ video: true });
          const v = document.createElement("video"); v.srcObject = flux; v.muted = true; await v.play();
          await new Promise((r) => setTimeout(r, 350));
          const cv = document.createElement("canvas"); cv.width = v.videoWidth; cv.height = v.videoHeight; cv.getContext("2d").drawImage(v, 0, 0);
          flux.getTracks().forEach((t) => t.stop());
          const url = cv.toDataURL("image/png"); b64 = url.split(",")[1];
          const img = $(".bu-capture img", c); img.src = url; img.hidden = false; $(".bu-capture span", c).hidden = true;
          $(".bu-capture", c).classList.remove("flash"); void img.offsetWidth; $(".bu-capture", c).classList.add("flash");
        } catch (err) { if (err.name !== "NotAllowedError") toast("Capture impossible : " + err.message, true); }
      }
      const a = e.target.closest("[data-c]")?.dataset.c; if (!a) return;
      if (!b64) return toast("Prends d'abord une capture", true);
      if (a === "galerie") { try { await api("/moteur/images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: b64, prompt: "capture d'écran", modele: "capture" }) }); toast("💾 Gardée dans la galerie 🎨 Images"); } catch (err) { toast(err.message, true); } }
      if (a === "ia") iaVoit(b64, "Décris cette capture d'écran : qu'est-ce qu'on voit, et y a-t-il un problème ou une erreur visible ?", $(".bu-sortie", c));
      if (a === "photo") { ouvrirApp("photo"); setTimeout(() => BU.photoCharger?.(b64), 400); }
    });
  } },
};

function ajouterTaches(texte) {
  const lignes = texte.split("\n").map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*(?:\[[ x]\]\s*)?/, "").trim()).filter((l) => l && l.length < 200);
  const ajout = async () => {
    BU.taches = BU.taches || await chargerBureau("taches", []);
    lignes.reverse().forEach((t, i) => BU.taches.unshift({ id: Date.now().toString(36) + i, texte: t, fait: false }));
    if (BU.majTaches && BU.fen.has("taches")) BU.majTaches(); else sauverBureau("taches", BU.taches);
    toast(`✅ ${lignes.length} tâche(s) ajoutée(s)`); ouvrirApp("taches");
  };
  ajout();
}
function ajouterPresse(t) {
  t = (t || "").trim(); if (!t || BU.presse[0] === t) return;
  BU.presse.unshift(t); BU.presse = BU.presse.slice(0, 40); BU.majPresse?.();
}
document.addEventListener("copy", () => setTimeout(() => ajouterPresse(String(window.getSelection() || "")), 0));
const _copierTexte = copierTexte;
copierTexte = async (t) => { ajouterPresse(t); return _copierTexte(t); };

/* ════════════════════════ Gestionnaire de fenêtres ════════════════════════ */
function ouvrirApp(id, depuis) {
  const app = APPS[id];
  if (BU.fen.has(id)) { const f = BU.fen.get(id); if (f.min) restaurer(id); devant(id); f.el.classList.remove("secoue"); void f.el.offsetWidth; f.el.classList.add("secoue"); return; }
  const zone = $("#bu-fenetres"), r = zone.getBoundingClientRect();
  const n = BU.fen.size;
  const l = Math.min(app.l, r.width - 20), h = Math.min(app.h, r.height - 20);
  const x = Math.max(10, Math.min(r.width - l - 10, (r.width - l) / 2 + (n % 5) * 28 - 56)), y = Math.max(10, Math.min(r.height - h - 10, (r.height - h) / 2 + (n % 5) * 24 - 48));
  const el = document.createElement("div");
  el.className = "bu-fen"; el.dataset.app = id;
  Object.assign(el.style, { left: x + "px", top: y + "px", width: l + "px", height: h + "px" });
  el.innerHTML = `<div class="bu-fen-tete"><span class="bu-fen-ic">${app.icone}</span><b>${app.nom}</b>
    <button class="bu-b min" title="Réduire">─</button><button class="bu-b max" title="Agrandir">▢</button><button class="bu-b fer" title="Fermer">✕</button></div>
    <div class="bu-fen-corps"></div><i class="bu-poignee"></i>`;
  zone.appendChild(el);
  // animation : la fenêtre sort de l'icône
  const src = (depuis || $(`.bu-icone[data-app="${id}"]`))?.getBoundingClientRect();
  if (src) {
    const er = el.getBoundingClientRect();
    el.animate([{ transform: `translate(${src.left + src.width / 2 - (er.left + er.width / 2)}px, ${src.top + src.height / 2 - (er.top + er.height / 2)}px) scale(.1)`, opacity: 0 },
                { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.2,1.2,.3,1)" });
  }
  BU.fen.set(id, { el, min: false, max: false });
  devant(id); majBarre();
  app.ouvrir($(".bu-fen-corps", el));
  // déplacer
  const tete = $(".bu-fen-tete", el);
  tete.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".bu-b")) return;
    devant(id);
    const f = BU.fen.get(id); if (f.max) return;
    const dx = e.clientX - el.offsetLeft, dy = e.clientY - el.offsetTop;
    tete.setPointerCapture(e.pointerId); el.classList.add("bouge");
    const bouger = (ev) => { el.style.left = Math.max(-el.offsetWidth + 80, Math.min(zone.clientWidth - 80, ev.clientX - dx)) + "px"; el.style.top = Math.max(0, Math.min(zone.clientHeight - 40, ev.clientY - dy)) + "px"; };
    const fin = () => { el.classList.remove("bouge"); tete.removeEventListener("pointermove", bouger); tete.removeEventListener("pointerup", fin); };
    tete.addEventListener("pointermove", bouger); tete.addEventListener("pointerup", fin);
  });
  tete.addEventListener("dblclick", (e) => { if (!e.target.closest(".bu-b")) agrandir(id); });
  // redimensionner
  const poig = $(".bu-poignee", el);
  poig.addEventListener("pointerdown", (e) => {
    e.stopPropagation(); poig.setPointerCapture(e.pointerId);
    const w0 = el.offsetWidth, h0 = el.offsetHeight, x0 = e.clientX, y0 = e.clientY;
    const bouger = (ev) => { el.style.width = Math.max(280, w0 + ev.clientX - x0) + "px"; el.style.height = Math.max(200, h0 + ev.clientY - y0) + "px"; };
    const fin = () => { poig.removeEventListener("pointermove", bouger); poig.removeEventListener("pointerup", fin); };
    poig.addEventListener("pointermove", bouger); poig.addEventListener("pointerup", fin);
  });
  el.addEventListener("pointerdown", () => devant(id));
  $(".fer", el).onclick = () => fermerApp(id);
  $(".min", el).onclick = () => reduire(id);
  $(".max", el).onclick = () => agrandir(id);
}
function devant(id) {
  const f = BU.fen.get(id); if (!f) return;
  f.el.style.zIndex = ++BU.z;
  $$(".bu-fen").forEach((x) => x.classList.toggle("active", x === f.el));
  $$(".bu-tache").forEach((b) => b.classList.toggle("active", b.dataset.app === id));
}
function fermerApp(id) {
  const f = BU.fen.get(id); if (!f) return;
  BU.fen.delete(id);
  if (id === "taches") BU.majTaches = null; if (id === "presse") BU.majPresse = null;
  f.el.animate([{ transform: "none", opacity: 1 }, { transform: "scale(.85) translateY(20px)", opacity: 0 }], { duration: 220, easing: "ease-in" }).onfinish = () => f.el.remove();
  majBarre();
}
function reduire(id) {
  const f = BU.fen.get(id); const b = $(`.bu-tache[data-app="${id}"]`);
  if (!f) return; f.min = true;
  const er = f.el.getBoundingClientRect(), br = b?.getBoundingClientRect();
  const a = f.el.animate([{ transform: "none", opacity: 1 }, { transform: br ? `translate(${br.left + br.width / 2 - (er.left + er.width / 2)}px, ${br.top - (er.top + er.height / 2)}px) scale(.08)` : "scale(.1)", opacity: 0 }], { duration: 320, easing: "cubic-bezier(.6,0,.4,1)" });
  a.onfinish = () => { f.el.hidden = true; }; majBarre();
}
function restaurer(id) {
  const f = BU.fen.get(id); if (!f) return;
  f.min = false; f.el.hidden = false;
  f.el.animate([{ transform: "translateY(60px) scale(.6)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,1.2,.3,1)" });
  devant(id); majBarre();
}
function agrandir(id) {
  const f = BU.fen.get(id); if (!f) return;
  f.max = !f.max; f.el.classList.toggle("max", f.max);
}
function majBarre() {
  $("#bu-taches").innerHTML = [...BU.fen.entries()].map(([id, f]) => `<button class="bu-tache ${f.min ? "min" : ""}" data-app="${id}" title="${APPS[id].nom}"><span>${APPS[id].icone}</span><b>${APPS[id].nom}</b></button>`).join("");
}

/* ════════════════════════ Ouvrir / sortir du bureau ════════════════════════ */
/* Les lanceurs « ti-lex IA » : ils ouvrent l'interface sur le bon onglet */
const LANCEURS = {
  chat: { nom: "ti-lex Chat", icone: "💬", vue: "chat" },
  codex: { nom: "Codex", icone: "⌨️", vue: "codex" },
  equipe: { nom: "Codex équipe", icone: "👥", vue: "equipe" },
  images: { nom: "Images", icone: "🎨", vue: "images" },
  schemas: { nom: "Schémas animés", icone: "🎬", vue: "schemas" },
  modeles: { nom: "Modèles", icone: "🧠", vue: "modeles" },
  cle: { nom: "La clé", icone: "🔌", vue: "cle" },
  parametres: { nom: "Paramètres", icone: "⚙️", vue: "parametres" },
  variables: { nom: "Variables", icone: "🔑", action: () => ouvrirEnv() },
  nuage: { nom: "IA en ligne", icone: "☁️", action: () => ouvrirNuage() },
};
function lancer(id) {
  const l = LANCEURS[id];
  if (l.action) return l.action();
  sortirBureau();
  setTimeout(() => { $(`.onglet[data-vue="${l.vue}"]`)?.click(); }, 120);
}
function construireBureau() {
  let k = 0;
  const icone = (type, id, a) => `<button class="bu-icone ${type === "lanceur" ? "lanceur" : ""}" data-${type}="${id}" style="animation-delay:${k++ * 40}ms"><span>${a.icone}</span><b>${a.nom}</b></button>`;
  $("#bu-icones").innerHTML = `<h5 class="bu-groupe">ti-lex IA</h5>` + Object.entries(LANCEURS).map(([id, a]) => icone("lanceur", id, a)).join("")
    + `<h5 class="bu-groupe">Outils</h5>` + Object.entries(APPS).map(([id, a]) => icone("app", id, a)).join("");
  $("#bu-menu-apps").innerHTML = `<h5>ti-lex IA</h5>` + Object.entries(LANCEURS).map(([id, a]) => `<button data-lanceur="${id}"><span>${a.icone}</span>${a.nom}</button>`).join("")
    + `<h5>Outils</h5>` + Object.entries(APPS).map(([id, a]) => `<button data-app="${id}"><span>${a.icone}</span>${a.nom}</button>`).join("");
}
function ouvrirBureau() {
  const b = $("#bureau");
  b.hidden = false; BU.ouvert = true;
  b.classList.remove("sort"); void b.offsetWidth; b.classList.add("entre");
  $("#app").classList.add("cache-bureau");
  $("#bu-modele").textContent = "🧠 " + (modeleTexte() || "aucun modèle");
  majHorloge();
}
function sortirBureau() {
  const b = $("#bureau");
  b.classList.remove("entre"); b.classList.add("sort");
  $("#app").classList.remove("cache-bureau");
  setTimeout(() => { b.hidden = true; b.classList.remove("sort"); BU.ouvert = false; }, 450);
}
function majHorloge() {
  const d = new Date();
  $("#bu-grande-heure").textContent = d.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
  const h = d.getHours();
  $("#bu-salut").textContent = `${h < 5 ? "Bonne nuit" : h < 12 ? "Bon matin" : h < 18 ? "Bon après-midi" : "Bonsoir"} Alex 👋 · ${d.toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" })}`;
  $("#bu-heure").textContent = d.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
  $("#bu-date").textContent = d.toLocaleDateString("fr-CA", { weekday: "short", day: "numeric", month: "short" });
}
setInterval(() => BU.ouvert && majHorloge(), 15000);

construireBureau();
$("#ouvrir-bureau").addEventListener("click", ouvrirBureau);
$("#bu-sortir").addEventListener("click", sortirBureau);
$("#bu-icones").addEventListener("click", (e) => {
  const b = e.target.closest(".bu-icone"); if (!b) return;
  b.classList.remove("rebond"); void b.offsetWidth; b.classList.add("rebond");
  if (b.dataset.lanceur) lancer(b.dataset.lanceur); else ouvrirApp(b.dataset.app, b);
});
$("#bu-taches").addEventListener("click", (e) => { const b = e.target.closest(".bu-tache"); if (!b) return; const f = BU.fen.get(b.dataset.app); if (f.min) restaurer(b.dataset.app); else if (f.el.classList.contains("active")) reduire(b.dataset.app); else devant(b.dataset.app); });
$("#bu-demarrer").addEventListener("click", (e) => { e.stopPropagation(); $("#bu-menu").classList.toggle("ouvert"); });
$("#bu-menu-apps").addEventListener("click", (e) => {
  const b = e.target.closest("[data-app], [data-lanceur]"); if (!b) return;
  $("#bu-menu").classList.remove("ouvert");
  if (b.dataset.lanceur) lancer(b.dataset.lanceur); else ouvrirApp(b.dataset.app, $("#bu-demarrer"));
});
/* Accueil : grande horloge + « Demande à ti-lex IA » qui ouvre le Chat */
$("#bu-demande").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("input", e.target).value.trim(); if (!q) return;
  $("input", e.target).value = "";
  sortirBureau();
  setTimeout(() => { $('.onglet[data-vue="chat"]').click(); nouvelle(); $("#saisie").value = q; envoyer(); }, 200);
});
/* Démarrer sur le bureau (réglable dans Paramètres) */
$("#depart-bureau").checked = mem.lire("lexos-depart-bureau", "1") === "1";
$("#depart-bureau").addEventListener("change", (e) => mem.ecrire("lexos-depart-bureau", e.target.checked ? "1" : "0"));
function bureauAuDemarrage() { if (mem.lire("lexos-depart-bureau", "1") === "1") ouvrirBureau(); }
document.addEventListener("click", (e) => { if (!e.target.closest("#bu-menu, #bu-demarrer")) $("#bu-menu")?.classList.remove("ouvert"); });
document.addEventListener("keydown", (e) => {
  if (!BU.ouvert) return;
  if (e.key === "Escape" && !$("#bu-menu").classList.contains("ouvert") && !document.activeElement.closest?.(".bu-fen")) sortirBureau();
  if (e.key === "Escape") $("#bu-menu").classList.remove("ouvert");
});

/* ── Grand logo au centre du bureau : clic = change de logo, suit un peu la souris ── */
(() => {
  const LOGOS = ["lexos-nomad.png", "logo.png", "/cle-images/tilexal.png", "/cle-images/marceau.png"];
  const LARGES = ["lexos-nomad.png"];                    // logos en bannière (larges, avec le nom dedans)
  const emb = $("#bu-embleme");
  const appliquer = (src) => { img.src = src; emb.classList.toggle("large", LARGES.includes(src)); };
  const btn = $("#bu-embleme-btn"), img = $("#bu-embleme-img");
  if (!btn) return;
  let i = Math.max(0, LOGOS.indexOf(mem.lire("lexos-logo-bureau2", LOGOS[0])));
  appliquer(LOGOS[i]);
  img.onerror = () => { if (!img.src.includes(LOGOS[0])) { i = 0; appliquer(LOGOS[0]); } };
  btn.addEventListener("click", () => {
    btn.classList.remove("tourne", "onde"); void btn.offsetWidth; btn.classList.add("tourne", "onde");
    setTimeout(() => { i = (i + 1) % LOGOS.length; appliquer(LOGOS[i]); mem.ecrire("lexos-logo-bureau2", LOGOS[i]); }, 400);
    if (typeof etincelles === "function") etincelles(btn, 30);
  });
  btn.addEventListener("animationend", (e) => { if (e.animationName === "emb-tourne") btn.classList.remove("tourne", "onde"); });
  $("#bureau").addEventListener("mousemove", (e) => {
    const x = e.clientX / innerWidth - .5, y = e.clientY / innerHeight - .5;
    btn.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 14}deg)`;
  });
  $("#bureau").addEventListener("mouseleave", () => { btn.style.transform = ""; });
})();

/* ⌨️ Moteur d'écriture de code : le code se tape tout seul dans l'image du bureau */
(() => {
  const zone = $("#bu-code");
  if (!zone) return;
  const MORCEAUX = [
`from pathlib import Path
from lexos import bureau, ia

CLE = Path("/media/LEXOS")`,
`def dessiner_horizon(scene):
    for ligne in scene.lignes:
        scene.afficher(ligne)
    return scene.horizon`,
`# Une lumière discrète
opacite: float = 0.35
mouvement: str = "doux"`,
`def composer_bureau(image, calques):
    resultat = image.copy()
    for calque in calques:
        resultat = calque.appliquer(resultat)
    return resultat`,
`palette = {"texte": "#9c9fa2", "accent": "#ff6a00"}`,
`async def demander(question: str) -> str:
    modele = ia.choisir("qwen3")
    return await modele.repondre(question)`,
`class Nomad:
    version = "2.0.0"
    def demarrer(self):
        bureau.ouvrir(theme="noir")
        print("ti-lex IA est prêt")`,
`for fichier in CLE.glob("**/*.gguf"):
    ia.importer(fichier)  # tout reste sur la clé`,
  ];
  const MAX = 15;
  let lignes = [""], morceau = 0, pos = 0, attente = 0, faute = null, minuteur = null;
  const peindre = () => {
    const html = lignes.map((l, i) => {
      const c = typeof colorier === "function" ? colorier(l, "python") : echapper(l);
      return `<span class="ligne">${c || " "}${i === lignes.length - 1 ? '<i class="bu-code-curseur"></i>' : ""}</span>`;
    }).join("");
    zone.innerHTML = html;
  };
  const taper = () => {
    const visible = !$("#bureau").hidden && !document.hidden && $("#bu-embleme").classList.contains("large");
    if (!visible) { minuteur = setTimeout(taper, 800); return; }
    if (attente > 0) { attente--; minuteur = setTimeout(taper, 90); return; }
    const texte = MORCEAUX[morceau];
    if (faute !== null) {                              // petite faute de frappe… puis on efface
      lignes[lignes.length - 1] = lignes[lignes.length - 1].slice(0, -1);
      faute = null; peindre(); minuteur = setTimeout(taper, 140); return;
    }
    if (pos >= texte.length) {                         // morceau fini : on saute une ligne et on passe au suivant
      lignes.push(""); morceau = (morceau + 1) % MORCEAUX.length; pos = 0; attente = 12;
    } else {
      const c = texte[pos++];
      if (c === "\n") lignes.push("");
      else {
        if (/[a-z]/.test(c) && Math.random() < .025) {   // une faute, de temps en temps
          lignes[lignes.length - 1] += String.fromCharCode(97 + Math.floor(Math.random() * 26));
          faute = true; pos--;
        } else lignes[lignes.length - 1] += c;
      }
      if (c === "\n") attente = 2 + Math.floor(Math.random() * 4);
    }
    while (lignes.length > MAX) lignes.shift();
    peindre();
    const vite = /[ (=:.,]/.test(texte[pos - 1] || "") ? 70 : 28;
    minuteur = setTimeout(taper, vite + Math.random() * 60);
  };
  // Si on ne veut pas d'animation : le code est écrit d'un coup
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { lignes = MORCEAUX.slice(0, 3).join("\n\n").split("\n"); peindre(); return; }
  lignes = (MORCEAUX[0] + "\n\n" + MORCEAUX[1] + "\n").split("\n"); morceau = 2;   // on commence avec du code déjà écrit
  peindre(); taper();
})();
