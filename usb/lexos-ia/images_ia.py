#!/usr/bin/env python3
"""Créer des images avec Z-Image Turbo, sur la clé, sans Internet.

Le moteur est stable-diffusion.cpp (sd-cli, licence MIT) et le modèle est
Z-Image Turbo (Alibaba, Apache 2.0 : les images peuvent être vendues).
Tout est dans lexos-ia/images-ia/ :

    images-ia/linux/sd-cli          moteur Linux (carte graphique, Vulkan)
    images-ia/linux-cpu/sd-cli      moteur Linux de secours (processeur seulement)
    images-ia/windows/sd-cli.exe    moteur Windows (Vulkan)
    images-ia/modeles/              z_image_turbo-*.gguf · Qwen3-4B-*.gguf · ae.safetensors

Les images créées vont dans lexos-ia/images/ (avec un .json : texte, taille, graine).
"""
import json
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
import unicodedata
from pathlib import Path

ICI = Path(__file__).resolve().parent
DOSSIER_MOTEUR = ICI / "images-ia"
DOSSIER_IMAGES = ICI / "images"
CACHE = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "lexos-ia"

FORMATS = {  # largeur, hauteur (multiples de 64)
    "carre": (1024, 1024), "portrait": (768, 1152), "paysage": (1152, 768), "rapide": (512, 512),
}
NOM_IMAGE = re.compile(r"^[a-z0-9-]{1,80}\.png$")
PROGRES = re.compile(r"(\d+)/(\d+) - ([\d.]+)(s/it|it/s)")
ERREUR_GPU = re.compile(r"vulkan|libvulkan|error while loading shared libraries|out of memory|VK_ERROR|ggml_vulkan",
                        re.IGNORECASE)

_verrou = threading.Lock()
_choix = {"moteur": None}  # moteur qui a marché la dernière fois


class ErreurImage(Exception):
    pass


# ── Ce qu'il y a sur la clé ──────────────────────────────────────────────
def _premier(motif):
    trouves = sorted((DOSSIER_MOTEUR / "modeles").glob(motif)) if (DOSSIER_MOTEUR / "modeles").is_dir() else []
    return next((f for f in trouves if not f.name.endswith(".part")), None)


def fichiers_modele():
    return {"diffusion": _premier("z_image_turbo*.gguf") or _premier("z_image_turbo*.safetensors"),
            "texte": _premier("Qwen3-4B*.gguf") or _premier("qwen_3_4b*.safetensors"),
            "vae": _premier("ae.safetensors") or _premier("ae.sft")}


def moteurs():
    """Moteurs installés pour ce système, du plus rapide au plus sûr."""
    if os.name == "nt":
        noms = [DOSSIER_MOTEUR / "windows" / "sd-cli.exe", DOSSIER_MOTEUR / "windows-cpu" / "sd-cli.exe"]
    else:
        noms = [DOSSIER_MOTEUR / "linux" / "sd-cli", DOSSIER_MOTEUR / "linux-cpu" / "sd-cli"]
    return [n for n in noms if n.is_file()]


def etat():
    f = fichiers_modele()
    manque = [nom for nom, chemin in f.items() if chemin is None]
    if not moteurs():
        manque.insert(0, "moteur")
    return {"pret": not manque, "manque": manque, "modele": f["diffusion"].name if f["diffusion"] else None,
            "formats": {k: list(v) for k, v in FORMATS.items()}}


def executable(binaire):
    """Clé montée sans droit d'exécution (noexec, exFAT) : on copie le moteur dans le cache du PC."""
    if os.name == "nt" or os.access(binaire, os.X_OK) and _peut_lancer(binaire):
        return binaire
    copie = CACHE / ("images-" + binaire.parent.name)
    if not (copie / binaire.name).is_file() or (copie / binaire.name).stat().st_size != binaire.stat().st_size:
        shutil.rmtree(copie, ignore_errors=True)
        shutil.copytree(binaire.parent, copie)
    for f in copie.iterdir():
        f.chmod(0o755)
    return copie / binaire.name


