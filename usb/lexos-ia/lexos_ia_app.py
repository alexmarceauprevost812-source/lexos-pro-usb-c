#!/usr/bin/env python3
"""LexOS IA — application (interface TI-LEX-AL) pour les IA locales de la clé USB-C.

Petit serveur local (127.0.0.1 seulement) qui affiche l'interface dans une
fenêtre du navigateur et parle à l'Ollama de la clé. Aucune dépendance.

Sécurité : un jeton secret aléatoire est exigé pour chaque appel à l'API,
et l'en-tête Host est vérifié. Un site web ouvert dans le navigateur ne peut
donc ni discuter avec les IA ni lancer de commandes.

Usage : python3 lexos_ia_app.py [--port N] [--sans-navigateur]
"""
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import images_ia
import lexos_ia as ia

ICI = Path(__file__).resolve().parent
DOSSIER_APP = ICI / "app"
DOSSIER_CONVS = ICI / "conversations" / "app"
DOSSIER_PROJETS = ICI / "projets"     # un dossier par projet, sur la clé
NOM_PROJET = re.compile(r"^[a-z0-9][a-z0-9._\-]{0,62}$")
URL_GITHUB = re.compile(r"^https://github\.com/[\w.\-]{1,100}/[\w.\-]{1,100}?(\.git)?/?$")
APERCUS = {}                          # id secret → dossier ou HTML à afficher dans le Studio
JETON = secrets.token_urlsafe(24)
INACTIVITE_MAX = 180          # secondes sans signe de la fenêtre → on arrête
PORT_DEFAUT = 47800           # fixe : le navigateur se souvient du thème jour/nuit
PORT_TELEPHONE = 47801        # accès Wi-Fi du téléphone (seulement si activé depuis le PC)
HOTE_IP = re.compile(r"^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$")  # adresse IP seulement (pas de nom de domaine)
INTERDIT_TELEPHONE = {"/api/ouvrir", "/api/telephone", "/api/quitter", "/api/github/jeton", "/api/github/oublier"}
TAILLE_MAX = 60 * 1024 * 1024  # photos comprises
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
         ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
         ".txt": "text/plain; charset=utf-8", ".json": "application/manifest+json; charset=utf-8"}
ID_VALIDE = re.compile(r"^[a-z0-9-]{1,64}$")

etat_serveur = {"dernier_signe": time.monotonic(), "dossier": str(Path.home()), "capacites": {},
                "telephone": None, "jeton_tel": None}


# --------------------------------------------------------------------------
# Outils
# --------------------------------------------------------------------------
def capacites(nom):
    """Ce que sait faire un modèle (ex. 'vision' pour lire les photos)."""
    if nom not in etat_serveur["capacites"]:
        try:
            with ia._requete("/api/show", {"model": nom}) as r:
                infos = json.load(r)
            caps = infos.get("capabilities") or []
            if not caps:  # anciens Ollama : on devine
                caps = ["completion"] + (["vision"] if "projector_info" in infos else [])
        except ia.ErreurIA:
            caps = []
        etat_serveur["capacites"][nom] = caps
    return etat_serveur["capacites"][nom]


def liste_modeles():
    modeles = ia.modeles_installes()
    noms = [m["name"] for m in modeles]
    config = ia.charger_config()
    ram = ia.ram_go()
    return {
        "modeles": [{"nom": m["name"], "taille": m.get("size", 0), "capacites": capacites(m["name"])}
                    for m in modeles],
        "chat": ia.choisir_modele("chat", noms, config, ram),
        "codex": ia.choisir_modele("codex", noms, config, ram),
    }


class FiltrePensee:
    """Sépare la réponse visible des pensées <think>…</think> (montrées dans le mode réflexion)."""
    OUVRE, FERME = "<think>", "</think>"

    def __init__(self):
        self.dedans = False
        self.tampon = ""

    def nourrir(self, morceau):
        self.tampon += morceau
        visible = pensee = ""
        while True:
            balise = self.FERME if self.dedans else self.OUVRE
            i = self.tampon.find(balise)
            if i >= 0:
                if self.dedans:
                    pensee += self.tampon[:i]
                else:
                    visible += self.tampon[:i]
                self.tampon = self.tampon[i + len(balise):]
                self.dedans = not self.dedans
                continue
            coupe = len(self.tampon) - ia._debut_partiel(self.tampon, balise)
            if self.dedans:
                pensee += self.tampon[:coupe]
            else:
                visible += self.tampon[:coupe]
            self.tampon = self.tampon[coupe:]
            return visible, pensee

    def fin(self):
        reste, self.tampon = self.tampon, ""
        return ("", reste) if self.dedans else (reste, "")


def systeme(mode, dossier):
    if mode == "codex":
        return ia.systeme_codex(dossier)
    if mode == "terminal":
        return ia.systeme_codexterminal(dossier)
    return ("Tu es Agent AL, l'assistant de TI-LEX-AL (LexOS IA). Tu fonctionnes 100 % hors ligne "
            "depuis une clé USB-C. Réponds en français québécois clair et naturel (ou dans la langue de "
            "l'utilisateur s'il en change). Sois direct et concis. Si on t'envoie une photo, regarde-la "
            "attentivement, décris ce que tu vois et réponds à la question. Quand on te demande un plan, "
            "un schéma, une organisation ou des étapes de travail, ajoute un schéma dans un bloc ```mermaid "
            "(flowchart TD). Mets TOUJOURS chaque étiquette entre guillemets, par exemple : "
            "A[\"Localisation (bureaux, ATM)\"] --> B{\"Prêt ?\"} et -->|\"oui\"| ; pas plus de 15 blocs.")


def nettoyer_messages(messages):
    propres = []
    for m in messages[-80:]:
        if m.get("role") not in ("user", "assistant", "system"):
            continue
        msg = {"role": m["role"], "content": str(m.get("content", ""))}
        images = [str(i).split(",", 1)[-1] for i in (m.get("images") or [])][:6]
        if images and m["role"] == "user":
            msg["images"] = images
        propres.append(msg)
    return propres


def chemin_conv(ident):
    if not ID_VALIDE.match(ident or ""):
        raise ValueError("identifiant invalide")
    return DOSSIER_CONVS / f"{ident}.json"


def lister_conversations():
    if not DOSSIER_CONVS.is_dir():
        return []
    convs = []
    for f in DOSSIER_CONVS.glob("*.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            convs.append({"id": f.stem, "titre": d.get("titre", "Sans titre"), "mode": d.get("mode", "chat"),
                          "date": d.get("date", 0)})
        except (OSError, ValueError):
            continue
    return sorted(convs, key=lambda c: c["date"], reverse=True)


