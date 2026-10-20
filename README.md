# ⚡ LexOS · Moteur d'interface portable

**Ton IA locale qui voyage sur une clé USB-C.** Tu branches la clé sur n'importe quel PC, tu double-cliques, et tout s'ouvre : chat, Codex, images, schémas animés… Les modèles, le moteur et tes données restent **sur la clé**. Rien n'est installé sur le PC.

> Produit du Québec 🇨🇦 · fait par Alex Marceau Prevost · thème noir / orange / blanc, plein d'animations.

---

## 🚀 Démarrer en un clic

| Système | Quoi faire |
|---|---|
| **Linux** | double-clic sur `LANCER-MOTEUR.sh` (ou `LexOS-Moteur.desktop`), ou `bash LANCER-MOTEUR.sh` |
| **Windows** | double-clic sur `LANCER-MOTEUR.bat` |

Ce qui se passe :

1. Le moteur **retrouve la clé tout seul**, peu importe où elle est montée (`/media/…`, `/run/media/…`, `E:\`).
2. Il démarre le moteur **Ollama de la clé** avec les **modèles de la clé**. L'Ollama du PC n'est jamais touché.
3. L'interface s'ouvre dans une fenêtre, à l'adresse `http://127.0.0.1:8787`.
4. Le bouton **⏻ Éteindre** arrête tout. Après, tu peux débrancher la clé.

**Seul besoin sur le PC : Python 3.** Le moteur n'utilise aucune dépendance, seulement la bibliothèque standard.

---

## 🔐 Mot de passe

- Au premier lancement, tu **crées ton mot de passe** (8 caractères minimum, avec une jauge de force).
- Ensuite, l'interface est **verrouillée** tant que le mot de passe n'est pas entré. Sans lui, rien n'est accessible : conversations, projets, images, modèles.
- Seule une **empreinte scrypt** est gardée (`MOTEUR-INTERFACE/acces.json`), jamais le mot de passe lui-même.
- Après 3 mauvais essais, le moteur bloque un moment : 30 s, puis 60 s, puis plus longtemps.
- 🔒 **Verrouiller** dans le menu, et **verrouillage automatique** après X minutes sans activité.
- Pour **changer le mot de passe** : ⚙️ Paramètres → Sécurité.
- **Mot de passe oublié ?** Supprime `MOTEUR-INTERFACE/acces.json` sur la clé, puis crée-en un nouveau.

### Coffre des clés API (`coffre.py`)

Tes clés API (OpenAI, etc.) peuvent être chiffrées dans `MOTEUR-INTERFACE/.env.coffre`, avec le **même mot de passe** que l'interface :

```bash
cd MOTEUR-INTERFACE
pip install cryptography
python3 coffre.py creer               # chiffre ton .env dans .env.coffre
python3 coffre.py ajouter CLE VALEUR  # ajoute ou modifie une clé
python3 coffre.py liste               # affiche le NOM des clés
```

Quand tu déverrouilles l'interface, le coffre s'ouvre aussi. Les clés vont **en mémoire seulement**, jamais en clair sur le disque.

### 📦 Cloner un dépôt GitHub

Le bouton **📦 Cloner** est dans le Codex, dans le Studio et dans le menu ＋. Il marche **sans git et sans IA**.

- Tu colles l'adresse (`https://github.com/proprio/depot`, ou simplement `proprio/depot`), avec une branche si tu veux.
- Le dépôt va dans un **✨ nouveau projet**, ou dans un sous-dossier du **📁 projet actuel**.
- Une animation montre la progression, puis tu peux **ouvrir le projet dans le Codex** ou le **voir dans le Studio**.
- **Dépôts privés** : ajoute la variable globale `GITHUB_TOKEN` dans 🔑 Variables. Si le jeton est refusé, le moteur réessaie comme un dépôt public.
- Les fichiers piégés (« zip slip ») sont bloqués.

### 🔑 Variables d'environnement (façon Vercel)

Le bouton **🔑 Variables** est en haut de l'écran, dans le Codex, et sur chaque carte du Studio.

- **🌍 Globales** : pour tous les projets. Elles sont aussi chargées dans le moteur.
- **📁 Par projet**, avec trois environnements : **Tous**, **🛠 Développement** et **🚀 Production**.
- Tout est **chiffré dans le coffre** (`.env.coffre`). Le mot de passe maître est redemandé pour ouvrir les variables, puis oublié après 10 minutes ou quand tu verrouilles.
- Pour chaque variable : 👁 voir, 📋 copier, ⌨️ copier `export NOM=…` pour le terminal, ✏️ modifier, 🗑 supprimer.
- **⬇ .env / .env.production**, comme `vercel env pull` : écrit le fichier du projet avec les globales, les variables du projet et celles de l'environnement choisi. Si un nom existe à deux niveaux, la valeur la plus précise gagne. Le fichier est ajouté automatiquement au `.gitignore`.
- Il faut le module `cryptography` sur le PC : `pip install cryptography`.

---

## 🧭 Ce qu'il y a dedans

### 💬 Chat
- Les réponses s'affichent en direct, mot par mot.
- Tu peux **joindre des images** (avec les modèles qui voient les images).
- Les conversations sont gardées **sur la clé**.

### ⌨️ Codex
- **Éditeur de code** avec numéros de ligne. Ctrl+S enregistre.
- **Changer de fichier = tourner une page** : la page se dézoome, pivote, et le nouveau fichier arrive.
- **Zone d'écriture en bas, au centre**, comme ChatGPT ou Claude Code. La conversation se replie avec « Codex ▾ ».
- **Bouton ＋ animé** pour ajouter des images ou des fichiers au projet. Tu peux aussi les glisser-déposer, ou coller une image avec Ctrl+V.
- **✍️ Écriture directe** : le code s'écrit **en direct dans l'éditeur** et s'enregistre tout seul (une copie `.avant-codex` est gardée). En bas, il ne reste que l'explication.
- **🎨 Code en couleurs** : Python, JavaScript, HTML, CSS, JSON, bash et Markdown, dans l'éditeur comme dans la conversation.
- **↳ Appliquer** met le code proposé dans le fichier, et une copie `.avant-codex` est gardée.
- **Terminal « à la main »**, sans sudo :
  - 📋 **Copier pour le terminal** copie une commande proposée par l'IA ;
  - 📂 **Chemin du projet** copie la commande `cd` vers le dossier du projet ;
  - ▶ **Commande pour lancer** copie la commande pour exécuter le fichier ouvert ;
  - 📥 **Résultat du terminal** : tu recolles ce que ton terminal a affiché et Codex l'explique.
- **🎛️ Studio** : tous tes projets en cartes (langages, fichiers, taille), avec un **👁 Aperçu en direct** des sites web, en vue ordinateur 💻 ou téléphone 📱.

### ⚡ Turbo REA (dans le Codex)
Inspiré de l'agent **ti-lex REA** ([dépôt `ti-lex-ia-REA-`](https://github.com/alexmarceauprevost812-source/ti-lex-ia-REA-)). Tu actives l'interrupteur **⚡ Turbo REA** et REA travaille **tout seul** dans le projet :

| Outil | Ce qu'il fait |
|---|---|
| 🔎 `web_search` · 🌐 `fetch_page` | cherche sur le web et lit des pages, pour vérifier plutôt que deviner |
| 📂 `list_files` · 📖 `read_file` · ✍️ `write_file` | lit et écrit les fichiers du projet. Chaque fichier remplacé garde une copie `.avant-codex` |
| 👁 `describe_image` | regarde une image du projet |
| 🎨 `create_image` | **crée une image** avec le modèle d'image local, et l'enregistre dans le projet |
| 📦 `clone_github` | **clone un dépôt GitHub public** dans le projet, sans git |

Chaque étape s'affiche en direct, avec une icône, un chronomètre, ✔ ou ✖. Les images créées apparaissent dans la conversation.
**Turbo REA ne lance jamais de commandes** : il te les propose, et c'est toi qui les lances dans ton terminal.

### 👥 Codex équipe
Trois IA travaillent ensemble sur ta demande :

1. 🧭 l'**Architecte** fait le plan ;
2. ⌨️ le **Codeur** écrit le code ;
3. 🔍 le **Réviseur** critique, puis le Codeur corrige (1 à 3 rondes).

Le bouton **Enregistrer tout** met les fichiers dans le projet.

### 🎨 Images
- Création d'images **en local**, avec des formats Carré, Paysage, Portrait ou Rapide, le nombre d'étapes et une graine.
- Pendant la création, une animation « je peins » avec le pourcentage. À la fin, l'image se révèle.
- Une **galerie** sur la clé (`MOTEUR-INTERFACE/images`) et un bouton « Mettre en fond d'écran ».
- Les modèles se téléchargent **directement sur la clé**, depuis l'onglet : `x/z-image-turbo` (environ 13 Go) ou `x/flux2-klein:4b`.
- **Sur Linux, le moteur d'images est stable-diffusion.cpp** (version Vulkan pour la carte graphique, avec une version processeur en secours). Il lit directement les fichiers de `lexos-ia/images-ia/` : `z_image_turbo-*.gguf`, `Qwen3-4B-*.gguf` et `ae.safetensors`. Il faut `--offload-to-cpu` pour les cartes de 8 Go, et c'est déjà activé. S'il manque une pièce, un bouton l'installe sur la clé.
- ⚠️ La création d'images d'Ollama est **expérimentale** : il faut Linux avec une carte NVIDIA (CUDA), ou un Mac, et une version récente d'Ollama. Les gros modèles demandent beaucoup de mémoire vidéo.

### 🎬 Schémas animés
- Tu décris un schéma (l'IA l'écrit) ou tu l'écris toi-même : `[A] -> [B] : action`.
- L'animation se construit comme un montage vidéo : boîtes qui rebondissent, flèches qui se dessinent, billes qui circulent dans les liens.
- **Export vidéo `.webm` 1920×1080** et image PNG, gardés sur la clé (`MOTEUR-INTERFACE/schemas`).

### 🖥️ Bureau LexOS

**Le Bureau est la page d'accueil**, juste après le mot de passe. On peut changer ça dans ⚙️ Paramètres → « Au démarrage ».

- **Les icônes « ti-lex IA »** ouvrent l'interface sur le bon onglet : 💬 Chat, ⌨️ Codex, 👥 Codex équipe, 🎨 Images, 🎬 Schémas, 🧠 Modèles, 🔌 La clé, ⚙️ Paramètres, 🔑 Variables.
- **En haut à droite**, une grande horloge et la barre **« Demande à ti-lex IA… »**, qui ouvre directement le Chat.
- **Pour revenir au Bureau** depuis l'interface, clique sur le bouton 🖥️, à côté du logo.

Le Bureau est un vrai petit bureau, avec des icônes, des **fenêtres** et une barre des tâches. Le bouton **⏏ Sortir du bureau** (ou Échap) te ramène à l'interface.

- **Les fenêtres** sortent de leur icône. Tu les **déplaces** par la barre de titre, tu les **redimensionnes** par le coin, et tu les **agrandis** d'un double-clic. Le bouton ─ les réduit dans la barre des tâches.
- **Le menu LexOS** (en bas à gauche) liste toutes les applications. L'heure et le modèle d'IA utilisé sont affichés dans la barre.

| Outil | Ce qu'il fait |
|---|---|
| ✍️ Texte IA | résumer, corriger le français, réécrire (ton au choix), expliquer simplement, traduire |
| 📝 Notes | des notes **gardées sur la clé**, et l'IA pour résumer, organiser ou transformer en tâches |
| ✅ Tâches | une liste de tâches **sur la clé**, avec une barre de progression et 🪄 « découper un objectif en tâches » |
| 📄 Documents | ouvrir un texte (txt, md, csv, json, code…), le résumer, en tirer les points importants, des questions de révision, ou lui poser une question |
| 🖼️ Photo | décrire une image, lire le texte d'une image, l'analyser, ou poser une question (il faut un modèle qui voit les images, comme gemma3) |
| 🧮 Calculatrice | avec un historique, `sqrt`, `sin`, `^`, `%`… |
| 🔁 Convertisseur | longueur, masse, volume, vitesse, données, temps, température |
| ⏱️ Minuterie | Pomodoro (25, 5 ou 15 min, ou ton choix), avec un son et une notification |
| 📋 Presse-papiers | l'historique de ce que tu copies dans LexOS (en mémoire seulement) |
| 📸 Capture d'écran | capturer l'écran, la garder dans la galerie, ou la faire décrire par l'IA |

### ⚙️ Paramètres
- **25 couleurs**, plus 🌈 arc-en-ciel et ta couleur à toi.
- **20 polices** incluses sur la clé, qui marchent sans Internet.
- La taille du texte.
- **7 fonds animés** : Constellation, Aurore, Hyperespace, Pluie de code, Vagues, Braises, Noir. Tu peux aussi mettre **ta propre image**, avec flou, assombrissement et zoom cinéma.
- Tout est gardé **sur la clé**, donc ton style te suit sur tous les PC.

### ☁️ IA en ligne (ta propre clé API + compteur)
Sur le Bureau, l'icône **☁️ IA en ligne** permet d'utiliser **Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google), OpenRouter, Groq et Mistral** en plus des modèles locaux.
- **Chaque personne met sa clé** : « 🔗 Se connecter et prendre ma clé » ouvre la page de ton compte chez le fournisseur. Tu crées une clé API, tu la colles, et c'est tout.
- La clé est gardée **chiffrée dans le coffre** (mot de passe maître). Elle ne revient jamais dans le navigateur : c'est le moteur qui parle au fournisseur.
- « 📋 Choisir des modèles » va chercher la liste à jour chez le fournisseur. Les modèles choisis apparaissent dans les menus du Chat, du Codex, etc., avec un ☁️ devant. Un modèle en ligne n'est **jamais choisi tout seul**.
- **Compteur du mois** : les jetons envoyés et reçus, et une **estimation en $** avec les prix que tu entres (en $ par million de jetons). Tu peux mettre une **limite en jetons et/ou en $**. Rendu à 80 %, tu reçois un avertissement. À 100 %, LexOS n'envoie plus rien jusqu'au mois suivant.
- **🎨 Images avec ChatGPT** : avec une clé OpenAI, « ☁️ ChatGPT Images » (gpt-image-1) apparaît dans l'onglet 🎨 Images. Les images sont comptées aussi.

