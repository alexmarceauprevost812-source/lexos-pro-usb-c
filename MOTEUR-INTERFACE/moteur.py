#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LexOS · Moteur d'interface portable
===================================
Vit SUR la clé USB-C et se déplace avec elle : peu importe le PC ou le point
de montage (/media/..., /run/media/..., E:\\ sous Windows), il retrouve la clé
tout seul à partir de son propre emplacement.

  1. trouve le moteur Ollama DE LA CLÉ (et les modèles DE LA CLÉ)
  2. le démarre sur un port libre (n'touche jamais à l'Ollama du PC)
  3. sert l'interface (noir / orange / blanc, animée) sur http://127.0.0.1:8787
  4. garde les conversations SUR LA CLÉ
  5. arrête tout en quittant : rien ne reste sur le PC

Aucune dépendance : seulement Python 3 (bibliothèque standard).

Usage :  python3 moteur.py [--port 8787] [--modeles DOSSIER] [--sans-navigateur]
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import secrets as _secrets
import http.client
import json
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "1.0"
ICI = Path(__file__).resolve().parent            # .../LEXOS/MOTEUR-INTERFACE
CLE = ICI.parent                                  # .../LEXOS  (racine de la clé)
INTERFACE = ICI / "interface"
CONVERSATIONS = ICI / "conversations"
PROJETS = ICI / "projets"
FONDS = ICI / "fonds"
SCHEMAS = ICI / "schemas"
IMAGES = ICI / "images"
NOM_IMAGE = re.compile(r"^img-\d{10,16}\.png$")
NOM_SCHEMA = re.compile(r"^[A-Za-z0-9 _.'-]{1,60}$")
PARAMETRES = ICI / "parametres.json"
NOM_FOND = re.compile(r"^[A-Za-z0-9_-]{1,40}\.(png|jpe?g|webp|gif)$", re.I)
NOM_PROJET = re.compile(r"^[A-Za-z0-9 _.-]{1,60}$")
WINDOWS = os.name == "nt"
CACHE = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_CACHE_HOME")
             or Path.home() / ".cache") / "lexos-moteur"

ORANGE, GRIS, ROUGE, RAZ = ("", "", "", "") if WINDOWS else (
    "\033[38;2;255;122;24m", "\033[90m", "\033[91m", "\033[0m")


def dire(msg: str, couleur: str = "") -> None:
    print(f"{couleur}{msg}{RAZ if couleur else ''}", flush=True)


# ─────────────────────────────── Ollama de la clé ───────────────────────────
def compter_manifestes(dossier: Path) -> int:
    n = 0
    for sous in ("manifests", "manifests-v2"):
        d = dossier / sous
        if d.is_dir():
            for _, _, fichiers in os.walk(d):
                n += len(fichiers)
    return n


def choisir_modeles(force: str | None) -> Path:
    if force:
        return Path(force).resolve()
    candidats = [CLE / "lexos-ia" / "ia" / "modeles", CLE / "ollama-models"]
    meilleurs = sorted(candidats, key=compter_manifestes, reverse=True)
    for c in meilleurs:
        if compter_manifestes(c):
            return c
    candidats[0].mkdir(parents=True, exist_ok=True)
    return candidats[0]


def executable_ok(chemin: Path) -> bool:
    try:
        subprocess.run([str(chemin), "--version"], capture_output=True, timeout=20)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def trouver_ollama() -> Path | None:
    if os.environ.get("LEXOS_OLLAMA"):
        return Path(os.environ["LEXOS_OLLAMA"])
    ia = CLE / "lexos-ia" / "ia"
    if WINDOWS:
        exe = ia / "ollama-windows" / "ollama.exe"
        if exe.is_file():
            return exe
    else:
        arch = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64",
                "arm64": "arm64"}.get(platform.machine().lower(), "amd64")
        dossier = ia / f"ollama-linux-{arch}"
        binaire = dossier / "bin" / "ollama"
        if binaire.is_file():
            if os.access(binaire, os.X_OK) and executable_ok(binaire):
                return binaire
            # Clé exFAT/FAT montée sans droit d'exécution : on copie le moteur
            # UNE fois dans le cache du PC (les modèles restent sur la clé).
            local = CACHE / f"ollama-linux-{arch}"
            lb = local / "bin" / "ollama"
            if not lb.is_file() or lb.stat().st_size != binaire.stat().st_size:
                dire("Première fois sur ce PC : copie du moteur IA (1 à 3 min)…", GRIS)
                shutil.rmtree(local, ignore_errors=True)
                shutil.copytree(dossier, local)
                lb.chmod(0o755)
            return lb
    systeme = shutil.which("ollama")
    if systeme:
        dire("Moteur absent de la clé : j'utilise l'Ollama du PC avec les modèles de la clé.", GRIS)
        return Path(systeme)
    return None


def port_libre(debut: int, fin: int) -> int | None:
    for p in range(debut, fin + 1):
        with socket.socket() as s:
            try:
                if not WINDOWS:
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    return None


def ollama_repond(port: int) -> dict | None:
    try:
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        c.request("GET", "/api/version")
        r = c.getresponse()
        if r.status == 200:
            return json.loads(r.read() or b"{}")
    except (OSError, ValueError):
        pass
    return None


