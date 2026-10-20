"""
nuage.py — ☁️ IA en ligne avec TA propre clé API + compteur de jetons et de dollars.

Fournisseurs : Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google), OpenRouter, Groq, Mistral.

- Chaque personne met SA clé. Elle est gardée chiffrée dans le coffre (.env.coffre) et
  chargée en mémoire quand le moteur est déverrouillé. La clé ne va jamais au navigateur :
  c'est le moteur (sur 127.0.0.1) qui parle au fournisseur.
- Les modèles en ligne s'appellent « nuage:fournisseur/modèle » (ex. nuage:openai/gpt-4o-mini).
  Ils passent par la même route que les modèles locaux (/api/chat, format Ollama),
  donc Chat, Codex, Codex équipe, Bureau… marchent avec.
- Un modèle en ligne n'est JAMAIS choisi tout seul : seulement quand la personne le prend.
- Compteur du mois (compteur.json) : jetons entrée/sortie par modèle + coût estimé avec
  les prix que la personne entre ($ par million de jetons). Limite en jetons ET/OU en $ :
  une fois atteinte, le moteur refuse d'envoyer d'autres demandes jusqu'au mois suivant
  (ou jusqu'à ce que la limite soit montée / le compteur remis à zéro).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

PREFIXE = "nuage:"

FOURNISSEURS = {
    "anthropic":  {"nom": "Claude (Anthropic)", "variable": "ANTHROPIC_API_KEY", "sorte": "anthropic",
                   "base": "https://api.anthropic.com/v1", "site": "https://console.anthropic.com/settings/keys"},
    "openai":     {"nom": "ChatGPT (OpenAI)", "variable": "OPENAI_API_KEY", "sorte": "openai",
                   "base": "https://api.openai.com/v1", "site": "https://platform.openai.com/api-keys"},
    "gemini":     {"nom": "Gemini (Google)", "variable": "GEMINI_API_KEY", "sorte": "openai",
                   "base": "https://generativelanguage.googleapis.com/v1beta/openai", "site": "https://aistudio.google.com/apikey"},
    "openrouter": {"nom": "OpenRouter", "variable": "OPENROUTER_API_KEY", "sorte": "openai",
                   "base": "https://openrouter.ai/api/v1", "site": "https://openrouter.ai/keys"},
    "groq":       {"nom": "Groq", "variable": "GROQ_API_KEY", "sorte": "openai",
                   "base": "https://api.groq.com/openai/v1", "site": "https://console.groq.com/keys"},
    "mistral":    {"nom": "Mistral", "variable": "MISTRAL_API_KEY", "sorte": "openai",
                   "base": "https://api.mistral.ai/v1", "site": "https://console.mistral.ai/api-keys"},
}
RE_MODELE = re.compile(r"^[A-Za-z0-9._:/@+-]{1,160}$")
ALERTE = 0.8          # avertissement à 80 % d'une limite


class ErreurNuage(Exception):
    pass


def est_nuage(nom: str | None) -> bool:
    return bool(nom) and str(nom).startswith(PREFIXE)


def _mime(b64: str) -> str:
    for debut, m in (("/9j/", "image/jpeg"), ("iVBOR", "image/png"), ("R0lG", "image/gif"), ("UklG", "image/webp")):
        if b64.startswith(debut):
            return m
    return "image/png"


def _estimer(texte: str) -> int:
    """Estimation grossière (≈ 4 caractères par jeton) si le fournisseur ne donne pas le compte."""
    return max(1, len(texte) // 4)


class Nuage:
    def __init__(self, dossier: Path):
        self.f_config = dossier / "nuage.json"
        self.f_compteur = dossier / "compteur.json"
        self.verrou = threading.Lock()

    # ───────────── fichiers ─────────────
    def _lire(self, f: Path, defaut: dict) -> dict:
        try:
            d = json.loads(f.read_text("utf-8"))
            return d if isinstance(d, dict) else defaut
        except (OSError, ValueError):
            return defaut

    def _ecrire(self, f: Path, d: dict) -> None:
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), "utf-8")
        os.replace(tmp, f)

    def config(self) -> dict:
        d = self._lire(self.f_config, {})
        lim = d.get("limites") or {}
        return {"modeles": [m for m in d.get("modeles", []) if isinstance(m, str)],
                "prix": d.get("prix") or {},
                "image_modele": str(d.get("image_modele") or "gpt-image-1"),
                "image_prix": float(d.get("image_prix") or 0),
                "limites": {"jetons": int(lim.get("jetons") or 0), "dollars": float(lim.get("dollars") or 0)}}

    def sauver_config(self, d: dict) -> dict:
        actuel = self.config()
        if "modeles" in d:
            vus, modeles = set(), []
            for m in d["modeles"] or []:
                m = str(m).strip()
                if not m.startswith(PREFIXE):
                    m = PREFIXE + m
                f = m[len(PREFIXE):].split("/", 1)
                if len(f) == 2 and f[0] in FOURNISSEURS and f[1] and RE_MODELE.match(m) and m not in vus:
                    vus.add(m)
                    modeles.append(m)
            actuel["modeles"] = modeles[:200]
        if "prix" in d:
            prix = {}
            for m, p in (d["prix"] or {}).items():
                try:
                    e, s = float(p[0] or 0), float(p[1] or 0)
                except (TypeError, ValueError, IndexError):
                    continue
                if m in actuel["modeles"] and 0 <= e < 10000 and 0 <= s < 10000:
                    prix[m] = [e, s]
            actuel["prix"] = prix
        if "limites" in d:
            lim = d["limites"] or {}
            try:
                actuel["limites"] = {"jetons": max(0, int(float(lim.get("jetons") or 0))),
                                     "dollars": max(0.0, round(float(lim.get("dollars") or 0), 4))}
            except (TypeError, ValueError):
                raise ErreurNuage("limite invalide")
        if "image_modele" in d:
            im = str(d["image_modele"] or "gpt-image-1").strip()
            if not RE_MODELE.match(im):
                raise ErreurNuage("nom de modèle d'image invalide")
            actuel["image_modele"] = im
        if "image_prix" in d:
            try:
                actuel["image_prix"] = max(0.0, min(100.0, float(d["image_prix"] or 0)))
            except (TypeError, ValueError):
                raise ErreurNuage("prix d'image invalide")
        actuel["prix"] = {m: p for m, p in actuel["prix"].items() if m in actuel["modeles"]}
        with self.verrou:
            self._ecrire(self.f_config, actuel)
        return actuel

    def _mois(self) -> str:
        return time.strftime("%Y-%m")

    def compteur(self) -> dict:
        c = self._lire(self.f_compteur, {})
        if c.get("mois") != self._mois():           # nouveau mois → on repart à zéro
            c = {"mois": self._mois(), "entree": 0, "sortie": 0, "dollars": 0.0, "requetes": 0, "modeles": {}}
        return c

    def remettre(self) -> dict:
        with self.verrou:
            c = {"mois": self._mois(), "entree": 0, "sortie": 0, "dollars": 0.0, "requetes": 0, "modeles": {}}
            self._ecrire(self.f_compteur, c)
        return c

    def _noter(self, modele: str, entree: int, sortie: int, cout_fixe: float | None = None) -> dict:
        p = self.config()["prix"].get(modele)
        cout = cout_fixe if cout_fixe is not None else ((entree * p[0] + sortie * p[1]) / 1_000_000 if p else 0.0)
        with self.verrou:
            c = self.compteur()
            c["entree"] += entree
            c["sortie"] += sortie
            c["dollars"] = round(c["dollars"] + cout, 6)
            c["requetes"] += 1
            m = c["modeles"].setdefault(modele, {"entree": 0, "sortie": 0, "dollars": 0.0, "requetes": 0})
            m["entree"] += entree
            m["sortie"] += sortie
            m["dollars"] = round(m["dollars"] + cout, 6)
            m["requetes"] += 1
            self._ecrire(self.f_compteur, c)
        return self.resume()

    # ───────────── limites ─────────────
    def resume(self) -> dict:
        c, lim = self.compteur(), self.config()["limites"]
        jetons = c["entree"] + c["sortie"]
        pj = jetons / lim["jetons"] if lim["jetons"] else 0
        pd = c["dollars"] / lim["dollars"] if lim["dollars"] else 0
        return {"jetons": jetons, "dollars": round(c["dollars"], 4), "limite_jetons": lim["jetons"],
                "limite_dollars": lim["dollars"], "pourcent": round(max(pj, pd) * 100, 1),
                "alerte": max(pj, pd) >= ALERTE, "bloque": max(pj, pd) >= 1}

    def verifier(self, estimation_entree: int = 0) -> None:
        r, lim = self.resume(), self.config()["limites"]
        if r["bloque"]:
            raise ErreurNuage("🛑 Limite du mois atteinte (" + self._texte_limite(r) + "). "
                              "Monte la limite ou remets le compteur à zéro dans ☁️ IA en ligne.")
        if lim["jetons"] and r["jetons"] + estimation_entree > lim["jetons"]:
            raise ErreurNuage(f"🛑 Cette demande (~{estimation_entree:,} jetons) dépasserait ta limite de "
                              f"{lim['jetons']:,} jetons. Raccourcis la conversation ou monte la limite.".replace(",", " "))

    @staticmethod
    def _texte_limite(r: dict) -> str:
        bouts = []
        if r["limite_jetons"]:
            bouts.append(f"{r['jetons']:,} / {r['limite_jetons']:,} jetons".replace(",", " "))
        if r["limite_dollars"]:
            bouts.append(f"{r['dollars']:.2f} / {r['limite_dollars']:.2f} $")
        return " · ".join(bouts)

    # ───────────── état pour l'interface ─────────────
    def cle(self, fournisseur: str) -> str:
        return os.environ.get(FOURNISSEURS[fournisseur]["variable"], "").strip()

    def etat(self) -> dict:
        return {"fournisseurs": [{"id": k, "nom": f["nom"], "variable": f["variable"], "site": f["site"],
                                  "cle": bool(self.cle(k))} for k, f in FOURNISSEURS.items()],
                **self.config(), "compteur": self.compteur(), "resume": self.resume()}

    def tags(self) -> list[dict]:
        """Modèles en ligne à montrer dans les menus (seulement si la clé est là)."""
        out = []
        for m in self.config()["modeles"]:
            f = m[len(PREFIXE):].split("/", 1)[0]
            if f in FOURNISSEURS and self.cle(f):
                out.append({"name": m, "model": m, "size": 0, "nuage": True,
                            "details": {"family": "nuage", "parameter_size": FOURNISSEURS[f]["nom"]}})
        return out

    # ───────────── HTTP ─────────────
    def _entetes(self, fournisseur: str) -> dict:
        cle = self.cle(fournisseur)
        if not cle:
            raise ErreurNuage(f"Aucune clé pour {FOURNISSEURS[fournisseur]['nom']} — ajoute-la dans ☁️ IA en ligne.")
        h = {"Content-Type": "application/json", "User-Agent": "LexOS-Moteur"}
        if FOURNISSEURS[fournisseur]["sorte"] == "anthropic":
            h.update({"x-api-key": cle, "anthropic-version": "2023-06-01"})
        else:
            h["Authorization"] = "Bearer " + cle
        if fournisseur == "openrouter":
            h.update({"HTTP-Referer": "https://github.com/alexmarceauprevost812-source/lexos-pro-usb-c", "X-Title": "LexOS"})
        return h

    @staticmethod
    def _message_erreur(e: urllib.error.HTTPError, fournisseur: str) -> str:
        brut = e.read()[:2000].decode("utf-8", "replace")
        try:
            d = json.loads(brut)
            err = d.get("error") if isinstance(d, dict) else None
            if isinstance(d, list) and d:
                err = d[0].get("error")
            msg = (err.get("message") if isinstance(err, dict) else err) or d.get("message") or brut
        except (ValueError, AttributeError):
            msg = brut
        nom = FOURNISSEURS[fournisseur]["nom"]
        if e.code in (401, 403):
            return f"{nom} refuse la clé (erreur {e.code}) : vérifie-la dans ☁️ IA en ligne. — {msg}"[:400]
        if e.code == 429:
            return f"{nom} : trop de demandes ou plus de crédit sur ton compte (429). — {msg}"[:400]
        if e.code == 404:
            return f"{nom} ne connaît pas ce modèle (404). Recharge la liste des modèles. — {msg}"[:400]
        return f"{nom} a répondu {e.code} : {msg}"[:400]

    def lister(self, fournisseur: str) -> list[str]:
        if fournisseur not in FOURNISSEURS:
            raise ErreurNuage("fournisseur inconnu")
        f = FOURNISSEURS[fournisseur]
        url = f["base"] + "/models" + ("?limit=1000" if f["sorte"] == "anthropic" else "")
        req = urllib.request.Request(url, headers=self._entetes(fournisseur))
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise ErreurNuage(self._message_erreur(e, fournisseur)) from e
        except (OSError, ValueError) as e:
            raise ErreurNuage(f"{f['nom']} injoignable : {e}") from e
        ids = [str(m.get("id", "")).removeprefix("models/") for m in d.get("data", []) if isinstance(m, dict)]
        bruit = re.compile(r"embed|whisper|tts|dall-e|audio|realtime|moderation|transcribe|image|search|guard|aqa", re.I)
        return sorted({i for i in ids if i and not bruit.search(i)})

    # ───────────── conversion des messages (format Ollama → fournisseur) ─────────────
    @staticmethod
    def _texte(m: dict) -> str:
        c = m.get("content") or ""
        if m.get("role") == "tool":
            c = "Résultat d'outil :\n" + c
        return c if isinstance(c, str) else json.dumps(c, ensure_ascii=False)

    def _corps_openai(self, nom: str, messages: list, options: dict) -> dict:
        out = []
        for m in messages:
            role = m.get("role") if m.get("role") in ("system", "user", "assistant") else "user"
            texte = self._texte(m)
            if m.get("images") and role == "user":
                contenu = [{"type": "text", "text": texte}] + [
                    {"type": "image_url", "image_url": {"url": f"data:{_mime(b)};base64,{b}"}} for b in m["images"]]
                out.append({"role": role, "content": contenu})
            else:
                out.append({"role": role, "content": texte})
        corps = {"model": nom, "messages": out, "stream": True}
        if "temperature" in options:
            corps["temperature"] = options["temperature"]
        if options.get("num_predict", 0) > 0:
            corps["max_tokens"] = int(options["num_predict"])
        return corps

    def _corps_anthropic(self, nom: str, messages: list, options: dict) -> dict:
        systeme, out = [], []
        for m in messages:
            if m.get("role") == "system":
                systeme.append(self._texte(m))
                continue
            role = "assistant" if m.get("role") == "assistant" else "user"
            blocs = [{"type": "image", "source": {"type": "base64", "media_type": _mime(b), "data": b}}
                     for b in (m.get("images") or [])] if role == "user" else []
            texte = self._texte(m)
            if texte:
                blocs.append({"type": "text", "text": texte})
            if not blocs:
                continue
            if out and out[-1]["role"] == role:          # Claude veut user / assistant en alternance
                out[-1]["content"].extend(blocs)
            else:
                out.append({"role": role, "content": blocs})
        if not out or out[0]["role"] != "user":
            out.insert(0, {"role": "user", "content": [{"type": "text", "text": "…"}]})
        corps = {"model": nom, "messages": out, "stream": True,
                 "max_tokens": int(options.get("num_predict") or 0) if options.get("num_predict", 0) > 0 else 4096}
        if systeme:
            corps["system"] = "\n\n".join(systeme)
        if "temperature" in options:
            corps["temperature"] = max(0.0, min(1.0, float(options["temperature"])))
        return corps

    # ───────────── discussion (flux, format Ollama) ─────────────
    def discuter(self, demande: dict):
        """Générateur : donne des morceaux au format Ollama /api/chat (message.content, done…)."""
        modele = str(demande.get("model", ""))
        fournisseur, _, nom = modele[len(PREFIXE):].partition("/")
        if fournisseur not in FOURNISSEURS or not nom:
            raise ErreurNuage("modèle en ligne invalide (forme : nuage:fournisseur/modèle)")
        messages = demande.get("messages") or []
        if not messages and demande.get("prompt"):                 # au cas où (/api/generate)
            messages = [{"role": "user", "content": str(demande["prompt"])}]
        options = demande.get("options") or {}
        estimation = sum(_estimer(self._texte(m)) + 800 * len(m.get("images") or []) for m in messages)
        self.verifier(estimation)

        f = FOURNISSEURS[fournisseur]
        anthropic = f["sorte"] == "anthropic"
        corps = self._corps_anthropic(nom, messages, options) if anthropic else self._corps_openai(nom, messages, options)
        if not anthropic and fournisseur != "mistral":
            corps["stream_options"] = {"include_usage": True}
        url = f["base"] + ("/messages" if anthropic else "/chat/completions")

        def ouvrir(c: dict):
            req = urllib.request.Request(url, data=json.dumps(c).encode(), headers=self._entetes(fournisseur))
            return urllib.request.urlopen(req, timeout=600)

        try:
            try:
                r = ouvrir(corps)
            except urllib.error.HTTPError as e:
                if e.code in (400, 422) and "stream_options" in corps:   # fournisseur qui n'aime pas l'option
                    corps.pop("stream_options")
                    r = ouvrir(corps)
                else:
                    raise
        except urllib.error.HTTPError as e:
            raise ErreurNuage(self._message_erreur(e, fournisseur)) from e
        except OSError as e:
            raise ErreurNuage(f"{f['nom']} injoignable : {e}") from e

        entree = sortie = 0
        texte_total = ""
        debut = time.time()
        try:
            with r:
                for brut in r:
                    ligne = brut.decode("utf-8", "replace").strip()
                    if not ligne.startswith("data:"):
                        continue
                    data = ligne[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        d = json.loads(data)
                    except ValueError:
                        continue
                    morceau = pense = ""
                    if anthropic:
                        t = d.get("type")
                        if t == "message_start":
                            u = d.get("message", {}).get("usage", {})
                            entree = (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) \
                                + (u.get("cache_creation_input_tokens") or 0)
                        elif t == "content_block_delta":
                            dl = d.get("delta", {})
                            morceau = dl.get("text", "") if dl.get("type") == "text_delta" else ""
                            pense = dl.get("thinking", "") if dl.get("type") == "thinking_delta" else ""
                        elif t == "message_delta":
                            sortie = d.get("usage", {}).get("output_tokens") or sortie
                        elif t == "error":
                            raise ErreurNuage(f"{f['nom']} : {d.get('error', {}).get('message', 'erreur')}")
                    else:
                        if d.get("error"):
                            err = d["error"]
                            raise ErreurNuage(f"{f['nom']} : {err.get('message') if isinstance(err, dict) else err}")
                        for ch in d.get("choices") or []:
                            dl = ch.get("delta") or {}
                            morceau += dl.get("content") or ""
                            pense += dl.get("reasoning") or dl.get("reasoning_content") or ""
                        u = d.get("usage")
                        if u:
                            entree = u.get("prompt_tokens") or entree
                            sortie = u.get("completion_tokens") or sortie
                    if morceau or pense:
                        texte_total += morceau + pense
                        msg = {"role": "assistant", "content": morceau}
                        if pense:
                            msg["thinking"] = pense
                        yield {"model": modele, "message": msg, "done": False}
        finally:
            # On compte même si l'utilisateur a cliqué « Stop » : le fournisseur facture quand même.
            entree = entree or estimation
            sortie = sortie or (_estimer(texte_total) if texte_total else 0)
            resume = self._noter(modele, int(entree), int(sortie))
        yield {"model": modele, "message": {"role": "assistant", "content": ""}, "done": True,
               "done_reason": "stop", "prompt_eval_count": entree, "eval_count": sortie,
               "total_duration": int((time.time() - debut) * 1e9), "lexos_compteur": resume}

    def discuter_complet(self, demande: dict) -> dict:
        """Version sans flux (pour Turbo REA) : une seule réponse au format Ollama."""
        contenu, pense, fin = "", "", {}
        for d in self.discuter(demande):
            contenu += d["message"].get("content", "")
            pense += d["message"].get("thinking", "")
            if d.get("done"):
                fin = d
        msg = {"role": "assistant", "content": contenu}
        if pense:
            msg["thinking"] = pense
        return {**fin, "message": msg}

    # ───────────── 🎨 images avec ChatGPT (OpenAI Images) ─────────────
    def image_dispo(self) -> dict | None:
        if not self.cle("openai"):
            return None
        return {"id": "nuage-image", "nom": "☁️ ChatGPT Images (" + self.config()["image_modele"] + ")"}

    def generer_image(self, prompt: str, largeur: int = 1024, hauteur: int = 1024) -> tuple[bytes, dict]:
        """Crée une image avec l'API Images d'OpenAI. Retourne (png, infos). Compte dans le compteur."""
        import base64
        cfg = self.config()
        prompt = (prompt or "").strip()[:4000]
        if not prompt:
            raise ErreurNuage("décris l'image à créer")
        self.verifier(_estimer(prompt) + 1500)
        if cfg["limites"]["dollars"] and cfg["image_prix"]:
            r = self.resume()
            if r["dollars"] + cfg["image_prix"] > cfg["limites"]["dollars"]:
                raise ErreurNuage("🛑 Cette image dépasserait ta limite de " + f"{cfg['limites']['dollars']:.2f} $ ce mois-ci.")
        ratio = (largeur or 1024) / max(1, hauteur or 1024)
        taille = "1536x1024" if ratio > 1.2 else "1024x1536" if ratio < 0.83 else "1024x1024"
        modele = cfg["image_modele"]
        corps = {"model": modele, "prompt": prompt, "n": 1, "size": taille}
        if modele.startswith("dall-e"):
            corps["response_format"] = "b64_json"
            corps["size"] = {"1536x1024": "1792x1024", "1024x1536": "1024x1792"}.get(taille, taille) if modele == "dall-e-3" else "1024x1024"
        req = urllib.request.Request(FOURNISSEURS["openai"]["base"] + "/images/generations",
                                     data=json.dumps(corps).encode(), headers=self._entetes("openai"))
        debut = time.time()
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                d = json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise ErreurNuage(self._message_erreur(e, "openai")) from e
        except (OSError, ValueError) as e:
            raise ErreurNuage(f"OpenAI injoignable : {e}") from e
        try:
            png = base64.b64decode(d["data"][0]["b64_json"])
        except (KeyError, IndexError, TypeError, ValueError) as e:
            raise ErreurNuage("OpenAI n'a pas renvoyé d'image") from e
        u = d.get("usage") or {}
        entree = int(u.get("input_tokens") or _estimer(prompt))
        sortie = int(u.get("output_tokens") or 0)
        nom = PREFIXE + "openai/" + modele
        resume = self._noter(nom, entree, sortie, cout_fixe=cfg["image_prix"] if cfg["image_prix"] else None)
        return png, {"modele": nom, "taille": taille, "duree": round(time.time() - debut, 1), "lexos_compteur": resume}