### ☰ Menu de gauche
S'ouvre et se ferme en douceur, avec le bouton ☰ ou **Ctrl+B**.

---

## 📁 Ce qui est sur la clé

```
LEXOS/
├── LANCER-MOTEUR.sh / .bat / LexOS-Moteur.desktop   ← un clic
├── LISEZ-MOI-MOTEUR.txt
├── lexos-ia/ia/ollama-linux-amd64/ (et ollama-windows/)  ← le moteur Ollama de la clé
├── lexos-ia/ia/modeles/  ou  ollama-models/               ← les modèles (le moteur prend celui qui en a le plus)
└── MOTEUR-INTERFACE/
    ├── moteur.py          ← le serveur (Python, bibliothèque standard seulement)
    ├── turbo_rea.py       ← l'agent ⚡ Turbo REA
    ├── coffre.py          ← le coffre chiffré des clés API
    ├── nuage.py           ← ☁️ IA en ligne + compteur de jetons
    ├── interface/         ← l'interface (HTML/CSS/JS, polices incluses)
    ├── acces.json         ← empreinte du mot de passe        (privé, pas sur GitHub)
    ├── conversations/ projets/ images/ schemas/ fonds/        (privé, pas sur GitHub)
    ├── nuage.json / compteur.json ← tes modèles en ligne et ta consommation (privé, pas sur GitHub)
    └── parametres.json    ← tes couleurs, police, fond       (privé, pas sur GitHub)
```

