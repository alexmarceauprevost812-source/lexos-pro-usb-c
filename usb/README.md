# LexOS IA : les IA locales sur la clé USB-C

Plusieurs modèles IA sont installés **directement sur la clé**. Tu branches la clé sur un PC, tu fais **un clic**, et un terminal LexOS s'ouvre avec les IA activées. Rien n'est installé sur le PC, et tout marche sans Internet.

```
 ██╗     ███████╗██╗  ██╗ ██████╗ ███████╗    ██╗ █████╗
 ███████╗███████╗██╔╝ ██╗╚██████╔╝███████║    ██║██║  ██║

  1  Chat            discuter avec l'IA
  2  Codex           écrire et corriger du code
  3  CodexTerminal   l'IA travaille dans le terminal (avec ta permission)
  4  Modèles         voir, choisir, télécharger
  0  Quitter         arrête les IA
```

## L'application TI-LEX-AL

Elle reprend la même interface que ti-lex v10, branchée sur les IA de la clé. Pas besoin d'Internet.

| Linux | Windows |
| --- | --- |
| double-clic sur `APP-IA.sh` à la racine de la clé, ou `bash APP-IA.sh` | double-clic sur `APP-IA.bat` |

- **Menu à gauche** : Navigation (Chat, Codex, CodexTerminal, Cerveau), Outils (LexOS Textes, Terminal IA, Mes fichiers), et la liste des conversations sauvegardées sur la clé.
- **Chat · Agent AL** : « + » ajoute une **photo**. Tu peux aussi coller une image ou la glisser dans la fenêtre. Si le modèle choisi ne voit pas les images, l'app passe toute seule à un modèle qui les voit (gemma3:4b).
- **Codex** (style CodexLocal) : « + » ajoute un fichier de code. Chaque bloc de code a ses boutons Copier et Télécharger.
- **CodexTerminal** : l'IA propose une commande dans une carte orange, avec les boutons Exécuter, Modifier, Refuser et Arrêter. Pour une commande sensible, il faut taper **OUI**.
- **Équipe IA** : l'Architecte planifie, le Codeur écrit et le Réviseur vérifie. Le Codeur corrige jusqu'à ce que le Réviseur approuve.
- **Projets** : tes projets vivent sur la clé (`lexos-ia/projets/`), un dossier par projet avec tous ses fichiers. L'éditeur colore le code, et Ctrl+S enregistre. Le bouton **💾 Projet** sur le code de l'IA l'enregistre directement dans le projet actif, et l'Équipe peut enregistrer tout le code approuvé en un clic.
  - **GitHub** : « Cloner depuis GitHub » copie un dépôt sur la clé. « Relier à un dépôt » relie un projet à ton GitHub. **⟳ Récupérer** et **⬆ Envoyer** synchronisent tes fichiers. La première fois, il faut te connecter à GitHub dans un terminal avec `gh auth login`.
