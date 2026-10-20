/* LexOS · Création d'images en local (Ollama, expérimental) — gardées SUR la clé */
"use strict";

const IM = { modeles: [], ctrl: null, dernier: null, format: { l: 1024, h: 1024 }, anim: null, pct: 0 };
const RE_IMAGE = RE_MODELE_IMAGE;

/* ── Trouver les modèles qui savent faire des images ── */
async function trouverModelesImage() {
  const tous = S.modeles.map((m) => m.name);
  // On demande à Ollama ce que chaque modèle sait faire : un .gguf d'image importé
  // (ComfyUI / stable-diffusion.cpp) n'a PAS la capacité « image » → on l'écarte.
  IM.casses = [];
  const verifs = await Promise.all(tous.map(async (n) => {
    try {
      const r = await fetch("/api/show", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: n }) });
      const d = await r.json();
      if (Array.isArray(d.capabilities)) {
        if (d.capabilities.includes("image")) return n;
        if (RE_IMAGE.test(n)) IM.casses.push(n);
        return null;
      }
    } catch {}
    return RE_IMAGE.test(n) ? n : null;
  }));
  IM.modeles = verifs.filter(Boolean); IM.cherche = true;
  $("#im-casses").hidden = !IM.casses.length;
  $("#im-casses").innerHTML = IM.casses.length ? `⚠️ <b>${IM.casses.map(echapper).join(", ")}</b> : ce modèle d'image en .gguf ne marche pas dans Ollama (fait pour ComfyUI / stable-diffusion.cpp). Télécharge plutôt un modèle officiel ci-dessous, puis supprime l'ancien dans l'onglet Modèles.` : "";
  const sel = $("#im-modele");
  sel.innerHTML = IM.modeles.length ? IM.modeles.map((n) => `<option>${echapper(n)}</option>`).join("") : `<option value="">(aucun modèle d'image)</option>`;
  const garde = mem.lire("lexos-modele-image", "");
  if (IM.modeles.includes(garde)) sel.value = garde;
  sel.onchange = () => mem.ecrire("lexos-modele-image", sel.value);
  $("#im-installer").hidden = IM.modeles.length > 0;
  $("#im-go").disabled = !IM.modeles.length;
}

/* ── Réglages ── */
$("#im-formats").addEventListener("click", (e) => {
  const b = e.target.closest(".im-format"); if (!b) return;
  $$(".im-format").forEach((x) => x.classList.toggle("actif", x === b));
  IM.format = { l: +b.dataset.l, h: +b.dataset.h };
  $("#im-toile").style.aspectRatio = `${IM.format.l} / ${IM.format.h}`;
});
$("#im-etapes").addEventListener("input", (e) => {
  const v = +e.target.value;
  e.target.nextElementSibling.textContent = v ? v : "auto";
  e.target.style.setProperty("--pct", (v / 30) * 100 + "%");
});
$("#im-etapes").style.setProperty("--pct", "0%");
$("#im-de").addEventListener("click", (e) => { $("#im-graine").value = Math.floor(Math.random() * 2 ** 31); e.currentTarget.animate([{ transform: "rotate(0) scale(1)" }, { transform: "rotate(540deg) scale(1.3)" }, { transform: "rotate(720deg) scale(1)" }], 600); });
$$("[data-idee]").forEach((b) => b.addEventListener("click", () => { $("#im-prompt").value = b.dataset.idee; $("#im-prompt").focus(); }));

/* ── Animation « je peins » pendant la création ── */
function demarrerMagie() {
  const c = $("#im-magie"), x = c.getContext("2d");
  const r = c.getBoundingClientRect(); c.width = r.width * devicePixelRatio; c.height = r.height * devicePixelRatio;
  const L = c.width, H = c.height;
  const pts = Array.from({ length: 140 }, () => ({ a: Math.random() * 7, d: 20 + Math.random() * Math.min(L, H) * .45, v: .004 + Math.random() * .012, t: Math.random() * 3 + 1, b: Math.random() < .25 }));
  let t = 0;
  const image = () => {
    t += 1;
    x.fillStyle = "rgba(7,7,7,.18)"; x.fillRect(0, 0, L, H);
    const g = x.createRadialGradient(L / 2, H / 2, 0, L / 2, H / 2, Math.max(L, H) * .6);
    g.addColorStop(0, `rgba(${THEME.rgb},${.10 + .08 * Math.sin(t / 30)})`); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, L, H);
    for (const p of pts) {
      p.a += p.v * (1 + IM.pct / 50); p.d += Math.sin(t / 40 + p.a) * .6;
      const px = L / 2 + Math.cos(p.a) * p.d, py = H / 2 + Math.sin(p.a * 1.3) * p.d * .8;
      x.beginPath(); x.arc(px, py, p.t * devicePixelRatio, 0, 7);
      x.fillStyle = p.b ? "rgba(255,255,255,.85)" : `rgba(${THEME.rgb},.85)`;
      x.shadowColor = THEME.hex; x.shadowBlur = 12; x.fill(); x.shadowBlur = 0;
    }
    IM.anim = requestAnimationFrame(image);
  };
  cancelAnimationFrame(IM.anim); c.classList.add("visible"); image();
}
function arreterMagie() { cancelAnimationFrame(IM.anim); $("#im-magie").classList.remove("visible"); }
function majProgres(pct, etat) {
  IM.pct = pct;
  $("#im-arc").style.strokeDashoffset = 326.7 * (1 - pct / 100);
  $("#im-pct").textContent = Math.round(pct) + "%";
  if (etat) $("#im-etat").textContent = etat;
}

