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
#    --nettoyer      NE FORMATE PAS : efface tout sur la clé sauf les modèles IA
#                    (et le Cerveau), puis réinstalle. Aucune copie sur le PC.
#    --sauvegarde DOSSIER  où copier les modèles avant de formater (défaut : ~)
#    --restaurer DOSSIER   remet une sauvegarde (~/lexos-sauvegarde-…) sur une clé
#                          déjà formatée, sans rien formater (si quelque chose a raté)
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

CLE=""; MEMOIRE=1; OPTIONS=(); RESTAURER=""; NETTOYER=0; BASE_SAUVE="$HOME"; SAUVE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --images|--windows) OPTIONS+=("$1") ;;
    --sans-memoire) MEMOIRE=0 ;;
    --nettoyer) NETTOYER=1 ;;
    --sauvegarde) BASE_SAUVE="${2:-}"; [ -n "$BASE_SAUVE" ] || erreur "--sauvegarde : indique un dossier"; shift ;;
    --restaurer) RESTAURER="${2:-}"; [ -n "$RESTAURER" ] || erreur "--restaurer : indique le dossier de sauvegarde"; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    -*) erreur "option inconnue : $1" ;;
    *) CLE="$1" ;;
  esac
  shift
done
[ -z "${SUDO_USER:-}" ] || erreur "lance ce script SANS sudo (il demandera le mot de passe lui-même) :  bash usb/reformater-cle.sh …"
[ -n "$CLE" ] || erreur "indique le dossier de la clé.  Ex. : bash usb/reformater-cle.sh /media/$USER/LEXOS"
[ -d "$CLE" ] || erreur "$CLE n'existe pas. Branche la clé et vérifie son nom (ls /media/$USER)."
CLE="$(cd "$CLE" && pwd)"
cd "$HOME"   # un terminal ouvert dans la clé empêcherait de la démonter
SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"
PATH="$PATH:/usr/sbin:/sbin"

compter() {  # nombre de fichiers + octets (indépendant du format du disque)
  find "$1" -type f -printf '%s\n' | awk '{ n++; s += $1 } END { printf "%d fichiers, %d octets", n, s }'
}
copier_verifier() {  # source destination élément
  mkdir -p "$2/$(dirname "$3")"
  rm -rf "${2:?}/${3:?}"
  echo "${GRIS}  $3 …${RAZ}"
  cp -r "$1/$3" "$2/$3"
  local a b; a="$(compter "$1/$3")"; b="$(compter "$2/$3")"
  [ "$a" = "$b" ] || erreur "la copie de $3 est incomplète ($b au lieu de $a)."
}

# ── Disque de la clé + vérifications (rien n'est touché ici) ────────────────
PARTITION="$(findmnt -fno SOURCE --target "$CLE" 2>/dev/null || true)"
[ -n "$PARTITION" ] && [ -b "$PARTITION" ] || erreur "$CLE n'est pas une clé montée."
case "$(lsblk -dno TYPE "$PARTITION" 2>/dev/null)" in
  part|disk) ;;
  *) erreur "$PARTITION n'est pas une partition simple (clé chiffrée ou LVM ?) : je ne la touche pas." ;;
esac
DISQUE="/dev/$(lsblk -no PKNAME "$PARTITION" | awk 'NR == 1')"
[ "$DISQUE" != "/dev/" ] || DISQUE="$PARTITION"   # clé sans table de partitions
[ -b "$DISQUE" ] || erreur "impossible de trouver le disque de $PARTITION."
[ "$(findmnt -fno TARGET --target "$CLE")" != "/" ] || erreur "$CLE est sur le disque du système : refusé."
TRANSPORT="$(lsblk -dno TRAN "$DISQUE" 2>/dev/null | tr -d ' ')"
if [ "$TRANSPORT" != usb ]; then
  erreur "$DISQUE n'est pas une clé USB (type : ${TRANSPORT:-inconnu}). Par sécurité, je ne formate que des clés USB."