- **Mode réflexion** : quand une IA travaille, son avatar pulse et une barre animée montre ce qu'elle fait, avec un chrono. Les pensées des modèles qui réfléchissent (qwen3, deepseek-r1) défilent en direct, puis se replient en « 💭 A réfléchi 8 s ». Clique dessus pour les relire.
- **Mémoire** (Cerveau → Mémoire) : tes IA apprennent de leurs erreurs. CodexTerminal retient la leçon quand une commande échoue puis réussit, l'Équipe apprend des corrections du Réviseur, et les schémas réparés laissent aussi une leçon. Le bouton **👎 Erreur** sous une réponse sert à lui dire ce qui n'allait pas, et `/retiens …` dans le Chat sert à lui apprendre quelque chose. Les souvenirs utiles sont rappelés à l'IA avant chaque réponse. Tout reste sur la clé (`lexos-ia/memoire/`).
- **Schémas** : quand Agent AL ou l'Architecte font un plan, il s'affiche en schéma animé, étape par étape. Les boutons permettent de ▶ Rejouer, **🎬 MP4** (une vraie vidéo 1280×720 de l'animation, aux couleurs LexOS, lisible partout et même sur téléphone ; il faut `ffmpeg` sur le PC, sinon le navigateur fait une vidéo WebM), ⬇ Image (SVG), voir le code, et **💾 Projet** enregistre le schéma dans le projet (`schemas/plan.mmd`). Dans Projets, les fichiers `.mmd` et `.md` se dessinent dans le Studio, et **🗺 Schéma du projet** dessine la carte de tous les fichiers du projet.
- **🤖 REA** (menu de gauche, même interface que ti-lex v10) : l'agent ti-lex de ton dépôt **ti-lex-ia-REA-**. Il cherche sur le web, regarde des images, lit et écrit les fichiers **du projet actif** et lance des commandes. Chaque outil utilisé s'affiche en carte (🔍 recherche, 📄 lecture, ✏️ écriture, ⌨️ commande). Avant de lancer une commande ou d'écraser un fichier, REA demande ta permission dans une carte orange **✔ Oui / ✕ Non**. ⟲ démarre une nouvelle conversation. L'installateur récupère la dernière version sur GitHub et copie seulement le cœur de l'agent (agent, outils, mémoire), sans l'installateur ni les modes Heretic. Pour ne pas l'ajouter : `--sans-rea`. Version terminal : `bash ACTIVER-IA.sh rea [projet]`.
- **Studio** : **👁 Aperçu** affiche en direct l'application créée (page HTML d'un bloc de code ou d'un projet), en format 📱 téléphone ou 💻 ordinateur. L'aperçu est isolé et ne peut toucher ni à l'app ni aux IA.
- **Cerveau** : les modèles de la clé. Tu choisis celui du Chat et celui de Codex, tu en télécharges ou en supprimes.
- **STUDIO** affiche la conversation et le panneau **TRAVAIL** (tout le code des réponses) côte à côte. 🌙 passe du mode jour au mode nuit, et 🔔 montre les notifications.
- Pour quitter, ferme la fenêtre ou choisis **⏻ Arrêter les IA**. Tout s'arrête et rien ne reste sur le PC.

**👥 Équipe IA** : l'Architecte planifie, le Codeur écrit, le Réviseur vérifie, puis le Codeur corrige jusqu'à l'approbation. Tu choisis le modèle de chaque rôle et le nombre de tours de révision.

**📱 Sur ton téléphone (même Wi-Fi)** : menu → **📱 Téléphone**, puis scanne le code QR. Le téléphone ouvre **CodexLocal** avec les IA et les projets de la clé branchée dans le PC. Dans Chrome, **⋮ → Ajouter à l'écran d'accueil** le transforme en app. Le code reste valide d'une fois à l'autre ; « Nouveau code » bloque les anciens et « Couper l'accès téléphone » ferme tout. Si le téléphone ne se connecte pas et que le pare-feu est actif sur le PC : `sudo ufw allow 47801/tcp`. À utiliser sur ton Wi-Fi à la maison.

Sécurité : sans le mode téléphone, l'app n'écoute que sur ton PC (127.0.0.1) et chaque appel demande un jeton secret. Un site web ouvert dans ton navigateur ne peut donc ni parler aux IA ni lancer de commandes.

## 1. Préparer la clé (une seule fois, sous Linux, avec Internet)

Formate la clé en **exFAT** (fonctionne sous Linux et Windows) ou en **ext4** (Linux seulement). Le FAT32 bloque les fichiers de plus de 4 Go, donc les gros modèles.

```bash
sudo apt install curl zstd python3        # si ce n'est pas déjà là
git clone -b claude https://github.com/alexmarceauprevost812-source/lexos-pro-usb-c
cd lexos-pro-usb-c
bash usb/installer-sur-cle.sh /media/$USER/NOM_DE_LA_CLE --windows
```

| Option | Effet |
| --- | --- |
| `--profil 1` | léger, environ 3 Go : marche sur presque tous les PC |
| `--profil 2` | complet, environ 16 Go (**par défaut**) |
| `--profil 3` | tout, environ 40 Go : ajoute le raisonnement et le gros Codex |
| `--windows` | ajoute le moteur pour Windows (environ 1,5 Go de plus) |
| `--sans-moteur --sans-modeles` | met à jour seulement le code de la clé |
| `--modele gemma4:26b` | télécharge seulement ce modèle (vérifie d'abord la place libre sur la clé) |

La liste des modèles se trouve dans [`modeles.txt`](modeles.txt), et tu peux la modifier :

| Modèle | Rôle | Profil |
| --- | --- | --- |
| llama3.2:3b | Chat rapide | 1 |
| qwen2.5-coder:1.5b | Codex léger | 1 |
| qwen3:8b | Chat de qualité, bon en français | 2 |
| qwen2.5-coder:7b | Codex principal | 2 |
| gemma3:4b | Comprend aussi les images | 2 |
| deepseek-r1:8b | Raisonnement | 3 |
| qwen3-coder:30b | Gros Codex (PC puissant) | 3 |
| gemma4:26b | **Gros modèle** (≈ 18 Go) : images, outils, réflexion | à la demande (`--modele`) |

Le gros modèle **gemma4:26b** demande 32 Go de mémoire vive. Sur un PC qui en a au moins 28 Go, le Chat le prend tout seul. Sur un PC plus petit, la clé reste sur qwen3:8b. Tu peux aussi le télécharger depuis l'app : **Cerveau → 🦣 gemma4:26b · 18 Go → Télécharger**.

## 2. Un clic pour activer les IA

| Sur… | Fais |
| --- | --- |
| Linux | double-clic sur `ACTIVER-IA.sh` à la racine de la clé, ou `bash ACTIVER-IA.sh` |
| Windows | double-clic sur `ACTIVER-IA.bat` |

Ce que fait le clic :
1. il ouvre un terminal ;
2. il démarre le moteur Ollama **de la clé**, avec les modèles **de la clé** ;
3. il lance le terminal LexOS IA ;
4. en quittant (`0`), il arrête le moteur. Rien ne reste actif sur le PC.

Si un Ollama tourne déjà sur le PC, la clé utilise le port 11435 pour ne pas le déranger.

## 3. Les outils sur le bureau du PC (Linux)

```bash
bash /media/$USER/NOM_DE_LA_CLE/lexos-ia/raccourcis-bureau.sh
```

Ça ajoute 7 icônes sur le bureau et dans le menu des applications : **TI-LEX-AL** (l'application), **LexOS IA (terminal), Chat IA, Codex, CodexTerminal, Modèles IA, LexOS Textes**. Le bureau garde son interface habituelle, avec les IA de la clé en plus. Chaque icône retrouve la clé toute seule quand elle est branchée. Pour les enlever : `--retirer`.

Sur GNOME, si une icône affiche « non fiable », fais un clic droit puis « Autoriser le lancement ».

## Les modes

**Chat** : une conversation normale. Commandes : `/modele`, `/nouveau`, `/sauver` (enregistre dans `lexos-ia/conversations/` sur la clé), `/quitter`.

**Codex** : un assistant de programmation.
- `/lire fichier.py` : Codex lit ton fichier.
- `/dossier` : Codex voit la liste des fichiers du projet.
- `/cd dossier` : change le dossier de travail.
- `/ecrire` : enregistre le code de la dernière réponse. Il te demande toujours la permission, et l'ancienne version est gardée en `.bak-…`.

**CodexTerminal** : un agent qui travaille dans le terminal. Tu donnes une tâche (« crée un projet Python avec un venv et un hello world ») :
- l'IA propose **une commande à la fois**, encadrée en orange ;
- tu réponds `o` (exécuter), `n` (refuser), `m` (modifier) ou `q` (arrêter) ;
- l'IA lit le résultat, puis propose la suite, jusqu'à « FINI » ;
- les **commandes sensibles** (`sudo`, `rm -r`, `dd`, `mkfs`, `git push --force`…) exigent de taper `OUI` en majuscules ;
- `/auto` exécute les commandes ordinaires sans demander, mais les commandes sensibles demandent toujours `OUI`.

**Modèles** : liste des modèles sur la clé, avec leur taille. `a` choisit le modèle du Chat, `c` celui de Codex (le choix est sauvé sur la clé), `t` télécharge un nouveau modèle (Internet requis), `s` supprime un modèle.

Le choix automatique tient compte du PC : avec moins de 12 Go de RAM, les modèles légers passent en premier.

## Bon à savoir

- **Python 3** doit être présent sur le PC. Il l'est sur Linux ; sous Windows, installe-le depuis python.org.
- Sur une clé exFAT, Linux bloque parfois l'exécution des programmes. ACTIVER-IA copie alors le moteur une seule fois dans `~/.cache/lexos-ia`. Les modèles, eux, restent sur la clé.
- La carte NVIDIA est utilisée automatiquement si elle est présente. Sinon, le processeur fait le travail, plus lentement.
- Une clé **USB 3 / USB-C rapide** rend le chargement des modèles beaucoup plus rapide.
- **LexOS Textes** est aussi sur la clé (`apps/`). Lancé par son icône, il utilise les IA de la clé.

## Structure

```
CLÉ/
├── APP-IA.sh / .bat          ← un clic : application TI-LEX-AL
├── ACTIVER-IA.sh / .bat      ← un clic : version terminal
├── LISEZ-MOI-IA.txt
└── lexos-ia/
    ├── lexos_ia_app.py + app/ application TI-LEX-AL (menu à gauche, photos)
    ├── lexos_ia.py           terminal IA : Chat · Codex · CodexTerminal · Modèles
    ├── ACTIVER-IA.sh / .bat
    ├── raccourcis-bureau.sh  icônes sur le bureau du PC
    ├── icones/  apps/  modeles.txt  config.json  conversations/
    └── ia/
        ├── ollama-linux-amd64/   moteur Linux
        ├── ollama-windows/       moteur Windows
        └── modeles/              les modèles IA
```

## Tests

```bash
cd usb && python3 -m unittest discover -s tests -v
```

Un faux moteur Ollama sert aux tests. Ils vérifient le Chat, Codex, CodexTerminal (permission, refus, commandes sensibles), le choix des modèles et le bouton un clic. Le vrai moteur et les vrais modèles doivent encore être testés sur une vraie clé.
