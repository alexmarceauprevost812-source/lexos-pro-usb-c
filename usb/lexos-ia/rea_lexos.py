#!/usr/bin/env python3
"""REA sur la clé LexOS : l'agent ti-lex (dépôt ti-lex-ia-REA-) branché sur les IA de la clé.

REA cherche sur le web, regarde des images, lit et écrit les fichiers d'un projet et lance des
commandes (toujours avec ta confirmation). Il travaille dans les Projets de LexOS IA :
le même dossier que l'app TI-LEX-AL (lexos-ia/projets/<projet>).

Usage : python3 rea_lexos.py [projet]
Seul le cœur de l'agent est copié sur la clé (agent + outils) ; voir installer-sur-cle.sh.
"""
import os
import re
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
REA = ICI / "rea"
sys.path[:0] = [str(REA), str(REA / "libs")]

import lexos_ia as ia  # noqa: E402

NOM_PROJET = re.compile(r"^[a-z0-9][a-z0-9._\-]{0,62}$")
# Modèles qui savent appeler des outils (du meilleur au plus léger)
MODELES_OUTILS = ["qwen3:8b", "qwen3", "llama3.2", "qwen2.5-coder:7b", "qwen2.5-coder", "qwen2.5", "llama3.1", "mistral"]
MODELES_VISION = ["qwen2.5vl", "qwen3-vl", "gemma3", "llava", "minicpm-v"]

LOGO_REA = r"""
 ██████╗ ███████╗ █████╗
 ██╔══██╗██╔════╝██╔══██╗   agent ti-lex sur la clé USB-C
 ██████╔╝█████╗  ███████║   web · vision · fichiers · commandes
 ██╔══██╗██╔══╝  ██╔══██║
 ██║  ██║███████╗██║  ██║
 ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝"""

AIDE = [
    ("(ta demande)", "ex. « crée un site météo dans ce projet puis teste-le »"),
    ("/projet NOM", "travailler dans un autre projet (lexos-ia/projets/NOM)"),
    ("/modele NOM", "changer de modèle (il doit savoir utiliser des outils)"),
    ("/retenir TEXTE", "ajouter un fait à la mémoire de REA"),
    ("/reset", "oublier la conversation"),
    ("/quitter", "fermer REA"),
]


def premier(noms, prefixes):
    for p in prefixes:
        for n in noms:
            if n.startswith(p):
                return n
    return None


def confirmer(question):
    ia.afficher()
    ia.afficher("┌─ REA demande ta permission " + "─" * 24, ia.ORANGE)
    for ligne in str(question).splitlines():
        ia.afficher(f"│ {ia.BLANC}{ligne}{ia.RAZ}", ia.ORANGE)
    ia.afficher("└" + "─" * 51, ia.ORANGE)
    return ia.lire("o (oui) / N (non) › ").lower() in ("o", "oui", "y", "yes")


def evenement(message):
    ia.afficher(f"  {message}", ia.GRIS)


def creer_agent(projet, modele, vision):
    from ti_lex_agent.agent import Agent
    from ti_lex_agent.config import Config
    from ti_lex_agent.params import DEFAULTS
    dossier = ICI / "projets" / projet
    config = Config(ollama_host="http://" + ia.hote(), model=modele, vision_model=vision, workspace=dossier)
    return Agent(config, confirm=confirmer, on_event=evenement, options=dict(DEFAULTS))


def main(arguments=None):
    arguments = sys.argv[1:] if arguments is None else arguments
    if not (REA / "ti_lex_agent" / "agent.py").exists():
        ia.afficher("REA n'est pas encore sur la clé.", ia.ROUGE)
        ia.afficher("Ajoute-le avec :  bash usb/installer-sur-cle.sh /media/$USER/LEXOS --sans-moteur --sans-modeles", ia.GRIS)
        return 1
    if not ia.attendre_ia(float(os.environ.get("LEXOS_IA_ATTENTE", "90"))):
        ia.afficher(f"Le moteur IA ne répond pas sur {ia.hote()}. Lance ACTIVER-IA (sur la clé).", ia.ROUGE)
        return 1
    os.environ["OLLAMA_HOST"] = "http://" + ia.hote()
    os.environ.setdefault("TILEX_MEMORY", str(ICI / "memoire" / "rea-memoire.md"))
    noms = [m["name"] for m in ia.modeles_installes()]
    if not noms:
        ia.afficher("Aucun modèle sur la clé : ouvre LexOS IA → Modèles pour en télécharger un.", ia.ROUGE)
        return 1
    modele = os.environ.get("TILEX_MODEL") or premier(noms, MODELES_OUTILS) or noms[0]
    vision = os.environ.get("TILEX_VISION_MODEL") or premier(noms, MODELES_VISION) or modele
    projet = arguments[0] if arguments and NOM_PROJET.match(arguments[0]) else "rea"

    from ti_lex_agent.memory import remember
    agent = creer_agent(projet, modele, vision)
    ia.afficher(LOGO_REA, ia.ORANGE + ia.GRAS)
    ia.afficher(f"  modèle : {modele} · vision : {vision} · projet : 📁 {projet}", ia.GRIS)
    ia.afficher(f"  dossier : {agent.config.workspace}", ia.GRIS)
    ia.afficher("  REA demande toujours ta permission avant d'écraser un fichier ou de lancer une commande.", ia.GRIS)
    ia.montrer_aide(AIDE)
    while True:
        ia.afficher()
        texte = ia.lire(f"rea [{projet}] › ")
        if not texte:
            continue
        commande, _, reste = texte.partition(" ")
        commande, reste = commande.lower(), reste.strip()
        if commande in ("/quitter", "/q", "/quit", "/exit", "/menu"):
            break
        if commande == "/aide":
            ia.montrer_aide(AIDE)
        elif commande == "/reset":
            agent.reset()
            ia.afficher("Conversation oubliée.", ia.GRIS)
        elif commande == "/retenir" and reste:
            ia.afficher(remember(agent.config, reste), ia.VERT)
        elif commande == "/projet" and reste:
            if not NOM_PROJET.match(reste.lower()):
                ia.afficher("Nom de projet invalide (minuscules, chiffres, - . _).", ia.ROUGE)
                continue
            projet = reste.lower()
            agent = creer_agent(projet, modele, vision)
            ia.afficher(f"📁 Projet : {projet} ({agent.config.workspace})", ia.VERT)
        elif commande == "/modele" and reste:
            modele = reste
            agent = creer_agent(projet, modele, vision)
            ia.afficher(f"Modèle : {modele}", ia.VERT)
        elif commande.startswith("/"):
            ia.montrer_aide(AIDE)
        else:
            ia.afficher("(REA travaille…)", ia.GRIS)
            try:
                reponse = agent.run(texte)
            except KeyboardInterrupt:
                ia.afficher("\nInterrompu.", ia.GRIS)
                continue
            except Exception as e:  # erreurs du moteur ou du réseau : on garde la conversation
                ia.afficher(f"Erreur : {e}", ia.ROUGE)
                continue
            ia.afficher(reponse, ia.VERT)
    ia.afficher("À la prochaine !", ia.ORANGE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
