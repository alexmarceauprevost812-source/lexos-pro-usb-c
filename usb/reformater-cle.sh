#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────────
#  LexOS IA — repartir à neuf : reformater la clé USB-C en gardant les modèles IA
#
#  1. Copie sur le PC ce qui vaut la peine d'être gardé :
#       les modèles IA (Ollama + Z-Image Turbo), le Cerveau (mémoire) et tes choix
#  2. Reformate la clé en exFAT (Linux + Windows), nom LEXOS
#       → tout le reste est EFFACÉ : projets, conversations, images, autres fichiers
#  3. Remet les modèles sur la clé, puis installe la dernière version de LexOS IA
#
#  Usage :
#    bash usb/reformater-cle.sh /media/$USER/LEXOS [--images] [--windows]
#
#    --images        ajoute aussi la création d'images Z-Image Turbo
#    --windows       ajoute aussi le moteur pour Windows
#    --sans-memoire  ne garde pas le Cerveau (mémoire) ni les choix de modèles
#
#  Le mot de passe (sudo) est demandé pour formater. Rien n'est effacé tant
#  que tu n'as pas tapé OUI, et seulement si la copie des modèles est complète.
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail
DEPOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORANGE=$'\033[38;2;224;96;32m'; VERT=$'\033[38;2;53;214;76m'; GRIS=$'\033[90m'; ROUGE=$'\033[91m'; GRAS=$'\033[1m'; RAZ=$'\033[0m'
etape() { echo; echo "${ORANGE}▸ $*${RAZ}"; }
erreur() { echo "${ROUGE}✗ $*${RAZ}" >&2; exit 1; }
NOM="LEXOS"

CLE=""; MEMOIRE=1; OPTIONS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --images|--windows) OPTIONS+=("$1") ;;
    --sans-memoire) MEMOIRE=0 ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    -*) erreur "option inconnue : $1" ;;
    *) CLE="$1" ;;
  esac
  shift
done
[ -n "$CLE" ] || erreur "indique le dossier de la clé.  Ex. : bash usb/reformater-cle.sh /media/$USER/LEXOS"
[ -d "$CLE" ] || erreur "$CLE n'existe pas. Branche la clé et vérifie son nom (ls /media/$USER)."
CLE="$(cd "$CLE" && pwd)"
SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"

echo "${ORANGE}${GRAS}LexOS IA — reformater la clé en gardant les modèles IA${RAZ}"

# ── 0. Vérifications (rien n'est touché ici) ────────────────────────────────
for outil in findmnt lsblk wipefs parted mkfs.exfat; do
  command -v "$outil" >/dev/null || PATH="$PATH:/usr/sbin:/sbin"
  command -v "$outil" >/dev/null || {
    [ "$outil" = mkfs.exfat ] && erreur "mkfs.exfat manque. Installe-le puis relance :  sudo apt install exfatprogs"
    [ "$outil" = parted ] && erreur "parted manque. Installe-le puis relance :  sudo apt install parted"
    erreur "$outil manque sur ce PC."
  }
done
PARTITION="$(findmnt -no SOURCE --target "$CLE" 2>/dev/null || true)"
[ -n "$PARTITION" ] && [ -b "$PARTITION" ] || erreur "$CLE n'est pas une clé montée."
DISQUE="/dev/$(lsblk -no PKNAME "$PARTITION" | head -1)"
[ "$DISQUE" != "/dev/" ] || DISQUE="$PARTITION"   # clé sans table de partitions
[ -b "$DISQUE" ] || erreur "impossible de trouver le disque de $PARTITION."
[ "$(findmnt -no TARGET --target "$CLE")" != "/" ] || erreur "$CLE est sur le disque du système : refusé."

TRANSPORT="$(lsblk -dno TRAN "$DISQUE" 2>/dev/null | tr -d ' ')"
if [ "$TRANSPORT" != usb ]; then
  erreur "$DISQUE n'est pas une clé USB (type : ${TRANSPORT:-inconnu}). Par sécurité, je ne formate que des clés USB."
fi
# Aucun morceau du système (/, /boot, /home…) ne doit être sur ce disque
while read -r _ point; do
  case "$point" in
    /|/boot|/boot/efi|/home|/usr|/var|"[SWAP]") erreur "$DISQUE contient $point (système du PC) : refusé." ;;
  esac