def sauver_conversation(d):
    ident = d.get("id") or f"{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}"
    chemin = chemin_conv(ident)
    DOSSIER_CONVS.mkdir(parents=True, exist_ok=True)
    messages = []
    for m in d.get("messages", []):
        m2 = {"role": m.get("role"), "content": m.get("content", "")}
        if m.get("agent") in ("architecte", "codeur", "reviseur"):  # Équipe IA
            m2["agent"] = m["agent"]
            m2["modele"] = str(m.get("modele") or "")[:100]
        if m.get("role") == "verdict":
            m2["ok"] = bool(m.get("ok"))
        if m.get("images"):
            m2["photos"] = len(m["images"])  # les photos ne sont pas recopiées sur la clé
        messages.append(m2)
    taches = []
    for x in (d.get("taches") or [])[:100]:  # liste de tâches du Codex (panneau de droite)
        if isinstance(x, dict) and str(x.get("texte", "")).strip():
            taches.append({"texte": str(x["texte"]).strip()[:300], "etat": x.get("etat") if x.get("etat") in ("a", "e", "f") else "a"})
    chemin.write_text(json.dumps({"titre": str(d.get("titre", "Sans titre"))[:80], "mode": d.get("mode", "chat"),
                                  "modele": d.get("modele"), "date": time.time(), "messages": messages,
                                  "taches": taches},
                                 ensure_ascii=False, indent=1), encoding="utf-8")
    return ident


