#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────────
#  LexOS IA — active les IA locales de la clé USB-C en un clic (Linux)
#
#  1. ouvre un terminal (si on a double-cliqué)
#  2. démarre le moteur Ollama DE LA CLÉ avec les modèles DE LA CLÉ
#  3. lance le terminal LexOS IA : Chat · Codex · CodexTerminal · Modèles
#  4. arrête le moteur en quittant — rien ne reste installé sur le PC
#
#  Usage : bash ACTIVER-IA.sh [app|chat|codex|codexterminal|modeles|textes]
#          app = l'application TI-LEX-AL (fenêtre graphique, sans terminal)
# ───────────────────────────────────────────────────────────────────────────
set -u
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-}"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/lexos-ia"
ORANGE=$'\033[38;2;224;96;32m'; GRIS=$'\033[90m'; ROUGE=$'\033[91m'; RAZ=$'\033[0m'

pause_et_sortir() {
  [ -t 1 ] || { command -v notify-send >/dev/null && notify-send "LexOS IA" "Les IA n'ont pas pu démarrer. Lance ACTIVER-IA.sh dans un terminal pour voir le détail."; }
  echo; read -r -p "Appuie sur Entrée pour fermer…" _ </dev/tty 2>/dev/null; exit "${1:-1}"
}

# ── 1. Pas dans un terminal (double-clic) ? On en ouvre un. ─────────────────
case "$MODE" in app|textes) SANS_TERMINAL=1 ;; *) SANS_TERMINAL="${LEXOS_IA_SANS_TERMINAL:-}" ;; esac
if [ "$MODE" = "app" ] && [ ! -t 1 ] && command -v notify-send >/dev/null; then
  notify-send -i "$ICI/app/images/tilexal.png" "TI-LEX-AL" "Activation des IA de la clé…"
fi
if [ -z "$SANS_TERMINAL" ] && { [ ! -t 0 ] || [ ! -t 1 ]; }; then
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

# ── 3. Démarrer le moteur (port 11434, ou le suivant libre) ─────────────────
PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
  echo "${ROUGE}Python 3 est requis sur ce PC (sudo apt install python3).${RAZ}"; pause_et_sortir
fi
port_ouvert() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
# Le port s'ouvre AVANT que le moteur réponde (il détecte d'abord la carte
# graphique) : on attend donc une vraie réponse HTTP.
ia_repond() {
  "$PY" -c 'import sys,urllib.request as u
u.build_opener(u.ProxyHandler({})).open("http://127.0.0.1:%s/api/version" % sys.argv[1], timeout=3).read()' "$1" 2>/dev/null
}
# Un moteur de la clé resté allumé (terminal fermé d'un coup) ? S'il n'a plus
# de lanceur vivant, on l'arrête. Vérification stricte : seulement un vrai
# « …/lexos-ia/…/bin/ollama serve ». L'Ollama du PC n'est jamais touché.
OUBLIES="$("$PY" - 2>/dev/null <<'FIN_PY'
import os
n = 0
for pid in filter(str.isdigit, os.listdir("/proc")):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            args = [a.decode(errors="replace") for a in f.read().split(b"\0") if a]
        i = next(i for i, a in enumerate(args[:2]) if a.endswith("/bin/ollama") and "lexos-ia/" in a)
        if args[i + 1:i + 2] != ["serve"]:
            continue
        with open(f"/proc/{pid}/stat") as f:
            ppid = f.read().rsplit(")", 1)[1].split()[1]
        with open(f"/proc/{ppid}/cmdline", "rb") as f:
            parent = f.read().replace(b"\0", b" ").decode(errors="replace")
        if "ACTIVER-IA.sh" in parent or "installer-sur-cle.sh" in parent:
            continue
        os.kill(int(pid), 15)
        n += 1
    except (StopIteration, OSError, IndexError, ValueError):
        continue
print(n)
FIN_PY
)"
if [ "${OUBLIES:-0}" -gt 0 ] 2>/dev/null; then
  echo "${GRIS}Moteur IA oublié d'une session précédente : arrêté.${RAZ}"
  sleep 1
fi
# Premier port libre : 11434 (normal), sinon 11435, 11436…
PORT=""
for p in 11434 11435 11436 11437 11438 11439 11440; do
  port_ouvert "$p" || { PORT="$p"; break; }
done
if [ -z "$PORT" ]; then
  echo "${ROUGE}Aucun port libre (11434 à 11440). Redémarre le PC puis réessaie.${RAZ}"
  pause_et_sortir
fi
[ "$PORT" != 11434 ] && echo "${GRIS}Un Ollama tourne déjà sur ce PC : la clé utilise le port $PORT.${RAZ}"
export OLLAMA_HOST="127.0.0.1:$PORT"
export LEXOS_IA_HOTE="127.0.0.1:$PORT"
JOURNAL="$CACHE/ollama.log"

printf '%s' "${ORANGE}Activation des IA de la clé…${RAZ} "
"$OLLAMA" serve >"$JOURNAL" 2>&1 &
PID=$!
arreter() { kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; }
trap arreter EXIT
trap 'exit 130' INT TERM HUP

DEBUT=$SECONDS
AVERTI=0
until ia_repond "$PORT"; do
  if ! kill -0 "$PID" 2>/dev/null || [ $((SECONDS - DEBUT)) -ge 240 ]; then break; fi
  if [ "$AVERTI" = 0 ] && [ $((SECONDS - DEBUT)) -ge 5 ]; then
    printf '\n%s' "${GRIS}(détection de la carte graphique : la 1re fois sur un PC peut prendre 1 à 3 minutes)${RAZ} "
    AVERTI=1
  fi
  printf '.'
  sleep 1
done
if ! ia_repond "$PORT"; then
  echo; echo "${ROUGE}Le moteur IA n'a pas démarré. Journal : $JOURNAL${RAZ}"
  tail -n 15 "$JOURNAL" 2>/dev/null
  pause_et_sortir
fi
echo "${ORANGE}prêt ✔${RAZ}"

# ── 4. Lancer LexOS IA (ou LexOS Textes) ────────────────────────────────────
if [ "$MODE" = "textes" ]; then
  "$PY" "$ICI/apps/lexos_textes.py"
  exit $?
fi
if [ "$MODE" = "app" ]; then
  "$PY" "$ICI/lexos_ia_app.py"
  exit $?
fi
cd "$HOME" 2>/dev/null || true
"$PY" "$ICI/lexos_ia.py" ${MODE:+"$MODE"}
CODE=$?
[ "$CODE" -ne 0 ] && pause_et_sortir "$CODE"
exit 0
