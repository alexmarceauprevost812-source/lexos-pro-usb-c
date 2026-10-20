#!/usr/bin/env bash
# Signer une APK avec TA clé (sans GitHub). Marche sur l'APK du build local
# ou sur celle téléchargée de GitHub. Besoin : Android SDK (apksigner) + Java.
#   bash signer-apk.sh mon-app.apk ma-cle-lexos.jks lexos
set -e
APK="$1"; CLE="${2:-ma-cle-lexos.jks}"; ALIAS="${3:-lexos}"
[ -f "$APK" ] || { echo "Usage : bash signer-apk.sh TON-APK.apk [cle.jks] [alias]"; exit 1; }
[ -f "$CLE" ] || { echo "✗ clé introuvable : $CLE  (crée-la avec  bash creer-cle.sh)"; exit 1; }

# Trouver apksigner (dans l'Android SDK) et zipalign
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
trouver() { command -v "$1" 2>/dev/null || ls "$SDK"/build-tools/*/"$1" 2>/dev/null | sort -V | tail -1; }
APKSIGNER="$(trouver apksigner)"; ZIPALIGN="$(trouver zipalign)"
[ -n "$APKSIGNER" ] || { echo "✗ apksigner introuvable. Installe l'Android SDK (Android Studio), ou mets ANDROID_HOME."; exit 1; }

BASE="${APK%.apk}"; ALIGNEE="${BASE}-aligne.apk"; SIGNEE="${BASE}-signe.apk"
echo "▸ Alignement…"
if [ -n "$ZIPALIGN" ]; then "$ZIPALIGN" -f -p 4 "$APK" "$ALIGNEE"; else cp "$APK" "$ALIGNEE"; fi
echo "▸ Signature avec $CLE (alias $ALIAS)…  (mot de passe de la clé demandé)"
"$APKSIGNER" sign --ks "$CLE" --ks-key-alias "$ALIAS" --out "$SIGNEE" "$ALIGNEE"
rm -f "$ALIGNEE" "${SIGNEE}.idsig" 2>/dev/null || true
echo "▸ Vérification…"
"$APKSIGNER" verify --print-certs "$SIGNEE" >/dev/null && echo "✔ Signature valide."
echo
echo "✔ APK signée : $SIGNEE"
echo "  Installe-la sur le téléphone (autorise les sources inconnues)."
