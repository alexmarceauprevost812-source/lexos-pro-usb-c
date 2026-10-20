"""
turbo_rea.py — ⚡ Mode Turbo REA pour le Codex du moteur LexOS.

Inspiré de l'agent ti-lex REA (dépôt GitHub ti-lex-ia-REA-) : le modèle choisit
des outils, on les exécute, on lui redonne le résultat, jusqu'à ce qu'il ait fini.
« Turbo » = il enchaîne tout seul, sans demander la permission à chaque fichier
(chaque fichier remplacé garde une copie « .avant-codex »).

Outils : recherche web, lecture de pages, fichiers du projet, vision (décrire une
image), création d'images (modèle d'image Ollama), clonage d'un dépôt GitHub public.
Volontairement AUCUN outil pour lancer des commandes : l'IA propose la commande,
c'est toi qui la lances dans ton terminal.

Aucune dépendance : bibliothèque standard Python seulement.
"""
from __future__ import annotations

import base64
import html
import io
import ipaddress
import json
import re
import socket
import time
import urllib.parse
import urllib.request
import zipfile
from html.parser import HTMLParser
from pathlib import Path

MAX_SORTIE = 8000            # caractères redonnés au modèle par outil
MAX_PAGE = 1_000_000         # octets lus par page web
MAX_DEPOT = 200 * 1024 ** 2  # taille max d'un dépôt cloné (zip)
MAX_ETAPES = 16
IMAGES_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
AGENT_WEB = "Mozilla/5.0 (X11; Linux x86_64) LexOS-TurboREA/1.0"

PROMPT = """Tu es REA en mode ⚡ TURBO, l'agent de programmation de LexOS (le Codex d'Alex), qui roule en local sur sa clé USB-C.
Tu réponds en français québécois simple et direct. Tu travailles dans le dossier du projet « {projet} ».

Tu as des outils et tu t'en sers sans demander la permission :
- list_files puis read_file avant de modifier un projet ; write_file pour créer ou remplacer un fichier (contenu COMPLET).
- web_search puis fetch_page pour vérifier un fait ou trouver de la documentation. Ne devine pas.
- describe_image pour regarder une image du projet ; create_image pour créer une image (logo, illustration, icône…).
- clone_github pour copier un dépôt GitHub public dans le projet.
Tu ne peux PAS lancer de commandes : quand il faut tester ou installer, donne la commande dans un bloc ```bash
(Alex la lance lui-même dans son terminal, déjà placé dans le dossier du projet).
Si un outil renvoie une erreur, corrige-toi et réessaie autrement.
Quand tu as fini, réponds avec un court résumé de ce que tu as fait et des fichiers touchés."""

