"""
coffre.py — Coffre-fort chiffré pour les clés API et les données de tes projets.

Les clés ne sont plus en clair dans un .env : elles sont chiffrées dans
le fichier .env.coffre. Au lancement de l'application, on demande un mot de
passe maître ; sans lui, personne ne peut lire les clés ni les données.

Installation :
    pip install cryptography

Commandes (dans le terminal, à la racine du projet) :
    python coffre.py creer               -> chiffre ton .env existant dans .env.coffre
    python coffre.py ajouter CLE VALEUR  -> ajoute ou modifie une clé
    python coffre.py retirer CLE         -> retire une clé
    python coffre.py liste               -> affiche le NOM des clés (pas les valeurs)
    python coffre.py motdepasse          -> change le mot de passe maître

Dans ton application (tout en haut du fichier principal) :
    from coffre import deverrouiller
    deverrouiller()                  # demande le mot de passe dans le terminal
    # ou : deverrouiller(gui=True)   # fenêtre graphique (Tkinter)
    cle = os.getenv("OPENAI_API_KEY")
"""

import base64
import getpass
import json
import os
import sys
import time

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

FICHIER_COFFRE = ".env.coffre"
FICHIER_ENV = ".env"
ESSAIS_MAX = 3

# Clé de session gardée en mémoire seulement (jamais écrite sur le disque)
_fernet_session = None


# ---------------------------------------------------------------------------
# Chiffrement
# ---------------------------------------------------------------------------

def _deriver_cle(mot_de_passe: str, sel: bytes) -> Fernet:
    """Transforme le mot de passe en clé de chiffrement (scrypt : lent exprès,
    pour rendre les attaques par force brute très coûteuses)."""
    kdf = Scrypt(salt=sel, length=32, n=2**15, r=8, p=1)
    cle = kdf.derive(mot_de_passe.encode("utf-8"))
    return Fernet(base64.urlsafe_b64encode(cle))


def _ecrire_coffre(secrets: dict, mot_de_passe: str) -> None:
    global _fernet_session
    sel = os.urandom(16)
    f = _deriver_cle(mot_de_passe, sel)
    jeton = f.encrypt(json.dumps(secrets).encode("utf-8"))
    contenu = {
        "version": 1,
        "sel": base64.b64encode(sel).decode(),
        "donnees": jeton.decode(),
    }
    with open(FICHIER_COFFRE, "w", encoding="utf-8") as fichier:
        json.dump(contenu, fichier, indent=2)
    try:
        os.chmod(FICHIER_COFFRE, 0o600)  # lisible seulement par toi (Linux)
    except OSError:
        pass
    _fernet_session = f


def _lire_coffre(mot_de_passe: str) -> dict:
    """Retourne les secrets, ou lève InvalidToken si le mot de passe est mauvais."""
    global _fernet_session
    with open(FICHIER_COFFRE, "r", encoding="utf-8") as fichier:
        contenu = json.load(fichier)
    sel = base64.b64decode(contenu["sel"])
    f = _deriver_cle(mot_de_passe, sel)
    secrets = json.loads(f.decrypt(contenu["donnees"].encode()).decode("utf-8"))
    _fernet_session = f
    return secrets


# ---------------------------------------------------------------------------
# Saisie du mot de passe
# ---------------------------------------------------------------------------

def _demander_terminal(message: str) -> str:
    return getpass.getpass(message)


def _demander_gui(message: str) -> str:
    import tkinter as tk
    from tkinter import simpledialog

    racine = tk.Tk()
    racine.withdraw()
    reponse = simpledialog.askstring("Coffre verrouillé", message, show="•", parent=racine)
    racine.destroy()
    if reponse is None:  # l'utilisateur a cliqué Annuler
        sys.exit("Application fermée : coffre non déverrouillé.")
    return reponse


# ---------------------------------------------------------------------------
# À utiliser au lancement de l'application
# ---------------------------------------------------------------------------