_lancables = {}


def _peut_lancer(binaire):
    if binaire in _lancables:
        return _lancables[binaire]
    _lancables[binaire] = _essai(binaire)
    return _lancables[binaire]


def _essai(binaire):
    try:
        subprocess.run([str(binaire), "--help"], capture_output=True, timeout=20)
        return True
    except PermissionError:
        return False
    except (OSError, subprocess.TimeoutExpired):
        return True  # autre souci : on verra au vrai lancement


# ── Galerie ──────────────────────────────────────────────────────────────
def lister():
    images = []
    if DOSSIER_IMAGES.is_dir():
        for png in sorted(DOSSIER_IMAGES.glob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True):
            info = {}
            try:
                info = json.loads(png.with_suffix(".json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
            images.append({"nom": png.name, "texte": info.get("texte", ""), "largeur": info.get("largeur"),
                           "hauteur": info.get("hauteur"), "graine": info.get("graine"),
                           "secondes": info.get("secondes"), "date": info.get("date", "")})
    return images


def chemin_image(nom):
    if not NOM_IMAGE.match(nom or ""):
        raise ErreurImage("nom d'image invalide")
    chemin = DOSSIER_IMAGES / nom
    if not chemin.is_file():
        raise ErreurImage("image introuvable")
    return chemin


def supprimer(nom):
    chemin = chemin_image(nom)
    chemin.unlink()
    chemin.with_suffix(".json").unlink(missing_ok=True)


def nom_libre(texte):
    sans_accents = unicodedata.normalize("NFKD", texte.lower()).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-z0-9]+", "-", sans_accents)[:40].strip("-") or "image"
    horodatage = time.strftime("%Y%m%d-%H%M%S")
    nom, n = f"{base}-{horodatage}.png", 2
    while (DOSSIER_IMAGES / nom).exists():
        nom, n = f"{base}-{horodatage}-{n}.png", n + 1
    return nom


# ── Création ─────────────────────────────────────────────────────────────
def commande(binaire, f, texte, largeur, hauteur, etapes, graine, sortie):
    return [str(binaire), "--diffusion-model", str(f["diffusion"]), "--llm", str(f["texte"]),
            "--vae", str(f["vae"]), "-p", texte, "--cfg-scale", "1.0", "--steps", str(etapes),
            "-W", str(largeur), "-H", str(hauteur), "-s", str(graine), "-o", str(sortie),
            "--offload-to-cpu", "--vae-tiling", "--diffusion-fa"]


def _lancer(binaire, cmd, rappel, etapes):
    """Lance sd-cli et transmet l'avancement. Retourne (code, fin du journal)."""
    env = dict(os.environ)
    if os.name != "nt":  # bibliothèques livrées à côté du moteur
        env["LD_LIBRARY_PATH"] = str(binaire.parent) + os.pathsep + env.get("LD_LIBRARY_PATH", "")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env,
                            cwd=str(binaire.parent))
    journal, morceau, phase, dessin_fini = [], b"", "chargement", False
    while True:
        octet = proc.stdout.read(1)
        if not octet:
            break
        if octet not in (b"\r", b"\n"):
            morceau += octet
            continue
        ligne = morceau.decode("utf-8", "replace").strip()
        morceau = b""
        if not ligne:
            continue
        journal = (journal + [ligne])[-40:]
        m = PROGRES.search(ligne)
        if m:  # « |====>   | 3/8 - 1.20s/it » : étapes du dessin, puis tuiles de la finition
            etape, total = int(m.group(1)), int(m.group(2))
            phase = "finition" if dessin_fini or total != etapes else "dessin"
            dessin_fini = dessin_fini or (phase == "dessin" and etape == total)
            rappel({"progres": {"etape": etape, "total": total, "phase": phase}})
        elif re.search(r"[MG]B/s", ligne) and phase == "chargement":
            rappel({"progres": {"phase": "chargement"}})
    proc.stdout.close()
    return proc.wait(), "\n".join(journal)