/* ── Créer l'image ── */
async function creerImage() {
  const prompt = $("#im-prompt").value.trim(), modele = $("#im-modele").value;
  if (IM.ctrl) { IM.ctrl.abort(); return; }
  if (!prompt) { $("#im-prompt").focus(); return toast("Décris d'abord ton image ✍️", true); }
  if (!modele) return toast("Aucun modèle d'image sur la clé — télécharge-en un ci-dessous.", true);
  const graine = $("#im-graine").value.trim() ? +$("#im-graine").value : Math.floor(Math.random() * 2 ** 31);
  const etapes = +$("#im-etapes").value;
  const corps = { model: modele, prompt, width: IM.format.l, height: IM.format.h, stream: true, options: { seed: graine } };
  if (etapes) corps.steps = etapes;

  IM.ctrl = new AbortController();
  const go = $("#im-go"); go.textContent = "■ Arrêter"; etincelles(go, 24);
  $("#im-vide").hidden = true; $("#im-resultat").classList.remove("revele"); $("#im-actions").hidden = true;
  $("#im-progres").hidden = false; majProgres(0, "je réveille le modèle…"); demarrerMagie();
  const debut = performance.now();
  let estimation = setInterval(() => { if (IM.pct < 92) majProgres(IM.pct + (92 - IM.pct) * .02, IM.pct > 5 ? "je peins…" : null); }, 400);
  let image = null;
  try {
    const r = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps), signal: IM.ctrl.signal });
    if (!r.ok || !r.body) throw new Error((await r.text()).slice(0, 300) || "Erreur " + r.status);
    const lecteur = r.body.getReader(), dec = new TextDecoder();
    let tampon = "";
    const lire = (l) => {
      if (!l.trim()) return;
      let d; try { d = JSON.parse(l); } catch { return; }
      if (d.error) throw new Error(d.error);
      if (d.total && d.completed != null) { clearInterval(estimation); majProgres((d.completed / d.total) * 100, `étape ${d.completed}/${d.total}`); }
      if (d.image) image = d.image;
      if (Array.isArray(d.images) && d.images[0]) image = d.images[0];
    };
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      tampon += dec.decode(value, { stream: true });
      const lignes = tampon.split("\n"); tampon = lignes.pop();
      lignes.forEach(lire);
    }
    lire(tampon);
    if (!image) throw new Error("le modèle n'a pas renvoyé d'image (version d'Ollama trop vieille, ou carte graphique pas prise en charge)");
    majProgres(100, "terminé ✔");
    const duree = Math.round((performance.now() - debut) / 100) / 10;
    afficherImage("data:image/png;base64," + image, true);
    const res = await api("/moteur/images", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: image, prompt, modele, largeur: IM.format.l, hauteur: IM.format.h, graine, etapes: etapes || null, duree }) });
    IM.dernier = { nom: res.nom, prompt, graine, b64: image };
    $("#im-ouvrir").href = "/images/" + res.nom;
    $("#im-info").textContent = `${duree} s · graine ${graine} · gardée sur la clé`;
    chargerGalerie();
  } catch (err) {
    if (err.name === "AbortError") toast("Création arrêtée.");
    else {
      toast("Image impossible : " + err.message, true);
      if (/memory|mémoire|out of|cuda|500/i.test(err.message)) toast("Astuce : essaie le format « Rapide », ou FLUX.2 Klein 4B — c'est plus léger pour la carte graphique.");
    }
    if (!$("#im-resultat").src) $("#im-vide").hidden = false;
  } finally {
    clearInterval(estimation); IM.ctrl = null; go.textContent = "✨ Créer l'image";
    setTimeout(() => { $("#im-progres").hidden = true; arreterMagie(); }, 500);
  }
}
function afficherImage(src, nouvelle) {
  const img = $("#im-resultat");
  img.classList.remove("revele"); void img.offsetWidth;
  img.src = src; $("#im-vide").hidden = true;
  img.onload = () => {
    $("#im-toile").style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    img.classList.add("revele"); $("#im-actions").hidden = false;
    if (nouvelle) etincelles($("#im-toile"), 40);
  };
}
$("#im-go").addEventListener("click", creerImage);
$("#im-prompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) creerImage(); });
$("#im-refaire").addEventListener("click", () => { $("#im-graine").value = ""; creerImage(); });
$("#im-fond").addEventListener("click", async (e) => {
  if (!IM.dernier) return;
  try {
    const b64 = IM.dernier.b64 || await fetch("/images/" + IM.dernier.nom).then((r) => r.blob()).then(enB64);
    const r = await api("/moteur/fonds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "image/png", data: b64 }) });
    changer({ image: r.nom }, false); etincelles(e.currentTarget, 20); toast("Image mise en fond d'écran ✔");
  } catch (err) { toast(err.message, true); }
});

/* ── Galerie (sur la clé) ── */
async function chargerGalerie() {
  let l = [];
  try { l = await api("/moteur/images"); } catch {}
  $("#im-galerie").innerHTML = l.length ? l.map((i, k) => `<figure class="im-vignette" data-nom="${echapper(i.nom)}" style="animation-delay:${Math.min(k, 20) * 40}ms">
      <img src="/images/${encodeURIComponent(i.nom)}" alt="" loading="lazy">
      <figcaption>${echapper(i.prompt || "")}</figcaption>
      <button type="button" class="x" title="Supprimer">✕</button></figure>`).join("")
    : `<div class="vide">Aucune image encore. Crée ta première ✨</div>`;
  IM.galerie = l;
}
$("#im-galerie").addEventListener("click", async (e) => {
  const f = e.target.closest(".im-vignette"); if (!f) return;
  const info = IM.galerie.find((i) => i.nom === f.dataset.nom) || {};
  if (e.target.closest(".x")) {
    if (!confirm("Supprimer cette image de la clé ?")) return;
    f.classList.add("sort");
    await fetch("/moteur/images/" + encodeURIComponent(f.dataset.nom), { method: "DELETE" }).catch(() => {});
    return setTimeout(chargerGalerie, 350);
  }
  IM.dernier = { nom: f.dataset.nom, prompt: info.prompt, graine: info.graine };
  $("#im-prompt").value = info.prompt || "";
  if (info.graine) $("#im-graine").value = info.graine;
  $("#im-ouvrir").href = "/images/" + f.dataset.nom;
  $("#im-info").textContent = [info.modele, info.duree && info.duree + " s", info.graine && "graine " + info.graine].filter(Boolean).join(" · ");
  afficherImage("/images/" + encodeURIComponent(f.dataset.nom), false);
});

/* ── Télécharger un modèle d'image SUR la clé (ollama pull, en direct) ── */
$$("[data-tirer]").forEach((b) => b.addEventListener("click", async () => {
  const nom = b.dataset.tirer;
  if (!confirm(`Télécharger ${nom} sur la clé ? Ça peut être long (plusieurs Go) et il faut Internet.`)) return;
  $$("[data-tirer]").forEach((x) => { x.disabled = true; });
  $("#im-tirage").hidden = false;
  try {
    const r = await fetch("/api/pull", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: nom, stream: true }) });
    const lecteur = r.body.getReader(), dec = new TextDecoder();
    let tampon = "";
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      tampon += dec.decode(value, { stream: true });
      const lignes = tampon.split("\n"); tampon = lignes.pop();
      for (const l of lignes) {
        let d; try { d = JSON.parse(l); } catch { continue; }
        if (d.error) throw new Error(d.error);
        const pct = d.total ? (d.completed || 0) / d.total * 100 : 0;
        $("#im-tirage-i").style.width = pct + "%";
        $("#im-tirage-txt").textContent = (d.status || "") + (d.total ? ` — ${octets(d.completed || 0)} / ${octets(d.total)}` : "");
      }
    }
    toast(`${nom} est sur la clé ✔`);
    await chargerModeles(); await trouverModelesImage();
  } catch (err) { toast("Téléchargement impossible : " + err.message, true); }
  finally { $$("[data-tirer]").forEach((x) => { x.disabled = false; }); }
}));

