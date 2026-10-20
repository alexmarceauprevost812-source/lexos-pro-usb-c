#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────────
#  LexOS IA — prépare la clé USB-C avec les IA locales (à lancer sous Linux)
#
#  Copie sur la clé :
#    lexos-ia/                 le terminal LexOS IA, les lanceurs, les icônes
#    lexos-ia/apps/            LexOS Textes
#    lexos-ia/ia/ollama-*      le moteur Ollama portable (Linux, et Windows en option)
#    lexos-ia/ia/modeles/      les modèles IA (plusieurs, voir modeles.txt)
#    ACTIVER-IA.sh / .bat      les boutons « un clic » à la racine de la clé
#
#  Usage :
#    bash usb/installer-sur-cle.sh /media/$USER/MACLE [options]
#
#  Options :
#    --profil 1|2|3   1 = léger (≈3 Go) · 2 = complet (≈16 Go, défaut) · 3 = tout (≈40 Go)
#    --windows        ajoute aussi le moteur pour Windows (≈1,5 Go de plus)
#    --arm64          moteur Linux ARM au lieu de x86-64
#    --sans-moteur    ne télécharge pas Ollama (mise à jour du code seulement)
#    --sans-modeles   ne télécharge pas les modèles
#    --sans-rea       n'ajoute pas REA (agent ti-lex, dépôt ti-lex-ia-REA-)
#    --modele NOM     télécharge seulement ce modèle (répétable). Ex. : --modele gemma4:26b
#    --images         ajoute la création d'images Z-Image Turbo (≈ 8 Go, gratuit, hors ligne)
#    --forcer         continuer même sur une clé FAT32
#
#  Internet est requis pendant la préparation, plus après.
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail
DEPOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORANGE=$'\033[38;2;224;96;32m'; VERT=$'\033[38;2;53;214;76m'; GRIS=$'\033[90m'; ROUGE=$'\033[91m'; RAZ=$'\033[0m'
etape() { echo; echo "${ORANGE}▸ $*${RAZ}"; }
erreur() { echo "${ROUGE}✗ $*${RAZ}" >&2; exit 1; }

IMAGES=0; VOULUS=(); CLE=""; PROFIL=2; WINDOWS=0; ARCH=amd64; MOTEUR=1; MODELES=1; FORCER=0; REA=1
while [ $# -gt 0 ]; do
  case "$1" in
    --profil) PROFIL="${2:-}"; shift ;;
    --windows) WINDOWS=1 ;;
    --arm64) ARCH=arm64 ;;
    --sans-moteur) MOTEUR=0 ;;
    --sans-modeles) MODELES=0 ;;
    --sans-rea) REA=0 ;;
    --images) IMAGES=1 ;;
    --modele) [ -n "${2:-}" ] || erreur "--modele : indique un nom (ex. gemma4:26b)"; VOULUS+=("$2"); shift ;;
    --forcer) FORCER=1 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    -*) erreur "option inconnue : $1" ;;
    *) CLE="$1" ;;
  esac
  shift
done
[ ${#VOULUS[@]} -eq 0 ] || MODELES=1   # --modele : on télécharge au moins celui-là
[ -n "$CLE" ] || erreur "indique le dossier de la clé.  Ex. : bash usb/installer-sur-cle.sh /media/$USER/LEXOS"
[ -d "$CLE" ] && [ -w "$CLE" ] || erreur "$CLE n'existe pas ou n'est pas accessible en écriture."
case "$PROFIL" in 1|2|3) ;; *) erreur "--profil doit être 1, 2 ou 3" ;; esac
CLE="$(cd "$CLE" && pwd)"
DEST="$CLE/lexos-ia"
IA="$DEST/ia"
TMP="${XDG_CACHE_HOME:-$HOME/.cache}/lexos-ia/telechargements"
mkdir -p "$TMP"

echo "${ORANGE}LexOS IA — préparation de la clé USB-C${RAZ}"
echo "${GRIS}Clé : $CLE${RAZ}"