def deverrouiller(gui: bool = False, charger_env: bool = True) -> dict:
    """Demande le mot de passe maître au lancement. Après 3 mauvais essais,
    l'application se ferme. Les clés sont chargées en mémoire (os.environ)."""
    if not os.path.exists(FICHIER_COFFRE):
        sys.exit(f"Aucun coffre trouvé ({FICHIER_COFFRE}). "
                 "Lance d'abord : python coffre.py creer")

    demander = _demander_gui if gui else _demander_terminal

    for essai in range(1, ESSAIS_MAX + 1):
        mdp = demander("Mot de passe maître : ")
        try:
            secrets = _lire_coffre(mdp)
            if charger_env:
                os.environ.update(secrets)
            return secrets
        except InvalidToken:
            restants = ESSAIS_MAX - essai
            if restants:
                print(f"Mot de passe incorrect. Essais restants : {restants}")
                time.sleep(2 * essai)  # ralentit les essais en rafale
    sys.exit("Trop d'essais. Application verrouillée.")


# ---------------------------------------------------------------------------
# Protéger aussi les données de l'app (fichiers, notes, base locale…)
# ---------------------------------------------------------------------------

def _session() -> Fernet:
    if _fernet_session is None:
        raise RuntimeError("Appelle deverrouiller() avant de chiffrer des données.")
    return _fernet_session


def sauver_donnees(chemin: str, donnees: bytes) -> None:
    """Écrit un fichier chiffré avec la clé du coffre."""
    with open(chemin, "wb") as fichier:
        fichier.write(_session().encrypt(donnees))


def lire_donnees(chemin: str) -> bytes:
    """Lit un fichier écrit avec sauver_donnees()."""
    with open(chemin, "rb") as fichier:
        return _session().decrypt(fichier.read())


# ---------------------------------------------------------------------------
# Commandes en ligne de commande
# ---------------------------------------------------------------------------

def _lire_env(chemin: str) -> dict:
    secrets = {}
    with open(chemin, "r", encoding="utf-8") as fichier:
        for ligne in fichier:
            ligne = ligne.strip()
            if not ligne or ligne.startswith("#") or "=" not in ligne:
                continue
            cle, valeur = ligne.split("=", 1)
            secrets[cle.strip()] = valeur.strip().strip('"').strip("'")
    return secrets


def _nouveau_mot_de_passe() -> str:
    while True:
        mdp = getpass.getpass("Nouveau mot de passe maître : ")
        if len(mdp) < 8:
            print("Minimum 8 caractères.")
            continue
        if mdp != getpass.getpass("Confirme le mot de passe : "):
            print("Les deux mots de passe ne sont pas pareils. Recommence.")
            continue
        return mdp


def _ouvrir_cli() -> tuple:
    mdp = getpass.getpass("Mot de passe maître : ")
    try:
        return _lire_coffre(mdp), mdp
    except InvalidToken:
        sys.exit("Mot de passe incorrect.")


def main(args: list) -> None:
    if not args:
        print(__doc__)
        return
    commande = args[0]

    if commande == "creer":
        if os.path.exists(FICHIER_COFFRE):
            sys.exit(f"{FICHIER_COFFRE} existe déjà. Utilise 'ajouter' pour le modifier.")
        secrets = _lire_env(FICHIER_ENV) if os.path.exists(FICHIER_ENV) else {}
        _ecrire_coffre(secrets, _nouveau_mot_de_passe())
        print(f"Coffre créé avec {len(secrets)} clé(s) : {FICHIER_COFFRE}")
        if os.path.exists(FICHIER_ENV):
            print(f"Tu peux maintenant supprimer ton fichier {FICHIER_ENV} (il est en clair).")

    elif commande == "ajouter" and len(args) == 3:
        secrets, mdp = _ouvrir_cli()
        secrets[args[1]] = args[2]
        _ecrire_coffre(secrets, mdp)
        print(f"Clé « {args[1]} » enregistrée.")

    elif commande == "retirer" and len(args) == 2:
        secrets, mdp = _ouvrir_cli()
        if secrets.pop(args[1], None) is None:
            sys.exit(f"Clé « {args[1]} » introuvable.")
        _ecrire_coffre(secrets, mdp)
        print(f"Clé « {args[1]} » retirée.")

    elif commande == "liste":
        secrets, _ = _ouvrir_cli()
        for cle in sorted(secrets):
            print(f"  {cle}")

    elif commande == "motdepasse":
        secrets, _ = _ouvrir_cli()
        _ecrire_coffre(secrets, _nouveau_mot_de_passe())
        print("Mot de passe maître changé.")

    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