def ouvrir_terminal(commande):
    """Ouvre une fenêtre de terminal qui exécute `commande` (liste)."""
    if os.name == "nt":
        subprocess.Popen(["cmd", "/c", "start", "LexOS IA", "cmd", "/k"] + commande)
        return True
    ligne = " ".join(map(lambda x: "'" + x.replace("'", "'\\''") + "'", commande))
    for t, args in (("x-terminal-emulator", ["-e"] + commande), ("xfce4-terminal", ["-x"] + commande),
                    ("qterminal", ["-e", ligne]), ("gnome-terminal", ["--"] + commande),
                    ("konsole", ["-e"] + commande), ("xterm", ["-e"] + commande)):
        if shutil.which(t):
            subprocess.Popen([t] + args, start_new_session=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
    return False


def ouvrir(quoi, projet=""):
    if quoi == "rea":  # agent ti-lex dans un terminal, sur le projet actif
        args = [projet] if NOM_PROJET.match(projet or "") else []
        return ouvrir_terminal([sys.executable, str(ICI / "rea_lexos.py"), *args])
    if quoi == "textes":
        subprocess.Popen([sys.executable, str(ICI / "apps" / "lexos_textes.py")], start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    if quoi == "terminal":
        return ouvrir_terminal([sys.executable, str(ICI / "lexos_ia.py")])
    if quoi == "conversations":
        DOSSIER_CONVS.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(str(DOSSIER_CONVS))  # noqa
        elif shutil.which("xdg-open"):
            subprocess.Popen(["xdg-open", str(DOSSIER_CONVS)], start_new_session=True)
        return True
    return False


# --------------------------------------------------------------------------
# Serveur
# --------------------------------------------------------------------------
class App(BaseHTTPRequestHandler):
    server_version = "LexOS-IA"
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    # -- réponses --
    def _envoyer(self, code, corps, type_="application/json; charset=utf-8"):
        if isinstance(corps, (dict, list)):
            corps = json.dumps(corps, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", type_)
        self.send_header("Content-Length", str(len(corps)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if code >= 400:  # refus : on ferme (le corps de la requête n'a peut-être pas été lu)
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        self.wfile.write(corps)

    def _flux_debut(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

    def _ligne(self, obj):
        self.wfile.write((json.dumps(obj, ensure_ascii=False) + "\n").encode())
        self.wfile.flush()

    # -- sécurité --
    def _autorise(self, api):
        reseau = getattr(self.server, "reseau", False)
        hote = self.headers.get("Host", "")
        if hote != self.server.adresse and not (reseau and HOTE_IP.match(hote)):
            self._envoyer(403, {"erreur": "hôte refusé"})
            return False
        if not api:
            return True
        jeton = self.headers.get("X-LexOS-Jeton", "")
        if not reseau and secrets.compare_digest(jeton, JETON):
            self.telephone = False
            return True
        if reseau and etat_serveur["jeton_tel"] and secrets.compare_digest(jeton, etat_serveur["jeton_tel"]):
            self.telephone = True
            if urllib.parse.urlparse(self.path).path in INTERDIT_TELEPHONE:
                self._envoyer(403, {"erreur": "pas permis depuis le téléphone"})
                return False
            return True
        self._envoyer(403, {"erreur": "jeton manquant ou invalide", "jeton": True})
        return False

    def _corps(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > TAILLE_MAX:
            raise ValueError("requête trop grosse")
        return json.loads(self.rfile.read(n) or b"{}")

    # -- GET --
    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        api = url.path.startswith("/api/")
        if not self._autorise(api):
            return
        if url.path.startswith("/apercu/"):
            return self._apercu(url.path)
        if not api:
            return self._fichier(url.path)
        etat_serveur["dernier_signe"] = time.monotonic()
        q = urllib.parse.parse_qs(url.query)
        try:
            if url.path == "/api/telephone":
                return self._envoyer(200, etat_telephone())
            if url.path == "/api/etat":
                return self._envoyer(200, {
                    "moteur": ia.ia_disponible(), "hote": ia.hote(), "dossier": etat_serveur["dossier"],
                    "systeme": f"{os.name}", "ram": ia.ram_go(), "version": ia.VERSION,
                    "sensibles": ia.MOTIFS_SENSIBLES, "langues_shell": sorted(ia.LANGUES_SHELL),
                    "ffmpeg": bool(shutil.which("ffmpeg"))})
            if url.path == "/api/modeles":
                return self._envoyer(200, liste_modeles())
            if url.path == "/api/conversations":
                return self._envoyer(200, lister_conversations())
            if url.path == "/api/rea":
                if not rea_disponible():
                    return self._envoyer(200, {"disponible": False})
                modele, vision = modeles_rea()
                return self._envoyer(200, {"disponible": True, "modele": modele, "vision": vision})
            if url.path == "/api/memoire":
                d = charger_memoire()
                return self._envoyer(200, {"apprendre": d.get("apprendre", True), "entrees": d["entrees"],
                                           "types": TYPES_MEMOIRE})
            if url.path == "/api/github":
                j = lire_jeton()
                return self._envoyer(200, {"connecte": bool(j), "login": (j or {}).get("login", "")})
            if url.path == "/api/projets":
                return self._envoyer(200, {"projets": lister_projets(), "git": bool(shutil.which("git")),
                                           "dossier": str(DOSSIER_PROJETS)})
            if url.path == "/api/projet":
                d = dossier_projet((q.get("nom") or [""])[0])
                if not d.is_dir():
                    raise ValueError("projet introuvable")
                return self._envoyer(200, {"nom": d.name, "fichiers": fichiers_du_projet(d), **infos_github(d)})
            if url.path == "/api/projet/fichier":
                f = fichier_projet((q.get("nom") or [""])[0], (q.get("chemin") or [""])[0])
                if f.stat().st_size > 2_000_000:
                    raise ValueError("fichier trop gros pour l'éditeur (2 Mo max)")
                donnees = f.read_bytes()
                if b"\0" in donnees[:8000]:
                    raise ValueError("fichier binaire : pas modifiable ici")
                return self._envoyer(200, {"contenu": donnees.decode("utf-8", "replace")})
            if url.path == "/api/images":
                return self._envoyer(200, {"etat": images_ia.etat(), "images": images_ia.lister()})
            if url.path == "/api/image":
                return self._envoyer(200, images_ia.chemin_image((q.get("nom") or [""])[0]).read_bytes(), "image/png")
            if url.path == "/api/conversation":
                chemin = chemin_conv((q.get("id") or [""])[0])
                return self._envoyer(200, json.loads(chemin.read_text(encoding="utf-8")))
        except (ia.ErreurIA, images_ia.ErreurImage, ValueError, OSError) as e:
            return self._envoyer(400, {"erreur": str(e)})
        self._envoyer(404, {"erreur": "inconnu"})

    def _fichier(self, chemin):
        if chemin in ("", "/"):
            chemin = "/index.html"
        cible = (DOSSIER_APP / urllib.parse.unquote(chemin).lstrip("/")).resolve()
        if not str(cible).startswith(str(DOSSIER_APP.resolve()) + os.sep) or not cible.is_file():
            return self._envoyer(404, b"introuvable", "text/plain; charset=utf-8")
        corps = cible.read_bytes()
        type_ = TYPES.get(cible.suffix.lower(), "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", type_)
        self.send_header("Content-Length", str(len(corps)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if cible.suffix == ".html":
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
                             "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'")
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corps)

    # -- POST --
    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        if not self._autorise(True):
            return
        etat_serveur["dernier_signe"] = time.monotonic()
        try:
            d = self._corps()
        except (ValueError, json.JSONDecodeError) as e:
            return self._envoyer(400, {"erreur": str(e)})
        route = {
            "/api/chat": self._chat, "/api/exec": self._exec, "/api/config": self._config,
            "/api/memoire/ajouter": self._memoire_ajouter, "/api/memoire/supprimer": self._memoire_supprimer,
            "/api/memoire/apprendre": self._memoire_apprendre, "/api/memoire/reglage": self._memoire_reglage,
            "/api/conversations": self._sauver_conv, "/api/supprimer-conversation": self._supprimer_conv,
            "/api/telecharger-modele": self._telecharger, "/api/supprimer-modele": self._supprimer_modele,
            "/api/dossier": self._dossier, "/api/ouvrir": self._ouvrir,
            "/api/projet/creer": self._projet_creer, "/api/projet/ecrire": self._projet_ecrire,
            "/api/projet/supprimer-fichier": self._projet_supprimer_fichier,
            "/api/projet/github/cloner": self._github_cloner, "/api/projet/github/recuperer": self._github_recuperer,
            "/api/projet/github/envoyer": self._github_envoyer, "/api/projet/github/lier": self._github_lier,
            "/api/projet/github/creer": self._github_creer_depot,
            "/api/github/jeton": self._github_jeton, "/api/github/oublier": self._github_oublier,
            "/api/apercu": self._apercu_creer, "/api/video-mp4": self._video_mp4,
            "/api/rea/demander": self._rea_demander, "/api/rea/repondre": self._rea_repondre,
            "/api/rea/oublier": self._rea_oublier,
            "/api/image/creer": self._image_creer, "/api/image/supprimer": self._image_supprimer,
            "/api/image/projet": self._image_projet,
            "/api/video-images": self._video_images,
            "/api/ping": lambda d: self._envoyer(200, {"ok": True}), "/api/quitter": self._quitter,
            "/api/telephone": self._telephone,
        }.get(url.path)
        if route is None:
            return self._envoyer(404, {"erreur": "inconnu"})
        try:
            route(d)
        except (ia.ErreurIA, images_ia.ErreurImage, ValueError, OSError) as e:
            self._envoyer(400, {"erreur": str(e)})

    def _chat(self, d):
        """Discussion en flux : {"t": texte visible} … {"fin": true}."""
        mode = d.get("mode", "chat")
        messages = nettoyer_messages(d.get("messages", []))
        if not messages or messages[0]["role"] != "system":
            messages.insert(0, {"role": "system", "content": systeme(mode, etat_serveur["dossier"])})
        souvenirs = memoire_pour(messages, mode)  # rappelle les leçons apprises
        if souvenirs:
            messages[0] = {"role": "system", "content": messages[0]["content"] + "\n\n" + souvenirs}
        self._flux_debut()
        filtre = FiltrePensee()
        try:
            for obj in ia.flux("/api/chat", {"model": d.get("modele"), "messages": messages, "stream": True}):
                msg = obj.get("message") or {}
                if msg.get("thinking"):  # modèles qui réfléchissent (champ séparé)
                    self._ligne({"pensee": msg["thinking"]})
                visible, pensee = filtre.nourrir(msg.get("content") or "")
                if pensee:  # pensées écrites entre <think> et </think>
                    self._ligne({"pensee": pensee})
                if visible:
                    self._ligne({"t": visible})
                if obj.get("done"):
                    break
            visible, pensee = filtre.fin()
            if pensee:
                self._ligne({"pensee": pensee})
            if visible:
                self._ligne({"t": visible})
            self._ligne({"fin": True})
        except ia.ErreurIA as e:
            self._ligne({"erreur": str(e)})
        except (BrokenPipeError, ConnectionResetError):
            pass  # la fenêtre a coupé la réponse

    def _exec(self, d):
        commande = str(d.get("commande", "")).strip()
        if not commande:
            raise ValueError("commande vide")
        if ia.est_sensible(commande) and d.get("confirme") != "OUI":
            return self._envoyer(409, {"erreur": "commande sensible : il faut confirmer avec OUI", "sensible": True})
        code, sortie, etat_serveur["dossier"] = ia.executer(commande, etat_serveur["dossier"])
        if len(sortie) > 20_000:
            sortie = sortie[:10_000] + "\n…(coupé)…\n" + sortie[-10_000:]
        self._envoyer(200, {"code": code, "sortie": sortie, "dossier": etat_serveur["dossier"]})

    def _dossier(self, d):
        cible = Path(os.path.expanduser(str(d.get("dossier", "")))).resolve()
        if not cible.is_dir():
            raise ValueError("ce dossier n'existe pas")
        etat_serveur["dossier"] = str(cible)
        self._envoyer(200, {"dossier": str(cible)})

    def _config(self, d):
        config = ia.charger_config()
        for role in ("chat", "codex"):
            if d.get(role):
                config[role] = str(d[role])
        ia.sauver_config(config)
        self._envoyer(200, config)

    def _sauver_conv(self, d):
        self._envoyer(200, {"id": sauver_conversation(d)})

    def _supprimer_conv(self, d):
        chemin = chemin_conv(d.get("id"))
        if chemin.exists():
            chemin.unlink()
        self._envoyer(200, {"ok": True})

    def _telecharger(self, d):
        nom = str(d.get("nom", "")).strip()
        if not re.fullmatch(r"[\w.\-/:]{1,100}", nom):
            raise ValueError("nom de modèle invalide")
        self._flux_debut()
        try:
            ia.verifier_place(nom)
            for obj in ia.flux("/api/pull", {"model": nom, "stream": True}, delai=7200):
                self._ligne({k: obj.get(k) for k in ("status", "total", "completed") if k in obj})
            self._ligne({"fin": True})
        except ia.ErreurIA as e:
            texte = str(e)
            if "newer version" in texte:
                texte = "ce modèle demande un moteur IA plus récent : mets la clé à jour (installer-sur-cle.sh sans --sans-moteur)."
            self._ligne({"erreur": texte})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _supprimer_modele(self, d):
        with ia._requete("/api/delete", {"model": str(d.get("nom", ""))}, methode="DELETE"):
            pass
        self._envoyer(200, {"ok": True})

    def _telephone(self, d):
        if d.get("actif"):
            self._envoyer(200, activer_telephone(bool(d.get("nouveau"))))
        else:
            desactiver_telephone()
            self._envoyer(200, etat_telephone())

    def _ouvrir(self, d):
        self._envoyer(200, {"ok": ouvrir(str(d.get("quoi", "")), str(d.get("projet") or ""))})

    # -- Projets --
    def _commande_en_flux(self, etapes, dossier):
        """Exécute des commandes git et envoie chaque ligne : {"l": …} puis {"fin": code}."""
        self._flux_debut()
        code = 0
        try:
            for cmd in etapes:
                self._ligne({"l": "$ " + " ".join(cmd)})
                p = subprocess.Popen(cmd, cwd=dossier, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     stdin=subprocess.DEVNULL, text=True, errors="replace", env=env_git())
                for ligne in p.stdout:
                    if ligne.strip():
                        self._ligne({"l": cacher_jeton(ligne.rstrip())[:400]})
                p.stdout.close()
                code = p.wait()
                if code != 0:
                    break
            self._ligne({"fin": code})
        except OSError as e:
            self._ligne({"erreur": str(e)})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _projet_creer(self, d):
        dossier = dossier_projet(str(d.get("nom", "")).strip().lower())
        if dossier.exists():
            raise ValueError("ce projet existe déjà")
        dossier.mkdir(parents=True)
        (dossier / "README.md").write_text(f"# {dossier.name}\n\nProjet créé avec LexOS IA.\n", encoding="utf-8")
        self._envoyer(200, {"nom": dossier.name})

    def _projet_ecrire(self, d):
        nom = str(d.get("nom", ""))
        cible = fichier_projet(nom, d.get("chemin"))
        if not dossier_projet(nom).is_dir():
            raise ValueError("projet introuvable")
        contenu = str(d.get("contenu", ""))
        if len(contenu) > 2_000_000:
            raise ValueError("fichier trop gros (2 Mo max)")
        garder_historique(nom, cible)
        cible.parent.mkdir(parents=True, exist_ok=True)
        cible.write_text(contenu, encoding="utf-8")
        self._envoyer(200, {"ok": True, "chemin": cible.relative_to(dossier_projet(nom).resolve()).as_posix()})

    def _projet_supprimer_fichier(self, d):
        nom = str(d.get("nom", ""))
        cible = fichier_projet(nom, d.get("chemin"))
        if cible.is_file():
            garder_historique(nom, cible)
            cible.unlink()
        self._envoyer(200, {"ok": True})

    def _verifier_git(self):
        if not shutil.which("git"):
            raise ValueError("git n'est pas installé sur ce PC (sudo apt install git)")

    def _github_cloner(self, d):
        self._verifier_git()
        url = str(d.get("url", "")).strip()
        if not URL_GITHUB.match(url):
            raise ValueError("adresse GitHub invalide (ex. https://github.com/moi/mon-projet)")
        nom = str(d.get("nom") or url.rstrip("/").split("/")[-1].removesuffix(".git")).strip().lower()
        dossier = dossier_projet(nom)
        if dossier.exists():
            raise ValueError("un projet porte déjà ce nom")
        DOSSIER_PROJETS.mkdir(parents=True, exist_ok=True)
        self._commande_en_flux([["git", "clone", "--", url, str(dossier)]], DOSSIER_PROJETS)

    def _github_recuperer(self, d):
        self._verifier_git()
        dossier = dossier_projet(str(d.get("nom", "")))
        self._commande_en_flux([["git", "pull", "--ff-only"]], dossier)

    def _github_envoyer(self, d):
        self._verifier_git()
        dossier = dossier_projet(str(d.get("nom", "")))
        if not (dossier / ".git").exists():
            raise ValueError("ce projet n'est pas relié à GitHub")
        self._commande_en_flux(etapes_envoi(dossier, d.get("message")), dossier)

    def _github_jeton(self, d):
        jeton = str(d.get("jeton", "")).strip()
        if not JETON_GITHUB.match(jeton):
            raise ValueError("ce n'est pas un jeton GitHub (il commence par github_pat_ ou ghp_)")
        code, moi, entetes = api_github("GET", "/user", jeton)
        if code == 401:
            raise ValueError("GitHub refuse ce jeton (expiré ou mal copié)")
        if code != 200 or not moi.get("login"):
            raise ValueError(f"GitHub a répondu {code} : {moi.get('message', '')}")
        sauver_jeton(jeton, moi["login"])
        portees = entetes.get("X-OAuth-Scopes") or entetes.get("x-oauth-scopes")
        avertir = bool(portees is not None and "repo" not in portees)
        self._envoyer(200, {"connecte": True, "login": moi["login"],
                            "avertissement": "Ce jeton n'a pas la permission « repo » : l'envoi risque d'être refusé." if avertir else ""})

    def _github_oublier(self, d):
        FICHIER_JETON.unlink(missing_ok=True)
        self._envoyer(200, {"connecte": False})

    def _github_creer_depot(self, d):
        """Crée le dépôt sur GitHub avec le jeton, relie le projet et envoie tout."""
        self._verifier_git()
        j = lire_jeton()
        if not j:
            raise ValueError("ajoute d'abord ton jeton GitHub (Projets → 🔑 GitHub)")
        dossier = dossier_projet(str(d.get("nom", "")))
        if not dossier.is_dir():
            raise ValueError("projet introuvable")
        depot = str(d.get("depot") or dossier.name).strip()
        if not NOM_DEPOT.match(depot):
            raise ValueError("nom de dépôt invalide (lettres, chiffres, - _ .)")
        code, rep, _ = api_github("POST", "/user/repos", j["jeton"],
                                  {"name": depot, "private": bool(d.get("prive", True)),
                                   "description": "Créé avec LexOS IA (clé USB-C)"})
        if code == 422 and "already exists" in json.dumps(rep):
            url = f"https://github.com/{j['login']}/{depot}.git"     # il existe déjà : on s'y relie
        elif code == 201:
            url = rep.get("clone_url") or f"https://github.com/{j['login']}/{depot}.git"
        elif code in (401, 403):
            raise ValueError("GitHub refuse : le jeton n'a pas le droit de créer des dépôts "
                             "(jeton classique : coche « repo » ; jeton fin : Administration en écriture)")
        else:
            raise ValueError(f"GitHub a répondu {code} : {rep.get('message', '')}")
        if not (dossier / ".git").exists():
            git(dossier, "init", "-b", "main")
        if git(dossier, "remote", "get-url", "origin")[0] == 0:
            git(dossier, "remote", "set-url", "origin", url)
        else:
            git(dossier, "remote", "add", "origin", url)
        self._commande_en_flux(etapes_envoi(dossier, d.get("message") or "Premier envoi depuis LexOS IA"), dossier)

    def _github_lier(self, d):
        self._verifier_git()
        dossier = dossier_projet(str(d.get("nom", "")))
        url = str(d.get("url", "")).strip()
        if not URL_GITHUB.match(url):
            raise ValueError("adresse GitHub invalide")
        if not (dossier / ".git").exists():
            git(dossier, "init", "-b", "main")
        if git(dossier, "remote", "get-url", "origin")[0] == 0:
            git(dossier, "remote", "set-url", "origin", url)
        else:
            git(dossier, "remote", "add", "origin", url)
        self._envoyer(200, infos_github(dossier))

    # -- Studio : aperçu isolé des applications créées --
    def _apercu_creer(self, d):
        if d.get("projet"):
            cible = dossier_projet(str(d["projet"]))
            if not cible.is_dir():
                raise ValueError("projet introuvable")
            entree = str(d.get("fichier") or "index.html")
            fichier_projet(cible.name, entree)
        else:
            cible, entree = str(d.get("html", ""))[:2_000_000], "index.html"
        self._envoyer(200, {"url": f"/apercu/{creer_apercu(cible)}/{entree}"})

    def _apercu(self, chemin):
        """Sert un aperçu dans une « boîte à sable » : la page ne peut pas toucher à l'app ni aux IA."""
        morceaux = chemin.split("/", 3)  # ['', 'apercu', id, reste]
        cible = APERCUS.get(morceaux[2] if len(morceaux) > 2 else "")
        if cible is None:
            return self._envoyer(404, b"apercu introuvable", "text/plain; charset=utf-8")
        reste = urllib.parse.unquote(morceaux[3] if len(morceaux) > 3 else "") or "index.html"
        try:
            if isinstance(cible, str):
                if reste != "index.html":
                    raise ValueError
                corps, type_ = cible.encode(), TYPES[".html"]
            else:
                f = fichier_projet(cible.name, reste)
                if f.is_dir():
                    f = f / "index.html"
                corps = f.read_bytes()
                type_ = TYPES.get(f.suffix.lower(), "application/octet-stream")
        except (ValueError, OSError):
            return self._envoyer(404, b"fichier introuvable", "text/plain; charset=utf-8")
        self.send_response(200)
        self.send_header("Content-Type", type_)
        self.send_header("Content-Length", str(len(corps)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy",
                         "sandbox allow-scripts allow-forms allow-modals allow-popups; "
                         "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'")
        self.end_headers()
        self.wfile.write(corps)

    def _video_mp4(self, d):
        """Convertit la vidéo d'un schéma en MP4 H.264 (lisible partout, même sur téléphone)."""
        import base64
        import tempfile
        if not shutil.which("ffmpeg"):
            raise ValueError("ffmpeg n'est pas installé sur ce PC (sudo apt install ffmpeg)")
        donnees = base64.b64decode(str(d.get("donnees", "")), validate=True)
        if not donnees or len(donnees) > 40 * 1024 * 1024:
            raise ValueError("vidéo vide ou trop grosse")
        with tempfile.TemporaryDirectory() as tmp:
            entree, sortie = os.path.join(tmp, "entree.bin"), os.path.join(tmp, "schema.mp4")
            with open(entree, "wb") as f:
                f.write(donnees)
            r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", entree, "-an", "-c:v", "libx264",
                                "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                                sortie], capture_output=True, text=True, timeout=180, stdin=subprocess.DEVNULL)
            if r.returncode != 0 or not os.path.exists(sortie):
                raise ValueError("conversion MP4 impossible : " + (r.stderr.strip()[-300:] or "erreur ffmpeg"))
            with open(sortie, "rb") as f:
                mp4 = base64.b64encode(f.read()).decode()
        self._envoyer(200, {"mp4": mp4})

    def _video_images(self, d):
        """Assemble les images d'une animation (JPEG) en vidéo MP4 H.264, image par image."""
        import base64
        import tempfile
        if not shutil.which("ffmpeg"):
            raise ValueError("ffmpeg n'est pas installé sur ce PC (sudo apt install ffmpeg)")
        images = d.get("images") or []
        ips = max(1, min(60, int(d.get("ips") or 24)))
        if not isinstance(images, list) or not 1 <= len(images) <= 1800:
            raise ValueError("nombre d'images invalide")
        with tempfile.TemporaryDirectory() as tmp:
            for i, b64 in enumerate(images):
                octets = base64.b64decode(str(b64).split(",")[-1], validate=True)
                if octets[:3] != b"\xff\xd8\xff":
                    raise ValueError("image JPEG invalide")
                with open(os.path.join(tmp, f"i{i:05d}.jpg"), "wb") as f:
                    f.write(octets)
            sortie = os.path.join(tmp, "schema.mp4")
            r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(ips), "-i",
                                os.path.join(tmp, "i%05d.jpg"), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                                "-pix_fmt", "yuv420p", "-movflags", "+faststart", sortie],
                               capture_output=True, text=True, timeout=300, stdin=subprocess.DEVNULL)
            if r.returncode != 0 or not os.path.exists(sortie):
                raise ValueError("assemblage MP4 impossible : " + (r.stderr.strip()[-300:] or "erreur ffmpeg"))
            with open(sortie, "rb") as f:
                mp4 = base64.b64encode(f.read()).decode()
        self._envoyer(200, {"mp4": mp4})

    # -- REA --
    def _rea_demander(self, d):
        if not rea_disponible():
            raise ValueError("REA n'est pas sur la clé : relance l'installateur (bash usb/installer-sur-cle.sh … --sans-moteur --sans-modeles)")
        projet = str(d.get("projet") or "rea").lower()
        dossier_projet(projet)  # valide le nom
        texte = str(d.get("texte", "")).strip()
        if not texte:
            raise ValueError("demande vide")
        modele, vision = modeles_rea()
        modele = str(d.get("modele") or "") or modele
        if not modele:
            raise ValueError("aucun modèle sur la clé")
        entree = agent_rea(projet, modele, vision)
        if not entree["occupe"].acquire(blocking=False):
            raise ValueError("REA travaille déjà sur ce projet : attends la fin")
        try:
            self._flux_debut()

            def evenement(message):
                self._ligne({"outil": str(message)})

            def confirmer(question):
                ident = secrets.token_hex(8)
                attente = {"ev": threading.Event(), "oui": False}
                _rea["attentes"][ident] = attente
                self._ligne({"confirmer": str(question), "id": ident})
                recu = attente["ev"].wait(900)
                _rea["attentes"].pop(ident, None)
                return bool(recu and attente["oui"])

            entree["rappels"]["evenement"], entree["rappels"]["confirmer"] = evenement, confirmer
            self._ligne({"info": {"modele": modele, "vision": vision, "projet": projet,
                                  "dossier": str(entree["agent"].config.workspace)}})
            reponse = entree["agent"].run(texte)
            self._ligne({"t": reponse})
            self._ligne({"fin": True})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # erreur du moteur ou d'un outil : on la montre dans l'interface
            try:
                self._ligne({"erreur": str(e)})
            except OSError:
                pass
        finally:
            entree["rappels"]["confirmer"] = lambda q: False
            entree["occupe"].release()

    def _rea_repondre(self, d):
        attente = _rea["attentes"].get(str(d.get("id", "")))
        if not attente:
            raise ValueError("cette demande de permission n'existe plus")
        attente["oui"] = d.get("oui") is True
        attente["ev"].set()
        self._envoyer(200, {"ok": True})

    def _rea_oublier(self, d):
        projet = str(d.get("projet") or "rea").lower()
        for (p, _), entree in list(_rea["agents"].items()):
            if p == projet:
                entree["agent"].reset()
        self._envoyer(200, {"ok": True})

    # -- Images (Z-Image Turbo) --
    def _image_creer(self, d):
        """Flux : {"info"} {"progres": {etape, total, phase}} … {"image": {...}} ou {"erreur"}."""
        self._flux_debut()
        try:
            info = images_ia.creer(str(d.get("texte", "")), str(d.get("format", "carre")), d.get("etapes", 8),
                                   d.get("graine"), rappel=self._ligne, ia=ia)
            self._ligne({"image": info})
        except images_ia.ErreurImage as e:
            self._ligne({"erreur": str(e)})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _image_supprimer(self, d):
        images_ia.supprimer(str(d.get("nom", "")))
        self._envoyer(200, {"ok": True})

    def _image_projet(self, d):
        source = images_ia.chemin_image(str(d.get("nom", "")))
        dossier = dossier_projet(str(d.get("projet", "")))
        if not dossier.is_dir():
            raise ValueError("projet introuvable")
        (dossier / "images").mkdir(exist_ok=True)
        shutil.copy2(source, dossier / "images" / source.name)
        self._envoyer(200, {"ok": True, "chemin": f"images/{source.name}"})

    # -- Mémoire --
    def _memoire_ajouter(self, d):
        e, nouveau = ajouter_memoire(d.get("texte", ""), d.get("type", "fait"), d.get("source", "manuel"))
        self._envoyer(200, {"entree": e, "nouveau": nouveau})

    def _memoire_supprimer(self, d):
        with _verrou_memoire:
            m = charger_memoire()
            if d.get("tout"):
                m["entrees"] = []
            else:
                m["entrees"] = [e for e in m["entrees"] if e["id"] != d.get("id")]
            sauver_memoire(m)
        self._envoyer(200, {"ok": True})

    def _memoire_reglage(self, d):
        with _verrou_memoire:
            m = charger_memoire()
            m["apprendre"] = bool(d.get("apprendre"))
            sauver_memoire(m)
        self._envoyer(200, {"apprendre": m["apprendre"]})

    def _memoire_apprendre(self, d):
        """L'IA tire elle-même une leçon de ce qui vient de se passer (erreur puis solution)."""
        if not charger_memoire().get("apprendre", True):
            return self._envoyer(200, {"lecon": None, "raison": "apprentissage désactivé"})
        lecon = tirer_lecon(str(d.get("modele", "")), d.get("contexte", ""))
        if not lecon:
            return self._envoyer(200, {"lecon": None})
        e, nouveau = ajouter_memoire(lecon, "lecon", d.get("source", "auto"))
        self._envoyer(200, {"lecon": e["texte"], "nouveau": nouveau})

    def _quitter(self, d):
        self._envoyer(200, {"ok": True})
        threading.Thread(target=self.server.shutdown, daemon=True).start()


# --------------------------------------------------------------------------
# Mode téléphone : le téléphone (même Wi-Fi) ouvre l'interface CodexLocal
# et travaille avec les IA et les projets de la clé branchée dans le PC.
# --------------------------------------------------------------------------
def ip_locale():
    """Adresse du PC sur le Wi-Fi (rien n'est envoyé sur Internet)."""
    for cible in ("10.255.255.255", "192.168.255.255", "8.8.8.8"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect((cible, 1))
                ip = s.getsockname()[0]
                if not ip.startswith("127."):
                    return ip
        except OSError:
            continue
    return None


def jeton_telephone(nouveau=False):
    """Code secret du téléphone, gardé sur la clé (le raccourci du téléphone reste valide)."""
    config = ia.charger_config()
    if nouveau or not config.get("jeton_telephone"):
        config["jeton_telephone"] = secrets.token_urlsafe(24)
        ia.sauver_config(config)
    return config["jeton_telephone"]


def etat_telephone():
    srv = etat_serveur["telephone"]
    if not srv:
        return {"actif": False, "ip": ip_locale()}
    return {"actif": True, "ip": srv.ip, "port": srv.server_address[1],
            "url": f"http://{srv.ip}:{srv.server_address[1]}/#t={etat_serveur['jeton_tel']}&m=tel"}


def activer_telephone(nouveau=False):
    etat_serveur["jeton_tel"] = jeton_telephone(nouveau)
    if not etat_serveur["telephone"]:
        ip = ip_locale()
        if not ip:
            raise ValueError("ce PC n'est connecté à aucun réseau Wi-Fi")
        try:
            srv = ThreadingHTTPServer(("0.0.0.0", PORT_TELEPHONE), App)
        except OSError:
            srv = ThreadingHTTPServer(("0.0.0.0", 0), App)
        srv.daemon_threads = True
        srv.reseau = True
        srv.ip = ip
        srv.adresse = f"{ip}:{srv.server_address[1]}"
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        etat_serveur["telephone"] = srv
    return etat_telephone()


def desactiver_telephone():
    srv = etat_serveur["telephone"]
    etat_serveur["telephone"] = None
    etat_serveur["jeton_tel"] = None
    if srv:
        srv.shutdown()
        srv.server_close()


# --------------------------------------------------------------------------
# Projets : des dossiers de fichiers sur la clé, reliés à GitHub si voulu
# --------------------------------------------------------------------------
IGNORES_PROJET = {".git", "node_modules", "__pycache__", ".venv", "venv", ".lexos-historique"}


def dossier_projet(nom):
    if not NOM_PROJET.match(nom or ""):
        raise ValueError("nom de projet invalide : lettres minuscules, chiffres, - . _")
    return DOSSIER_PROJETS / nom


def fichier_projet(nom, chemin):
    """Chemin d'un fichier DANS le projet (refuse ../, .git, chemins absolus)."""
    racine = dossier_projet(nom).resolve()
    chemin = str(chemin or "").strip().replace("\\", "/")
    if chemin.startswith("/") or re.match(r"^[A-Za-z]:", chemin):
        raise ValueError("chemin absolu refusé : donne un chemin dans le projet (ex. src/app.py)")
    if not chemin or any(p in ("..", ".git") or p in IGNORES_PROJET for p in chemin.split("/")):
        raise ValueError("chemin de fichier invalide")
    cible = (racine / chemin).resolve()
    if not str(cible).startswith(str(racine) + os.sep):
        raise ValueError("chemin hors du projet")
    return cible


def git(dossier, *args, timeout=120):
    r = subprocess.run(["git", *args], cwd=dossier, capture_output=True, text=True, errors="replace",
                       timeout=timeout, env=env_git(), stdin=subprocess.DEVNULL)
    return r.returncode, cacher_jeton(r.stdout + r.stderr).strip()


def etapes_envoi(dossier, message=None):
    """git add + commit (s'il y a des changements) + push."""
    message = str(message or "Mise à jour depuis LexOS IA").strip()[:200]
    identite = []
    if git(dossier, "config", "user.email")[0] != 0:  # pas d'identité git : celle du compte GitHub
        j = lire_jeton()
        _, url = git(dossier, "remote", "get-url", "origin")
        proprio = (j or {}).get("login") or (url.rstrip("/").split("/")[-2] if url.count("/") >= 4 else "lexos")
        identite = ["-c", f"user.name={proprio}", "-c", f"user.email={proprio}@users.noreply.github.com"]
    etapes = [["git", "add", "-A"]]
    if git(dossier, "status", "--porcelain")[1].strip() or git(dossier, "rev-parse", "HEAD")[0] != 0:
        etapes.append(["git", *identite, "commit", "--allow-empty", "-m", message])
    etapes.append(["git", "push", "-u", "origin", "HEAD"])
    return etapes


# ── Jeton GitHub : gardé SUR LE PC (pas sur la clé), lisible par toi seul ──
DOSSIER_CONFIG_PC = Path(os.environ.get("APPDATA") or os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "lexos-ia"
FICHIER_JETON = DOSSIER_CONFIG_PC / "github.json"
JETON_GITHUB = re.compile(r"^(gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})$")
NOM_DEPOT = re.compile(r"^[A-Za-z0-9._-]{1,100}$")


def lire_jeton():
    try:
        d = json.loads(FICHIER_JETON.read_text(encoding="utf-8"))
        return d if JETON_GITHUB.match(d.get("jeton", "")) else None
    except (OSError, ValueError, AttributeError):
        return None


def sauver_jeton(jeton, login):
    FICHIER_JETON.parent.mkdir(parents=True, exist_ok=True)
    tmp = FICHIER_JETON.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({"jeton": jeton, "login": login}, f)
    os.replace(tmp, FICHIER_JETON)
    try:
        os.chmod(FICHIER_JETON, 0o600)
    except OSError:
        pass


def api_github(methode, chemin, jeton, corps=None):
    """Appel à l'API GitHub. Retourne (code HTTP, réponse JSON, en-têtes)."""
    req = urllib.request.Request("https://api.github.com" + chemin, method=methode,
                                 data=json.dumps(corps).encode() if corps is not None else None,
                                 headers={"Authorization": f"Bearer {jeton}", "Accept": "application/vnd.github+json",
                                          "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "LexOS-IA",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}"), dict(r.headers)
    except urllib.error.HTTPError as e:
        try:
            donnees = json.loads(e.read() or b"{}")
        except ValueError:
            donnees = {}
        return e.code, donnees, dict(e.headers or {})
    except (urllib.error.URLError, OSError) as e:
        raise ValueError(f"GitHub ne répond pas (Internet ?) : {e}") from None


def env_git():
    """Environnement de git : jamais de question dans le terminal ; le jeton passe par
    une variable (pas dans la ligne de commande, ni dans .git/config du projet)."""
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    j = lire_jeton()
    if j:
        import base64
        cle = base64.b64encode(f"x-access-token:{j['jeton']}".encode()).decode()
        n = int(env.get("GIT_CONFIG_COUNT") or 0) if str(env.get("GIT_CONFIG_COUNT", "0")).isdigit() else 0
        env.update({"GIT_CONFIG_COUNT": str(n + 1), f"GIT_CONFIG_KEY_{n}": "http.https://github.com/.extraheader",
                    f"GIT_CONFIG_VALUE_{n}": f"AUTHORIZATION: basic {cle}"})  # ajouté aux réglages git déjà là
    return env


def cacher_jeton(texte):
    j = lire_jeton()
    return texte.replace(j["jeton"], "***") if j else texte


def infos_github(dossier):
    if not (dossier / ".git").exists() or not shutil.which("git"):
        return {"lie": False}
    _, url = git(dossier, "remote", "get-url", "origin")
    _, branche = git(dossier, "branch", "--show-current")
    _, modifs = git(dossier, "status", "--porcelain")
    return {"lie": url.startswith("https://github.com/"), "url": url if url.startswith("https://") else "",
            "branche": branche, "modifs": len([l for l in modifs.splitlines() if l.strip()]), "git": True}


def lister_projets():
    if not DOSSIER_PROJETS.is_dir():
        return []
    res = []
    for d in sorted(DOSSIER_PROJETS.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if d.is_dir() and NOM_PROJET.match(d.name):
            gh = infos_github(d)
            res.append({"nom": d.name, "github": gh.get("url", ""), "date": d.stat().st_mtime})
    return res


def fichiers_du_projet(dossier, limite=2000):
    res = []
    for racine, dossiers, fichiers in os.walk(dossier):
        dossiers[:] = sorted(x for x in dossiers if x not in IGNORES_PROJET)
        for f in sorted(fichiers):
            p = Path(racine) / f
            res.append({"chemin": p.relative_to(dossier).as_posix(), "taille": p.stat().st_size})
            if len(res) >= limite:
                return res
    return res


def garder_historique(nom, cible):
    """Garde l'ancienne version d'un fichier (projets sans GitHub)."""
    if cible.exists() and not (dossier_projet(nom) / ".git").exists():
        hist = dossier_projet(nom) / ".lexos-historique"
        hist.mkdir(exist_ok=True)
        rel = cible.relative_to(dossier_projet(nom).resolve()).as_posix().replace("/", "__")
        shutil.copy2(cible, hist / f"{rel}.{time.strftime('%Y%m%d-%H%M%S')}")


# --------------------------------------------------------------------------
# REA dans l'app : l'agent ti-lex (dépôt ti-lex-ia-REA-) avec l'interface TI-LEX-AL.
# Les demandes de permission (commande, fichier écrasé) passent par l'interface.
# --------------------------------------------------------------------------
DOSSIER_REA = ICI / "rea"
MODELES_OUTILS = ["qwen3:8b", "qwen3", "llama3.2", "qwen2.5-coder:7b", "qwen2.5-coder", "qwen2.5", "llama3.1", "mistral"]
MODELES_VISION = ["qwen2.5vl", "qwen3-vl", "gemma3", "llava", "minicpm-v"]
_rea = {"agents": {}, "attentes": {}, "verrou": threading.Lock()}


def rea_disponible():
    return (DOSSIER_REA / "ti_lex_agent" / "agent.py").exists()


def premier_modele(noms, prefixes):
    for p in prefixes:
        for n in noms:
            if n.startswith(p):
                return n
    return None


def modeles_rea():
    noms = [m["name"] for m in ia.modeles_installes()]
    modele = premier_modele(noms, MODELES_OUTILS) or (noms[0] if noms else None)
    return modele, premier_modele(noms, MODELES_VISION) or modele


def agent_rea(projet, modele, vision):
    """Un agent par projet et par modèle ; la conversation est gardée entre les demandes."""
    with _rea["verrou"]:
        cle = (projet, modele)
        if cle not in _rea["agents"]:
            for chemin in (DOSSIER_REA, DOSSIER_REA / "libs"):
                if str(chemin) not in sys.path:
                    sys.path.insert(0, str(chemin))
            os.environ.setdefault("TILEX_MEMORY", str(ICI / "memoire" / "rea-memoire.md"))
            from ti_lex_agent.agent import Agent
            from ti_lex_agent.config import Config
            from ti_lex_agent.params import DEFAULTS
            rappels = {"evenement": lambda m: None, "confirmer": lambda q: False}
            config = Config(ollama_host="http://" + ia.hote(), model=modele, vision_model=vision,
                            workspace=DOSSIER_PROJETS / projet)
            agent = Agent(config, confirm=lambda q: rappels["confirmer"](q),
                          on_event=lambda m: rappels["evenement"](m), options=dict(DEFAULTS))
            _rea["agents"][cle] = {"agent": agent, "rappels": rappels, "occupe": threading.Lock()}
        return _rea["agents"][cle]

# --------------------------------------------------------------------------
# Mémoire : les IA apprennent de leurs erreurs (tout reste sur la clé)
# --------------------------------------------------------------------------
FICHIER_MEMOIRE = ICI / "memoire" / "memoire.json"
TYPES_MEMOIRE = {"lecon": "🧩", "correction": "✋", "fait": "📌", "preference": "⭐"}
MOTS_VIDES = set("avec dans pour sans plus moins mais donc alors cette cela ceci comme quoi quel quelle elle elles "
                 "ils nous vous leur leurs être avoir fait faire peut tout tous toute toutes très bien aussi encore "
                 "entre vers chez sous sur une des les est sont the and for with that this from".split())
_verrou_memoire = threading.Lock()


def charger_memoire():
    try:
        d = json.loads(FICHIER_MEMOIRE.read_text(encoding="utf-8"))
        if isinstance(d, dict) and isinstance(d.get("entrees"), list):
            return d
    except (OSError, ValueError):
        pass
    return {"apprendre": True, "entrees": []}


def sauver_memoire(d):
    FICHIER_MEMOIRE.parent.mkdir(parents=True, exist_ok=True)
    tmp = FICHIER_MEMOIRE.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(FICHIER_MEMOIRE)


def mots(texte):
    return {m for m in re.findall(r"[a-zà-ÿ0-9_.\-]{4,}", str(texte).lower()) if m not in MOTS_VIDES}


def ajouter_memoire(texte, type_="lecon", source="manuel"):
    texte = re.sub(r"\s+", " ", str(texte)).strip()[:400]
    if len(texte) < 6:
        raise ValueError("souvenir trop court")
    type_ = type_ if type_ in TYPES_MEMOIRE else "lecon"
    with _verrou_memoire:
        d = charger_memoire()
        for e in d["entrees"]:  # pas de doublon
            if e["texte"].lower() == texte.lower():
                e["date"] = time.time()
                sauver_memoire(d)
                return e, False
        e = {"id": secrets.token_hex(6), "type": type_, "texte": texte, "source": str(source)[:30],
             "date": time.time(), "utilisations": 0}
        d["entrees"].insert(0, e)
        d["entrees"] = d["entrees"][:500]
        sauver_memoire(d)
        return e, True


def memoire_pour(messages, mode):
    """Les souvenirs utiles pour cette demande, à ajouter aux consignes de l'IA."""
    d = charger_memoire()
    if not d["entrees"]:
        return ""
    demande = " ".join(m["content"] for m in messages[-3:] if m["role"] == "user")
    cles = mots(demande)
    choisis = []
    for e in d["entrees"]:
        commun = len(cles & mots(e["texte"]))
        if e["type"] in ("preference", "fait"):
            score = 5 + commun
        elif commun or e.get("source") == mode:
            score = 2 * commun + (1 if e.get("source") == mode else 0)
        else:
            continue
        choisis.append((score, e["date"], e))
    choisis.sort(key=lambda x: (x[0], x[1]), reverse=True)
    lignes, taille_ = [], 0
    for _, _, e in choisis[:12]:
        ligne = f"- {e['texte']}"
        if taille_ + len(ligne) > 1500:
            break
        lignes.append(ligne)
        taille_ += len(ligne)
        e["utilisations"] = e.get("utilisations", 0) + 1
    if not lignes:
        return ""
    with _verrou_memoire:
        sauver_memoire(d)
    return ("MÉMOIRE — ce que tu as appris sur ce PC et avec cet utilisateur (applique-le sans le répéter) :\n"
            + "\n".join(lignes))


CONSIGNE_LECON = ("Tu aides une IA locale à apprendre de ses erreurs. À partir de ce qui s'est passé, écris UNE "
                  "seule leçon courte, générale et réutilisable (25 mots maximum), en français, qui commence par "
                  "un verbe à l'infinitif (ex. « Utiliser python3 au lieu de python sur ce PC. »). Si rien d'utile "
                  "n'est à retenir, réponds exactement AUCUNE.")


def tirer_lecon(modele, contexte):
    filtre, texte = ia.FiltreReflexion(), ""
    for obj in ia.flux("/api/chat", {"model": modele, "stream": True, "messages": [
            {"role": "system", "content": CONSIGNE_LECON}, {"role": "user", "content": str(contexte)[:6000]}]},
                       delai=300):
        texte += filtre.nourrir((obj.get("message") or {}).get("content") or "")
        if obj.get("done"):
            break
    texte += filtre.fin()
    lignes = [l.strip(" -*•\"«»") for l in texte.strip().splitlines() if l.strip()]
    lecon = re.sub(r"^(leçon|lecon)\s*:\s*", "", lignes[0], flags=re.I).strip() if lignes else ""
    if not lecon or lecon.upper().startswith("AUCUNE") or not 8 <= len(lecon) <= 300:
        return None
    return lecon

def creer_apercu(cible):
    """Donne une adresse secrète pour afficher un projet ou un HTML dans le Studio."""
    ident = secrets.token_urlsafe(18)
    if len(APERCUS) > 50:
        APERCUS.pop(next(iter(APERCUS)))
    APERCUS[ident] = cible
    return ident

def surveiller(serveur):
    """Arrête l'app si la fenêtre est fermée depuis un moment."""
    while True:
        time.sleep(5)
        if time.monotonic() - etat_serveur["dernier_signe"] > INACTIVITE_MAX:
            print("Fenêtre fermée : arrêt de LexOS IA.", flush=True)
            serveur.shutdown()
            return


def ouvrir_fenetre(url):
    """Ouvre l'interface dans une fenêtre d'application (sans barre d'adresse si possible)."""
    candidats = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
                 "brave-browser", "microsoft-edge", "msedge"]
    if os.name == "nt":
        for base in (os.environ.get("ProgramFiles(x86)", ""), os.environ.get("ProgramFiles", "")):
            candidats.append(os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
            candidats.append(os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
    for c in candidats:
        exe = shutil.which(c) or (c if os.path.isfile(c) else None)
        if exe:
            try:
                subprocess.Popen([exe, f"--app={url}", "--new-window"], stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, **({} if os.name == "nt" else {"start_new_session": True}))
                return
            except OSError:
                continue
    webbrowser.open(url)


def main(arguments=None):
    arguments = sys.argv[1:] if arguments is None else arguments
    port = PORT_DEFAUT
    if "--port" in arguments:
        port = int(arguments[arguments.index("--port") + 1])
    if not ia.attendre_ia(float(os.environ.get("LEXOS_IA_ATTENTE", "90"))):
        print(f"Le moteur IA ne répond pas sur {ia.hote()}. Lance APP-IA ou ACTIVER-IA depuis la clé.")
        return 1
    try:
        serveur = ThreadingHTTPServer(("127.0.0.1", port), App)
    except OSError:  # port déjà pris (autre LexOS IA ouvert ?) → port libre au hasard
        serveur = ThreadingHTTPServer(("127.0.0.1", 0), App)
    serveur.daemon_threads = True
    serveur.adresse = f"127.0.0.1:{serveur.server_address[1]}"
    url = f"http://{serveur.adresse}/#t={JETON}"
    print(f"{ia.ORANGE}TI-LEX-AL · LexOS IA ouvert dans ta fenêtre.{ia.RAZ}", flush=True)
    print(f"{ia.GRIS}Si rien ne s'ouvre, colle ce lien dans ton navigateur :{ia.RAZ}\n{url}", flush=True)
    print(f"{ia.GRIS}Fermer la fenêtre (ou « Arrêter les IA » dans le menu) arrête tout.{ia.RAZ}", flush=True)
    threading.Thread(target=surveiller, args=(serveur,), daemon=True).start()
    if "--sans-navigateur" not in arguments and not os.environ.get("LEXOS_IA_SANS_NAVIGATEUR"):
        ouvrir_fenetre(url)
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        pass
    serveur.server_close()
    print("À la prochaine ! Les IA s'arrêtent.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
