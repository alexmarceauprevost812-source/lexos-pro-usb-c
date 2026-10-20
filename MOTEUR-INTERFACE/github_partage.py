"""Partager un projet de la clé sur GitHub, avec le jeton GITHUB_TOKEN du coffre.

Crée le dépôt (ou le réutilise) et envoie TOUS les fichiers du projet en un seul
commit, par l'API Git Data de GitHub. Pas besoin de git installé sur le PC.
Le jeton reste côté moteur (coffre chiffré) : il n'est jamais envoyé à l'interface.
"""
from __future__ import annotations

import base64
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.github.com"
JETON_OK = re.compile(r"^(gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})$")
NOM_DEPOT = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
IGNORER = {".git", ".venv", "venv", "node_modules", "__pycache__", "deps", "blobs",
           "lib", "dist", "build", "site-packages", ".avant-codex"}
MAX_FICHIER = 50 * 1024 * 1024
MAX_TOTAL = 400 * 1024 * 1024
MAX_N = 3000


class ErreurGitHub(Exception):
    pass


def jeton_du_coffre() -> str:
    j = os.environ.get("GITHUB_TOKEN", "").strip()
    return j if JETON_OK.match(j) else ""


def _api(methode: str, chemin: str, jeton: str, corps: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        API + chemin, method=methode,
        data=json.dumps(corps).encode() if corps is not None else None,
        headers={"Authorization": f"Bearer {jeton}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "LexOS-Moteur",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}
    except (urllib.error.URLError, OSError) as e:
        raise ErreurGitHub(f"GitHub ne répond pas (Internet ?) : {e}") from None


def _fichiers(projet: Path) -> list[tuple[str, Path]]:
    out, total = [], 0
    for racine, dossiers, noms in os.walk(projet):
        dossiers[:] = sorted(d for d in dossiers if d not in IGNORER and not d.startswith("."))
        for nom in sorted(noms):
            if nom.endswith(".avant-codex") or nom.startswith("."):
                continue
            f = Path(racine) / nom
            try:
                taille = f.stat().st_size
            except OSError:
                continue
            if taille > MAX_FICHIER:
                continue
            total += taille
            if total > MAX_TOTAL or len(out) >= MAX_N:
                raise ErreurGitHub("projet trop gros pour l'envoi d'un coup.")
            out.append((f.relative_to(projet).as_posix(), f))
    return out


def partager(projet: Path, nom_depot: str, prive: bool, message: str, progres=None):
    """Envoie le projet sur GitHub. `progres(dict)` suit l'avancement.
    Retourne {url, login, depot, fichiers} à la fin."""
    def dire(**e):
        if progres:
            progres(e)
    jeton = jeton_du_coffre()
    if not jeton:
        raise ErreurGitHub("Ajoute d'abord ton jeton GitHub : 🔑 Variables → variable globale "
                           "GITHUB_TOKEN (jeton « fine-grained » avec Contents et Administration en écriture).")
    depot = (nom_depot or projet.name).strip()
    if not NOM_DEPOT.match(depot):
        raise ErreurGitHub("nom de dépôt invalide (lettres, chiffres, - _ .).")

    code, moi = _api("GET", "/user", jeton)
    if code == 401:
        raise ErreurGitHub("GitHub refuse le jeton (expiré ou mal copié). Refais-en un dans 🔑 Variables.")
    login = moi.get("login")
    if code != 200 or not login:
        raise ErreurGitHub(f"GitHub a répondu {code} : {moi.get('message', '')}")
    dire(type="info", texte=f"Compte GitHub : {login}")

    fichiers = _fichiers(projet)
    if not fichiers:
        raise ErreurGitHub("le projet est vide : rien à envoyer.")

    # 1) le dépôt (créer, ou réutiliser s'il existe déjà)
    code, rep = _api("POST", "/user/repos", jeton,
                     {"name": depot, "private": bool(prive), "description": "Projet LexOS (clé USB-C)"})
    if code == 201:
        dire(type="info", texte=f"Dépôt créé : {login}/{depot}")
        branche = rep.get("default_branch") or "main"
    elif code == 422 and "already exists" in json.dumps(rep):
        _, infos = _api("GET", f"/repos/{login}/{depot}", jeton)
        branche = infos.get("default_branch") or "main"
        dire(type="info", texte=f"Dépôt existant : {login}/{depot} (on ajoute un commit)")
    elif code in (401, 403):
        raise ErreurGitHub("Le jeton n'a pas le droit de créer un dépôt : donne-lui « Administration » "
                           "et « Contents » en écriture (Repository permissions).")
    else:
        raise ErreurGitHub(f"GitHub a répondu {code} : {rep.get('message', '')}")

    depot_url = f"/repos/{login}/{depot}"

    # 2) un blob par fichier
    arbre = []
    for i, (rel, f) in enumerate(fichiers):
        dire(type="progres", n=i + 1, total=len(fichiers), fichier=rel)
        contenu = base64.b64encode(f.read_bytes()).decode()
        code, blob = _api("POST", f"{depot_url}/git/blobs", jeton, {"content": contenu, "encoding": "base64"})
        if code != 201 or "sha" not in blob:
            raise ErreurGitHub(f"envoi de {rel} refusé ({code}) : {blob.get('message', '')}")
        arbre.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})

    # 3) commit déjà là ? (dépôt non vide)
    code, ref = _api("GET", f"{depot_url}/git/ref/heads/{branche}", jeton)
    parents, base_tree = [], None
    if code == 200 and isinstance(ref.get("object"), dict):
        parent = ref["object"]["sha"]
        parents = [parent]
        _, com = _api("GET", f"{depot_url}/git/commits/{parent}", jeton)
        base_tree = (com.get("tree") or {}).get("sha")

    dire(type="info", texte="Je prépare le commit…")
    corps_arbre = {"tree": arbre}
    if base_tree:
        corps_arbre["base_tree"] = base_tree
    code, tree = _api("POST", f"{depot_url}/git/trees", jeton, corps_arbre)
    if code != 201 or "sha" not in tree:
        raise ErreurGitHub(f"arbre refusé ({code}) : {tree.get('message', '')}")

    code, commit = _api("POST", f"{depot_url}/git/commits", jeton,
                        {"message": (message or "Envoi depuis LexOS Moteur").strip()[:200],
                         "tree": tree["sha"], "parents": parents})
    if code != 201 or "sha" not in commit:
        raise ErreurGitHub(f"commit refusé ({code}) : {commit.get('message', '')}")

    # 4) placer la branche sur ce commit
    if parents:
        code, maj = _api("PATCH", f"{depot_url}/git/refs/heads/{branche}", jeton,
                         {"sha": commit["sha"], "force": False})
    else:
        code, maj = _api("POST", f"{depot_url}/git/refs", jeton,
                         {"ref": f"refs/heads/{branche}", "sha": commit["sha"]})
    if code not in (200, 201):
        raise ErreurGitHub(f"mise à jour de la branche refusée ({code}) : {maj.get('message', '')}")

    return {"url": f"https://github.com/{login}/{depot}", "login": login, "depot": depot,
            "fichiers": len(fichiers), "branche": branche, "prive": bool(prive)}