---

## 🛡️ Sécurité

- **Mot de passe obligatoire**, avec une session par cookie `HttpOnly` / `SameSite=Strict`.
- Le serveur écoute **seulement sur `127.0.0.1`**, donc il est invisible sur le réseau. Les sites web étrangers sont refusés (vérification de l'origine).
- Les aperçus du Studio tournent dans un **bac à sable** (`sandbox`) : un projet ne peut pas toucher au moteur.
- Les fichiers ne peuvent jamais sortir du dossier du projet.
- Turbo REA refuse les adresses privées ou locales, et se protège contre les fichiers piégés (« zip slip ») quand il clone.
- **Aucune exécution de commande par l'IA** : c'est toujours toi qui lances les commandes.

---

## 🔧 Options

```bash
python3 MOTEUR-INTERFACE/moteur.py --help
  --port 8787            port de l'interface
  --modeles DOSSIER      un autre dossier de modèles
  --sans-navigateur      ne pas ouvrir la fenêtre
```

---

## 💾 Formater la clé sans rien perdre

1. Copie sur ton PC : `lexos-ia/ia/` (le moteur et les modèles), `ollama-models/`, et `MOTEUR-INTERFACE/` (tes données).
2. Formate : **ext4** si la clé sert seulement sur Linux, **exFAT** si tu l'utilises aussi sur Windows. L'interface marche dans les deux cas.
3. Remets les dossiers, ou reprends l'interface de ce dépôt, puis double-clique sur `LANCER-MOTEUR.sh`.

---

**Licences :** les polices incluses sont sous licence SIL Open Font License (voir `MOTEUR-INTERFACE/interface/polices/LICENCE-*.txt`).
