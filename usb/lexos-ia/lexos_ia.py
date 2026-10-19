#!/usr/bin/env python3
"""LexOS IA — Chat, Codex et CodexTerminal avec des IA 100 % locales.

Les modèles et le moteur (Ollama) vivent sur la clé USB-C LexOS.
ACTIVER-IA démarre le moteur depuis la clé puis lance ce programme.

Usage :  python3 lexos_ia.py [chat | codex | codexterminal | modeles]

Aucune dépendance : Python 3.8+ seulement (bibliothèque standard).
"""
import datetime
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

try:  # historique des commandes (flèches haut/bas) sous Linux/macOS
    import readline  # noqa: F401
except ImportError:
    pass

VERSION = "0.1.0"
ICI = Path(__file__).resolve().parent          # dossier lexos-ia/ sur la clé
FICHIER_CONFIG = ICI / "config.json"
DOSSIER_CONVERSATIONS = ICI / "conversations"

# --------------------------------------------------------------------------
# Couleurs du thème LexOS : logo orange, IA en vert, toi en blanc
# --------------------------------------------------------------------------
if os.name == "nt":
    os.system("")  # active les couleurs ANSI dans la console Windows

_COULEURS = sys.stdout.isatty() and not os.environ.get("NO_COLOR")


def _c(code):
    return code if _COULEURS else ""


ORANGE = _c("\033[38;2;224;96;32m")
VERT = _c("\033[38;2;53;214;76m")
BLANC = _c("\033[97m")
GRIS = _c("\033[90m")
ROUGE = _c("\033[91m")
JAUNE = _c("\033[93m")
GRAS = _c("\033[1m")
RAZ = _c("\033[0m")

LOGO = r"""
 ██╗     ███████╗██╗  ██╗ ██████╗ ███████╗    ██╗ █████╗
 ██║     ██╔════╝╚██╗██╔╝██╔═══██╗██╔════╝    ██║██╔══██╗
 ██║     █████╗   ╚███╔╝ ██║   ██║███████╗    ██║███████║
 ██║     ██╔══╝   ██╔██╗ ██║   ██║╚════██║    ██║██╔══██║
 ███████╗███████╗██╔╝ ██╗╚██████╔╝███████║    ██║██║  ██║
 ╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝    ╚═╝╚═╝  ╚═╝"""


def afficher(texte="", couleur=""):
    print(f"{couleur}{texte}{RAZ}" if couleur else texte, flush=True)


def titre(nom, modele=None):
    afficher()
    ligne = f"━━ {nom} " + (f"· {modele} " if modele else "")
    afficher(ligne + "━" * max(3, 60 - len(ligne)), ORANGE + GRAS)


def lire(invite="› "):
    """Lit une ligne tapée par l'utilisateur (texte en blanc)."""
    try:
        return input(f"{ORANGE}{invite}{RAZ}{BLANC}").strip()
    except EOFError:
        return "/quitter"
    finally:
        print(RAZ, end="", flush=True)


# --------------------------------------------------------------------------
# Connexion au moteur Ollama de la clé (jamais par Internet)
# --------------------------------------------------------------------------
class ErreurIA(Exception):
    pass


_OUVREUR = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # ignore les proxys


def hote():
    return os.environ.get("LEXOS_IA_HOTE", "127.0.0.1:11434")


def _requete(chemin, donnees=None, methode=None, delai=10):
    corps = json.dumps(donnees).encode() if donnees is not None else None
    req = urllib.request.Request(
        f"http://{hote()}{chemin}", data=corps,
        method=methode or ("POST" if corps is not None else "GET"),
        headers={"Content-Type": "application/json"})
    try:
        return _OUVREUR.open(req, timeout=delai)
    except urllib.error.HTTPError as e:
        try:
            message = json.loads(e.read().decode()).get("error", str(e))
        except Exception:
            message = str(e)
        raise ErreurIA(message) from None
    except (urllib.error.URLError, OSError) as e:
        raise ErreurIA(f"moteur IA inaccessible sur {hote()} ({e})") from None


def ia_disponible():
    try:
        with _requete("/api/version", delai=3):
            return True
    except ErreurIA:
        return False


def attendre_ia(delai=90):
    """Attend que le moteur réponde (il peut être en train de démarrer)."""
    import time
    fin = time.monotonic() + delai
    if ia_disponible():
        return True
    print(f"{GRIS}Le moteur IA démarre…{RAZ} ", end="", flush=True)
    while time.monotonic() < fin:
        time.sleep(1)
        if ia_disponible():
            print(f"{VERT}prêt ✔{RAZ}", flush=True)
            return True
        print(".", end="", flush=True)
    print(flush=True)
    return False


def modeles_installes():
    """Liste des modèles présents sur la clé : [{'name':..., 'size':...}, ...]."""
    with _requete("/api/tags") as r:
        return json.load(r).get("models", [])