class Moteur:
    def __init__(self, modeles: Path):
        self.modeles = modeles
        self.binaire: Path | None = None
        self.proc: subprocess.Popen | None = None
        self.port: int | None = None
        self.version = "?"
        self.debut = time.time()
        self.journal = CACHE / "ollama-moteur.log"

    def demarrer(self) -> bool:
        self.binaire = trouver_ollama()
        if not self.binaire:
            dire("Aucun moteur Ollama sur la clé ni sur le PC.", ROUGE)
            return False
        self.port = port_libre(11434, 11450)
        if not self.port:
            dire("Aucun port libre pour le moteur (11434-11450).", ROUGE)
            return False
        env = dict(os.environ, OLLAMA_MODELS=str(self.modeles),
                   OLLAMA_HOST=f"127.0.0.1:{self.port}")
        CACHE.mkdir(parents=True, exist_ok=True)
        log = open(self.journal, "wb")
        opts = {"creationflags": 0x08000000} if WINDOWS else {"start_new_session": True}
        self.proc = subprocess.Popen([str(self.binaire), "serve"], env=env,
                                     stdout=log, stderr=subprocess.STDOUT, **opts)
        dire(f"Activation du moteur IA (port {self.port})", ORANGE)
        t0 = time.time()
        while time.time() - t0 < 240:
            v = ollama_repond(self.port)
            if v is not None:
                self.version = v.get("version", "?")
                dire(f"  moteur prêt ✔  Ollama {self.version}", ORANGE)
                return True
            if self.proc.poll() is not None:
                break
            print(".", end="", flush=True)
            time.sleep(1)
        dire(f"\nLe moteur n'a pas démarré. Journal : {self.journal}", ROUGE)
        return False

    def arreter(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()


# ─────────────────────────────── Mot de passe (accès) ───────────────────────
# Le mot de passe n'est JAMAIS gardé : seulement une empreinte scrypt (lente
# exprès) + un sel aléatoire, dans MOTEUR-INTERFACE/acces.json.
# Si un coffre chiffré (.env.coffre, fait avec coffre.py) est sur la clé et que
# « cryptography » est installé, le même mot de passe maître l'ouvre aussi :
# les clés API sont chargées en mémoire seulement, jamais écrites en clair.
ACCES = ICI / "acces.json"
COFFRE_FICHIER = ICI / ".env.coffre"
try:
    sys.path.insert(0, str(ICI))
    import coffre as _coffre                     # coffre.py (à côté de ce fichier)
    _coffre.FICHIER_COFFRE = str(COFFRE_FICHIER)
except Exception:                                # cryptography absent → pas de coffre
    _coffre = None


class Acces:
    ESSAIS = 3

    def __init__(self):
        self.sessions: dict[str, float] = {}
        self.echecs = 0
        self.bloque_jusqua = 0.0
        self.verrou = threading.Lock()

    # empreinte du mot de passe
    @staticmethod
    def _empreinte(mdp: str, sel: bytes) -> bytes:
        return hashlib.scrypt(mdp.encode("utf-8"), salt=sel, n=2**15, r=8, p=1,
                              maxmem=64 * 1024 * 1024, dklen=32)

    def configure(self) -> bool:
        return ACCES.is_file() or (COFFRE_FICHIER.is_file() and _coffre is not None)

    def coffre_present(self) -> bool:
        return COFFRE_FICHIER.is_file()

    def _ecrire(self, mdp: str) -> None:
        sel = os.urandom(16)
        tmp = ACCES.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": 1, "algo": "scrypt-n15-r8-p1",
                                   "sel": sel.hex(), "empreinte": self._empreinte(mdp, sel).hex()}), "utf-8")
        os.replace(tmp, ACCES)
        try:
            ACCES.chmod(0o600)
        except OSError:
            pass

    def _bon(self, mdp: str) -> bool:
        if ACCES.is_file():
            try:
                d = json.loads(ACCES.read_text("utf-8"))
                ok = hmac.compare_digest(self._empreinte(mdp, bytes.fromhex(d["sel"])),
                                         bytes.fromhex(d["empreinte"]))
            except (OSError, ValueError, KeyError):
                return False
            if ok:
                self._ouvrir_coffre(mdp)
            return ok
        if COFFRE_FICHIER.is_file() and _coffre is not None:   # seulement le coffre
            if self._ouvrir_coffre(mdp):
                self._ecrire(mdp)
                return True
        return False

    def _ouvrir_coffre(self, mdp: str) -> bool:
        if not (COFFRE_FICHIER.is_file() and _coffre is not None):
            return False
        try:
            os.environ.update(_coffre._lire_coffre(mdp))
            return True
        except Exception:
            return False

    def _nouvelle_session(self) -> str:
        jeton = _secrets.token_urlsafe(32)
        self.sessions[jeton] = time.time()
        return jeton

    # actions
    def creer(self, mdp: str) -> tuple[bool, str]:
        with self.verrou:
            if self.configure():
                return False, "un mot de passe existe déjà"
            if len(mdp) < 8:
                return False, "minimum 8 caractères"
            self._ecrire(mdp)
            return True, self._nouvelle_session()

    def entrer(self, mdp: str) -> tuple[bool, str, float]:
        with self.verrou:
            attente = self.bloque_jusqua - time.time()
            if attente > 0:
                return False, "trop d'essais, attends un peu", attente
            if self._bon(mdp):
                self.echecs = 0
                return True, self._nouvelle_session(), 0
            self.echecs += 1
            restants = self.ESSAIS - self.echecs % self.ESSAIS
            if self.echecs % self.ESSAIS == 0:          # 30 s, puis 60, 120… (max 15 min)
                self.bloque_jusqua = time.time() + min(900, 30 * 2 ** (self.echecs // self.ESSAIS - 1))
                return False, "trop d'essais : moteur verrouillé un moment", self.bloque_jusqua - time.time()
            time.sleep(1.5)
            return False, f"mot de passe incorrect — essais restants : {restants}", 0

    def changer(self, ancien: str, nouveau: str) -> tuple[bool, str]:
        with self.verrou:
            if not self._bon(ancien):
                return False, "ancien mot de passe incorrect"
            if len(nouveau) < 8:
                return False, "minimum 8 caractères"
            if COFFRE_FICHIER.is_file() and _coffre is not None:   # re-chiffre le coffre
                try:
                    _coffre._ecrire_coffre(_coffre._lire_coffre(ancien), nouveau)
                except Exception as e:
                    return False, f"coffre non modifié : {e}"
            self._ecrire(nouveau)
            self.sessions.clear()
            return True, self._nouvelle_session()

    def valide(self, jeton: str | None) -> bool:
        return bool(jeton) and jeton in self.sessions

    # Aperçu du Studio : un jeton dans l'adresse (l'aperçu tourne en bac à
    # sable, sans cookie), valide seulement tant que la session existe.
    def jeton_apercu(self, session: str) -> str:
        if not hasattr(self, "apercus"):
            self.apercus = {}
        for k, v in self.apercus.items():
            if v == session:
                return k
        k = _secrets.token_urlsafe(24)
        self.apercus[k] = session
        return k

    def apercu_valide(self, k: str) -> bool:
        return self.valide(getattr(self, "apercus", {}).get(k))


ACCES_MOTEUR = Acces()


# ─────────────────────────────── Fichiers .gguf ──────────────────────────────
SAUTER = {".git", ".venv", "venv", "deps", "blobs", "lib", "node_modules",
          "heretic-runtime", "heretic-outils", "__pycache__", "huggingface",
          "manifests", "manifests-v2", "site-packages"}


def chercher_gguf() -> list[dict]:
    trouves = []
    for racine, dossiers, fichiers in os.walk(CLE):
        dossiers[:] = [d for d in dossiers if d not in SAUTER and not d.startswith(".")]
        if Path(racine).relative_to(CLE).parts.__len__() > 5:
            dossiers[:] = []
        for f in fichiers:
            if f.lower().endswith(".gguf"):
                p = Path(racine) / f
                try:
                    taille = p.stat().st_size
                except OSError:
                    continue
                trouves.append({"nom": f, "chemin": str(p.relative_to(CLE)), "taille": taille})
    return sorted(trouves, key=lambda x: x["nom"].lower())


def nom_modele(fichier: str) -> str:
    base = re.sub(r"\.gguf$", "", fichier, flags=re.I).lower()
    base = re.sub(r"[^a-z0-9._-]+", "-", base).strip("-.")
    return f"cle/{base}:latest"


# ─────────────────────────────── Serveur web ─────────────────────────────────
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
         ".woff2": "font/woff2", ".json": "application/json", ".ico": "image/x-icon", ".webm": "video/webm", ".txt": "text/plain; charset=utf-8"}
ID_SUR = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def fabriquer_gestionnaire(moteur: Moteur, arret: threading.Event):
    class G(BaseHTTPRequestHandler):
        server_version = f"LexOS-Moteur/{VERSION}"

        def log_message(self, *_):  # silence
            pass

        # ── petits outils ──
        def _json(self, obj, code=200):
            data = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _corps(self) -> bytes:
            n = int(self.headers.get("Content-Length") or 0)
            return self.rfile.read(n) if n else b""

        def _origine_ok(self) -> bool:
            # Bloque les sites web étrangers qui essaieraient de parler au moteur.
            o = self.headers.get("Origin")
            return not o or o.startswith(("http://127.0.0.1:", "http://localhost:"))

        # ── portier : rien de privé sans le mot de passe ──
        def _jeton(self) -> str | None:
            for morceau in (self.headers.get("Cookie") or "").split(";"):
                k, _, v = morceau.strip().partition("=")
                if k == "lexos_session":
                    return v
            return None

        def _bloque(self) -> bool:
            p = self.path.split("?", 1)[0]
            prive = (p.startswith(("/api/", "/fonds/", "/schemas/", "/images/"))
                     or (p.startswith("/moteur/") and not p.startswith("/moteur/acces/")
                         and not (p == "/moteur/parametres" and self.command == "GET")))
            if prive and not ACCES_MOTEUR.valide(self._jeton()):
                self._json({"erreur": "verrouillé", "verrou": True}, 401)
                return True
            return False

        def _session_json(self, obj, jeton: str | None, code=200):
            data = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            if jeton is not None:
                self.send_header("Set-Cookie", f"lexos_session={jeton}; HttpOnly; SameSite=Strict; Path=/"
                                 + ("; Max-Age=0" if jeton == "" else ""))
            self.end_headers()
            self.wfile.write(data)

        def _acces(self):
            try:
                d = json.loads(self._corps() or b"{}")
            except ValueError:
                return self._json({"erreur": "json invalide"}, 400)
            action = self.path.split("?", 1)[0].rsplit("/", 1)[1]
            if action == "creer":
                ok, r = ACCES_MOTEUR.creer(str(d.get("mdp", "")))
                return self._session_json({"ok": True}, r) if ok else self._json({"erreur": r}, 400)
            if action == "entrer":
                ok, r, attente = ACCES_MOTEUR.entrer(str(d.get("mdp", "")))
                if ok:
                    return self._session_json({"ok": True, "coffre": ACCES_MOTEUR.coffre_present() and _coffre is not None}, r)
                return self._json({"erreur": r, "attente": round(attente)}, 429 if attente else 403)
            if action == "sortir":
                ACCES_MOTEUR.sessions.pop(self._jeton() or "", None)
                return self._session_json({"ok": True}, "")
            if action == "changer":
                if not ACCES_MOTEUR.valide(self._jeton()):
                    return self._json({"erreur": "verrouillé"}, 401)
                ok, r = ACCES_MOTEUR.changer(str(d.get("ancien", "")), str(d.get("nouveau", "")))
                return self._session_json({"ok": True}, r) if ok else self._json({"erreur": r}, 400)
            self._json({"erreur": "inconnu"}, 404)

        # ── routes ──
        def do_GET(self):
            if self.path == "/moteur/acces/etat":
                return self._json({"configure": ACCES_MOTEUR.configure(),
                                   "connecte": ACCES_MOTEUR.valide(self._jeton()),
                                   "coffre": ACCES_MOTEUR.coffre_present(),
                                   "cryptographie": _coffre is not None})
            if self.path.startswith("/apercu/"):
                return self._apercu()
            if self._bloque():
                return
            if self.path.startswith("/api/"):
                return self._proxy("GET")
            if self.path == "/moteur/apercu-jeton":
                return self._json({"jeton": ACCES_MOTEUR.jeton_apercu(self._jeton())})
            if self.path == "/moteur/studio":
                return self._studio()
            if self.path == "/moteur/images":
                IMAGES.mkdir(exist_ok=True)
                out = []
                for f in sorted(IMAGES.glob("img-*.png"), reverse=True):
                    info = {}
                    try:
                        info = json.loads(f.with_suffix(".json").read_text("utf-8"))
                    except (OSError, ValueError):
                        pass
                    out.append({"nom": f.name, **info})
                return self._json(out[:300])
            if self.path == "/moteur/etat":
                return self._etat()
            if self.path.startswith("/moteur/projets"):
                return self._projets_get()
            if self.path == "/moteur/parametres":
                try:
                    return self._json(json.loads(PARAMETRES.read_text("utf-8")))
                except (OSError, ValueError):
                    return self._json({})
            if self.path == "/moteur/schemas":
                SCHEMAS.mkdir(exist_ok=True)
                noms = {}
                for f in SCHEMAS.iterdir():
                    if f.suffix in (".txt", ".webm", ".png"):
                        noms.setdefault(f.stem, {"nom": f.stem, "maj": 0})[f.suffix[1:]] = True
                        noms[f.stem]["maj"] = max(noms[f.stem]["maj"], f.stat().st_mtime)
                return self._json(sorted(noms.values(), key=lambda x: x["maj"], reverse=True))
            if self.path == "/moteur/fonds":
                FONDS.mkdir(exist_ok=True)
                return self._json(sorted(f.name for f in FONDS.iterdir() if NOM_FOND.match(f.name)))
            if self.path == "/moteur/conversations":
                return self._liste_conv()
            if self.path.startswith("/moteur/conversations/"):
                return self._lire_conv(self.path.rsplit("/", 1)[1])
            return self._statique()

        def do_POST(self):
            if not self._origine_ok():
                return self._json({"erreur": "origine refusée"}, 403)
            if self.path.startswith("/moteur/acces/"):
                return self._acces()
            if self._bloque():
                return
            if self.path.startswith("/api/"):
                return self._proxy("POST")
            if self.path.startswith("/moteur/conversations/"):
                return self._ecrire_conv(self.path.rsplit("/", 1)[1])
            if self.path.startswith("/moteur/projets"):
                return self._projets_post()
            if self.path == "/moteur/parametres":
                try:
                    d = json.loads(self._corps() or b"{}")
                except ValueError:
                    return self._json({"erreur": "json invalide"}, 400)
                PARAMETRES.write_text(json.dumps(d, ensure_ascii=False, indent=1), "utf-8")
                return self._json({"ok": True})
            if self.path == "/moteur/schemas":
                return self._sauver_schema()
            if self.path == "/moteur/images":
                return self._sauver_image()
            if self.path == "/moteur/fonds":
                return self._ajouter_fond()
            if self.path == "/moteur/importer":
                return self._importer()
            if self.path == "/moteur/rea":
                return self._turbo_rea()
            if self.path == "/moteur/arreter":
                self._json({"ok": True})
                threading.Timer(0.5, arret.set).start()
                return
            self._json({"erreur": "inconnu"}, 404)

        def do_DELETE(self):
            if not self._origine_ok():
                return self._json({"erreur": "origine refusée"}, 403)
            if self._bloque():
                return
            if self.path.startswith("/api/"):
                return self._proxy("DELETE")
            if self.path.startswith("/moteur/images/"):
                nom = self.path.rsplit("/", 1)[1]
                if NOM_IMAGE.match(nom):
                    (IMAGES / nom).unlink(missing_ok=True)
                    (IMAGES / nom).with_suffix(".json").unlink(missing_ok=True)
                    return self._json({"ok": True})
            if self.path.startswith("/moteur/schemas/"):
                from urllib.parse import unquote
                nom = unquote(self.path.rsplit("/", 1)[1])
                if NOM_SCHEMA.match(nom) and not nom.startswith("."):
                    for ext in ("txt", "webm", "png"):
                        (SCHEMAS / f"{nom}.{ext}").unlink(missing_ok=True)
                    return self._json({"ok": True})
            if self.path.startswith("/moteur/fonds/"):
                nom = self.path.rsplit("/", 1)[1]
                if NOM_FOND.match(nom):
                    (FONDS / nom).unlink(missing_ok=True)
                    return self._json({"ok": True})
            if self.path.startswith("/moteur/conversations/"):
                cid = self.path.rsplit("/", 1)[1]
                if ID_SUR.match(cid):
                    (CONVERSATIONS / f"{cid}.json").unlink(missing_ok=True)
                    return self._json({"ok": True})
            self._json({"erreur": "inconnu"}, 404)

        # ── fichiers de l'interface ──
        def _statique(self):
            chemin = self.path.split("?", 1)[0]
            if chemin in ("", "/"):
                chemin = "/index.html"
            if chemin.startswith("/cle-images/"):     # images déjà sur la clé
                base = CLE / "lexos-ia" / "app" / "images"
                chemin = chemin[len("/cle-images"):]
            elif chemin.startswith("/images/"):
                base = IMAGES
                chemin = chemin[len("/images"):]
            elif chemin.startswith("/schemas/"):
                from urllib.parse import unquote
                base = SCHEMAS
                chemin = unquote(chemin[len("/schemas"):])
            elif chemin.startswith("/fonds/"):
                base = FONDS
                chemin = chemin[len("/fonds"):]
            elif chemin.startswith("/cle-polices/"):
                base = CLE / "lexos-ia" / "app" / "polices"
                chemin = chemin[len("/cle-polices"):]
            else:
                base = INTERFACE
            f = (base / chemin.lstrip("/")).resolve()
            if base.resolve() not in f.parents or not f.is_file():
                self.send_error(404)
                return
            data = f.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", TYPES.get(f.suffix.lower(), "application/octet-stream"))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        # ── relais vers Ollama (en flux, mot par mot) ──
        def _proxy(self, methode):
            corps = self._corps() if methode != "GET" else None
            try:
                c = http.client.HTTPConnection("127.0.0.1", moteur.port, timeout=900)
                c.request(methode, self.path, body=corps,
                          headers={"Content-Type": "application/json"})
                r = c.getresponse()
            except OSError as e:
                return self._json({"error": f"moteur IA injoignable : {e}"}, 502)
            self.send_response(r.status)
            self.send_header("Content-Type", r.getheader("Content-Type", "application/json"))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                while True:
                    morceau = r.read1(65536) if hasattr(r, "read1") else r.read(4096)
                    if not morceau:
                        break
                    self.wfile.write(morceau)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass  # l'utilisateur a cliqué « Stop »
            finally:
                c.close()
                self.close_connection = True

        # ── état du moteur ──
        def _etat(self):
            defaut = codex = None
            try:
                cfg = json.loads((CLE / "lexos-ia" / "config.json").read_text("utf-8"))
                defaut, codex = cfg.get("chat"), cfg.get("codex")
            except (OSError, ValueError, AttributeError):
                pass
            try:
                du = shutil.disk_usage(CLE)
                disque = {"total": du.total, "libre": du.free}
            except OSError:
                disque = None
            self._json({
                "version": VERSION, "ollama": moteur.version, "port": moteur.port,
                "cle": str(CLE), "pc": socket.gethostname(),
                "systeme": f"{platform.system()} {platform.release()}",
                "modeles": str(moteur.modeles), "binaire": str(moteur.binaire),
                "depuis": moteur.debut, "defaut": defaut, "codex": codex, "disque": disque,
                "gguf": chercher_gguf(),
            })

        # ── import d'un .gguf de la clé dans le moteur ──
        def _importer(self):
            try:
                demande = json.loads(self._corps() or b"{}")
            except ValueError:
                return self._json({"erreur": "requête invalide"}, 400)
            permis = {g["chemin"]: g for g in chercher_gguf()}
            g = permis.get(demande.get("chemin", ""))
            if not g:
                return self._json({"erreur": "fichier .gguf introuvable sur la clé"}, 404)
            if re.search(r"z[-_ ]?image|flux|sdxl|stable[-_ ]?diffusion|sd3|qwen[-_]?image|hidream|wan2", g["nom"], re.I):
                return self._json({"erreur": "c'est un modèle d'IMAGE en .gguf (pour ComfyUI / stable-diffusion.cpp) : "
                                   "Ollama ne sait pas le charger. Dans l'onglet 🎨 Images, télécharge plutôt "
                                   "x/z-image-turbo (version officielle d'Ollama)."}, 400)
            nom = nom_modele(g["nom"])
            mf = CACHE / "Modelfile.import"
            mf.write_text(f"FROM {CLE / g['chemin']}\n", "utf-8")
            env = dict(os.environ, OLLAMA_HOST=f"127.0.0.1:{moteur.port}",
                       OLLAMA_MODELS=str(moteur.modeles))
            try:
                p = subprocess.run([str(moteur.binaire), "create", nom, "-f", str(mf)],
                                   env=env, capture_output=True, text=True, timeout=3600)
            except (OSError, subprocess.SubprocessError) as e:
                return self._json({"erreur": str(e)}, 500)
            if p.returncode:
                return self._json({"erreur": (p.stderr or p.stdout)[-400:]}, 500)
            self._json({"ok": True, "modele": nom})

        # ── images créées par l'IA (gardées SUR la clé) ──
        def _sauver_image(self):
            import base64
            try:
                d = json.loads(self._corps() or b"{}")
                data = base64.b64decode(d.get("data", ""), validate=True)
            except ValueError:
                return self._json({"erreur": "image invalide"}, 400)
            if not data.startswith(b"\x89PNG") and not data.startswith(b"\xff\xd8"):
                return self._json({"erreur": "ce n'est pas une image"}, 400)
            IMAGES.mkdir(exist_ok=True)
            nom = f"img-{int(time.time() * 1000)}.png"
            (IMAGES / nom).write_bytes(data)
            info = {k: d.get(k) for k in ("prompt", "modele", "largeur", "hauteur", "graine", "etapes", "duree")}
            info["date"] = time.time()
            (IMAGES / nom).with_suffix(".json").write_text(json.dumps(info, ensure_ascii=False), "utf-8")
            self._json({"ok": True, "nom": nom})

        # ── schémas animés : texte, image et vidéo gardés SUR la clé ──
        def _sauver_schema(self):
            import base64
            try:
                d = json.loads(self._corps() or b"{}")
            except ValueError:
                return self._json({"erreur": "json invalide"}, 400)
            nom = str(d.get("nom", "")).strip()
            sorte = d.get("sorte")
            if not NOM_SCHEMA.match(nom) or nom.startswith(".") or sorte not in ("txt", "webm", "png"):
                return self._json({"erreur": "nom invalide (lettres, chiffres, espaces, - _ .)"}, 400)
            SCHEMAS.mkdir(exist_ok=True)
            cible = SCHEMAS / f"{nom}.{sorte}"
            if sorte == "txt":
                cible.write_text(str(d.get("texte", "")), "utf-8")
            else:
                try:
                    data = base64.b64decode(d.get("data", ""), validate=True)
                except ValueError:
                    return self._json({"erreur": "données invalides"}, 400)
                if len(data) > 300_000_000:
                    return self._json({"erreur": "fichier trop gros"}, 413)
                cible.write_bytes(data)
            self._json({"ok": True, "fichier": cible.name})

        # ── fond d'écran personnel (image gardée SUR la clé) ──
        def _ajouter_fond(self):
            import base64
            try:
                d = json.loads(self._corps() or b"{}")
                ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
                       "image/gif": "gif"}[d.get("type", "")]
                data = base64.b64decode(d.get("data", ""), validate=True)
            except (ValueError, KeyError):
                return self._json({"erreur": "image invalide (png, jpg, webp ou gif)"}, 400)
            if len(data) > 25_000_000:
                return self._json({"erreur": "image trop grosse (25 Mo max)"}, 413)
            FONDS.mkdir(exist_ok=True)
            nom = f"fond-{int(time.time() * 1000)}.{ext}"
            (FONDS / nom).write_bytes(data)
            self._json({"ok": True, "nom": nom})

        # ── ⚡ Turbo REA : l'agent travaille dans le projet et raconte ce qu'il fait ──
        def _turbo_rea(self):
            from turbo_rea import TurboREA
            try:
                d = json.loads(self._corps() or b"{}")
            except ValueError:
                return self._json({"erreur": "json invalide"}, 400)
            projet = self._dossier_projet(str(d.get("projet", "")))
            if not projet or not projet.is_dir():
                return self._json({"erreur": "projet introuvable"}, 404)
            if not d.get("modele") or not str(d.get("message", "")).strip():
                return self._json({"erreur": "modèle ou message manquant"}, 400)
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            agent = None

            def evenement(e: dict):
                try:
                    self.wfile.write((json.dumps(e, ensure_ascii=False) + "\n").encode())
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    if agent:
                        agent.arret = True                         # bouton « Stop »
            agent = TurboREA(projet, f"http://127.0.0.1:{moteur.port}", str(d["modele"]),
                             d.get("vision") or None, d.get("modele_image") or None, evenement)
            try:
                fin = agent.tourner(d.get("historique") or [], str(d["message"]))
                evenement({"type": "fin", "texte": fin})
            except Exception as e:
                evenement({"type": "erreur", "texte": f"{type(e).__name__} : {e}"})
            self.close_connection = True

        # ── Studio : vue d'ensemble des projets ──
        def _studio(self):
            PROJETS.mkdir(exist_ok=True)
            out = []
            for p in sorted(PROJETS.iterdir()):
                if not p.is_dir() or p.name.startswith("."):
                    continue
                fichiers, taille, maj, langages = [], 0, p.stat().st_mtime, {}
                for racine, dossiers, noms in os.walk(p):
                    dossiers[:] = [d for d in dossiers if not d.startswith(".") and d not in SAUTER]
                    for n in noms:
                        if n.endswith(".avant-codex") or n.startswith("."):
                            continue
                        f = Path(racine) / n
                        try:
                            st = f.stat()
                        except OSError:
                            continue
                        rel = f.relative_to(p).as_posix()
                        fichiers.append(rel)
                        taille += st.st_size
                        maj = max(maj, st.st_mtime)
                        ext = f.suffix.lower().lstrip(".") or "autre"
                        langages[ext] = langages.get(ext, 0) + 1
                    if len(fichiers) > 2000:
                        break
                web = next((f for f in ("index.html", "web/index.html", "public/index.html", "site/index.html")
                            if f in fichiers), None) or next((f for f in fichiers if f.endswith(".html")), None)
                principal = next((f for f in fichiers if re.search(r"(^|/)(main|app|index)\.\w+$", f)), fichiers[0] if fichiers else None)
                lisez = next((f for f in fichiers if f.lower() in ("readme.md", "lisez-moi.md", "readme.txt", "lisez-moi.txt")), None)
                resume = ""
                if lisez:
                    try:
                        resume = (p / lisez).read_text("utf-8", errors="replace")[:600]
                    except OSError:
                        pass
                out.append({"nom": p.name, "fichiers": len(fichiers), "liste": fichiers[:12], "taille": taille,
                            "maj": maj, "langages": langages, "web": web, "principal": principal, "resume": resume})
            self._json(sorted(out, key=lambda x: x["maj"], reverse=True))

        def _apercu(self):
            from urllib.parse import unquote
            morceaux = self.path.split("?", 1)[0].split("/", 4)      # ['', 'apercu', jeton, projet, chemin]
            if len(morceaux) < 4 or not ACCES_MOTEUR.apercu_valide(morceaux[2]):
                return self.send_error(403)
            projet = self._dossier_projet(morceaux[3])
            rel = unquote(morceaux[4]) if len(morceaux) > 4 and morceaux[4] else "index.html"
            if not projet or not projet.is_dir():
                return self.send_error(404)
            f = self._chemin_dans(projet, rel)
            if f and f.is_dir():
                f = f / "index.html"
            if not f or not f.is_file():
                return self.send_error(404)
            data = f.read_bytes()
            types = dict(TYPES, **{".mjs": "text/javascript; charset=utf-8", ".jpg": "image/jpeg",
                                   ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
                                   ".mp3": "audio/mpeg", ".wav": "audio/wav", ".mp4": "video/mp4"})
            self.send_response(200)
            self.send_header("Content-Type", types.get(f.suffix.lower(), "application/octet-stream"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            # l'aperçu roule dans un bac à sable : il ne peut pas toucher au moteur
            self.send_header("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-modals allow-popups")
            self.end_headers()
            self.wfile.write(data)

        # ── projets Codex (gardés SUR la clé) ──
        def _dossier_projet(self, nom: str) -> Path | None:
            from urllib.parse import unquote
            nom = unquote(nom)
            if not NOM_PROJET.match(nom) or nom.startswith("."):
                return None
            return PROJETS / nom

        def _chemin_dans(self, projet: Path, rel: str) -> Path | None:
            if not rel or "\0" in rel:
                return None
            f = (projet / rel).resolve()
            if projet.resolve() not in f.parents:
                return None
            return f

        def _projets_get(self):
            from urllib.parse import urlsplit, parse_qs
            u = urlsplit(self.path)
            parts = [p for p in u.path.split("/") if p][2:]      # après moteur/projets
            PROJETS.mkdir(exist_ok=True)
            if not parts:
                noms = sorted(p.name for p in PROJETS.iterdir() if p.is_dir() and not p.name.startswith("."))
                return self._json(noms)
            projet = self._dossier_projet(parts[0])
            if not projet or not projet.is_dir():
                return self._json({"erreur": "projet introuvable"}, 404)
            if len(parts) == 2 and parts[1] == "fichiers":
                out = []
                for racine, dossiers, fichiers in os.walk(projet):
                    dossiers[:] = sorted(d for d in dossiers if not d.startswith(".") and d not in SAUTER)
                    for f in sorted(x for x in fichiers if not x.endswith(".avant-codex")):
                        p = Path(racine) / f
                        out.append({"chemin": p.relative_to(projet).as_posix(), "taille": p.stat().st_size})
                        if len(out) >= 500:
                            break
                return self._json(out)
            if len(parts) == 2 and parts[1] == "brut":            # image, etc. telle quelle
                rel = parse_qs(u.query).get("chemin", [""])[0]
                f = self._chemin_dans(projet, rel)
                if not f or not f.is_file():
                    return self.send_error(404)
                data = f.read_bytes()
                typ = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
                       ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp"}.get(f.suffix.lower(), "application/octet-stream")
                self.send_response(200)
                self.send_header("Content-Type", typ)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Security-Policy", "sandbox")
                self.end_headers()
                self.wfile.write(data)
                return
            if len(parts) == 2 and parts[1] == "fichier":
                rel = parse_qs(u.query).get("chemin", [""])[0]
                f = self._chemin_dans(projet, rel)
                if not f or not f.is_file():
                    return self._json({"erreur": "fichier introuvable"}, 404)
                if f.stat().st_size > 2_000_000:
                    return self._json({"erreur": "fichier trop gros pour l'éditeur"}, 413)
                return self._json({"chemin": rel, "contenu": f.read_text("utf-8", errors="replace")})
            self._json({"erreur": "inconnu"}, 404)

        def _projets_post(self):
            parts = [p for p in self.path.split("?")[0].split("/") if p][2:]
            try:
                d = json.loads(self._corps() or b"{}")
            except ValueError:
                return self._json({"erreur": "json invalide"}, 400)
            if not parts:                                        # créer un projet
                projet = self._dossier_projet(str(d.get("nom", "")).strip())
                if not projet:
                    return self._json({"erreur": "nom invalide (lettres, chiffres, - _ .)"}, 400)
                projet.mkdir(parents=True, exist_ok=True)
                return self._json({"ok": True, "nom": projet.name})
            projet = self._dossier_projet(parts[0])
            if not projet or not projet.is_dir():
                return self._json({"erreur": "projet introuvable"}, 404)
            if len(parts) == 2 and parts[1] == "televerser":      # ajouter une image / un fichier
                import base64
                f = self._chemin_dans(projet, str(d.get("chemin", "")).strip())
                if not f:
                    return self._json({"erreur": "chemin refusé"}, 400)
                try:
                    data = base64.b64decode(d.get("data", ""), validate=True)
                except ValueError:
                    return self._json({"erreur": "données invalides"}, 400)
                if len(data) > 25_000_000:
                    return self._json({"erreur": "fichier trop gros (25 Mo max)"}, 413)
                if f.exists():                                   # ne jamais écraser : on renomme
                    base, ext, k = f.stem, f.suffix, 2
                    while f.exists():
                        f = f.with_name(f"{base}-{k}{ext}"); k += 1
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(data)
                return self._json({"ok": True, "chemin": f.relative_to(projet.resolve()).as_posix()})
            if len(parts) == 2 and parts[1] == "fichier":
                f = self._chemin_dans(projet, str(d.get("chemin", "")).strip())
                if not f:
                    return self._json({"erreur": "chemin refusé"}, 400)
                f.parent.mkdir(parents=True, exist_ok=True)
                if f.exists():                                   # copie de sécurité
                    (f.parent / (f.name + ".avant-codex")).write_bytes(f.read_bytes())
                f.write_text(str(d.get("contenu", "")), "utf-8")
                return self._json({"ok": True})
            self._json({"erreur": "inconnu"}, 404)

        # ── conversations (gardées SUR la clé) ──
        def _liste_conv(self):
            CONVERSATIONS.mkdir(exist_ok=True)
            out = []
            for f in CONVERSATIONS.glob("*.json"):
                try:
                    d = json.loads(f.read_text("utf-8"))
                    out.append({"id": f.stem, "titre": d.get("titre", "Sans titre"),
                                "maj": d.get("maj", 0), "modele": d.get("modele")})
                except (OSError, ValueError):
                    continue
            self._json(sorted(out, key=lambda x: x["maj"], reverse=True))

        def _lire_conv(self, cid):
            f = CONVERSATIONS / f"{cid}.json"
            if not ID_SUR.match(cid) or not f.is_file():
                return self._json({"erreur": "introuvable"}, 404)
            self._json(json.loads(f.read_text("utf-8")))

        def _ecrire_conv(self, cid):
            if not ID_SUR.match(cid):
                return self._json({"erreur": "id invalide"}, 400)
            try:
                d = json.loads(self._corps() or b"{}")
            except ValueError:
                return self._json({"erreur": "json invalide"}, 400)
            CONVERSATIONS.mkdir(exist_ok=True)
            d["maj"] = time.time()
            tmp = CONVERSATIONS / f".{cid}.tmp"
            tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), "utf-8")
            os.replace(tmp, CONVERSATIONS / f"{cid}.json")
            self._json({"ok": True})

    return G