$$(".onglet").forEach((o) => o.addEventListener("click", () => {
  if (o.dataset.vue !== "images") return;
  trouverModelesImage(); chargerGalerie();
}));


/* ── Créer une image directement dans le Chat (« crée une image de… ») ── */
async function imageDansChat(texte) {
  if (!IM.cherche) await trouverModelesImage();
  const modele = IM.modeles[0];
  ajouterMsg("user", texte);
  S.conv.messages.push({ role: "user", content: texte });
  const bulle = ajouterMsg("assistant", ""); bulle.classList.add("ecrit");
  const t = $(".texte", bulle);
  if (!modele) {
    const raison = IM.casses?.length
      ? `Ton modèle **${IM.casses.join(", ")}** est un .gguf d'image pour ComfyUI : Ollama ne sait pas le charger.`
      : "Il n'y a pas encore de modèle d'image sur la clé.";
    const rep = `${raison}\n\nVa dans l'onglet **🎨 Images** et clique sur **⬇ Z-Image Turbo** (ou FLUX.2 Klein 4B, plus léger) : il se télécharge directement sur la clé. Ensuite, redemande-moi ton image ici 😉`;
    bulle.classList.remove("ecrit"); t.innerHTML = rendre(rep);
    S.conv.messages.push({ role: "assistant", content: rep }); sauver(); return;
  }
  const prompt = texte.replace(RE_DEMANDE_IMAGE, "").replace(/^[\s:,-]*(de|d'|du|avec|qui|représentant)?\s*/i, "").trim() || texte;
  t.innerHTML = `<div class="chat-image-attente"><canvas></canvas><b>🎨 je peins avec ${echapper(modele)}…</b><small>0%</small></div>`;
  const zone = $(".chat-image-attente", t), cv = $("canvas", zone), x = cv.getContext("2d");
  cv.width = 320; cv.height = 320;
  let k = 0, anim;
  const dessinerAttente = () => {
    k++; x.fillStyle = "rgba(7,7,7,.2)"; x.fillRect(0, 0, 320, 320);
    for (let i = 0; i < 40; i++) {
      const a = k / 30 + i * .5, d = 40 + (i * 37 % 110) + Math.sin(k / 20 + i) * 10;
      x.beginPath(); x.arc(160 + Math.cos(a) * d, 160 + Math.sin(a * 1.2) * d, 2.4, 0, 7);
      x.fillStyle = i % 4 ? `rgba(${THEME.rgb},.9)` : "#fff"; x.fill();
    }
    anim = requestAnimationFrame(dessinerAttente);
  };
  dessinerAttente();
  const debut = performance.now(); let image = null, rep;
  try {
    const r = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modele, prompt, width: 1024, height: 1024, stream: true }) });
    if (!r.ok || !r.body) throw new Error((await r.text()).slice(0, 300));
    const lec = r.body.getReader(), dec = new TextDecoder(); let tampon = "";
    for (;;) {
      const { value, done } = await lec.read(); if (done) break;
      tampon += dec.decode(value, { stream: true });
      const lignes = tampon.split("\n"); tampon = lignes.pop();
      for (const l of lignes.concat(done ? [tampon] : [])) {
        let d; try { d = JSON.parse(l); } catch { continue; }
        if (d.error) throw new Error(d.error);
        if (d.total) $("small", zone).textContent = Math.round((d.completed || 0) / d.total * 100) + "%";
        if (d.image) image = d.image;
      }
    }
    try { const d = JSON.parse(tampon); if (d.image) image = d.image; } catch {}
    if (!image) throw new Error("le modèle n'a pas renvoyé d'image");
    const s = ((performance.now() - debut) / 1000).toFixed(1);
    const res = await api("/moteur/images", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: image, prompt, modele, largeur: 1024, hauteur: 1024, duree: +s }) });
    t.innerHTML = `<img class="chat-image" src="/images/${encodeURIComponent(res.nom)}" alt=""><p>🎨 Voilà ! <small>(${s} s · gardée dans la galerie 🎨 Images)</small></p>`;
    etincelles(bulle, 30);
    rep = `[image créée : ${res.nom}] ${prompt}`;
  } catch (err) {
    rep = "⚠️ " + expliquerErreur(err.message);
    t.innerHTML = rendre(rep);
  } finally {
    cancelAnimationFrame(anim); bulle.classList.remove("ecrit");
    S.conv.messages.push({ role: "assistant", content: rep }); sauver();
  }
}