# ── Vérifier le format de la clé ────────────────────────────────────────────
FS="$(findmnt -no FSTYPE --target "$CLE" 2>/dev/null || echo inconnu)"
LIBRE="$(df -h --output=avail "$CLE" | tail -1 | tr -d ' ')"
echo "${GRIS}Format : $FS · espace libre : $LIBRE${RAZ}"
if [ "$FS" = "vfat" ] || [ "$FS" = "msdos" ]; then
  echo "${ROUGE}La clé est en FAT32 : les fichiers de plus de 4 Go (gros modèles) ne passent pas.${RAZ}"
  echo "Formate-la en exFAT (Linux + Windows) ou ext4 (Linux seulement)."
  [ "$FORCER" = 1 ] || erreur "arrêt (ajoute --forcer pour continuer quand même)."
fi

# ── 1. Copier LexOS IA sur la clé (sans toucher aux modèles ni à la config) ─
etape "Copie de LexOS IA sur la clé"
mkdir -p "$DEST/apps" "$IA/modeles"
for f in lexos_ia.py lexos_ia_app.py images_ia.py rea_lexos.py ACTIVER-IA.sh ACTIVER-IA.bat raccourcis-bureau.sh; do
  cp "$DEPOT/lexos-ia/$f" "$DEST/$f"
