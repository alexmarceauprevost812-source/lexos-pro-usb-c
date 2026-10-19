#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────────
#  LexOS IA — active les IA locales de la clé USB-C en un clic (Linux)
#
#  1. ouvre un terminal (si on a double-cliqué)
#  2. démarre le moteur Ollama DE LA CLÉ avec les modèles DE LA CLÉ
#  3. lance le terminal LexOS IA : Chat · Codex · CodexTerminal · Modèles
#  4. arrête le moteur en quittant — rien ne reste installé sur le PC
#
#  Usage : bash ACTIVER-IA.sh [chat|codex|codexterminal|modeles|textes]
# ───────────────────────────────────────────────────────────────────────────
set -u
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-}"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/lexos-ia"
ORANGE=$'\033[38;2;224;96;32m'; GRIS=$'\033[90m'; ROUGE=$'\033[91m'; RAZ=$'\033[0m'

pause_et_sortir() { echo; read -r -p "Appuie sur Entrée pour fermer…" _ </dev/tty 2>/dev/null; exit "${1:-1}"; }

# ── 1. Pas dans un terminal (double-clic) ? On en ouvre un. ─────────────────
if [ "$MODE" != "textes" ] && [ -z "${LEXOS_IA_SANS_TERMINAL:-}" ] && { [ ! -t 0 ] || [ ! -t 1 ]; }; then
  SOI="$ICI/ACTIVER-IA.sh"
  for t in x-terminal-emulator xfce4-terminal qterminal gnome-terminal konsole kgx tilix mate-terminal lxterminal xterm; do
    command -v "$t" >/dev/null 2>&1 || continue
    case "$t" in
      gnome-terminal|kgx|tilix) exec "$t" -- bash "$SOI" "$@" ;;
      xfce4-terminal|mate-terminal) exec "$t" -x bash "$SOI" "$@" ;;
      qterminal|lxterminal) exec "$t" -e "bash $(printf '%q' "$SOI") $*" ;;
      *) exec "$t" -e bash "$SOI" "$@" ;;
    esac
  done
  command -v notify-send >/dev/null && notify-send "LexOS IA" "Aucun terminal trouvé sur ce PC."
  exit 1
fi

# ── 2. Trouver le moteur Ollama sur la clé ──────────────────────────────────
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "${ROUGE}Processeur $(uname -m) non pris en charge.${RAZ}"; pause_et_sortir ;;
esac
MOTEUR="$ICI/ia/ollama-linux-$ARCH"
export OLLAMA_MODELS="$ICI/ia/modeles"
mkdir -p "$OLLAMA_MODELS" "$CACHE" 2>/dev/null

OLLAMA=""
if [ -f "$MOTEUR/bin/ollama" ]; then
  if [ -x "$MOTEUR/bin/ollama" ] && "$MOTEUR/bin/ollama" --version >/dev/null 2>&1; then
    OLLAMA="$MOTEUR/bin/ollama"
  else
    # Clé en exFAT/FAT montée sans droit d'exécution : on copie le moteur
    # une seule fois dans ~/.cache (les modèles restent sur la clé).
    LOCAL="$CACHE/ollama-linux-$ARCH"
    TAILLE_CLE="$(stat -c %s "$MOTEUR/bin/ollama")"
    if [ ! -x "$LOCAL/bin/ollama" ] || [ "$(stat -c %s "$LOCAL/bin/ollama")" != "$TAILLE_CLE" ]; then
      echo "${GRIS}Première fois sur ce PC : copie du moteur IA (1 à 3 minutes)…${RAZ}"
      rm -rf "$LOCAL" && mkdir -p "$LOCAL" && cp -r "$MOTEUR/." "$LOCAL/" && chmod +x "$LOCAL/bin/ollama"
    fi
    OLLAMA="$LOCAL/bin/ollama"
  fi
elif command -v ollama >/dev/null 2>&1; then
  echo "${GRIS}Moteur absent de la clé : j'utilise l'Ollama du PC avec les modèles de la clé.${RAZ}"
  OLLAMA="$(command -v ollama)"
else
  echo "${ROUGE}Le moteur IA n'est pas sur la clé.${RAZ}"
  echo "Prépare la clé avec :  bash usb/installer-sur-cle.sh /chemin/de/la/cle"
  pause_et_sortir
fi

# ── 3. Démarrer le moteur (port 11434, ou 11435 si un Ollama tourne déjà) ──
port_ouvert() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
PORT=11434
if port_ouvert 11434; then
  PORT=11435
  echo "${GRIS}Un Ollama tourne déjà sur ce PC : la clé utilise le port 11435.${RAZ}"
fi
if port_ouvert "$PORT"; then
  echo "${ROUGE}Le port $PORT est déjà pris. Ferme l'autre LexOS IA et réessaie.${RAZ}"
  pause_et_sortir
fi
export OLLAMA_HOST="127.0.0.1:$PORT"
export LEXOS_IA_HOTE="127.0.0.1:$PORT"
JOURNAL="$CACHE/ollama.log"

printf '%s' "${ORANGE}Activation des IA de la clé…${RAZ} "
"$OLLAMA" serve >"$JOURNAL" 2>&1 &
PID=$!
arreter() { kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; }
trap arreter EXIT
trap 'exit 130' INT TERM HUP

for _ in $(seq 1 60); do
  port_ouvert "$PORT" && break
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
if ! port_ouvert "$PORT"; then
  echo; echo "${ROUGE}Le moteur IA n'a pas démarré. Journal : $JOURNAL${RAZ}"
  tail -n 15 "$JOURNAL" 2>/dev/null
  pause_et_sortir
fi
echo "${ORANGE}prêt ✔${RAZ}"

# ── 4. Lancer LexOS IA (ou LexOS Textes) ────────────────────────────────────
PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
  echo "${ROUGE}Python 3 est requis sur ce PC (sudo apt install python3).${RAZ}"; pause_et_sortir
fi
if [ "$MODE" = "textes" ]; then
  "$PY" "$ICI/apps/lexos_textes.py"
  exit $?
fi
cd "$HOME" 2>/dev/null || true
"$PY" "$ICI/lexos_ia.py" ${MODE:+"$MODE"}
CODE=$?
[ "$CODE" -ne 0 ] && pause_et_sortir "$CODE"
exit 0