def liberer_carte_graphique(ia):
    """Décharge les modèles d'Ollama de la carte graphique pour laisser la place à l'image."""
    try:
        with ia._requete("/api/ps", None, delai=5) as r:
            charges = json.loads(r.read() or b"{}").get("models", [])
        for m in charges:
            with ia._requete("/api/generate", {"model": m.get("name"), "keep_alive": 0}, delai=30) as r:
                r.read()
    except Exception:  # noqa: BLE001 — sans Ollama, on dessine quand même
        pass


def creer(texte, format_="carre", etapes=8, graine=None, rappel=lambda o: None, ia=None):
    """Crée une image. Retourne son info (nom, taille, graine…)."""
    texte = (texte or "").strip()
    if not texte:
        raise ErreurImage("décris l'image à créer")
    if len(texte) > 2000:
        raise ErreurImage("description trop longue (2000 caractères max)")
    largeur, hauteur = FORMATS.get(format_, FORMATS["carre"])
    etapes = max(1, min(int(etapes or 8), 30))
    graine = int(graine) if str(graine or "").lstrip("-").isdigit() else random.randint(0, 2**31 - 1)
    f = fichiers_modele()
    if not all(f.values()) or not moteurs():
        raise ErreurImage("le moteur d'images n'est pas sur la clé : relance installer-sur-cle.sh avec --images")
    if not _verrou.acquire(blocking=False):
        raise ErreurImage("une image est déjà en train d'être créée, attends qu'elle finisse")
    try:
        if ia is not None:
            rappel({"info": "Je libère la carte graphique…"})
            liberer_carte_graphique(ia)
        DOSSIER_IMAGES.mkdir(parents=True, exist_ok=True)
        nom = nom_libre(texte)
        sortie = DOSSIER_IMAGES / nom
        essais = moteurs()
        if _choix["moteur"] in essais:  # celui qui a marché passe en premier
            essais.remove(_choix["moteur"])
            essais.insert(0, _choix["moteur"])
        debut, journal = time.monotonic(), ""
        for i, binaire in enumerate(essais):
            rappel({"info": "Chargement de Z-Image Turbo" + (" (mode processeur, plus lent)" if "cpu" in binaire.parent.name else "") + "…"})
            try:
                lanceur = executable(binaire)
            except OSError as e:
                journal = str(e)
                continue
            code, journal = _lancer(lanceur, commande(lanceur, f, texte, largeur, hauteur, etapes, graine, sortie), rappel, etapes)
            if code == 0 and sortie.is_file():
                _choix["moteur"] = binaire
                break
            if i + 1 < len(essais) and (ERREUR_GPU.search(journal) or code != 0):
                rappel({"info": "La carte graphique n'a pas marché, j'essaie avec le processeur…"})
                continue
        if not sortie.is_file():
            derniere = [l for l in journal.splitlines() if l.strip()][-3:]
            raise ErreurImage("le moteur d'images a échoué. " + " / ".join(derniere)[:400])
        info = {"nom": nom, "texte": texte, "largeur": largeur, "hauteur": hauteur, "graine": graine,
                "etapes": etapes, "secondes": round(time.monotonic() - debut, 1),
                "date": time.strftime("%Y-%m-%d %H:%M"), "modele": f["diffusion"].name}
        sortie.with_suffix(".json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
        return info
    finally:
        _verrou.release()


if __name__ == "__main__":  # essai rapide : python3 images_ia.py "un chat orange"
    print(json.dumps(etat(), indent=2, ensure_ascii=False))
    if len(sys.argv) > 1:
        print(creer(" ".join(sys.argv[1:]), "rapide", rappel=print))