done
mkdir -p "$DEST/icones" && cp "$DEPOT"/lexos-ia/icones/*.svg "$DEST/icones/"
rm -rf "$DEST/app" && cp -r "$DEPOT/lexos-ia/app" "$DEST/app"
cp "$DEPOT/modeles.txt" "$DEST/modeles.txt"
if [ -f "$DEPOT/../desktop/lexos_textes.py" ]; then
  cp "$DEPOT/../desktop/lexos_textes.py" "$DEST/apps/lexos_textes.py"
fi
chmod +x "$DEST"/*.sh 2>/dev/null || true

# Boutons « un clic » à la racine de la clé
cat >"$CLE/ACTIVER-IA.sh" <<'EOF'
#!/usr/bin/env bash
# LexOS IA — un clic : active les IA de la clé et ouvre le terminal IA.
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lexos-ia/ACTIVER-IA.sh" "$@"
EOF
printf '@echo off\r\nrem LexOS IA - un clic : active les IA de la cle et ouvre le terminal IA.\r\ncall "%%~dp0lexos-ia\\ACTIVER-IA.bat" %%*\r\n' >"$CLE/ACTIVER-IA.bat"
cat >"$CLE/APP-IA.sh" <<'FIN_APP'
#!/usr/bin/env bash
# TI-LEX-AL — un clic : active les IA de la clé et ouvre l'application (Agent AL, Codex, CodexTerminal).
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lexos-ia/ACTIVER-IA.sh" app
FIN_APP
printf '@echo off\r\nrem TI-LEX-AL - un clic : active les IA de la cle et ouvre l application.\r\ncall "%%~dp0lexos-ia\\ACTIVER-IA.bat" app\r\n' >"$CLE/APP-IA.bat"
chmod +x "$CLE/ACTIVER-IA.sh" "$CLE/APP-IA.sh" 2>/dev/null || true
cat >"$CLE/LISEZ-MOI-IA.txt" <<'EOF'
LexOS IA — les IA locales sont sur cette clé USB-C
==================================================

UN CLIC — APPLICATION TI-LEX-AL (fenêtre comme ti-lex v10) :
  Linux   : double-clic sur APP-IA.sh (ou : bash APP-IA.sh)
  Windows : double-clic sur APP-IA.bat
  Menu à gauche : Chat (Agent AL, photos), Codex, Équipe IA, REA, Images, Projets, Cerveau.

UN CLIC — VERSION TERMINAL :
  Linux   : double-clic sur ACTIVER-IA.sh (ou dans un terminal : bash ACTIVER-IA.sh)
  Windows : double-clic sur ACTIVER-IA.bat

Le terminal LexOS IA s'ouvre avec :
  1 Chat           discuter avec l'IA
  2 Codex          écrire et corriger du code
  3 CodexTerminal  l'IA travaille dans le terminal (avec ta permission)
  4 Modèles        voir, choisir, télécharger

ICÔNES SUR LE BUREAU DU PC (Linux, une seule fois par PC) :
  bash lexos-ia/raccourcis-bureau.sh

Tout fonctionne sans Internet. Quitter (0) arrête les IA.
Python 3 doit être présent sur le PC.
EOF
# Moteur d'interface portable (LANCER-MOTEUR) à la racine de la clé.
# Seul le code est remplacé : conversations, projets, fonds et schémas restent.
if [ -d "$DEPOT/moteur-interface/MOTEUR-INTERFACE" ]; then
  MI="$CLE/MOTEUR-INTERFACE"
  mkdir -p "$MI"
  rm -rf "${MI:?}/interface" && cp -r "$DEPOT/moteur-interface/MOTEUR-INTERFACE/interface" "$MI/interface"
  cp "$DEPOT/moteur-interface/MOTEUR-INTERFACE/moteur.py" "$MI/moteur.py"
  for f in LANCER-MOTEUR.sh LANCER-MOTEUR.bat LISEZ-MOI-MOTEUR.txt; do
    cp "$DEPOT/moteur-interface/$f" "$CLE/$f"
  done
  sed "s|^Icon=.*|Icon=$MI/interface/logo.png|" "$DEPOT/moteur-interface/LexOS-Moteur.desktop" >"$CLE/LexOS-Moteur.desktop"
  chmod +x "$CLE/LANCER-MOTEUR.sh" "$CLE/LexOS-Moteur.desktop" 2>/dev/null || true
fi
echo "${VERT}✔ code, lanceurs et icônes copiés${RAZ}"

# ── 2. Moteur Ollama portable ───────────────────────────────────────────────
telecharger() {  # url fichier
  echo "${GRIS}$1${RAZ}"
  rm -f "$2"
  curl -fL --retry 3 --progress-bar -o "$2" "$1"
}
URL_OLLAMA="https://github.com/ollama/ollama/releases/latest/download"
LOCAL_LINUX="$TMP/ollama-linux-$ARCH"

if [ "$MOTEUR" = 1 ]; then
  etape "Moteur Ollama pour Linux ($ARCH) — environ 1,5 Go"
  command -v curl >/dev/null || erreur "curl est requis : sudo apt install curl"
  rm -rf "$LOCAL_LINUX" && mkdir -p "$LOCAL_LINUX"
  if command -v zstd >/dev/null && telecharger "$URL_OLLAMA/ollama-linux-$ARCH.tar.zst" "$TMP/ollama-linux-$ARCH.tar.zst"; then
    tar --use-compress-program=unzstd -xf "$TMP/ollama-linux-$ARCH.tar.zst" -C "$LOCAL_LINUX"
  elif telecharger "$URL_OLLAMA/ollama-linux-$ARCH.tgz" "$TMP/ollama-linux-$ARCH.tgz" 2>/dev/null; then
    tar -xzf "$TMP/ollama-linux-$ARCH.tgz" -C "$LOCAL_LINUX"
  else
    command -v zstd >/dev/null || erreur "zstd est requis pour décompresser Ollama : sudo apt install zstd"
    erreur "téléchargement d'Ollama impossible."
  fi
  [ -f "$LOCAL_LINUX/bin/ollama" ] || erreur "archive Ollama inattendue (bin/ollama absent)."
  echo "${GRIS}Copie sur la clé…${RAZ}"
  rm -rf "$IA/ollama-linux-$ARCH"
  mkdir -p "$IA/ollama-linux-$ARCH"
  # -L : copie les liens comme de vrais fichiers (exFAT ne gère pas les liens)
  cp -rL "$LOCAL_LINUX/." "$IA/ollama-linux-$ARCH/"
  chmod +x "$IA/ollama-linux-$ARCH/bin/ollama" 2>/dev/null || true
  VERSION_OLLAMA="$("$LOCAL_LINUX/bin/ollama" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | tail -1 || true)"
  echo "${VERT}✔ moteur Linux : Ollama ${VERSION_OLLAMA:-installé}${RAZ}"

  if [ "$WINDOWS" = 1 ]; then
    etape "Moteur Ollama pour Windows — environ 1,5 Go"
    telecharger "$URL_OLLAMA/ollama-windows-amd64.zip" "$TMP/ollama-windows-amd64.zip"
    rm -rf "$IA/ollama-windows" && mkdir -p "$IA/ollama-windows"
    if command -v unzip >/dev/null; then
      unzip -q "$TMP/ollama-windows-amd64.zip" -d "$IA/ollama-windows"
    else
      python3 -m zipfile -e "$TMP/ollama-windows-amd64.zip" "$IA/ollama-windows"
    fi
    echo "${VERT}✔ moteur Windows copié${RAZ}"
  fi
fi

# ── 3. Modèles IA, téléchargés directement sur la clé ───────────────────────
if [ "$MODELES" = 1 ]; then
  if [ ${#VOULUS[@]} -gt 0 ]; then etape "Modèles IA : ${VOULUS[*]}"; else etape "Modèles IA (profil $PROFIL)"; fi
  if [ -x "$LOCAL_LINUX/bin/ollama" ]; then
    OLLAMA="$LOCAL_LINUX/bin/ollama"
  elif [ -x "$IA/ollama-linux-$ARCH/bin/ollama" ]; then
    OLLAMA="$IA/ollama-linux-$ARCH/bin/ollama"
  elif command -v ollama >/dev/null; then
    OLLAMA="$(command -v ollama)"
  else
    erreur "aucun moteur Ollama pour télécharger les modèles (relance sans --sans-moteur)."
  fi
  export OLLAMA_MODELS="$IA/modeles"
  export OLLAMA_HOST="127.0.0.1:11439"   # port à part : n'interfère pas avec un Ollama du PC
  "$OLLAMA" serve >"$TMP/ollama-installation.log" 2>&1 &
  PID=$!
  trap 'kill $PID 2>/dev/null || true' EXIT
  for _ in $(seq 1 60); do (exec 3<>/dev/tcp/127.0.0.1/11439) 2>/dev/null && break; sleep 0.5; done
  (exec 3<>/dev/tcp/127.0.0.1/11439) 2>/dev/null || erreur "le moteur n'a pas démarré (voir $TMP/ollama-installation.log)."

  # Liste à télécharger : les modèles demandés (--modele) ou ceux du profil.
  A_TELECHARGER=()
  if [ ${#VOULUS[@]} -gt 0 ]; then
    A_TELECHARGER=("${VOULUS[@]}")
  else
    while read -r profil modele _; do
      case "$profil" in ''|\#*) continue ;; esac
      [ "$profil" -le "$PROFIL" ] 2>/dev/null && A_TELECHARGER+=("$modele")
    done <"$DEPOT/modeles.txt"
  fi
  ECHECS=()
  for modele in "${A_TELECHARGER[@]}"; do
    # Assez de place sur la clé ? (taille indiquée dans modeles.txt, en Go)
    besoin="$(awk -v m="$modele" '$2 == m { gsub(",", ".", $4); print $4; exit }' "$DEPOT/modeles.txt")"
    libre="$(df -Pk "$CLE" | awk 'NR == 2 { printf "%.1f", $4 / 1024 / 1024 }')"
    if [ -n "$besoin" ] && [ -n "$libre" ] && awk -v b="$besoin" -v l="$libre" 'BEGIN { exit !(l < b + 1) }'; then
      echo "${ROUGE}✗ $modele : il faut ≈ $besoin Go, il reste $libre Go sur la clé.${RAZ}"
      echo "${GRIS}  Libère de la place (Cerveau → 🗑 sur un modèle), puis relance.${RAZ}"
      ECHECS+=("$modele"); continue
    fi
    echo "${ORANGE}↓ $modele${RAZ}${besoin:+ ${GRIS}(≈ $besoin Go · $libre Go libres sur la clé)${RAZ}}"
    if ! "$OLLAMA" pull "$modele"; then
      ECHECS+=("$modele")
      echo "${GRIS}  Si le message parle de « newer version » : relance sans --sans-moteur (moteur à jour).${RAZ}"
    fi
  done
  kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; trap - EXIT
  echo
  [ ${#ECHECS[@]} -eq 0 ] || echo "${ROUGE}Non installés : ${ECHECS[*]}${RAZ}"
fi

# ── 4. REA : l'agent ti-lex (web, vision, fichiers, commandes) ──────────────
# Dernière version du dépôt GitHub ti-lex-ia-REA-. Seul le cœur de l'agent
# (agent + outils + mémoire) est copié : pas l'installateur ni les modes Heretic.
if [ "$REA" = 1 ]; then
  etape "REA — l'agent ti-lex (dernière version sur GitHub)"
  URL_REA="https://github.com/alexmarceauprevost812-source/ti-lex-ia-REA-/archive/refs/heads/main.tar.gz"
  rm -rf "$TMP/rea"
  if { command -v git >/dev/null && git clone --quiet --depth 1 "https://github.com/alexmarceauprevost812-source/ti-lex-ia-REA-" "$TMP/rea" 2>/dev/null; } \
     || { rm -rf "$TMP/rea" && mkdir -p "$TMP/rea" && curl -fsSL "$URL_REA" | tar -xz -C "$TMP/rea" --strip-components=1; }; then
    rm -rf "$DEST/rea/ti_lex_agent" && mkdir -p "$DEST/rea/ti_lex_agent"
    MANQUE=0
    for f in __init__.py agent.py config.py memory.py ollama_client.py params.py tools.py; do
      cp "$TMP/rea/ti_lex_agent/$f" "$DEST/rea/ti_lex_agent/$f" 2>/dev/null || MANQUE=1
    done
    if [ "$MANQUE" = 1 ]; then
      echo "${ROUGE}REA : la structure du dépôt a changé, des fichiers manquent.${RAZ}"
    else
      echo "${GRIS}Dépendances de REA (requests, ddgs) sur la clé…${RAZ}"
      if python3 -m pip install --quiet --upgrade --target "$DEST/rea/libs" requests ddgs 2>/dev/null \
         || python3 -m pip install --quiet --upgrade --break-system-packages --target "$DEST/rea/libs" requests ddgs; then
        echo "${VERT}✔ REA ajouté : bash $CLE/lexos-ia/ACTIVER-IA.sh rea  (ou menu de l'app → REA)${RAZ}"
      else
        echo "${ROUGE}pip est requis pour REA : sudo apt install python3-pip, puis relance l'installateur.${RAZ}"
      fi
    fi
  else
    echo "${ROUGE}REA non téléchargé (Internet ?). Relance plus tard avec --sans-moteur --sans-modeles.${RAZ}"
  fi
fi

# ── 5. Images : Z-Image Turbo avec stable-diffusion.cpp (MIT) ───────────────
# Moteur : dernière version de github.com/leejet/stable-diffusion.cpp (Vulkan :
# NVIDIA, AMD, Intel ; + une version « processeur » de secours).
# Modèle : Z-Image Turbo (Alibaba, Apache 2.0 : images libres de droits).
if [ "$IMAGES" = 1 ]; then
  etape "Images — Z-Image Turbo (≈ 8 Go)"
  IMG="$DEST/images-ia"
  mkdir -p "$IMG/modeles"
  HF="https://huggingface.co"
  FICHIERS_IMAGES="$HF/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q6_K.gguf 5.3
$HF/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf 2.5
$HF/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors 0.4"
  ECHECS_IMG=()
  # 1) le moteur sd-cli
  if INFO="$(curl -fsSL --retry 3 https://api.github.com/repos/leejet/stable-diffusion.cpp/releases/latest)"; then
    choisir() {  # motif → URL du zip correspondant dans la dernière version
      printf '%s' "$INFO" | python3 -c 'import json,re,sys
for a in json.load(sys.stdin).get("assets", []):
    if re.search(sys.argv[1], a["name"]):
        print(a["browser_download_url"]); break' "$1"
    }
    for cible in "linux|Linux-.*-x86_64-vulkan\.zip$" "linux-cpu|Linux-.*-x86_64\.zip$" \
                 "windows|bin-win-vulkan-x64\.zip$" "windows-cpu|bin-win-avx2-x64\.zip$"; do
      dossier="${cible%%|*}"; motif="${cible#*|}"
      case "$dossier" in windows*) [ "$WINDOWS" = 1 ] || continue ;; esac
      [ "$ARCH" = arm64 ] && case "$dossier" in linux*) continue ;; esac
      url="$(choisir "$motif")"
      if [ -z "$url" ]; then
        [ "$dossier" = windows-cpu ] || ECHECS_IMG+=("moteur $dossier"); continue
      fi
      echo "${ORANGE}↓ moteur $dossier${RAZ}"
      if telecharger "$url" "$TMP/sd-$dossier.zip"; then
        rm -rf "${IMG:?}/${dossier:?}" && mkdir -p "$IMG/$dossier"
        python3 -m zipfile -e "$TMP/sd-$dossier.zip" "$IMG/$dossier/"
        # le zip peut contenir un sous-dossier : on remonte tout à plat
        find "$IMG/$dossier" -mindepth 2 -type f -exec mv -f {} "$IMG/$dossier/" \; 2>/dev/null || true
        chmod +x "$IMG/$dossier"/sd-* 2>/dev/null || true
        rm -f "$TMP/sd-$dossier.zip"
      else
        ECHECS_IMG+=("moteur $dossier")
      fi
    done
  else
    ECHECS_IMG+=("moteur (GitHub ne répond pas)")
  fi
  # 2) les trois fichiers du modèle, directement sur la clé (reprise si coupé)
  while read -r url go; do
    nom="${url##*/}"
    if [ -f "$IMG/modeles/$nom" ]; then echo "${VERT}✔ $nom déjà sur la clé${RAZ}"; continue; fi
    libre="$(df -Pk "$CLE" | awk 'NR == 2 { printf "%.1f", $4 / 1024 / 1024 }')"
    if awk -v b="$go" -v l="$libre" 'BEGIN { exit !(l < b + 0.5) }'; then
      echo "${ROUGE}✗ $nom : il faut ≈ $go Go, il reste $libre Go sur la clé.${RAZ}"; ECHECS_IMG+=("$nom"); continue
    fi
    echo "${ORANGE}↓ $nom${RAZ} ${GRIS}(≈ $go Go)${RAZ}"
    if curl -fL --retry 3 -C - --progress-bar -o "$IMG/modeles/$nom.part" "$url"; then
      mv -f "$IMG/modeles/$nom.part" "$IMG/modeles/$nom"
    else
      ECHECS_IMG+=("$nom")
      echo "${GRIS}  Relance la même commande : le téléchargement reprendra où il était rendu.${RAZ}"
    fi
  done <<<"$FICHIERS_IMAGES"
  if [ ${#ECHECS_IMG[@]} -eq 0 ]; then
    echo "${VERT}✔ Z-Image Turbo prêt : menu 🎨 Images dans TI-LEX-AL (ou « /image … » dans le Chat)${RAZ}"
  else
    echo "${ROUGE}Images — non installé : ${ECHECS_IMG[*]}${RAZ}"
  fi
fi

# ── Résumé ──────────────────────────────────────────────────────────────────
etape "Écriture sur la clé (sync)…"
sync
echo
echo "${VERT}✔ Clé LexOS IA prête.${RAZ}"
echo "${GRIS}Taille de lexos-ia : $(du -sh "$DEST" 2>/dev/null | cut -f1) · espace libre : $(df -h --output=avail "$CLE" | tail -1 | tr -d ' ')${RAZ}"
echo
echo "  Application :     ${ORANGE}bash $CLE/APP-IA.sh${RAZ}  (Windows : APP-IA.bat)"
echo "  Terminal IA :     ${ORANGE}bash $CLE/ACTIVER-IA.sh${RAZ}  (Windows : ACTIVER-IA.bat)"
echo "  Icônes bureau :   ${ORANGE}bash \"$DEST/raccourcis-bureau.sh\"${RAZ}"
echo "  Les téléchargements temporaires sont dans $TMP (tu peux les effacer)."