def flux(chemin, donnees, delai=900):
    """Envoie une requête et renvoie les objets JSON au fur et à mesure."""
    with _requete(chemin, donnees, delai=delai) as r:
        for ligne in r:
            ligne = ligne.strip()
            if not ligne:
                continue
            obj = json.loads(ligne)
            if obj.get("error"):
                raise ErreurIA(obj["error"])
            yield obj


# --------------------------------------------------------------------------
# Les modèles qui « réfléchissent » (qwen3, deepseek-r1) écrivent parfois
# <think>…</think> : on cache cette partie et on montre seulement la réponse.
# --------------------------------------------------------------------------
def _debut_partiel(texte, balise):
    """Nombre de caractères à la fin de `texte` qui pourraient commencer `balise`."""
    for k in range(min(len(balise) - 1, len(texte)), 0, -1):
        if texte.endswith(balise[:k]):
            return k
    return 0


class FiltreReflexion:
    OUVRE, FERME = "<think>", "</think>"

    def __init__(self):
        self.dedans = False
        self.tampon = ""

    def nourrir(self, morceau):
        """Ajoute un morceau reçu et renvoie le texte visible à afficher."""
        self.tampon += morceau
        visible = ""
        while True:
            if not self.dedans:
                i = self.tampon.find(self.OUVRE)
                if i >= 0:
                    visible += self.tampon[:i]
                    self.tampon = self.tampon[i + len(self.OUVRE):]
                    self.dedans = True
                    continue
                garde = _debut_partiel(self.tampon, self.OUVRE)
                coupe = len(self.tampon) - garde
                visible += self.tampon[:coupe]
                self.tampon = self.tampon[coupe:]
                return visible
            i = self.tampon.find(self.FERME)
            if i >= 0:
                self.tampon = self.tampon[i + len(self.FERME):]
                self.dedans = False
                continue
            garde = _debut_partiel(self.tampon, self.FERME)
            self.tampon = self.tampon[len(self.tampon) - garde:]
            return visible

    def fin(self):
        reste = "" if self.dedans else self.tampon
        self.tampon = ""
        return reste


def discuter(modele, messages, afficher_reponse=True):
    """Envoie la conversation au modèle et affiche la réponse en vert,
    caractère par caractère. Ctrl+C coupe la réponse. Renvoie le texte."""
    filtre = FiltreReflexion()
    morceaux = []
    reflexion_annoncee = False
    debut = True

    def montrer(texte):
        nonlocal debut
        if not texte:
            return
        if debut:  # pas de lignes vides au début de la réponse
            texte = texte.lstrip("\n")
            if not texte:
                return
            debut = False
        morceaux.append(texte)
        if afficher_reponse:
            print(f"{VERT}{texte}{RAZ}", end="", flush=True)

    try:
        for obj in flux("/api/chat", {"model": modele, "messages": messages, "stream": True}):
            msg = obj.get("message") or {}
            dans_reflexion = bool(msg.get("thinking")) or filtre.dedans
            if dans_reflexion and not reflexion_annoncee and afficher_reponse and debut:
                print(f"{GRIS}(l'IA réfléchit…){RAZ} ", end="", flush=True)
                reflexion_annoncee = True
            montrer(filtre.nourrir(msg.get("content") or ""))
            if obj.get("done"):
                break
        montrer(filtre.fin())
    except KeyboardInterrupt:
        morceaux.append(" [coupé]")
        if afficher_reponse:
            print(f"{GRIS} [coupé]{RAZ}", end="")
    if afficher_reponse:
        print(flush=True)
    return "".join(morceaux).strip()


# --------------------------------------------------------------------------
# Choix des modèles (sauvegardé sur la clé dans config.json)
# --------------------------------------------------------------------------
PREFERENCES = {
    # du meilleur au plus léger — le premier modèle installé est choisi
    "chat": ["qwen3:8b", "qwen3", "llama3.2", "gemma3", "mistral", "phi"],
    "codex": ["qwen2.5-coder:7b", "qwen2.5-coder", "qwen3-coder", "deepseek-coder",
              "codellama", "codegemma"],
}
PREFERENCES_GROS_PC = {  # 28 Go de mémoire vive ou plus : le gros modèle (≈ 18 Go) passe en premier
    "chat": ["gemma4:26b", "gemma4:31b", "qwen3:30b"],
    "codex": ["qwen3-coder:30b"],
}
PREFERENCES_PETIT_PC = {  # moins de 12 Go de mémoire vive : on commence léger
    "chat": ["llama3.2", "qwen3:4b", "gemma3", "qwen3"],
    "codex": ["qwen2.5-coder:1.5b", "qwen2.5-coder:3b", "qwen2.5-coder"],
}


def nom_complet(nom):
    return nom if ":" in nom else nom + ":latest"


def ram_go():
    try:
        with open("/proc/meminfo") as f:
            for ligne in f:
                if ligne.startswith("MemTotal:"):
                    return int(ligne.split()[1]) / 1024 / 1024
    except OSError:
        return None
    return None


