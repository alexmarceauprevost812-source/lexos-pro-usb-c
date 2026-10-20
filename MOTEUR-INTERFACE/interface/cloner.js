/* LexOS · 📦 Cloner un dépôt GitHub — sans git, sans IA, directement sur la clé */
"use strict";

const CLONE = { ou: "nouveau", ctrl: null };

function ouvrirClone(url) {
  $("#clone").hidden = false;
  $("#clone-progres").hidden = true; $("#clone-fini").hidden = true; $("#clone-go").hidden = false;
  if (url) $("#clone-url").value = url;
  const dans = $('[data-ou="dans"]');
  dans.disabled = !(typeof CX !== "undefined" && CX.projet);
  dans.textContent = CX?.projet ? `📁 Dans « ${CX.projet} »` : "📁 Dans le projet actuel";
  choisirOu(CLONE.ou === "dans" && !dans.disabled ? "dans" : "nouveau");
  $("#clone-prive").textContent = "";
  fetch("/moteur/env").then((r) => r.json()).then((d) => {
    $("#clone-prive").textContent = (d.noms || []).includes("GITHUB_TOKEN") ? "🔐 GITHUB_TOKEN trouvé : les dépôts privés marchent aussi" : "";
  }).catch(() => {});
  setTimeout(() => $("#clone-url").focus(), 250);
}
function fermerClone() {
  CLONE.ctrl?.abort();
  $(".clone-boite").classList.add("sort");
  setTimeout(() => { $("#clone").hidden = true; $(".clone-boite").classList.remove("sort"); }, 300);
}
function choisirOu(ou) {
  CLONE.ou = ou;
  $$("#clone-ou button").forEach((b) => b.classList.toggle("actif", b.dataset.ou === ou));
  const b = $("#clone-ou button.actif"), g = $("#clone-ou .env-envs-glisse");
  requestAnimationFrame(() => { g.style.left = b.offsetLeft + "px"; g.style.width = b.offsetWidth + "px"; });
  $("#clone-nom").closest("label").firstChild.textContent = ou === "dans" ? "Nom du dossier" : "Nom du projet";
}
$("#clone-ou").addEventListener("click", (e) => { const b = e.target.closest("[data-ou]"); if (b && !b.disabled) choisirOu(b.dataset.ou); });
$("#clone-url").addEventListener("input", () => {
  const m = $("#clone-url").value.match(/github\.com\/[\w.-]+\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/) || $("#clone-url").value.match(/^[\w.-]+\/([\w.-]+?)(?:\.git)?$/);
  $("#clone-nom").placeholder = m ? m[1] : "auto";
});

$("#clone-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("#clone-url").value.trim();
  if (!url) { $("#clone-url").focus(); return; }
  $("#clone-go").hidden = true; $("#clone-fini").hidden = true;
  $("#clone-progres").hidden = false; $("#clone-barre").style.width = "4%"; $("#clone-etat").textContent = "connexion à GitHub…";
  $(".clone-boite").classList.add("travail");
  CLONE.ctrl = new AbortController();
  const corps = { url, branche: $("#clone-branche").value.trim(),
    ...(CLONE.ou === "dans" ? { dans: CX.projet, dossier: $("#clone-nom").value.trim() } : { nom: $("#clone-nom").value.trim() }) };
  let fin = null, erreur = null;
  try {
    const r = await fetch("/moteur/cloner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps), signal: CLONE.ctrl.signal });
    if (!r.ok || !r.body) { const d = await r.json().catch(() => ({})); throw new Error(d.erreur || "Erreur " + r.status); }
    const lec = r.body.getReader(), dec = new TextDecoder(); let tampon = "";
    for (;;) {
      const { value, done } = await lec.read(); if (done) break;
      tampon += dec.decode(value, { stream: true });
      const lignes = tampon.split("\n"); tampon = lignes.pop();
      for (const l of lignes) {
        let ev; try { ev = JSON.parse(l); } catch { continue; }
        if (ev.type === "debut") $("#clone-etat").textContent = `téléchargement de ${ev.depot}…`;
        if (ev.type === "progres") {
          const pct = ev.total ? ev.recu / ev.total * 90 : Math.min(85, 10 + Math.log2(1 + ev.recu / 65536) * 8);
          $("#clone-barre").style.width = pct + "%";
          $("#clone-etat").textContent = `${octets(ev.recu)}${ev.total ? " / " + octets(ev.total) : ""} reçus…`;
        }
        if (ev.type === "fin") fin = ev;
        if (ev.type === "erreur") erreur = ev.texte;
      }
    }
  } catch (err) { if (err.name !== "AbortError") erreur = err.message; }
  $(".clone-boite").classList.remove("travail");
  CLONE.ctrl = null;
  if (fin) {
    $("#clone-barre").style.width = "100%";
    setTimeout(() => {
      $("#clone-progres").hidden = true;
      $("#clone-fini").hidden = false;
      $("#clone-fini").innerHTML = `<div class="clone-ok">✔</div><b>${echapper(fin.proprio)}/${echapper(fin.depot)}</b> est sur la clé !
        <small>${fin.fichiers} fichiers · ${octets(fin.taille)} · projet 📁 ${echapper(fin.projet)}${fin.dossier ? " / " + echapper(fin.dossier) : ""}</small>
        <div class="clone-btns"><button type="button" class="btn btn-contour mini" id="clone-studio">🎛️ Voir dans le Studio</button>
        <button type="button" class="btn btn-plein mini" id="clone-ouvrir">⌨️ Ouvrir dans le Codex</button></div>`;
      etincelles($(".clone-ok"), 40);
      $("#clone-ouvrir").onclick = async () => {
        fermerClone();
        allerA("codex"); await ouvrirCodex();
        if (CX.projet !== fin.projet) { $("#cx-projet").value = fin.projet; $("#cx-projet").dispatchEvent(new Event("change")); }
      };
      $("#clone-studio").onclick = () => { fermerClone(); allerA("codex"); ouvrirCodex().then(ouvrirStudio); };
      if (typeof listerFichiers === "function" && CX.projet === fin.projet) listerFichiers();
      if (!$("#studio").hidden) chargerStudio();
    }, 400);
  } else {
    $("#clone-progres").hidden = true; $("#clone-go").hidden = false;
    if (erreur) {
      toast("Clonage impossible : " + erreur, true);
      $(".clone-boite").classList.remove("erreur"); void $(".clone-boite").offsetWidth; $(".clone-boite").classList.add("erreur");
    }
  }
});
$$("[data-cloner]").forEach((b) => b.addEventListener("click", () => ouvrirClone()));
$("#clone-fermer").addEventListener("click", fermerClone);
$("#clone").addEventListener("click", (e) => { if (e.target.id === "clone") fermerClone(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#clone").hidden) fermerClone(); });
