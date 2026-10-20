#!/usr/bin/env bash
# Créer ta clé de signature d'APK (une seule fois). Besoin : Java (keytool).
# Garde bien le fichier .jks et tes mots de passe : c'est TON identité d'auteur.
# Si tu la perds, tu ne pourras plus mettre à jour une app déjà publiée avec.
set -e
CLE="${1:-ma-cle-lexos.jks}"
ALIAS="${2:-lexos}"
command -v keytool >/dev/null || { echo "✗ keytool manque. Installe Java :  sudo apt install default-jdk"; exit 1; }
if [ -f "$CLE" ]; then echo "✗ $CLE existe déjà. Choisis un autre nom ou garde celle-là."; exit 1; fi
echo "On crée ta clé de signature : $CLE (alias : $ALIAS)"
echo "keytool va te demander 2 mots de passe (garde-les !) et quelques infos (tu peux laisser vide)."
keytool -genkeypair -v -keystore "$CLE" -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000
echo
echo "✔ Clé créée : $CLE"
echo "  Garde ce fichier et tes mots de passe en lieu sûr (clé USB, gestionnaire de mots de passe)."
echo "  Pour signer une APK :  bash signer-apk.sh TON-APK.apk \"$CLE\" \"$ALIAS\""