def charger_config():
    try:
        return json.loads(FICHIER_CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def sauver_config(config):
    try:
        FICHIER_CONFIG.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError as e:
        afficher(f"Impossible d'écrire la config sur la clé : {e}", ROUGE)


def choisir_modele(role, installes, config=None, ram=None):
    """Modèle à utiliser pour 'chat' ou 'codex' parmi les noms installés."""
    if not installes:
        return None
    voulu = (config or {}).get(role)
    if voulu:
        for nom in installes:
            if nom_complet(nom) == nom_complet(voulu):
                return nom
    ordre = list(PREFERENCES[role])
    if ram is not None and ram < 12:
        ordre = PREFERENCES_PETIT_PC[role] + ordre
    elif ram is not None and ram >= 28:
        ordre = PREFERENCES_GROS_PC[role] + ordre
    for prefixe in ordre:
        for nom in installes:
            if nom.startswith(prefixe):
                return nom
    return installes[0]


def demander_modele(installes, actuel):
    afficher("Modèles sur la clé :", GRIS)
    for i, nom in enumerate(installes, 1):
        marque = " ◂ actuel" if nom == actuel else ""
        afficher(f"  {i}  {nom}{marque}")
    choix = lire("numéro (Entrée = garder) › ")
    if choix.isdigit() and 1 <= int(choix) <= len(installes):
        return installes[int(choix) - 1]
    return actuel


# --------------------------------------------------------------------------
# Outils communs
# --------------------------------------------------------------------------
def chemin_libre(dossier, base, extension):
    """Chemin qui n'écrase jamais un fichier existant."""
    dossier.mkdir(parents=True, exist_ok=True)
    chemin = dossier / f"{base}{extension}"
    n = 2
    while chemin.exists():
        chemin = dossier / f"{base}-{n}{extension}"
        n += 1
    return chemin


def sauver_conversation(nom_mode, modele, messages):
    date = datetime.datetime.now().strftime("%Y-%m-%d_%Hh%M")
    chemin = chemin_libre(DOSSIER_CONVERSATIONS, f"{date}-{nom_mode}", ".md")
    lignes = [f"# LexOS IA — {nom_mode} ({modele})", ""]
    for m in messages:
        if m["role"] == "system":
            continue
        qui = "Toi" if m["role"] == "user" else "IA"
        lignes += [f"**{qui} :**", "", m["content"], ""]
    chemin.write_text("\n".join(lignes), encoding="utf-8")
    return chemin


AIDE_COMMUNE = [
    ("/modele", "changer de modèle"),
    ("/nouveau", "nouvelle conversation"),
    ("/sauver", "sauver la conversation sur la clé"),
    ("/aide", "voir les commandes"),
    ("/quitter", "retour au menu  (Ctrl+C coupe une réponse)"),
]


def montrer_aide(lignes):
    for cmd, desc in lignes:
        afficher(f"  {ORANGE}{cmd:<16}{RAZ}{GRIS}{desc}{RAZ}")


def commande_commune(entree, etat, nom_mode, systeme):
    """Gère les commandes partagées. Renvoie 'quitter', True (gérée) ou False."""
    cmd = entree.split()[0].lower() if entree else ""
    if cmd in ("/quitter", "/q", "/menu", "/exit"):
        return "quitter"
    if cmd == "/modele":
        etat["modele"] = demander_modele(etat["installes"], etat["modele"])
        afficher(f"Modèle : {etat['modele']}", GRIS)
        return True
    if cmd == "/nouveau":
        etat["messages"] = [{"role": "system", "content": systeme()}]
        afficher("Nouvelle conversation.", GRIS)
        return True
    if cmd == "/sauver":
        chemin = sauver_conversation(nom_mode, etat["modele"], etat["messages"])
        afficher(f"Sauvé : {chemin}", GRIS)
        return True
    return False


# --------------------------------------------------------------------------
# 1. CHAT
# --------------------------------------------------------------------------
def systeme_chat():
    return ("Tu es LexOS IA, un assistant qui fonctionne 100 % hors ligne depuis une clé USB-C "
            "LexOS. Réponds en français québécois clair et naturel (ou dans la langue de "
            "l'utilisateur s'il en change). Sois direct et concis.")


def mode_chat(etat):
    etat["modele"] = choisir_modele("chat", etat["installes"], etat["config"], ram_go())
    titre("Chat", etat["modele"])
    montrer_aide(AIDE_COMMUNE)
    etat["messages"] = [{"role": "system", "content": systeme_chat()}]
    while True:
        afficher()
        entree = lire("toi › ")
        if not entree:
            continue
        if entree.startswith("/"):
            r = commande_commune(entree, etat, "chat", systeme_chat)
            if r == "quitter":
                return
            if r is not True:
                montrer_aide(AIDE_COMMUNE)
            continue
        etat["messages"].append({"role": "user", "content": entree})
        try:
            reponse = discuter(etat["modele"], etat["messages"])
        except ErreurIA as e:
            afficher(f"Erreur IA : {e}", ROUGE)
            etat["messages"].pop()
            continue
        etat["messages"].append({"role": "assistant", "content": reponse})


# --------------------------------------------------------------------------
# 2. CODEX — écrire, expliquer et corriger du code
# --------------------------------------------------------------------------
_BLOC = re.compile(
    r"(?:^|\n)[ \t]*(?:[*#>\- ]*(?:Fichier|File)\**\s*:\s*\**\s*`?(?P<chemin>[^\n`*]+?)`?\**[ \t]*\n+)?"
    r"```(?P<langue>[\w+.#-]*)[^\n]*\n(?P<code>.*?)```",
    re.S | re.I)


def extraire_blocs(texte):
    """Blocs de code d'une réponse : [(chemin ou None, langue, code), ...]."""
    return [(m.group("chemin").strip() if m.group("chemin") else None,
             m.group("langue").lower(), m.group("code"))
            for m in _BLOC.finditer(texte)]


def systeme_codex(dossier):
    return ("Tu es Codex de LexOS, un expert en programmation qui fonctionne hors ligne. "
            "Tu aides à écrire, expliquer, corriger et améliorer du code. Réponds en français. "
            "Quand tu donnes un fichier complet, écris juste avant son bloc de code une ligne "
            "« Fichier: chemin/relatif/du/fichier » puis le bloc ```langage complet, sans couper. "
            f"Dossier de travail : {dossier}")


AIDE_CODEX = [
    ("/lire FICHIER", "donner un fichier à lire à Codex"),
    ("/dossier", "montrer à Codex les fichiers du dossier"),
    ("/cd DOSSIER", "changer de dossier de travail"),
    ("/ecrire [CHEMIN]", "écrire le code de la dernière réponse (avec ta permission)"),
] + AIDE_COMMUNE

LIMITE_FICHIER = 60_000


def lister_dossier(dossier, limite=200):
    ignores = {".git", "__pycache__", "node_modules", ".venv", "venv", "dist", "build"}
    noms = []
    for racine, dossiers, fichiers in os.walk(dossier):
        dossiers[:] = sorted(d for d in dossiers if d not in ignores and not d.startswith("."))
        for f in sorted(fichiers):
            noms.append(os.path.relpath(os.path.join(racine, f), dossier))
            if len(noms) >= limite:
                return noms + ["… (liste coupée)"]
    return noms


def ecrire_fichier(chemin, code, dossier, demander=lire):
    """Écrit un fichier après confirmation. Ancienne version gardée en .bak."""
    cible = (Path(dossier) / chemin).resolve()
    afficher(f"\n→ {cible}  ({len(code.splitlines())} lignes)", ORANGE)
    if not str(cible).startswith(str(Path(dossier).resolve())):
        afficher("Attention : en dehors du dossier de travail.", JAUNE)
    if demander("écrire ce fichier ? [o/N] › ").lower() not in ("o", "oui", "y"):
        afficher("Pas écrit.", GRIS)
        return False
    cible.parent.mkdir(parents=True, exist_ok=True)
    if cible.exists():
        sauvegarde = cible.with_name(cible.name + datetime.datetime.now().strftime(".bak-%Y%m%d-%H%M%S"))
        cible.replace(sauvegarde)
        afficher(f"Ancienne version gardée : {sauvegarde.name}", GRIS)
    cible.write_text(code, encoding="utf-8")
    afficher("Écrit ✔", VERT)
    return True


def mode_codex(etat):
    etat["modele"] = choisir_modele("codex", etat["installes"], etat["config"], ram_go())
    titre("Codex", etat["modele"])
    afficher(f"Dossier : {etat['dossier']}", GRIS)
    montrer_aide(AIDE_CODEX)
    etat["messages"] = [{"role": "system", "content": systeme_codex(etat["dossier"])}]
    derniere = ""
    while True:
        afficher()
        entree = lire("codex › ")
        if not entree:
            continue
        if entree.startswith("/"):
            cmd, _, arg = entree.partition(" ")
            arg = arg.strip()
            cmd = cmd.lower()
            if cmd == "/lire" and arg:
                f = (Path(etat["dossier"]) / os.path.expanduser(arg)).resolve()
                try:
                    contenu = f.read_text(encoding="utf-8", errors="replace")
                except OSError as e:
                    afficher(f"Impossible de lire : {e}", ROUGE)
                    continue
                coupe = len(contenu) > LIMITE_FICHIER
                contenu = contenu[:LIMITE_FICHIER]
                etat["messages"].append({"role": "user", "content":
                    f"Voici le fichier {arg} :\n```\n{contenu}\n```" + ("\n(fichier coupé)" if coupe else "")})
                etat["messages"].append({"role": "assistant", "content": f"J'ai lu {arg}."})
                afficher(f"Codex a lu {arg} ({len(contenu.splitlines())} lignes)" + (" — coupé" if coupe else ""), GRIS)
            elif cmd == "/dossier":
                liste = "\n".join(lister_dossier(etat["dossier"]))
                etat["messages"].append({"role": "user", "content": f"Fichiers du dossier {etat['dossier']} :\n{liste}"})
                etat["messages"].append({"role": "assistant", "content": "Je vois les fichiers."})
                afficher(liste or "(dossier vide)", GRIS)
            elif cmd == "/cd" and arg:
                nouveau = (Path(etat["dossier"]) / os.path.expanduser(arg)).resolve()
                if nouveau.is_dir():
                    etat["dossier"] = str(nouveau)
                    afficher(f"Dossier : {nouveau}", GRIS)
                else:
                    afficher("Ce dossier n'existe pas.", ROUGE)
            elif cmd == "/ecrire":
                blocs = extraire_blocs(derniere)
                if not blocs:
                    afficher("Aucun bloc de code dans la dernière réponse.", GRIS)
                elif arg:
                    ecrire_fichier(arg, blocs[-1][2], etat["dossier"])
                elif any(b[0] for b in blocs):
                    for chemin, _, code in blocs:
                        if chemin:
                            ecrire_fichier(chemin, code, etat["dossier"])
                else:
                    afficher("Donne un nom :  /ecrire nom-du-fichier.py", GRIS)
            else:
                r = commande_commune(entree, etat, "codex", lambda: systeme_codex(etat["dossier"]))
                if r == "quitter":
                    return
                if r is not True:
                    montrer_aide(AIDE_CODEX)
            continue
        etat["messages"].append({"role": "user", "content": entree})
        try:
            derniere = discuter(etat["modele"], etat["messages"])
        except ErreurIA as e:
            afficher(f"Erreur IA : {e}", ROUGE)
            etat["messages"].pop()
            continue
        etat["messages"].append({"role": "assistant", "content": derniere})
        if extraire_blocs(derniere):
            afficher("(/ecrire pour enregistrer ce code)", GRIS)


# --------------------------------------------------------------------------
# 3. CODEXTERMINAL — l'IA travaille dans le terminal, avec ta permission
# --------------------------------------------------------------------------
LANGUES_SHELL = {"", "bash", "sh", "shell", "zsh", "console", "terminal", "cmd", "bat",
                 "powershell", "ps1", "pwsh"}

MOTIFS_SENSIBLES = [
    r"\bsudo\b", r"\bsu\s", r"\brm\s+-\w*[rR]", r"\brm\s+.*\*", r"\bmkfs", r"\bdd\b",
    r"\bshred\b", r"\bwipefs\b", r"\bfdisk\b", r"\bparted\b", r">\s*/dev/(sd|nvme|mmc)",
    r":\(\)\s*\{", r"\bchmod\s+-R\b", r"\bchown\s+-R\b", r"\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?\w*sh\b",
    r"\b(shutdown|reboot|poweroff|halt)\b", r"\bkill\s+-9\s+-?1\b", r"\bgit\s+push\b.*--force",
    r"\bgit\s+reset\s+--hard", r"\bdel\s+/[sq]", r"\brmdir\s+/s", r"\bformat\s+[a-z]:",
    r"Remove-Item\b.*-Recurse", r"\bmv\s+.*\s/(\s|$)",
]


def est_sensible(commande):
    """Vrai si la commande peut casser quelque chose (il faudra taper OUI)."""
    return any(re.search(m, commande, re.I) for m in MOTIFS_SENSIBLES)


def extraire_commande(reponse):
    """Première commande proposée par l'IA, ou None si la tâche est finie."""
    if reponse.lstrip().upper().startswith("FINI"):
        return None
    for _, langue, code in extraire_blocs(reponse):
        if langue in LANGUES_SHELL and code.strip():
            return code.strip()
    return None


def shell_courant():
    if os.name == "nt":
        return "cmd.exe (Windows)"
    return os.environ.get("SHELL", "/bin/sh")


def systeme_codexterminal(dossier):
    return (
        "Tu es CodexTerminal de LexOS, un agent IA local qui accomplit des tâches en exécutant "
        "des commandes dans le terminal. Réponds en français.\n"
        f"Système : {platform.system()} {platform.release()} · shell : {shell_courant()} · "
        f"dossier : {dossier}\n\n"
        "À CHAQUE tour : une phrase courte qui dit ce que tu fais, puis UN SEUL bloc :\n"
        "```bash\nla commande\n```\n"
        "L'utilisateur approuve chaque commande ; tu reçois ensuite le code de sortie et la sortie. "
        "Analyse le résultat avant la prochaine commande.\n"
        "Quand la tâche est terminée (ou impossible), n'écris AUCUN bloc de code et commence ta "
        "réponse par « FINI: » suivi d'un court résumé.\n"
        "Règles : commandes non interactives seulement (pas de nano, vim, top, less ; utilise "
        "-y seulement quand c'est sans danger) ; une étape à la fois (tu peux enchaîner avec &&) ; "
        "pour créer un fichier, utilise cat <<'EOF' > fichier ; pas de sudo sauf si vraiment "
        "nécessaire ; n'efface rien que la tâche ne demande pas.")


LIMITE_SORTIE = 8_000
MAX_ETAPES = 15


def executer(commande, dossier, delai=180):
    """Exécute une commande et renvoie (code, sortie). `cd X` seul change de dossier."""
    m = re.fullmatch(r"cd\s+(.+)", commande.strip())
    if m and "&&" not in commande and ";" not in commande:
        cible = (Path(dossier) / os.path.expanduser(m.group(1).strip("'\""))).resolve()
        if cible.is_dir():
            return 0, f"(dossier : {cible})", str(cible)
        return 1, f"cd : {cible} n'existe pas", dossier
    try:
        r = subprocess.run(commande, shell=True, cwd=dossier, stdin=subprocess.DEVNULL,
                           capture_output=True, text=True, errors="replace", timeout=delai)
        return r.returncode, (r.stdout + r.stderr).strip(), dossier
    except subprocess.TimeoutExpired as e:
        sortie = e.stdout or ""
        if isinstance(sortie, bytes):
            sortie = sortie.decode("utf-8", "replace")
        return 124, sortie + f"\n(arrêtée après {delai} s)", dossier


def tache_codexterminal(tache, etat, demander=lire):
    """Boucle de l'agent pour une tâche. Chaque commande demande ta permission."""
    etat["messages"].append({"role": "user", "content": f"TÂCHE : {tache}"})
    for etape in range(1, MAX_ETAPES + 1):
        afficher(f"\n{GRIS}[étape {etape}]{RAZ}")
        try:
            reponse = discuter(etat["modele"], etat["messages"])
        except ErreurIA as e:
            afficher(f"Erreur IA : {e}", ROUGE)
            return
        etat["messages"].append({"role": "assistant", "content": reponse})
        commande = extraire_commande(reponse)
        if commande is None:
            afficher("✔ Tâche terminée.", ORANGE)
            return
        sensible = est_sensible(commande)
        afficher("┌─ commande proposée " + "─" * 30, ORANGE)
        for ligne in commande.splitlines():
            afficher(f"│ {BLANC}{ligne}{RAZ}", ORANGE)
        afficher("└" + "─" * 50, ORANGE)
        if sensible:
            afficher("⚠ Commande sensible : tape OUI en majuscules pour l'exécuter.", JAUNE)
            brut = demander("OUI / n (refuser) / m (modifier) / q (arrêter) › ")
            if brut == "OUI":
                choix = "o"
            elif brut.lower() in ("o", "oui", "y"):
                afficher("Il faut taper OUI en majuscules. Commande refusée.", JAUNE)
                choix = "n"
            else:
                choix = brut.lower()
        elif etat.get("auto"):
            afficher("(mode auto : exécutée)", GRIS)
            choix = "o"
        else:
            choix = demander("o (exécuter) / n (refuser) / m (modifier) / q (arrêter) › ").lower()
        if choix == "q":
            etat["messages"].append({"role": "user", "content": "L'utilisateur a arrêté la tâche."})
            afficher("Tâche arrêtée.", GRIS)
            return
        if choix == "m":
            commande = demander("ta version › ") or commande
            choix = "o"
        if choix not in ("o", "oui", "y"):
            raison = demander("pourquoi ? (optionnel) › ")
            etat["messages"].append({"role": "user", "content":
                "L'utilisateur a REFUSÉ cette commande." + (f" Raison : {raison}" if raison else "")
                + " Propose autre chose ou termine avec FINI:."})
            continue
        code, sortie, etat["dossier"] = executer(commande, etat["dossier"])
        apercu = sortie if len(sortie) < 2_000 else sortie[:2_000] + "\n… (sortie coupée à l'écran)"
        afficher(apercu or "(aucune sortie)", GRIS)
        afficher(f"code de sortie : {code}", VERT if code == 0 else ROUGE)
        if len(sortie) > LIMITE_SORTIE:
            sortie = sortie[:LIMITE_SORTIE // 2] + "\n…(coupé)…\n" + sortie[-LIMITE_SORTIE // 2:]
        etat["messages"].append({"role": "user", "content":
            f"Commande exécutée : {commande}\nDossier : {etat['dossier']}\n"
            f"Code de sortie : {code}\nSortie :\n{sortie or '(aucune)'}"})
    afficher(f"Arrêt après {MAX_ETAPES} étapes. Redonne la tâche pour continuer.", JAUNE)


AIDE_CODEXTERMINAL = [
    ("(ta tâche)", "ex. : « crée un projet python avec un venv »"),
    ("/auto", "exécuter sans demander (sauf commandes sensibles)"),
    ("/cd DOSSIER", "changer de dossier de travail"),
] + AIDE_COMMUNE


def mode_codexterminal(etat):
    etat["modele"] = choisir_modele("codex", etat["installes"], etat["config"], ram_go())
    titre("CodexTerminal", etat["modele"])
    afficher("Donne une tâche : l'IA propose des commandes, tu approuves chacune.", GRIS)
    montrer_aide(AIDE_CODEXTERMINAL)
    etat["messages"] = [{"role": "system", "content": systeme_codexterminal(etat["dossier"])}]
    etat["auto"] = False
    while True:
        afficher()
        afficher(etat["dossier"], GRIS)
        entree = lire("tâche › ")
        if not entree:
            continue
        if entree.startswith("/"):
            cmd, _, arg = entree.partition(" ")
            if cmd.lower() == "/auto":
                etat["auto"] = not etat["auto"]
                afficher("Mode auto ACTIVÉ — les commandes sensibles demandent quand même OUI."
                         if etat["auto"] else "Mode auto désactivé.", JAUNE if etat["auto"] else GRIS)
            elif cmd.lower() == "/cd" and arg.strip():
                code, sortie, etat["dossier"] = executer("cd " + arg.strip(), etat["dossier"])
                afficher(sortie, GRIS if code == 0 else ROUGE)
            else:
                r = commande_commune(entree, etat, "codexterminal",
                                     lambda: systeme_codexterminal(etat["dossier"]))
                if r == "quitter":
                    return
                if r is not True:
                    montrer_aide(AIDE_CODEXTERMINAL)
            continue
        try:
            tache_codexterminal(entree, etat)
        except KeyboardInterrupt:
            afficher("\nTâche interrompue.", GRIS)


# --------------------------------------------------------------------------
# 4. MODÈLES — voir, choisir, télécharger, supprimer
# --------------------------------------------------------------------------
def taille(octets):
    return f"{octets / 1e9:.1f} Go" if octets >= 1e9 else f"{octets / 1e6:.0f} Mo"


def taille_prevue(nom):
    """Taille en Go indiquée dans modeles.txt (None si le modèle n'y est pas)."""
    for fichier in (ICI / "modeles.txt", ICI.parent / "modeles.txt"):
        try:
            for ligne in fichier.read_text(encoding="utf-8").splitlines():
                morceaux = ligne.split()
                if len(morceaux) >= 4 and not ligne.startswith("#") and morceaux[1] == nom:
                    return float(morceaux[3].replace(",", "."))
        except (OSError, ValueError):
            continue
    return None


def verifier_place(nom):
    """Lève ErreurIA s'il ne reste pas assez de place sur la clé pour ce modèle."""
    besoin = taille_prevue(nom)
    dossier = Path(os.environ.get("OLLAMA_MODELS") or ICI / "ia" / "modeles")
    while not dossier.exists() and dossier != dossier.parent:
        dossier = dossier.parent
    try:
        libre = shutil.disk_usage(dossier)[2] / 1e9   # place libre
    except OSError:
        return
    if besoin and libre < besoin + 1:
        raise ErreurIA(f"il faut ≈ {besoin:g} Go pour {nom}, il reste {libre:.1f} Go sur la clé. "
                       "Supprime un modèle (🗑) pour faire de la place.")


def telecharger_modele(nom):
    afficher(f"Téléchargement de {nom} sur la clé (Internet requis)…", GRIS)
    try:
        verifier_place(nom)
        for obj in flux("/api/pull", {"model": nom, "stream": True}, delai=3600):
            total, fait = obj.get("total"), obj.get("completed")
            if total and fait:
                print(f"\r{ORANGE}{obj.get('status', '')[:30]:<30} {fait * 100 // total:3d} %  "
                      f"{taille(fait)} / {taille(total)}{RAZ}   ", end="", flush=True)
            else:
                print(f"\r{GRIS}{obj.get('status', '')[:70]:<70}{RAZ}", end="", flush=True)
        print()
        afficher(f"{nom} installé sur la clé ✔", VERT)
    except (ErreurIA, KeyboardInterrupt) as e:
        print()
        afficher(f"Téléchargement arrêté : {e}", ROUGE)


def mode_modeles(etat):
    while True:
        titre("Modèles sur la clé")
        try:
            modeles = modeles_installes()
        except ErreurIA as e:
            afficher(f"Erreur : {e}", ROUGE)
            return
        etat["installes"] = [m["name"] for m in modeles]
        chat = choisir_modele("chat", etat["installes"], etat["config"], ram_go())
        codex = choisir_modele("codex", etat["installes"], etat["config"], ram_go())
        if not modeles:
            afficher("Aucun modèle sur la clé. Tape t pour en télécharger un (ex. llama3.2:3b).", JAUNE)
        for i, m in enumerate(modeles, 1):
            roles = [r for r, n in (("chat", chat), ("codex", codex)) if n == m["name"]]
            etiquette = f"{VERT}◂ {' + '.join(roles)}{RAZ}" if roles else ""
            afficher(f"  {ORANGE}{i:>2}{RAZ}  {m['name']:<28} {GRIS}{taille(m.get('size', 0)):>8}{RAZ}  {etiquette}")
        total = sum(m.get("size", 0) for m in modeles)
        afficher(f"\n  Total : {taille(total)}", GRIS)
        afficher(f"\n  {ORANGE}a{RAZ} modèle du Chat   {ORANGE}c{RAZ} modèle de Codex   "
                 f"{ORANGE}t{RAZ} télécharger   {ORANGE}s{RAZ} supprimer   {ORANGE}r{RAZ} retour")
        choix = lire("› ").lower()
        if choix in ("r", "", "/quitter", "q", "0"):
            return
        if choix in ("a", "c") and etat["installes"]:
            role = "chat" if choix == "a" else "codex"
            nom = demander_modele(etat["installes"], chat if role == "chat" else codex)
            etat["config"][role] = nom
            sauver_config(etat["config"])
            afficher(f"{role} → {nom} (sauvé sur la clé)", VERT)
        elif choix == "t":
            nom = lire("nom du modèle (ex. qwen2.5-coder:7b, voir ollama.com/library) › ")
            if nom:
                telecharger_modele(nom)
        elif choix == "s" and etat["installes"]:
            nom = demander_modele(etat["installes"], None)
            if nom and lire(f"supprimer {nom} de la clé ? [o/N] › ").lower() in ("o", "oui"):
                try:
                    with _requete("/api/delete", {"model": nom}, methode="DELETE"):
                        pass
                    afficher(f"{nom} supprimé.", GRIS)
                except ErreurIA as e:
                    afficher(f"Erreur : {e}", ROUGE)


# --------------------------------------------------------------------------
# Menu principal
# --------------------------------------------------------------------------
MODES = {"1": ("chat", mode_chat), "2": ("codex", mode_codex),
         "3": ("codexterminal", mode_codexterminal), "4": ("modeles", mode_modeles)}


def menu(etat):
    afficher(LOGO, ORANGE + GRAS)
    afficher(f"  IA locales sur clé USB-C · v{VERSION} · moteur {hote()}", GRIS)
    while True:
        afficher()
        afficher(f"  {ORANGE}1{RAZ}  Chat            {GRIS}discuter avec l'IA{RAZ}")
        afficher(f"  {ORANGE}2{RAZ}  Codex           {GRIS}écrire et corriger du code{RAZ}")
        afficher(f"  {ORANGE}3{RAZ}  CodexTerminal   {GRIS}l'IA travaille dans le terminal (avec ta permission){RAZ}")
        afficher(f"  {ORANGE}4{RAZ}  Modèles         {GRIS}voir, choisir, télécharger{RAZ}")
        afficher(f"  {ORANGE}0{RAZ}  Quitter         {GRIS}arrête les IA{RAZ}")
        choix = lire("› ")
        if choix in ("0", "q", "/quitter", "quitter"):
            return
        if choix in MODES:
            lancer_mode(MODES[choix][1], etat)


def lancer_mode(fonction, etat):
    if fonction is not mode_modeles and not etat["installes"]:
        afficher("Aucun modèle sur la clé : va dans Modèles (4) pour en télécharger un.", JAUNE)
        return
    try:
        fonction(etat)
    except KeyboardInterrupt:
        afficher("\nRetour au menu.", GRIS)


def main(arguments=None):
    arguments = sys.argv[1:] if arguments is None else arguments
    if arguments and arguments[0] in ("-h", "--help", "aide"):
        print(__doc__)
        return 0
    if not attendre_ia(float(os.environ.get("LEXOS_IA_ATTENTE", "90"))):
        afficher(f"Le moteur IA ne répond pas sur {hote()}.", ROUGE)
        afficher("Lance ACTIVER-IA (sur la clé) : il démarre les IA puis ouvre ce terminal.", GRIS)
        return 1
    try:
        installes = [m["name"] for m in modeles_installes()]
    except ErreurIA as e:
        afficher(f"Erreur : {e}", ROUGE)
        return 1
    etat = {"installes": installes, "config": charger_config(), "modele": None,
            "messages": [], "dossier": os.getcwd(), "auto": False}
    direct = {nom: f for nom, f in MODES.values()}
    try:
        if arguments and arguments[0].lower() in direct:
            afficher(LOGO, ORANGE + GRAS)
            lancer_mode(direct[arguments[0].lower()], etat)
            return 0
        menu(etat)
    except KeyboardInterrupt:
        print()
    afficher("À la prochaine ! Les IA s'arrêtent.", ORANGE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
