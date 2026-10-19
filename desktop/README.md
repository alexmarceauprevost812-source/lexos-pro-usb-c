# LexOS Textes sur PC

Version commune Linux, Windows et macOS. Écriture de textes, brouillon local automatique, ouverture UTF-8 `.txt` et `.md`, export de projets sur un dossier USB choisi. Les sauvegardes n’écrasent pas les versions précédentes.

## Lancer les sources

Installer Python 3 avec Tkinter, puis lancer `python lexos_textes.py` (ou `python3` sous Linux/macOS). Sur Debian, le paquet `python3-tk` fournit Tkinter. Sous Windows, utiliser la distribution officielle Python avec Tcl/Tk. Sous macOS, utiliser Python avec support Tkinter.

## IA hors ligne

Installer Ollama sur le PC et télécharger une fois un modèle compatible, par exemple avec `ollama pull qwen3:1.7b`. Ollama doit fonctionner localement ; le modèle doit déjà être disponible avant le trajet sans Internet. Renseigner son nom dans l’application. Les demandes passent exclusivement par `127.0.0.1:11434` et les proxys sont ignorés. Aucun compte ni service cloud n’est requis pour la génération. Les performances dépendent du PC. Le modèle n’est pas livré dans les exécutables. Copier un exécutable sur une clé ne rend pas Ollama ni ses modèles portables.

La réponse apparaît séparément du texte. Relire puis utiliser « Ajouter la proposition au texte » avant de sauvegarder.

## Brouillons

Le brouillon est conservé toutes les trois secondes dans `~/.lexos-textes/brouillon.json`, sur le PC utilisé. Une coupure brutale peut perdre les dernières secondes. Sauvegarder sur la clé pour reprendre sur un autre ordinateur ou Android. Fermer l’application avant de retirer la clé après une sauvegarde réussie.

## Exécutables

Le workflow « Construire versions PC » produit les artefacts Windows, Linux et macOS correspondant à l’architecture des runners GitHub. Cela ne garantit pas toutes les architectures ni tous les anciens systèmes. Ces exécutables de test ne sont pas signés. La version macOS peut nécessiter une autorisation dans les réglages de sécurité. Linux nécessite un environnement graphique compatible avec les bibliothèques du runner.

## Vérification

Depuis ce dossier : `python -m unittest discover -s tests -v`. Les tests vérifient les noms, l’absence d’écrasement des fichiers et le refus d’un dossier de projet redirigé par un lien symbolique. L’interface et la génération Ollama doivent encore être testées sur les trois systèmes.
