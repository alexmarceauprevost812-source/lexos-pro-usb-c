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
- ⚠️ La création d'images d'Ollama est **expérimentale** : il faut Linux avec une carte NVIDIA (CUDA), ou un Mac, et une version récente d'Ollama. Les gros modèles demandent beaucoup de mémoire vidéo.

### 🎬 Schémas animés
- Tu décris un schéma (l'IA l'écrit) ou tu l'écris toi-même : `[A] -> [B] : action`.
- L'animation se construit comme un montage vidéo : boîtes qui rebondissent, flèches qui se dessinent, billes qui circulent dans les liens.
- **Export vidéo `.webm` 1920×1080** et image PNG, gardés sur la clé (`MOTEUR-INTERFACE/schemas`).

### ⚙️ Paramètres
- **25 couleurs**, plus 🌈 arc-en-ciel et ta couleur à toi.
- **20 polices** incluses sur la clé, qui marchent sans Internet.
- La taille du texte.
- **7 fonds animés** : Constellation, Aurore, Hyperespace, Pluie de code, Vagues, Braises, Noir. Tu peux aussi mettre **ta propre image**, avec flou, assombrissement et zoom cinéma.
- Tout est gardé **sur la clé**, donc ton style te suit sur tous les PC.

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
    ├── interface/         ← l'interface (HTML/CSS/JS, polices incluses)
    ├── acces.json         ← empreinte du mot de passe        (privé, pas sur GitHub)
    ├── conversations/ projets/ images/ schemas/ fonds/        (privé, pas sur GitHub)
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