OUTILS = [
    {"type": "function", "function": {"name": "web_search",
        "description": "Cherche sur le web (vérifier un fait, trouver de la doc récente).",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"}, "max_results": {"type": "integer", "description": "1 à 10"}},
            "required": ["query"]}}},
    {"type": "function", "function": {"name": "fetch_page",
        "description": "Télécharge une page web publique et retourne son texte.",
        "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}}},
    {"type": "function", "function": {"name": "list_files",
        "description": "Liste les fichiers d'un dossier du projet.",
        "parameters": {"type": "object", "properties": {"path": {"type": "string", "description": "dossier (défaut : racine)"}}}}},
    {"type": "function", "function": {"name": "read_file",
        "description": "Lit un fichier texte du projet.",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
    {"type": "function", "function": {"name": "write_file",
        "description": "Crée ou remplace un fichier texte du projet (contenu complet). Crée les dossiers au besoin.",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"]}}},
    {"type": "function", "function": {"name": "describe_image",
        "description": "Regarde une image du projet et la décrit, ou répond à une question sur elle.",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "question": {"type": "string"}},
            "required": ["path"]}}},
    {"type": "function", "function": {"name": "create_image",
        "description": "Crée une image avec le modèle d'image local et l'enregistre dans le projet (png).",
        "parameters": {"type": "object", "properties": {
            "prompt": {"type": "string", "description": "description détaillée de l'image"},
            "path": {"type": "string", "description": "fichier de sortie, ex. images/logo.png"},
            "width": {"type": "integer"}, "height": {"type": "integer"}}, "required": ["prompt", "path"]}}},
    {"type": "function", "function": {"name": "clone_github",
        "description": "Copie un dépôt GitHub public dans le projet (sans git). Ex. url = https://github.com/proprio/depot",
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string"}, "branch": {"type": "string", "description": "branche (défaut : celle du dépôt)"},
            "dest": {"type": "string", "description": "dossier de destination dans le projet (défaut : nom du dépôt)"}},
            "required": ["url"]}}},
]


class ErreurOutil(Exception):
    pass


def _couper(t: str) -> str:
    return t if len(t) <= MAX_SORTIE else t[:MAX_SORTIE] + f"\n… (coupé, {len(t) - MAX_SORTIE} caractères de plus)"


def _url_publique(url: str) -> None:
    p = urllib.parse.urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ErreurOutil("URL invalide : seulement http:// et https://")
    try:
        infos = socket.getaddrinfo(p.hostname, p.port or 443)
    except socket.gaierror as e:
        raise ErreurOutil(f"Domaine introuvable : {p.hostname}") from e
    for i in infos:
        if not ipaddress.ip_address(i[4][0]).is_global:
            raise ErreurOutil("Adresse privée ou locale refusée (sécurité).")


class _PasDeRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def _telecharger(url: str, limite: int, accept: str = "*/*") -> tuple[bytes, str]:
    ouvreur = urllib.request.build_opener(_PasDeRedirection)
    for _ in range(6):                             # suit les redirections en revérifiant chaque adresse
        _url_publique(url)
        req = urllib.request.Request(url, headers={"User-Agent": AGENT_WEB, "Accept": accept})
        try:
            r = ouvreur.open(req, timeout=30)
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                url = urllib.parse.urljoin(url, e.headers["Location"])
                continue
            raise ErreurOutil(f"Le site a répondu {e.code}.") from e
        data = r.read(limite + 1)
        if len(data) > limite:
            raise ErreurOutil("Trop gros à télécharger.")
        return data, r.headers.get("Content-Type", "")
    raise ErreurOutil("Trop de redirections.")


class _Texte(HTMLParser):
    def __init__(self):
        super().__init__()
        self.morceaux, self.cache = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "svg"):
            self.cache += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg") and self.cache:
            self.cache -= 1
        if tag in ("p", "div", "br", "li", "h1", "h2", "h3", "tr", "section", "article"):
            self.morceaux.append("\n")

    def handle_data(self, d):
        if not self.cache and d.strip():
            self.morceaux.append(d.strip() + " ")


def html_vers_texte(h: str) -> str:
    p = _Texte()
    p.feed(h)
    return re.sub(r"\n\s*\n+", "\n\n", "".join(p.morceaux)).strip()