fi
while read -r _ point; do   # aucun morceau du système (/, /boot, /home…) sur ce disque
  case "$point" in
    /|/boot|/boot/efi|/home|/usr|/var|"[SWAP]") erreur "$DISQUE contient $point (système du PC) : refusé." ;;
  esac
done < <(lsblk -nlpo NAME,MOUNTPOINT "$DISQUE")
case "$DEPOT" in "$CLE"/*) erreur "lance ce script depuis le dossier lexos-pro-usb-c du PC, pas depuis la clé." ;; esac
IDENTITE="$(lsblk -dno SERIAL,SIZE,MODEL "$DISQUE" 2>/dev/null | xargs || true)"
TAILLE_DISQUE="$(lsblk -dno SIZE "$DISQUE" | tr -d ' ')"
MODELE_DISQUE="$(lsblk -dno VENDOR,MODEL "$DISQUE" 2>/dev/null | xargs || true)"

# En cas de pépin après le formatage : dire exactement quoi faire
PHASE=""
secours() {
  local code=$?
  [ "$code" = 0 ] && return
  case "$PHASE" in
    formatage|retour)
      echo
      echo "${ROUGE}${GRAS}Ça a bloqué, mais tes modèles sont en sécurité dans : $SAUVE${RAZ}"
      echo "  1. Débranche et rebranche la clé. Si elle n'apparaît pas, formate-la avec l'app « Disques » (exFAT, nom $NOM)."
      echo "  2. Puis remets les modèles :"
      echo "     ${ORANGE}bash \"$DEPOT/reformater-cle.sh\" /media/$USER/$NOM --restaurer \"$SAUVE\"${OPTIONS[*]:+ ${OPTIONS[*]}}${RAZ}" ;;
    installation)
      echo
      echo "${ROUGE}L'installation n'a pas fini, mais tes modèles sont sur la clé${SAUVE:+ (copie aussi dans $SAUVE)}.${RAZ}"
      echo "  Relance :  ${ORANGE}bash \"$DEPOT/installer-sur-cle.sh\" \"$CLE\" --sans-modeles${OPTIONS[*]:+ ${OPTIONS[*]}}${RAZ}" ;;
  esac
}
trap secours EXIT

remettre_et_installer() {
  PHASE="retour"
  etape "Les modèles retournent sur la clé ($CLE)"
  [ -w "$CLE" ] || erreur "la clé n'est pas modifiable par toi ($CLE)."
  for g in "${GARDER[@]}"; do copier_verifier "$SAUVE" "$CLE" "$g"; done
  sync
  echo "${VERT}✔ modèles remis sur la clé et vérifiés${RAZ}"
  PHASE="installation"
  etape "Nouvelle interface LexOS IA"
  bash "$DEPOT/installer-sur-cle.sh" "$CLE" --sans-modeles ${OPTIONS[@]+"${OPTIONS[@]}"}
  PHASE=""
  echo
  echo "${VERT}${GRAS}✔ Clé toute neuve, avec tes modèles IA (copie vérifiée).${RAZ}"
  echo "  Ouvre l'app :   ${ORANGE}bash $CLE/APP-IA.sh${RAZ}"
  [ -z "$SAUVE" ] || echo "  Quand tout marche, efface la copie du PC :  ${GRIS}rm -rf \"$SAUVE\"${RAZ}"
}

# ── Mode --restaurer : remettre une sauvegarde sur une clé déjà formatée ────
if [ -n "$RESTAURER" ]; then
  SAUVE="$(cd "$RESTAURER" 2>/dev/null && pwd)" || erreur "sauvegarde introuvable : $RESTAURER"
  echo "${ORANGE}${GRAS}LexOS IA — remettre la sauvegarde sur la clé${RAZ}"
  GARDER=()
  for g in lexos-ia/ia/modeles lexos-ia/images-ia/modeles lexos-ia/memoire lexos-ia/config.json; do
    [ -e "$SAUVE/$g" ] && GARDER+=("$g")
  done
  [ ${#GARDER[@]} -gt 0 ] || erreur "$SAUVE ne contient pas de modèles LexOS."
  remettre_et_installer
  exit 0
fi

# ── Mode --nettoyer : tout effacer sauf les modèles, sans formater ──────────
if [ "$NETTOYER" = 1 ]; then
  echo "${ORANGE}${GRAS}LexOS IA — nettoyer la clé en gardant les modèles IA (sans formater)${RAZ}"
  [ -d "$CLE/lexos-ia" ] || erreur "$CLE ne contient pas lexos-ia : ce n'est pas ta clé LexOS IA. Rien n'a été touché."
  shopt -s dotglob nullglob
  GARDE=(ia images-ia)
  [ "$MEMOIRE" = 1 ] && GARDE+=(memoire config.json)
  garde() { local x; for x in "${GARDE[@]}"; do [ "$1" = "$x" ] && return 0; done; return 1; }
  etape "On garde"
  for g in "${GARDE[@]}"; do
    [ -e "$CLE/lexos-ia/$g" ] && echo "  ${VERT}✔${RAZ} lexos-ia/$g ${GRIS}($(du -sh "$CLE/lexos-ia/$g" | cut -f1))${RAZ}"
  done
  if [ -d "$CLE/lexos-ia/ia/modeles/manifests" ]; then
    find "$CLE/lexos-ia/ia/modeles/manifests" -mindepth 3 -type f 2>/dev/null \
      | sed -E 's#.*/manifests/[^/]+/(library/)?##; s#/#:#' | awk 'NR <= 20 { print "      • " $0 }'
  fi
  etape "On efface"
  EFFACER=()
  for f in "$CLE"/*; do [ "${f##*/}" = lexos-ia ] || EFFACER+=("$f"); done
  for f in "$CLE"/lexos-ia/*; do garde "${f##*/}" || EFFACER+=("$f"); done
  for f in "${EFFACER[@]}"; do
    echo "  ${ROUGE}✗${RAZ} ${f#"$CLE"/} ${GRIS}($(du -sh "$f" 2>/dev/null | cut -f1))${RAZ}"
  done | awk 'NR <= 60'
  [ ${#EFFACER[@]} -gt 0 ] || echo "${GRIS}  (rien à effacer)${RAZ}"
  echo
  echo "${GRAS}Clé : $CLE · $TAILLE_DISQUE · ${MODELE_DISQUE:-clé USB}${RAZ}  ${GRIS}(espace libre : $(df -h --output=avail "$CLE" | tail -1 | tr -d ' '))${RAZ}"
  printf '%s' "Pour effacer tout ça (les modèles restent), tape ${GRAS}OUI${RAZ} en majuscules : "
  read -r reponse || reponse=""
  [ "$reponse" = OUI ] || { echo "Annulé : rien n'a été touché."; exit 0; }
  etape "Nettoyage"
  for f in "${EFFACER[@]}"; do rm -rf "${f:?}"; done
  sync
  echo "${VERT}✔ clé nettoyée · espace libre : $(df -h --output=avail "$CLE" | tail -1 | tr -d ' ')${RAZ}"
  shopt -u dotglob nullglob
  PHASE="installation"
  etape "Nouvelle interface LexOS IA"
  bash "$DEPOT/installer-sur-cle.sh" "$CLE" --sans-modeles ${OPTIONS[@]+"${OPTIONS[@]}"}
  PHASE=""
  echo
  echo "${VERT}${GRAS}✔ Clé propre, avec tes modèles IA.${RAZ}"
  echo "  TI-LEX-AL :     ${ORANGE}bash $CLE/APP-IA.sh${RAZ}"
  echo "  LexOS Moteur :  ${ORANGE}bash $CLE/LANCER-MOTEUR.sh${RAZ}"
  exit 0
fi

echo "${ORANGE}${GRAS}LexOS IA — reformater la clé en gardant les modèles IA${RAZ}"
for outil in wipefs parted mkfs.exfat; do
  command -v "$outil" >/dev/null || {
    [ "$outil" = mkfs.exfat ] && erreur "mkfs.exfat manque. Installe-le puis relance :  sudo apt install exfatprogs"
    [ "$outil" = parted ] && erreur "parted manque. Installe-le puis relance :  sudo apt install parted"
    erreur "$outil manque sur ce PC."
  }
done
[ -d "$CLE/lexos-ia" ] || erreur "$CLE ne contient pas lexos-ia : ce n'est pas ta clé LexOS IA. Rien n'a été touché."

# ── 1. Ce qu'on garde / ce qui sera effacé ──────────────────────────────────
etape "Ce qu'on garde"
[ -d "$BASE_SAUVE" ] && [ -w "$BASE_SAUVE" ] || erreur "dossier de sauvegarde introuvable ou non modifiable : $BASE_SAUVE"
BASE_SAUVE="$(cd "$BASE_SAUVE" && pwd)"
SOURCE_SAUVE="$(findmnt -fno SOURCE --target "$BASE_SAUVE" 2>/dev/null || true)"
case "$SOURCE_SAUVE" in "$DISQUE"*) erreur "la sauvegarde ne peut pas aller sur la clé elle-même." ;; esac
SAUVE="$BASE_SAUVE/lexos-sauvegarde-$(date +%Y%m%d-%H%M%S)"
[ ! -e "$SAUVE" ] || erreur "$SAUVE existe déjà : attends une seconde et relance."
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
if [ -d "$CLE/lexos-ia/ia/modeles/manifests" ]; then
  find "$CLE/lexos-ia/ia/modeles/manifests" -mindepth 3 -type f 2>/dev/null \
    | sed -E 's#.*/manifests/[^/]+/(library/)?##; s#/#:#' | awk 'NR <= 20 { print "      • " $0 }'
fi
LIBRE_PC_KO="$(df -Pk "$BASE_SAUVE" | awk 'NR == 2 { print $4 }')"
if [ "$LIBRE_PC_KO" -lt $((BESOIN_KO + 1048576)) ]; then
  echo "${ROUGE}✗ pas assez de place pour la copie : il faut $((BESOIN_KO / 1048576 + 1)) Go, il reste $((LIBRE_PC_KO / 1048576)) Go dans $BASE_SAUVE.${RAZ}" >&2
  echo "  Rien n'a été touché. Deux solutions :" >&2
  echo "  • sans formater (aucune copie) :  ${ORANGE}bash usb/reformater-cle.sh $CLE --nettoyer${OPTIONS[*]:+ ${OPTIONS[*]}}${RAZ}" >&2
  echo "  • copie sur un autre disque     :  ${ORANGE}bash usb/reformater-cle.sh $CLE --sauvegarde /chemin/disque${OPTIONS[*]:+ ${OPTIONS[*]}}${RAZ}" >&2
  exit 1
fi

etape "Ce qui sera EFFACÉ"
for f in "$CLE"/*; do
  [ -e "$f" ] || continue
  case "${f#"$CLE"/}" in lexos-ia|ACTIVER-IA.*|APP-IA.*|LISEZ-MOI-IA.txt) continue ;; esac
  echo "  ${ROUGE}✗${RAZ} ${f#"$CLE"/}"
done | awk 'NR <= 40'
for d in projets conversations images; do
  if [ -d "$CLE/lexos-ia/$d" ]; then
    echo "  ${ROUGE}✗${RAZ} lexos-ia/$d ${GRIS}($(find "$CLE/lexos-ia/$d" -mindepth 1 -maxdepth 1 | wc -l) éléments)${RAZ}"
  fi
done
[ "$MEMOIRE" = 1 ] || echo "  ${ROUGE}✗${RAZ} lexos-ia/memoire (Cerveau) ${GRIS}(--sans-memoire)${RAZ}"

echo
echo "${GRAS}Clé à formater : ${ORANGE}$DISQUE${RAZ}${GRAS} · $TAILLE_DISQUE · ${MODELE_DISQUE:-clé USB} · montée sur $CLE${RAZ}"
echo "Les modèles seront d'abord copiés dans ${GRIS}$SAUVE${RAZ}"
if [ -n "$SUDO" ]; then   # mot de passe demandé maintenant, pas après 10 minutes de copie
  echo "${GRIS}Mot de passe de l'ordinateur (pour formater) :${RAZ}"
  $SUDO -v || erreur "mot de passe refusé : rien n'a été touché."
  ( while kill -0 $$ 2>/dev/null; do $SUDO -n true 2>/dev/null; sleep 50; done ) &
fi
printf '%s' "Pour TOUT effacer sur cette clé, tape ${GRAS}OUI${RAZ} en majuscules : "
read -r reponse || reponse=""
[ "$reponse" = OUI ] || { echo "Annulé : rien n'a été touché."; exit 0; }

etape "1/3 · Copie des modèles sur le PC"
mkdir -p "$SAUVE"
for g in "${GARDER[@]}"; do copier_verifier "$CLE" "$SAUVE" "$g"; done
echo "${VERT}✔ modèles en sécurité (copie vérifiée) dans $SAUVE${RAZ}"

# ── 2. Formatage ────────────────────────────────────────────────────────────
etape "2/3 · Formatage de la clé en exFAT ($NOM)"
[ "$(lsblk -dno SERIAL,SIZE,MODEL "$DISQUE" 2>/dev/null | xargs || true)" = "$IDENTITE" ] \
  || erreur "la clé a changé pendant la copie ($DISQUE n'est plus la même) : rien n'a été effacé."
PHASE="formatage"
sync
demonter() {
  for p in $(lsblk -nlpo NAME "$DISQUE"); do
    if findmnt -rno TARGET -S "$p" >/dev/null 2>&1; then
      udisksctl unmount -b "$p" >/dev/null 2>&1 || $SUDO umount "$p" \
        || erreur "impossible de démonter $p (ferme les fenêtres ouvertes sur la clé)."
    fi
  done
}
demonter
# Effacer les signatures de chaque partition puis du disque (sinon le bureau
# reconnaît l'ancienne clé et la remonte avant le formatage)
for p in $(lsblk -nlpo NAME "$DISQUE" | tac); do $SUDO wipefs -a -q "$p"; done
$SUDO parted -s "$DISQUE" mklabel msdos mkpart primary ntfs 1MiB 100%
$SUDO partprobe "$DISQUE" 2>/dev/null || true
NOUVELLE=""
for _ in $(seq 1 30); do
  if command -v udevadm >/dev/null; then $SUDO udevadm settle 2>/dev/null || true; fi
  NOUVELLE="$(lsblk -nlpo NAME,TYPE "$DISQUE" | awk '$2 == "part" { print $1; exit }')"
  [ -n "$NOUVELLE" ] && [ -b "$NOUVELLE" ] && break
  sleep 0.5
done
[ -n "$NOUVELLE" ] && [ -b "$NOUVELLE" ] || erreur "la nouvelle partition n'apparaît pas."
$SUDO wipefs -a -q "$NOUVELLE"
demonter
$SUDO mkfs.exfat -L "$NOM" "$NOUVELLE" >/dev/null
echo "${VERT}✔ clé formatée : $NOUVELLE (exFAT, $NOM)${RAZ}"

# ── 3. Remonter la clé (le bureau le fait parfois tout seul) ────────────────
PHASE="retour"
if command -v udevadm >/dev/null; then $SUDO udevadm settle 2>/dev/null || true; fi
CLE=""
for _ in $(seq 1 20); do
  CLE="$(findmnt -fno TARGET -S "$NOUVELLE" 2>/dev/null || true)"
  [ -n "$CLE" ] && break
  if command -v udisksctl >/dev/null; then udisksctl mount -b "$NOUVELLE" >/dev/null 2>&1 || true; fi
  CLE="$(findmnt -fno TARGET -S "$NOUVELLE" 2>/dev/null || true)"
  [ -n "$CLE" ] && break
  sleep 0.5
done
if [ -z "$CLE" ]; then
  CLE="/media/$USER/$NOM"
  $SUDO mkdir -p "$CLE"
  $SUDO mount -t exfat -o "uid=$(id -u),gid=$(id -g)" "$NOUVELLE" "$CLE" || erreur "impossible de monter la clé."
fi
remettre_et_installer