# ─────────────────────────────── Navigateur ──────────────────────────────────
def ouvrir_fenetre(url: str) -> None:
    """Ouvre l'interface en mode « application » (sans barre d'adresse) si un
    Chrome/Chromium/Edge est là, sinon dans le navigateur par défaut."""
    candidats = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
                 "brave-browser", "microsoft-edge"]
    if WINDOWS:
        for base in (os.environ.get("PROGRAMFILES(X86)", ""), os.environ.get("PROGRAMFILES", "")):
            for rel in (r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe"):
                p = Path(base) / rel
                if p.is_file():
                    candidats.insert(0, str(p))
    for c in candidats:
        exe = c if Path(c).is_file() else shutil.which(c)
        if exe:
            try:
                profil = CACHE / "fenetre"
                subprocess.Popen([exe, f"--app={url}", f"--user-data-dir={profil}",
                                  "--window-size=1280,820"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
            except OSError:
                continue
    webbrowser.open(url)


# ─────────────────────────────── Programme ───────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="Moteur d'interface portable LexOS")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--modeles", help="dossier de modèles Ollama (défaut : celui de la clé)")
    ap.add_argument("--sans-navigateur", action="store_true")
    ap.add_argument("--sans-ia", action="store_true", help="interface seule (tests)")
    a = ap.parse_args()

    dire("╭──────────────────────────────────────────╮", ORANGE)
    dire("│   LexOS · Moteur d'interface portable    │", ORANGE)
    dire("╰──────────────────────────────────────────╯", ORANGE)
    dire(f"Clé détectée : {CLE}", GRIS)

    moteur = Moteur(choisir_modeles(a.modeles))
    dire(f"Modèles      : {moteur.modeles}", GRIS)
    if a.sans_ia:
        moteur.port = int(os.environ.get("LEXOS_PORT_IA", "11434"))
        v = ollama_repond(moteur.port)
        moteur.version = (v or {}).get("version", "absent")
    elif not moteur.demarrer():
        moteur.arreter()
        return 1

    port = port_libre(a.port, a.port + 50)
    if not port:
        dire("Aucun port libre pour l'interface.", ROUGE)
        moteur.arreter()
        return 1
    arret = threading.Event()
    serveur = ThreadingHTTPServer(("127.0.0.1", port), fabriquer_gestionnaire(moteur, arret))
    serveur.daemon_threads = True
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/"
    dire(f"\nInterface    : {url}", ORANGE)
    dire("Ferme avec le bouton ⏻ de l'interface, ou Ctrl+C ici.\n", GRIS)
    if not a.sans_navigateur:
        ouvrir_fenetre(url)

    def fin(*_):
        arret.set()
    signal.signal(signal.SIGINT, fin)
    signal.signal(signal.SIGTERM, fin)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, fin)
    try:
        while not arret.wait(0.5):
            if moteur.proc and moteur.proc.poll() is not None:
                dire("Le moteur IA s'est arrêté tout seul.", ROUGE)
                break
    finally:
        serveur.shutdown()
        moteur.arreter()
        dire("Moteur arrêté. Tu peux débrancher la clé. ✔", ORANGE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
