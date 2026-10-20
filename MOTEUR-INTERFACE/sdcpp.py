"""
sdcpp.py — Moteur d'images local avec stable-diffusion.cpp (leejet/stable-diffusion.cpp).

Pourquoi : sur Linux, les modèles d'image d'Ollama demandent « MLX » (pas dispo).
stable-diffusion.cpp lit directement les .gguf de type ComfyUI déjà sur la clé :
  - le modèle d'image   : z_image_turbo-*.gguf (ou flux…)
  - le lecteur de texte : Qwen3-4B-*.gguf
  - le décodeur (VAE)   : ae.safetensors   (téléchargé une fois, ~335 Mo)
  - le programme        : sd-cli           (téléchargé une fois, version Vulkan pour Linux)

Tout reste SUR LA CLÉ, dans lexos-ia/images-ia/ (ou MOTEUR-INTERFACE/images-ia/).
Le moteur lance seulement CE programme, avec des arguments fixes (jamais un shell).
"""
from __future__ import annotations

import io
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import tempfile
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

URL_VAE = "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors"
API_SD = "https://api.github.com/repos/leejet/stable-diffusion.cpp/releases/latest"
AGENT = "LexOS-Moteur/1.0"
WINDOWS = os.name == "nt"
RE_DIFFUSION = re.compile(r"z[-_ ]?image|flux|sd3|qwen[-_]?image|chroma|ovis", re.I)
RE_LLM = re.compile(r"qwen3[-_]?4b", re.I)
RE_VAE = re.compile(r"^(ae|.*vae.*)\.(safetensors|sft)$", re.I)


class ErreurSD(Exception):
    pass


