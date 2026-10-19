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
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import lexos_ia as ia

ICI = Path(__file__).resolve().parent
DOSSIER_APP = ICI / "app"
DOSSIER_CONVS = ICI / "conversations" / "app"
JETON = secrets.token_urlsafe(24)
INACTIVITE_MAX = 180          # secondes sans signe de la fenêtre → on arrête
PORT_DEFAUT = 47800           # fixe : le navigateur se souvient du thème jour/nuit
PORT_TELEPHONE = 47801        # accès Wi-Fi du téléphone (seulement si activé depuis le PC)
HOTE_IP = re.compile(r"^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$")  # adresse IP seulement (pas de nom de domaine)
INTERDIT_TELEPHONE = {"/api/ouvrir", "/api/telephone", "/api/quitter"}
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


def systeme(mode, dossier):
    if mode == "codex":
        return ia.systeme_codex(dossier)
    if mode == "terminal":
        return ia.systeme_codexterminal(dossier)
    return ("Tu es Agent AL, l'assistant de TI-LEX-AL (LexOS IA). Tu fonctionnes 100 % hors ligne "
            "depuis une clé USB-C. Réponds en français québécois clair et naturel (ou dans la langue de "
            "l'utilisateur s'il en change). Sois direct et concis. Si on t'envoie une photo, regarde-la "
            "attentivement, décris ce que tu vois et réponds à la question.")


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
    chemin.write_text(json.dumps({"titre": str(d.get("titre", "Sans titre"))[:80], "mode": d.get("mode", "chat"),
                                  "modele": d.get("modele"), "date": time.time(), "messages": messages},
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


def ouvrir(quoi):
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
                    "sensibles": ia.MOTIFS_SENSIBLES, "langues_shell": sorted(ia.LANGUES_SHELL)})
            if url.path == "/api/modeles":
                return self._envoyer(200, liste_modeles())
            if url.path == "/api/conversations":
                return self._envoyer(200, lister_conversations())
            if url.path == "/api/conversation":
                chemin = chemin_conv((q.get("id") or [""])[0])
                return self._envoyer(200, json.loads(chemin.read_text(encoding="utf-8")))
        except (ia.ErreurIA, ValueError, OSError) as e:
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
            "/api/conversations": self._sauver_conv, "/api/supprimer-conversation": self._supprimer_conv,
            "/api/telecharger-modele": self._telecharger, "/api/supprimer-modele": self._supprimer_modele,
            "/api/dossier": self._dossier, "/api/ouvrir": self._ouvrir,
            "/api/ping": lambda d: self._envoyer(200, {"ok": True}), "/api/quitter": self._quitter,
            "/api/telephone": self._telephone,
        }.get(url.path)
        if route is None:
            return self._envoyer(404, {"erreur": "inconnu"})
        try:
            route(d)
        except (ia.ErreurIA, ValueError, OSError) as e:
            self._envoyer(400, {"erreur": str(e)})

    def _chat(self, d):
        """Discussion en flux : {"t": texte visible} … {"fin": true}."""
        mode = d.get("mode", "chat")
        messages = nettoyer_messages(d.get("messages", []))
        if not messages or messages[0]["role"] != "system":
            messages.insert(0, {"role": "system", "content": systeme(mode, etat_serveur["dossier"])})
        self._flux_debut()
        filtre = ia.FiltreReflexion()
        reflexion = False
        try:
            for obj in ia.flux("/api/chat", {"model": d.get("modele"), "messages": messages, "stream": True}):
                msg = obj.get("message") or {}
                if (msg.get("thinking") or filtre.dedans) and not reflexion:
                    reflexion = True
                    self._ligne({"reflexion": True})
                texte = filtre.nourrir(msg.get("content") or "")
                if texte:
                    self._ligne({"t": texte})
                if obj.get("done"):
                    break
            reste = filtre.fin()
            if reste:
                self._ligne({"t": reste})
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
            for obj in ia.flux("/api/pull", {"model": nom, "stream": True}, delai=7200):
                self._ligne({k: obj.get(k) for k in ("status", "total", "completed") if k in obj})
            self._ligne({"fin": True})
        except ia.ErreurIA as e:
            self._ligne({"erreur": str(e)})
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
        self._envoyer(200, {"ok": ouvrir(str(d.get("quoi", "")))})

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
