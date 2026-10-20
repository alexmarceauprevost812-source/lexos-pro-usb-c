# TI-LEX Local — IA locale sur clé USB-C (Android)

App Expo / React Native. L'IA (llama.cpp via `llama.rn`) roule **dans le téléphone** et lit le
modèle `.gguf` **directement sur la clé USB-C**, sans le copier.

## Les écrans
- **Clé** : détecte la clé, trouve les `.gguf`, charge le modèle (barre de chargement, logo animé).
- **Chat** : discussion avec l'IA, réponses en direct, avatars, tok/s.
- **Codex** : feuilles de code (fichiers) + l'IA qui code dedans.
  - 3 animations pour changer de feuille, choisies en haut à droite :
    - **Zoom** : dézoom → glisse de côté vers l'autre fenêtre → zoom
    - **↔ Côté** : la feuille glisse horizontalement
    - **↕ Haut** : la nouvelle feuille monte par en bas et pousse l'autre
  - Change de feuille en touchant l'onglet ou en glissant le doigt à gauche/droite.
  - `+` = nouvelle feuille, appui long sur l'onglet actif = supprimer.


## Signer ton APK avec TA clé (sans GitHub)
L'APK du build est signée avec une clé « debug » (bonne pour toi, pas pour distribuer largement).
Pour la signer avec ta propre clé — sur ton Ubuntu / Kali, sans GitHub :
```bash
cd mobile/signature
bash creer-cle.sh            # une seule fois : crée ta clé (garde le .jks et les mots de passe !)
bash signer-apk.sh LexOS-Mobile.apk   # signe n'importe quelle APK (locale ou téléchargée de GitHub)
```
Besoin : Java (`sudo apt install default-jdk`) et l'Android SDK (`apksigner`, fourni par Android Studio).
⚠️ Garde ta clé `.jks` et tes mots de passe en lieu sûr : c'est ton identité d'auteur. Perdue = tu ne peux plus mettre à jour une app publiée avec.

## Construire l'APK

### Option A — GitHub (le plus simple, rien à installer)
L'app est dans le dépôt `lexos-pro-usb-c`, dossier `mobile/`. Le build se lance tout seul quand `mobile/` change.
1. Va sur le dépôt → onglet **Actions** → **APK LexOS Mobile**.
2. Ouvre le dernier build (ou **Run workflow** pour en relancer un).
3. ~15-25 min plus tard : télécharge **LexOS-Mobile-apk** en bas de la page du build.

### Option B — Sur ton Ubuntu / Kali
Besoin : Node 20+, Java 17, Android SDK (Android Studio l'installe).
```bash
./build-apk-ubuntu.sh
```

## Sur le téléphone
1. Installe l'APK (autorise « sources inconnues »).
2. Branche la clé USB-C.
3. Onglet **Clé** → « Donner l'accès aux fichiers de la clé » → active-le pour TI-LEX Local.
4. Touche un modèle dans la liste (ou « Choisir un .gguf à la main » → va dans la clé).

## Important
- Le téléphone fait le calcul avec SA RAM. Un modèle de **3-5 Go max** (ex. `qwen3-4b` Q4) est réaliste.
  `Qwen3-Coder-30B-A3B` (~18 Go) ne rentrera pas sur la plupart des téléphones.
- Une clé USB est plus lente que la mémoire du téléphone : le chargement peut prendre une minute.
- L'APK est signé avec la clé de debug (correct pour toi, pas pour le Play Store).
- **Téléphone qui rame ?** Écran **Clé** → réglage **Animations** : éteins-les pour alléger l'app.
- Pas encore dans cette version : vision (photos) et recherche web.