class TurboREA:
    def __init__(self, projet: Path, ollama: str, modele: str, vision: str | None, modele_image: str | None,
                 evenement):
        self.dossier = projet
        self.ollama = ollama.rstrip("/")
        self.modele = modele
        self.vision = vision or modele
        self.modele_image = modele_image
        self.evenement = evenement
        self.arret = False

    # ── utilitaires ──
    def _chemin(self, rel: str) -> Path:
        racine = self.dossier.resolve()
        cible = (racine / (rel or ".")).resolve()
        if cible != racine and racine not in cible.parents:
            raise ErreurOutil("Chemin refusé : en dehors du dossier du projet.")
        return cible

    def _ollama(self, chemin: str, corps: dict, delai: int = 900) -> dict:
        req = urllib.request.Request(self.ollama + chemin, data=json.dumps(corps).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=delai) as r:
                lignes = r.read().decode("utf-8", "replace").strip().splitlines()
        except urllib.error.HTTPError as e:
            raise ErreurOutil(f"Ollama a répondu {e.code} : {e.read()[:300].decode('utf-8', 'replace')}") from e
        except OSError as e:
            raise ErreurOutil(f"Moteur IA injoignable : {e}") from e
        final: dict = {}
        for l in lignes:                            # réponse simple, ou flux NDJSON
            try:
                d = json.loads(l)
            except ValueError:
                continue
            if d.get("error"):
                raise ErreurOutil(str(d["error"]))
            final.update({k: v for k, v in d.items() if v not in (None, "")})
        return final

    # ── outils ──
    def outil_web_search(self, query: str, max_results: int = 5) -> str:
        n = max(1, min(int(max_results or 5), 10))
        try:
            from ddgs import DDGS                   # si présent (libs de REA sur la clé)
            res = list(DDGS().text(query, max_results=n))
            if res:
                return "\n\n".join(f"{r.get('title', '')}\n{r.get('href', '')}\n{r.get('body', '')}" for r in res)
        except Exception:
            pass
        data, _ = _telecharger("https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query}), MAX_PAGE, "text/html")
        page = data.decode("utf-8", "replace")
        sortie = []
        for m in re.finditer(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>.*?(?:class="result__snippet"[^>]*>(.*?)</a>)?', page, re.S):
            lien = html.unescape(m.group(1))
            q = urllib.parse.parse_qs(urllib.parse.urlparse(lien).query).get("uddg")
            lien = q[0] if q else lien
            titre = html.unescape(re.sub("<.*?>", "", m.group(2)))
            extrait = html.unescape(re.sub("<.*?>", "", m.group(3) or ""))
            sortie.append(f"{titre}\n{lien}\n{extrait}")
            if len(sortie) >= n:
                break
        return "\n\n".join(sortie) or "Aucun résultat."

    def outil_fetch_page(self, url: str) -> str:
        data, typ = _telecharger(url, MAX_PAGE)
        t = data.decode("utf-8", "replace")
        return html_vers_texte(t) if "html" in typ.lower() else t

    def outil_list_files(self, path: str = ".") -> str:
        d = self._chemin(path)
        if not d.is_dir():
            raise ErreurOutil(f"Pas un dossier : {path}")
        racine = self.dossier.resolve()
        e = [x for x in sorted(d.iterdir()) if not x.name.endswith(".avant-codex")][:300]
        return "\n".join(x.relative_to(racine).as_posix() + ("/" if x.is_dir() else "") for x in e) or "(dossier vide)"

    def outil_read_file(self, path: str) -> str:
        f = self._chemin(path)
        if not f.is_file():
            raise ErreurOutil(f"Fichier introuvable : {path}")
        if f.suffix.lower() in IMAGES_EXT:
            raise ErreurOutil("C'est une image : utilise describe_image.")
        return f.read_text("utf-8", errors="replace")

    def outil_write_file(self, path: str, content: str) -> str:
        f = self._chemin(path)
        f.parent.mkdir(parents=True, exist_ok=True)
        if f.exists():
            (f.parent / (f.name + ".avant-codex")).write_bytes(f.read_bytes())
        f.write_text(content, "utf-8")
        self.evenement({"type": "fichier", "chemin": f.relative_to(self.dossier.resolve()).as_posix()})
        return f"Écrit : {path} ({len(content)} caractères)"

    def outil_describe_image(self, path: str, question: str = "Décris cette image en détail, en français.") -> str:
        f = self._chemin(path)
        if not f.is_file() or f.suffix.lower() not in IMAGES_EXT:
            raise ErreurOutil(f"Image introuvable ou format non pris en charge : {path}")
        r = self._ollama("/api/chat", {"model": self.vision, "stream": False, "messages": [
            {"role": "user", "content": question, "images": [base64.b64encode(f.read_bytes()).decode()]}]})
        return (r.get("message") or {}).get("content", "") or "(aucune description)"

    def outil_create_image(self, prompt: str, path: str, width: int = 1024, height: int = 1024) -> str:
        if not self.modele_image:
            raise ErreurOutil("Aucun modèle d'image sur la clé (onglet 🎨 Images pour en télécharger un).")
        if not path.lower().endswith(".png"):
            path += ".png"
        f = self._chemin(path)
        self.evenement({"type": "info", "texte": "🎨 je peins l'image… (ça peut prendre une minute)"})
        r = self._ollama("/api/generate", {"model": self.modele_image, "prompt": prompt, "stream": False,
                                           "width": max(256, min(int(width or 1024), 1536)),
                                           "height": max(256, min(int(height or 1024), 1536))}, delai=1800)
        img = r.get("image") or (r.get("images") or [None])[0]
        if not img:
            raise ErreurOutil("Le modèle n'a pas renvoyé d'image (Ollama trop vieux ou carte graphique non prise en charge).")
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(base64.b64decode(img))
        rel = f.relative_to(self.dossier.resolve()).as_posix()
        self.evenement({"type": "image", "chemin": rel})
        return f"Image créée : {rel}"

    def outil_clone_github(self, url: str, branch: str = "", dest: str = "") -> str:
        m = re.match(r"^(?:https?://)?(?:www\.)?github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?(?:/tree/([^?#]+))?/?$", url.strip())
        if not m:
            raise ErreurOutil("Donne une adresse comme https://github.com/proprio/depot")
        proprio, depot, branche_url = m.group(1), m.group(2), m.group(3)
        branche = (branch or branche_url or "").strip()
        ref = f"refs/heads/{branche}" if branche else "HEAD"
        self.evenement({"type": "info", "texte": f"📦 téléchargement de {proprio}/{depot}…"})
        try:
            data, _ = _telecharger(f"https://codeload.github.com/{proprio}/{depot}/zip/{ref}", MAX_DEPOT)
        except ErreurOutil as e:
            raise ErreurOutil(f"Dépôt introuvable ou privé ({e}). Seuls les dépôts publics marchent.") from e
        cible = self._chemin(dest or depot)
        if cible.exists() and any(cible.iterdir()):
            raise ErreurOutil(f"Le dossier « {dest or depot} » existe déjà et n'est pas vide : choisis un autre dest.")
        racine = cible.resolve()
        n = taille = 0
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for info in z.infolist():
                morceaux = info.filename.split("/", 1)          # enlève le dossier « depot-branche/ »
                if len(morceaux) < 2 or not morceaux[1] or info.is_dir():
                    continue
                f = (racine / morceaux[1]).resolve()
                if racine not in f.parents:                       # protection « zip slip »
                    continue
                taille += info.file_size
                if taille > MAX_DEPOT * 3 or n > 20000:
                    raise ErreurOutil("Dépôt trop gros.")
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(z.read(info))
                n += 1
        rel = racine.relative_to(self.dossier.resolve()).as_posix()
        self.evenement({"type": "fichier", "chemin": rel + "/"})
        return f"Dépôt {proprio}/{depot} copié dans « {rel}/ » : {n} fichiers. Utilise list_files pour l'explorer."

    # ── la boucle de l'agent ──
    def appeler(self, nom: str, args: dict) -> str:
        f = getattr(self, "outil_" + nom, None)
        if not f:
            return f"Erreur : outil inconnu « {nom} » (outils : {', '.join(o['function']['name'] for o in OUTILS)})."
        try:
            return _couper(str(f(**(args or {}))))
        except ErreurOutil as e:
            return f"Erreur : {e}"
        except TypeError as e:
            return f"Erreur : arguments invalides pour {nom} ({e})."
        except Exception as e:                                    # la boucle ne plante jamais
            return f"Erreur inattendue ({type(e).__name__}) : {e}"

    def tourner(self, historique: list[dict], demande: str) -> str:
        messages = [{"role": "system", "content": PROMPT.format(projet=self.dossier.name)}]
        messages += [m for m in historique[-10:] if m.get("role") in ("user", "assistant") and m.get("content")]
        messages.append({"role": "user", "content": demande})
        for etape in range(1, MAX_ETAPES + 1):
            if self.arret:
                return "(arrêté)"
            self.evenement({"type": "etape", "n": etape})
            r = self._ollama("/api/chat", {"model": self.modele, "messages": messages, "tools": OUTILS,
                                           "stream": False, "options": {"temperature": 0.4, "num_ctx": 16384}})
            msg = r.get("message") or {}
            messages.append(msg)
            appels = msg.get("tool_calls") or []
            if msg.get("content") and appels:
                self.evenement({"type": "pensee", "texte": msg["content"][:600]})
            if not appels:
                return (msg.get("content") or "").strip() or "(fini)"
            for a in appels:
                fn = a.get("function") or {}
                nom, args = fn.get("name", "?"), fn.get("arguments") or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except ValueError:
                        args = {}
                apercu = {k: (v if len(str(v)) < 90 else str(v)[:90] + "…") for k, v in args.items() if k != "content"}
                self.evenement({"type": "outil", "nom": nom, "args": apercu})
                t0 = time.time()
                res = self.appeler(nom, args)
                self.evenement({"type": "resultat", "nom": nom, "ok": not res.startswith("Erreur"),
                                "duree": round(time.time() - t0, 1), "apercu": res[:240]})
                messages.append({"role": "tool", "tool_name": nom, "content": res})
        return "(J'ai atteint la limite d'étapes. Dis « continue » pour que je poursuive.)"
