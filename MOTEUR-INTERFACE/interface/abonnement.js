/* LexOS · 🌐 Mon abonnement en ligne
   Quand il y a du réseau, on ouvre le SITE OFFICIEL (ChatGPT, Claude, Gemini…) où la personne
   se connecte elle-même avec son compte et son abonnement. LexOS ne voit jamais le mot de passe
   et ne se sert pas du compte à sa place : il copie la question et ouvre la bonne page. */
"use strict";

const ABO = { enLigne: null, minuteur: null };
const SERVICES = [
  { id: "chatgpt", nom: "ChatGPT", sous: "Plus · Pro · Team", icone: "🤖", c: "#10a37f", url: "https://chatgpt.com/", q: (t) => "https://chatgpt.com/?q=" + encodeURIComponent(t) },
  { id: "claude", nom: "Claude", sous: "Pro · Max", icone: "✳️", c: "#d97757", url: "https://claude.ai/new", q: (t) => "https://claude.ai/new?q=" + encodeURIComponent(t) },
  { id: "gemini", nom: "Gemini", sous: "Google AI Pro", icone: "✨", c: "#4c8df6", url: "https://gemini.google.com/app" },
  { id: "lechat", nom: "Le Chat", sous: "Mistral · Pro", icone: "🌬️", c: "#ff7000", url: "https://chat.mistral.ai/chat", q: (t) => "https://chat.mistral.ai/chat?q=" + encodeURIComponent(t) },
  { id: "copilot", nom: "Copilot", sous: "Microsoft · Pro", icone: "🪁", c: "#7b61ff", url: "https://copilot.microsoft.com/" },
  { id: "perplexity", nom: "Perplexity", sous: "Pro", icone: "🔎", c: "#20b8cd", url: "https://www.perplexity.ai/", q: (t) => "https://www.perplexity.ai/search?q=" + encodeURIComponent(t) },
];

/* ── Le réseau : est-ce qu'on est en ligne ? ── */
async function verifierReseau() {
  let ok = navigator.onLine;
  if (ok) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
    try { await fetch("https://www.google.com/generate_204", { mode: "no-cors", cache: "no-store", signal: ctrl.signal }); ok = true; }
    catch { ok = false; } finally { clearTimeout(t); }
  }
  const change = ok !== ABO.enLigne;
  ABO.enLigne = ok;
  const txt = ok ? "En ligne" : "Hors ligne";
  for (const el of [$("#abo-reseau"), $("#bu-reseau")]) {
    if (!el) continue;
    el.classList.toggle("oui", ok); el.classList.toggle("non", !ok);
    $(el.id === "abo-reseau" ? "b" : "span", el).textContent = txt;
  }
  $("#abo").classList.toggle("hors-ligne", !ok);
  $("#vers-abo").hidden = !ok;
  if (change && ABO.enLigne !== null && document.visibilityState === "visible" && ABO.dejaVu) toast(ok ? "🌐 Réseau revenu : ton abonnement en ligne est disponible" : "📴 Plus de réseau : tes IA locales continuent de marcher");
  ABO.dejaVu = true;
  return ok;
}
addEventListener("online", verifierReseau);
addEventListener("offline", verifierReseau);
ABO.minuteur = setInterval(verifierReseau, 30000);
verifierReseau();

/* ── La fenêtre ── */
function ouvrirAbo(texte) {
  $("#abo").hidden = false;
  $(".abo-icone").classList.remove("tourne"); void $(".abo-icone").offsetWidth; $(".abo-icone").classList.add("tourne");
  if (typeof texte === "string" && texte) $("#abo-texte").value = texte;
  $("#abo-contexte").parentElement.hidden = !(typeof S !== "undefined" && S.conv?.messages?.length);
  rendreAbo(); verifierReseau();
}
function fermerAbo() {
  $(".abo-boite").classList.add("sort");
  setTimeout(() => { $("#abo").hidden = true; $(".abo-boite").classList.remove("sort"); }, 300);
}
$("#abo-fermer").addEventListener("click", fermerAbo);
$("#abo").addEventListener("click", (e) => { if (e.target.id === "abo") fermerAbo(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#abo").hidden) fermerAbo(); });
$("#bu-reseau")?.addEventListener("click", () => ouvrirAbo());

function rendreAbo() {
  $("#abo-services").innerHTML = SERVICES.map((s, i) => `
    <button class="abo-carte" data-s="${s.id}" style="--c:${s.c};animation-delay:${i * 60}ms">
      <div class="abo-carte-tete"><span class="abo-logo">${s.icone}</span><div><b>${s.nom}</b><small>${s.sous}</small></div></div>
      <span class="abo-go">${s.q ? "Ouvrir avec ma question →" : "Ouvrir (question copiée) →"}</span>
    </button>`).join("");
}

function texteAEnvoyer() {
  let t = $("#abo-texte").value.trim();
  if ($("#abo-contexte").checked && typeof S !== "undefined" && S.conv?.messages?.length) {
    const hist = S.conv.messages.slice(-10).map((m) => (m.role === "user" ? "Moi : " : "IA : ") + String(m.content || "").slice(0, 1500)).join("\n\n");
    t = "Voici notre conversation jusqu'ici :\n\n" + hist + (t ? "\n\nMa question : " + t : "");
  }
  return t;
}

$("#abo-services").addEventListener("click", async (e) => {
  const carte = e.target.closest(".abo-carte"); if (!carte) return;
  const s = SERVICES.find((x) => x.id === carte.dataset.s);
  if (!ABO.enLigne && !(await verifierReseau())) return toast("📴 Pas de réseau : ton abonnement en ligne a besoin d'Internet.", true);
  const t = texteAEnvoyer();
  if (t) { try { await navigator.clipboard.writeText(t); } catch {} }
  const url = t && s.q && t.length < 6000 ? s.q(t) : s.url;
  carte.classList.remove("part"); void carte.offsetWidth; carte.classList.add("part");
  if (typeof etincelles === "function") etincelles(carte, 22);
  const l = Math.min(1280, screen.availWidth - 80), h = Math.min(900, screen.availHeight - 80);
  const fen = window.open(url, "lexos-" + s.id, `popup,width=${l},height=${h},left=${(screen.availWidth - l) / 2},top=${(screen.availHeight - h) / 2}`);
  if (!fen) window.open(url, "_blank", "noopener");
  toast(t ? (s.q ? `🌐 ${s.nom} s'ouvre avec ta question (aussi copiée : Ctrl+V au besoin)` : `🌐 ${s.nom} s'ouvre — ta question est copiée, fais Ctrl+V`) : `🌐 ${s.nom} s'ouvre — connecte-toi avec ton compte`);
});

/* ── Depuis le chat : le bouton 🌐 envoie ce qu'on est en train d'écrire ── */
$("#vers-abo").addEventListener("click", () => ouvrirAbo($("#saisie").value.trim()));
