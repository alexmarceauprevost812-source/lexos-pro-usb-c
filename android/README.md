# LexOS Textes — première base Android

Interface française, écriture hors ligne et export dans un dossier choisi sur le téléphone ou une clé USB via le sélecteur Android.

## État réel
Le moteur d’IA n’est pas intégré. Aucun modèle GGUF n’est inclus. Cette première base crée des projets et sauvegarde des textes écrits ou collés. Les textes UTF-8 `.txt` et `.md` de moins de 2 Mo peuvent être rouverts. Le brouillon et les noms sont mémorisés dans le téléphone après une pause de saisie et lorsque l’application passe en arrière-plan. Une sauvegarde sur la clé crée toujours une nouvelle version et conserve le fichier original.

## APK avec GitHub

Les sources se trouvent dans `android/` et le workflow dans `.github/workflows/`. À chaque envoi sur la branche `supabase`, GitHub Actions construit un APK de test. Après une exécution réussie, ouvrir **Actions → Construire APK Android → Artifacts → lexos-textes-android-apk** et extraire l’APK de l’archive téléchargée.

Cette tâche est préparée mais n’a pas encore été exécutée. Aucun APK n’est livré pour l’instant. L’APK de test ne constitue pas une version de distribution signée. Les conversations et textes personnels ne doivent pas être ajoutés au dépôt.

## Construire
Ouvrir ce dossier dans Android Studio. Utiliser JDK 17, SDK Android 35 et Gradle 8.9. Le Gradle Wrapper n’est pas fourni ; avec Gradle installé, lancer `gradle wrapper --gradle-version 8.9`. Puis construire avec `./gradlew assembleDebug` ou le menu Build APK(s).
APK attendu : `app/build/outputs/apk/debug/app-debug.apk`.
Une connexion est nécessaire pour préparer les outils de compilation, mais pas pour utiliser l’éditeur.

## Utiliser
1. Installer l’APK sur le Samsung.
2. Brancher la clé USB et choisir un sous-dossier accessible.
3. Donner un nom au projet et au texte, puis écrire et sauvegarder.
4. Vérifier `mon-projet/README.md` et `mon-projet/textes/introduction.md` dans Mes fichiers.
Les noms sont normalisés sans accents ; les fichiers existants sont conservés, avec suffixes numériques pour les nouvelles sauvegardes.

## Vérifications à effectuer sur appareil
Sauvegarder un texte français avec accents. Sauvegarder deux fois et vérifier les deux fichiers. Débrancher la clé et vérifier le message d’échec. Redémarrer l’application et vérifier l’accès mémorisé. Contrôler les noms réellement créés par le fournisseur de documents.

## Prochaine étape
Intégrer un moteur Android compatible GGUF, importer un petit modèle et générer des propositions avant sauvegarde. Tester ensuite les performances sur Galaxy S25 Ultra.

Les vérifications locales des noms sont exécutables avec `bash tests/verifier-noms.sh`. L’application complète n’a pas encore été compilée ni testée sur téléphone.