def _ouvrir(url: str, timeout: int = 60):
    req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": "*/*"})
    return urllib.request.urlopen(req, timeout=timeout)


def _telecharger_vers(url: str, cible: Path, progres=None, etiquette: str = "") -> None:
    tmp = cible.with_suffix(cible.suffix + ".partiel")
    try:
        with _ouvrir(url, 120) as r, open(tmp, "wb") as f:
            total = int(r.headers.get("Content-Length") or 0)
            recu, dernier = 0, 0.0
            while True:
                m = r.read(1024 * 1024)
                if not m:
                    break
                f.write(m)
                recu += len(m)
                if progres and time.time() - dernier > .25:
                    dernier = time.time()
                    progres({"status": etiquette, "completed": recu, "total": total})
    except OSError as e:
        tmp.unlink(missing_ok=True)
        raise ErreurSD(f"téléchargement impossible ({e}). Vérifie Internet.") from e
    os.replace(tmp, cible)


class MoteurSD:
    def __init__(self, cle: Path, ici: Path, cache: Path):
        self.cle, self.ici, self.cache = cle, ici, cache
        self.verrou = threading.Lock()

    # ── où sont les choses ──
    def dossier(self) -> Path:
        d = self.cle / "lexos-ia" / "images-ia"
        return d if d.is_dir() else self.ici / "images-ia"

    def _fichiers(self) -> list[Path]:
        racines = [self.dossier(), self.cle / "ia-locale-sauvegarde", self.ici / "images-ia"]
        vus, out = set(), []
        for r in racines:
            if not r.is_dir():
                continue
            for base, dossiers, noms in os.walk(r):
                dossiers[:] = [x for x in dossiers if not x.startswith(".") and x != "sdcpp"]
                for n in noms:
                    p = Path(base) / n
                    if p.resolve() not in vus:
                        vus.add(p.resolve()); out.append(p)
        return out

    def trouver(self) -> dict:
        f = self._fichiers()
        d = self.dossier().resolve()
        chez_nous = lambda p: 0 if d in p.resolve().parents else 1          # d'abord lexos-ia/images-ia
        diff = sorted([p for p in f if p.suffix.lower() in (".gguf", ".safetensors") and RE_DIFFUSION.search(p.name)
                       and not RE_VAE.match(p.name) and p.stat().st_size > 300_000_000],
                      key=lambda p: (chez_nous(p), p.stat().st_size))
        llm = sorted([p for p in f if p.suffix.lower() == ".gguf" and RE_LLM.search(p.name) and p.stat().st_size > 300_000_000],
                     key=lambda p: (chez_nous(p), p.stat().st_size))
        vae = [p for p in f if RE_VAE.match(p.name) and p.stat().st_size > 50_000_000]
        return {"diffusion": diff[0] if diff else None, "llm": llm[0] if llm else None,
                "vae": vae[0] if vae else None, "binaire": self._binaire_cle()}

    def _binaires(self) -> list[Path]:
        """Les sd-cli de la clé, du meilleur au secours : carte graphique (Vulkan), puis processeur."""
        d = self.dossier()
        if WINDOWS:
            noms = [d / "windows" / "sd-cli.exe", d / "windows-cpu" / "sd-cli.exe"]
        else:
            noms = [d / "linux" / "sd-cli", d / "linux-cpu" / "sd-cli"]
        noms += sorted((d / "sdcpp").rglob("sd-cli.exe" if WINDOWS else "sd-cli")) if (d / "sdcpp").is_dir() else []
        return [p for p in noms if p.is_file()]

    def _binaire_cle(self) -> Path | None:
        b = self._binaires()
        return b[0] if b else None

    def etat(self) -> dict:
        t = self.trouver()
        rel = lambda p: str(p.relative_to(self.cle)) if p and self.cle in p.parents else (str(p) if p else None)
        manque = [k for k in ("diffusion", "llm", "vae", "binaire") if not t[k]]
        return {"pret": not manque, "manque": manque, **{k: rel(v) for k, v in t.items()},
                "nom": f"Z-Image (stable-diffusion.cpp) · {t['diffusion'].stem}" if t["diffusion"] else None}

    # ── installation des pièces manquantes ──
    def installer(self, progres) -> dict:
        with self.verrou:
            t = self.trouver()
            if not t["diffusion"]:
                raise ErreurSD("aucun modèle d'image .gguf (z_image_turbo…) sur la clé")
            d = self.dossier()
            (d / "modeles").mkdir(parents=True, exist_ok=True)
            if not t["vae"]:
                progres({"status": "décodeur d'image (VAE)"})
                _telecharger_vers(URL_VAE, d / "modeles" / "ae.safetensors", progres, "décodeur d'image (VAE, ~335 Mo)")
            if not t["binaire"]:
                self._installer_binaire(progres)
            if not t["llm"]:
                raise ErreurSD("il manque le lecteur de texte Qwen3-4B (.gguf) sur la clé — "
                               "télécharge Qwen3-4B-Instruct-2507-Q4_K_M.gguf (unsloth) dans lexos-ia/images-ia/modeles")
            return self.etat()

    def _installer_binaire(self, progres) -> None:
        progres({"status": "recherche de stable-diffusion.cpp…"})
        try:
            with _ouvrir(API_SD) as r:
                rel = json.loads(r.read())
        except OSError as e:
            raise ErreurSD(f"GitHub injoignable ({e})") from e
        actifs = {a["name"]: a["browser_download_url"] for a in rel.get("assets", [])}
        if WINDOWS:
            ordre = [r"win-vulkan-x64\.zip$", r"win-cpu-x64\.zip$"]
        elif platform.system() == "Darwin":
            ordre = [r"Darwin.*arm64\.zip$"]
        else:
            ordre = [r"Linux.*x86_64-vulkan\.zip$", r"Linux.*x86_64\.zip$"]
        choix = next((n for motif in ordre for n in actifs if re.search(motif, n)), None)
        if not choix:
            raise ErreurSD("aucune version de stable-diffusion.cpp pour ce système")
        zipf = self.dossier() / "sdcpp.zip"
        _telecharger_vers(actifs[choix], zipf, progres, f"programme {choix}")
        dest = self.dossier() / "sdcpp"
        shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir(parents=True)
        with zipfile.ZipFile(zipf) as z:
            racine = dest.resolve()
            for info in z.infolist():
                f = (racine / info.filename).resolve()
                if racine != f and racine not in f.parents:
                    continue
                if info.is_dir():
                    f.mkdir(parents=True, exist_ok=True); continue
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(z.read(info))
                try:
                    f.chmod(f.stat().st_mode | stat.S_IXUSR)
                except OSError:
                    pass
        zipf.unlink(missing_ok=True)
        (dest / "VERSION.txt").write_text(f"{rel.get('tag_name')} · {choix}\n", "utf-8")
        if not self._binaire_cle():
            raise ErreurSD("le programme sd-cli n'a pas été trouvé dans le zip")

    def _executable(self, b: Path | None = None) -> Path:
        b = b or self._binaire_cle()
        if not b:
            raise ErreurSD("stable-diffusion.cpp n'est pas installé")
        if WINDOWS or (os.access(b, os.X_OK) and self._marche(b)):
            return b
        # clé exFAT sans droit d'exécution : copie du dossier du programme dans le cache du PC
        local = self.cache / ("sdcpp-" + b.parent.name)
        if not (local / b.name).is_file() or (local / b.name).stat().st_size != b.stat().st_size:
            shutil.rmtree(local, ignore_errors=True)
            shutil.copytree(b.parent, local)
            for p in local.iterdir():
                try:
                    p.chmod(p.stat().st_mode | stat.S_IXUSR)
                except OSError:
                    pass
        return local / b.name

    @staticmethod
    def _marche(b: Path) -> bool:
        try:
            subprocess.run([str(b), "--help"], capture_output=True, timeout=20, env=_env_lib(b))
            return True
        except (OSError, subprocess.SubprocessError):
            return False

    # ── créer une image ──
    def generer(self, prompt: str, largeur: int, hauteur: int, etapes: int | None, graine: int | None,
                progres, annule=lambda: False) -> bytes:
        t = self.trouver()
        manque = [k for k in ("diffusion", "llm", "vae") if not t[k]]
        if manque:
            raise ErreurSD("pièces manquantes : " + ", ".join(manque) + " (bouton « Installer » dans 🎨 Images)")
        binaires = self._binaires()
        if not binaires:
            raise ErreurSD("stable-diffusion.cpp n'est pas sur la clé (bouton « Installer » dans 🎨 Images)")
        erreur = None
        for i, b in enumerate(binaires[:2]):
            try:
                if i:
                    progres({"status": "carte graphique indisponible : je passe au processeur (plus lent)…"})
                return self._generer_avec(self._executable(b), t, prompt, largeur, hauteur, etapes, graine, progres, annule)
            except ErreurSD as e:
                if str(e) == "annulé":
                    raise
                erreur = e
        raise erreur

    def _generer_avec(self, exe: Path, t: dict, prompt: str, largeur, hauteur, etapes, graine, progres, annule) -> bytes:
        sortie = Path(tempfile.mkstemp(suffix=".png", prefix="lexos-sd-")[1])
        largeur = max(256, min(int(largeur or 1024), 1536)) // 16 * 16
        hauteur = max(256, min(int(hauteur or 1024), 1536)) // 16 * 16
        args = [str(exe), "--diffusion-model", str(t["diffusion"]), "--llm", str(t["llm"]), "--vae", str(t["vae"]),
                "-p", prompt[:2000], "--cfg-scale", "1.0", "--steps", str(int(etapes or 8)),
                "-W", str(largeur), "-H", str(hauteur), "--seed", str(int(graine if graine is not None else -1)),
                "--offload-to-cpu", "--diffusion-fa", "--vae-tiling", "-o", str(sortie)]
        opts = {"creationflags": 0x08000000} if WINDOWS else {"start_new_session": True}
        p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             env=_env_lib(exe), **opts)
        journal, tampon = [], b""
        total = int(etapes or 8)
        try:
            while True:
                if annule():
                    p.kill()
                    raise ErreurSD("annulé")
                m = p.stdout.read1(4096) if hasattr(p.stdout, "read1") else p.stdout.read(256)
                if not m:
                    break
                tampon += m
                *lignes, tampon = re.split(rb"[\r\n]", tampon)
                for l in lignes:
                    s = l.decode("utf-8", "replace").strip()
                    if not s:
                        continue
                    journal.append(s); journal[:] = journal[-40:]
                    mm = re.search(r"\|\s*(\d+)/(\d+)", s)
                    if mm:
                        progres({"completed": int(mm.group(1)), "total": int(mm.group(2)), "status": "je peins…"})
                    elif "loading" in s.lower() or "load" in s.lower():
                        progres({"status": "chargement des modèles…"})
                    elif "decod" in s.lower():
                        progres({"status": "décodage de l'image…", "completed": total, "total": total})
            code = p.wait(timeout=60)
            if code != 0 or not sortie.is_file() or sortie.stat().st_size == 0:
                raise ErreurSD("stable-diffusion.cpp a échoué :\n" + "\n".join(journal[-8:]))
            return sortie.read_bytes()
        finally:
            if p.poll() is None:
                p.kill()
            sortie.unlink(missing_ok=True)


def _env_lib(exe: Path) -> dict:
    env = dict(os.environ)
    if not WINDOWS:
        env["LD_LIBRARY_PATH"] = str(exe.parent) + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
    return env