done < <(lsblk -nlpo NAME,MOUNTPOINT "$DISQUE")
case "$DEPOT" in "$CLE"/*) erreur "lance ce script depuis le dossier lexos-pro-usb-c du PC, pas depuis la clé." ;; esac
[ -d "$CLE/lexos-ia" ] || erreur "$CLE ne contient pas lexos-ia : ce n'est pas ta clé LexOS IA. Rien n'a été touché."

TAILLE_DISQUE="$(lsblk -dno SIZE "$DISQUE" | tr -d ' ')"
MODELE_DISQUE="$(lsblk -dno VENDOR,MODEL "$DISQUE" 2>/dev/null | xargs || true)"

# ── 1. Ce qu'on garde → copie sur le PC ─────────────────────────────────────
etape "Ce qu'on garde"
SAUVE="$HOME/lexos-sauvegarde-$(date +%Y%m%d-%H%M)"
GARDER=()
[ -d "$CLE/lexos-ia/ia/modeles" ] && GARDER+=("lexos-ia/ia/modeles")
[ -d "$CLE/lexos-ia/images-ia/modeles" ] && GARDER+=("lexos-ia/images-ia/modeles")
if [ "$MEMOIRE" = 1 ]; then
  [ -d "$CLE/lexos-ia/memoire" ] && GARDER+=("lexos-ia/memoire")
  [ -f "$CLE/lexos-ia/config.json" ] && GARDER+=("lexos-ia/config.json")
fi
[ ${#GARDER[@]} -gt 0 ] || echo "${GRIS}(aucun modèle trouvé sur la clé : elle sera formatée vide)${RAZ}"
BESOIN_KO=0
for g in "${GARDER[@]}"; do
  ko="$(du -sk "$CLE/$g" | cut -f1)"; BESOIN_KO=$((BESOIN_KO + ko))
  echo "  ${VERT}✔${RAZ} $g ${GRIS}($(du -sh "$CLE/$g" | cut -f1))${RAZ}"
done
if [ -f "$CLE/lexos-ia/ia/modeles/manifests" ] || [ -d "$CLE/lexos-ia/ia/modeles/manifests" ]; then
  find "$CLE/lexos-ia/ia/modeles/manifests" -mindepth 3 -type f 2>/dev/null \
    | sed -E 's#.*/manifests/[^/]+/(library/)?##; s#/#:#' | sed 's/^/      • /' | head -20
fi
LIBRE_PC_KO="$(df -Pk "$HOME" | awk 'NR == 2 { print $4 }')"
if [ "$LIBRE_PC_KO" -lt $((BESOIN_KO + 1048576)) ]; then
  erreur "pas assez de place sur le PC pour garder les modèles : il faut $((BESOIN_KO / 1048576 + 1)) Go, il reste $((LIBRE_PC_KO / 1048576)) Go dans $HOME."
fi

