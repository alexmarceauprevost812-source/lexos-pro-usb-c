#!/usr/bin/env bash
# LexOS · Moteur d'interface portable — un clic.
# Se retrouve tout seul sur la clé, peu importe où elle est montée.
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
  command -v notify-send >/dev/null && notify-send "LexOS" "Python 3 est requis sur ce PC (sudo apt install python3)."
  echo "Python 3 est requis sur ce PC (sudo apt install python3)."; read -r -p "Entrée pour fermer…" _; exit 1
fi
# Double-clic (pas de terminal) : on en ouvre un pour voir le moteur tourner.
if [ -z "${LEXOS_DANS_TERMINAL:-}" ] && { [ ! -t 0 ] || [ ! -t 1 ]; }; then
  export LEXOS_DANS_TERMINAL=1
  SOI="$ICI/LANCER-MOTEUR.sh"
  for t in x-terminal-emulator gnome-terminal kgx konsole xfce4-terminal mate-terminal tilix qterminal lxterminal xterm; do
    command -v "$t" >/dev/null 2>&1 || continue
    case "$t" in
      gnome-terminal|kgx|tilix) exec "$t" -- bash "$SOI" "$@" ;;
      xfce4-terminal|mate-terminal) exec "$t" -x bash "$SOI" "$@" ;;
      qterminal|lxterminal) exec "$t" -e "bash $(printf '%q' "$SOI") $*" ;;
      *) exec "$t" -e bash "$SOI" "$@" ;;
    esac
  done
  # Aucun terminal : on lance quand même, en silence.
  exec "$PY" "$ICI/MOTEUR-INTERFACE/moteur.py" "$@" >/dev/null 2>&1
fi
"$PY" "$ICI/MOTEUR-INTERFACE/moteur.py" "$@"
CODE=$?
[ "$CODE" -ne 0 ] && read -r -p "Entrée pour fermer…" _
exit $CODE
