/* LexOS · 📤 Partager un projet sur GitHub (jeton GITHUB_TOKEN du coffre).
   Le projet devient un dépôt GitHub ; le jeton reste côté moteur, jamais ici. */
"use strict";

const PART = { prive: true, ctrl: null };

async function ouvrirPartage() {
  if (!CX.projet) return toast("Choisis d'abord un projet.", true);
  $("#partage").hidden = false;
  $("#partage-progres").hidden = true; $("#partage-fini").hidden = true; $("#partage-go").hidden = false;
  $("#partage-depot").value = CX.projet;
  $("#partage-message").value = "";
  $("#partage-info").textContent = "";
  const note = $("#partage-jeton");
  note.hidden = true; note.textContent = "";
  try {
    const d = await api("/moteur/github");
    if (!d.pret) {
      note.hidden = false;
      note.innerHTML = "🔑 Il faut d'abord ajouter ton jeton GitHub : <b>🔑 Variables → variable globale GITHUB_TOKEN</b> " +
        "(jeton « fine-grained » avec Contents et Administration en écriture).";
    }
  } catch {}
  setTimeout(() => $("#partage-depot").focus(), 250);
}
function fermerPartage() {
  if (PART.ctrl) PART.ctrl.abort();
  $(".clone-boite", $("#partage")).classList.add("sort");
  setTimeout(() => { $("#partage").hidden = true; $(".clone-boite", $("#partage")).classList.remove("sort"); }, 300);
}

$$("#partage-ou button").forEach((b) => b.addEventListener("click", () => {
  PART.prive = b.dataset.prive === "1";
  $$("#partage-ou button").forEach((x) => x.classList.toggle("actif", x === b));
}));

$("#partage-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (PART.ctrl) return;
  const depot = $("#partage-depot").value.trim() || CX.projet;
  $("#partage-go").hidden = true; $("#partage-fini").hidden = true;
  $("#partage-progres").hidden = false; $("#partage-barre").style.width = "6%";
  $("#partage-etat").textContent = "connexion à GitHub…";
  PART.ctrl = new AbortController();
  let fin = null, erreur = null;
  try {
    const r = await fetch("/moteur/partager", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: PART.ctrl.signal,
      body: JSON.stringify({ projet: CX.projet, depot, prive: PART.prive, message: $("#partage-message").value.trim() }),
    });
    if (!r.ok || !r.body) throw new Error((await r.text()).slice(0, 200) || "Erreur " + r.status);
    const lec = r.body.getReader(), dec = new TextDecoder(); let tampon = "";
    for (;;) {
      const { value, done } = await lec.read();
      if (done) break;
      tampon += dec.decode(value, { stream: true });
      const lignes = tampon.split("\n"); tampon = lignes.pop();
      for (const l of lignes) {
        let o; try { o = JSON.parse(l); } catch { continue; }
        if (o.type === "info") $("#partage-etat").textContent = o.texte;
        else if (o.type === "progres") {
          $("#partage-barre").style.width = (10 + 80 * o.n / o.total) + "%";
          $("#partage-etat").textContent = `envoi ${o.n}/${o.total} · ${o.fichier}`;
        } else if (o.type === "fin") fin = o;
        else if (o.type === "erreur") erreur = o.texte;
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") erreur = err.message;
  } finally {
    PART.ctrl = null;
  }
  $("#partage-progres").hidden = true;
  if (fin) {
    $("#partage-barre").style.width = "100%";
    $("#partage-fini").hidden = false;
    $("#partage-fini").innerHTML = `<div class="clone-ok">✅</div>
      <b>Projet envoyé sur GitHub !</b>
      <p>${fin.fichiers} fichier(s) · ${fin.prive ? "🔒 dépôt privé" : "🌍 dépôt public"} · branche ${echapper(fin.branche)}</p>
      <a class="btn btn-contour mini" href="${echapper(fin.url)}" target="_blank" rel="noopener">🔗 Ouvrir sur GitHub</a>`;
    toast("📤 Projet partagé sur GitHub ✔");
    if (typeof etincelles === "function") etincelles($("#partage-fini"), 26);
  } else {
    $("#partage-go").hidden = false;
    toast("Partage : " + (erreur || "arrêté"), true);
    $("#partage-info").textContent = erreur || "";
  }
});

$("#partage-fermer").addEventListener("click", fermerPartage);
$("#partage").addEventListener("click", (e) => { if (e.target.id === "partage") fermerPartage(); });
$$("[data-partager]").forEach((b) => b.addEventListener("click", ouvrirPartage));