etape "Ce qui sera EFFACÉ"
for f in "$CLE"/*; do
  [ -e "$f" ] || continue
  case "${f#"$CLE"/}" in lexos-ia|ACTIVER-IA.*|APP-IA.*|LISEZ-MOI-IA.txt) continue ;; esac
  echo "  ${ROUGE}✗${RAZ} ${f#"$CLE"/}"
done | head -40
for d in projets conversations images; do
  [ -d "$CLE/lexos-ia/$d" ] && echo "  ${ROUGE}✗${RAZ} lexos-ia/$d ${GRIS}($(find "$CLE/lexos-ia/$d" -mindepth 1 -maxdepth 1 | wc -l) éléments)${RAZ}"
done
[ "$MEMOIRE" = 1 ] || echo "  ${ROUGE}✗${RAZ} lexos-ia/memoire (Cerveau) ${GRIS}(--sans-memoire)${RAZ}"

echo
echo "${GRAS}Clé à formater : ${ORANGE}$DISQUE${RAZ}${GRAS} · $TAILLE_DISQUE · ${MODELE_DISQUE:-clé USB} · montée sur $CLE${RAZ}"
echo "Les modèles seront d'abord copiés dans ${GRIS}$SAUVE${RAZ}"
printf '%s' "Pour TOUT effacer sur cette clé, tape ${GRAS}OUI${RAZ} en majuscules : "
read -r reponse
[ "$reponse" = OUI ] || { echo "Annulé : rien n'a été touché."; exit 0; }

compter() {  # nombre de fichiers + octets (indépendant du format du disque)
  find "$1" -type f -printf '%s\n' | awk '{ n++; s += $1 } END { printf "%d fichiers, %d octets", n, s }'
}
etape "1/4 · Copie des modèles sur le PC"
mkdir -p "$SAUVE"
for g in "${GARDER[@]}"; do
  mkdir -p "$SAUVE/$(dirname "$g")"
  echo "${GRIS}  $g …${RAZ}"
  cp -r "$CLE/$g" "$SAUVE/$g"
done
# Vérification : même nombre de fichiers et même taille, sinon on n'efface rien
for g in "${GARDER[@]}"; do
  a="$(compter "$CLE/$g")"; b="$(compter "$SAUVE/$g")"
  [ "$a" = "$b" ] || erreur "la copie de $g est incomplète ($a ≠ $b). Rien n'a été effacé ; la copie est dans $SAUVE."
done
echo "${VERT}✔ modèles en sécurité dans $SAUVE${RAZ}"

etape "2/4 · Formatage de la clé en exFAT ($NOM)"
sync
for p in $(lsblk -nlpo NAME "$DISQUE"); do
  if findmnt -rno TARGET -S "$p" >/dev/null 2>&1; then
    udisksctl unmount -b "$p" >/dev/null 2>&1 || $SUDO umount "$p" || erreur "impossible de démonter $p (ferme les fenêtres ouvertes sur la clé)."
  fi
done
$SUDO wipefs -a -q "$DISQUE"
$SUDO parted -s "$DISQUE" mklabel msdos mkpart primary ntfs 1MiB 100%
$SUDO partprobe "$DISQUE" 2>/dev/null || true
command -v udevadm >/dev/null && $SUDO udevadm settle || sleep 2
NOUVELLE="$(lsblk -nlpo NAME,TYPE "$DISQUE" | awk '$2 == "part" { print $1; exit }')"
[ -n "$NOUVELLE" ] || erreur "la nouvelle partition n'apparaît pas. Débranche et rebranche la clé, puis relance : tes modèles sont dans $SAUVE."
$SUDO mkfs.exfat -L "$NOM" "$NOUVELLE" >/dev/null
echo "${VERT}✔ clé formatée : $NOUVELLE (exFAT, $NOM)${RAZ}"

etape "3/4 · Les modèles retournent sur la clé"
CLE="$(findmnt -no TARGET -S "$NOUVELLE" 2>/dev/null || true)"   # déjà montée par le bureau ?
if [ -z "$CLE" ] && command -v udisksctl >/dev/null; then
  CLE="$(udisksctl mount -b "$NOUVELLE" 2>/dev/null | sed -n 's/.* at \(.*\)$/\1/p' | sed 's/\.$//')"
fi
if [ -z "$CLE" ] || [ ! -d "$CLE" ]; then
  CLE="/media/$USER/$NOM"
  $SUDO mkdir -p "$CLE"
  $SUDO mount -o "uid=$(id -u),gid=$(id -g)" "$NOUVELLE" "$CLE" || erreur "impossible de monter la clé. Rebranche-la, puis : bash usb/installer-sur-cle.sh /media/$USER/$NOM (modèles dans $SAUVE)."
fi
for g in "${GARDER[@]}"; do
  mkdir -p "$CLE/$(dirname "$g")"
  echo "${GRIS}  $g …${RAZ}"
  cp -r "$SAUVE/$g" "$CLE/$g"
done
sync
echo "${VERT}✔ modèles remis sur la clé ($CLE)${RAZ}"

etape "4/4 · Nouvelle interface LexOS IA"
bash "$DEPOT/installer-sur-cle.sh" "$CLE" --sans-modeles ${OPTIONS[@]+"${OPTIONS[@]}"}

echo
echo "${VERT}${GRAS}✔ Clé toute neuve, avec tes modèles IA.${RAZ}"
echo "  Ouvre l'app :   ${ORANGE}bash $CLE/APP-IA.sh${RAZ}"
echo "  Quand tout marche, efface la copie du PC :  ${GRIS}rm -rf \"$SAUVE\"${RAZ}"
