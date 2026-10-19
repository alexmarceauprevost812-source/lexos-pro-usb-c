#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────────
#  LexOS IA — ajoute les outils IA de la clé sur le bureau de ce PC (Linux)
#
#  Icônes ajoutées (bureau + menu des applications) :
#    LexOS IA · Chat IA · Codex · CodexTerminal · Modèles IA · LexOS Textes
#  Chaque icône retrouve la clé toute seule quand elle est branchée.
#  Rien d'autre n'est installé : les IA restent sur la clé.
#
#  Usage : bash raccourcis-bureau.sh            (ajouter)
#          bash raccourcis-bureau.sh --retirer  (enlever)
# ───────────────────────────────────────────────────────────────────────────
set -eu
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$HOME/.local/bin"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONES="${XDG_DATA_HOME:-$HOME/.local/share}/icons/lexos-ia"
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/lexos-ia"
BUREAU="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
if [ -z "$BUREAU" ] || [ "$BUREAU" = "$HOME" ] || [ ! -d "$BUREAU" ]; then
  for d in "$HOME/Bureau" "$HOME/Desktop"; do [ -d "$d" ] && BUREAU="$d" && break; done
fi

#        id               nom              mode            icône     terminal  description
OUTILS="lexos-ia-app|TI-LEX-AL|app|tilexal|false|Agent AL, Codex et CodexTerminal avec les IA locales de la clé
lexos-ia|LexOS IA (terminal)||lexos-ia|true|Active les IA de la clé et ouvre le menu dans le terminal
lexos-ia-chat|Chat IA|chat|chat|true|Discuter avec une IA locale
lexos-ia-codex|Codex|codex|codex|true|Écrire et corriger du code avec une IA locale
lexos-ia-codexterminal|CodexTerminal|codexterminal|codexterminal|true|L'IA travaille dans le terminal avec ta permission
lexos-ia-modeles|Modèles IA|modeles|lexos-ia|true|Voir, choisir et télécharger les modèles de la clé
lexos-ia-rea|REA (agent)|rea|lexos-ia|true|Agent ti-lex : web, vision, fichiers du projet, commandes
lexos-ia-textes|LexOS Textes|textes|textes|false|Écrire des textes avec l'IA locale"

if [ "${1:-}" = "--retirer" ]; then
  while IFS='|' read -r id _; do
    rm -f "$APPS/$id.desktop" ${BUREAU:+"$BUREAU/$id.desktop"}
  done <<<"$OUTILS"
  rm -rf "$ICONES" "$BIN/lexos-ia-cle"
  echo "Outils LexOS IA retirés de ce PC."
  exit 0
fi

mkdir -p "$BIN" "$APPS" "$ICONES" "$CONF"
cp "$ICI"/icones/*.svg "$ICONES/"
[ -f "$ICI/app/images/tilexal.png" ] && cp "$ICI/app/images/tilexal.png" "$ICONES/tilexal.png"
echo "$ICI" >"$CONF/cle"   # dernier emplacement connu de la clé

# Petit lanceur qui retrouve la clé, même si elle change de nom de montage.
cat >"$BIN/lexos-ia-cle" <<'LANCEUR'
#!/usr/bin/env bash
# Retrouve la clé LexOS USB-C et lance ACTIVER-IA avec le mode demandé.
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/lexos-ia/cle"
trouver() {
  [ -f "$CONF" ] && d="$(cat "$CONF")" && [ -f "$d/ACTIVER-IA.sh" ] && { echo "$d"; return; }
  for d in /media/"$USER"/*/lexos-ia /run/media/"$USER"/*/lexos-ia /media/*/lexos-ia /mnt/*/lexos-ia; do
    [ -f "$d/ACTIVER-IA.sh" ] && { echo "$d"; return; }
  done
}
CLE="$(trouver)"
if [ -z "$CLE" ]; then
  echo "Branche la clé LexOS USB-C, puis relance."
  command -v notify-send >/dev/null && notify-send "LexOS IA" "Branche la clé LexOS USB-C, puis relance."
  [ -t 0 ] && read -r -p "Entrée pour fermer…" _
  exit 1
fi
echo "$CLE" >"$CONF"
exec bash "$CLE/ACTIVER-IA.sh" "$@"
LANCEUR
chmod +x "$BIN/lexos-ia-cle"

n=0
while IFS='|' read -r id nom mode icone terminal desc; do
  f="$APPS/$id.desktop"
  cat >"$f" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$nom
Comment=$desc
Exec=$BIN/lexos-ia-cle${mode:+ $mode}
Icon=$ICONES/$icone.$( [ "$icone" = tilexal ] && echo png || echo svg )
Terminal=$terminal
Categories=Development;Utility;
Keywords=IA;AI;LexOS;Ollama;Codex;Chat;
EOF
  chmod +x "$f"
  if [ -n "$BUREAU" ] && [ -d "$BUREAU" ]; then
    cp "$f" "$BUREAU/$id.desktop"
    chmod +x "$BUREAU/$id.desktop"
    # Bureau GNOME / XFCE : marquer l'icône comme fiable (sinon, clic droit → « Autoriser le lancement »)
    gio set "$BUREAU/$id.desktop" metadata::trusted true 2>/dev/null || true
    gio set "$BUREAU/$id.desktop" metadata::xfce-exe-checksum "$(sha256sum "$BUREAU/$id.desktop" | cut -d' ' -f1)" 2>/dev/null || true
  fi
  n=$((n + 1))
done <<<"$OUTILS"
update-desktop-database "$APPS" 2>/dev/null || true

echo "✔ $n outils LexOS IA ajoutés au menu des applications${BUREAU:+ et sur le bureau ($BUREAU)}."
echo "  Branche la clé, puis double-clique sur « TI-LEX-AL »."
echo "  Pour les enlever :  bash \"$ICI/raccourcis-bureau.sh\" --retirer"
