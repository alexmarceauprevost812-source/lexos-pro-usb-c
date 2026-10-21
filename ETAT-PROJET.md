# État du projet LexOS USB-C (récap du 21 oct. 2026)

À relire au début d'une session Claude Code sur ce projet.

## 1. Clés USB-C (matériel)
- **Ancienne clé (~115 Go)** : ext4, lisible seulement sous Linux (boot Kali / Ubuntu). Ne jamais la formater sous Windows : elle contient un modèle d'environ 18 Go + Z-Image Turbo.
- **Clé « LEXOS » bleue (64 Go)** : exFAT, clé principale Windows + Linux. Reformatée via `usb/reformater-cle.sh` (mode `--nettoyer` : préserve les modèles IA).
- **Nouvelle 2e clé (en cours)** : exFAT, Windows + Linux + Android. Moteurs IA portables (type llamafile) + scripts de lancement `.bat` / `.sh` / `.command`. Pour Android : petit modèle de 2–4 Go.

## 2. Terminal Python — `usb/lexos-ia/lexos_ia.py`
Modes Chat / Codex / CodexTerminal / Models, connecté à un Ollama portable sur la clé (llama3.2, qwen3, qwen2.5-coder, un gemma plus gros).

## 3. Interface web « TI-LEX-AL » — `lexos_ia_app.py` + `app/index.html`
Photo, Codex (coloration), équipe IA multi-agents (Architecte / Codeur / Réviseur), diagrammes Mermaid animés (export MP4), Projets avec sync GitHub, Studio (sandbox), mémoire / apprentissage, mode réflexion, REA intégré (cartes d'outils + permissions), images locales Z-Image Turbo, panneaux tâches / directions.

## 4. Interface « LexOS Moteur » — `MOTEUR-INTERFACE/`
Coexiste avec la précédente. Verrou par mot de passe, coffre chiffré, Turbo REA, fonctions cloud, partage de projet par jeton GitHub (API Git Data), panneau « Plan de marche » et menu d'actions à droite.

## 5. Coffre — `MOTEUR-INTERFACE/coffre.py`
scrypt + Fernet, 3 essais max, invite terminal ou Tkinter. CLI : `creer`, `ajouter`, `retirer`, `liste`, `motdepasse`.
**Perdre le mot de passe maître = perte définitive des clés.**

Clés API : `.env` + `python-dotenv` (+ `.gitignore`, `.env.example`) ; web : secrets côté serveur (Supabase Edge Functions / Vercel). Clé poussée par erreur sur GitHub : la révoquer et en regénérer une.

## 6. Application mobile — `mobile/`
React Native / Expo, APK Android. Build GitHub Actions corrigé (étape `setup-android` retirée, le runner a déjà le SDK).

## 7. GitHub
Repos : `lexos-pro-usb-c`, `ti-lex-ia-REA-`. Branche de travail actuelle : `main`. Jeton d'accès personnel en variable globale (jamais dans le dépôt).

## À faire
- [ ] Confirmer la capacité de la 2e clé pour choisir les modèles.
- [ ] Finaliser les scripts de lancement `.bat` / `.sh` / `.command` de la clé cross-plateforme.
- [ ] Choisir le petit modèle Android (2–4 Go).
