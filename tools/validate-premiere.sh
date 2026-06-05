#!/usr/bin/env bash
#
# validate-premiere.sh – Premiere-PoC-Validierung (Block B) weitgehend automatisieren.
#
# Was das Script macht:
#   1. Preflight: Fixtures/MOGRT pruefen, stoerende Prozesse beenden
#      (haengendes After Effects blockiert den MOGRT-Import via DynamicLink,
#      Befund V-5 in docs/validierung/ergebnis-2026-06-05.md).
#   2. Premiere Pro 2026 mit dem Projekt starten (Default: juengstes Autosave).
#   3. Konsolen-Befehl automatisch eintippen (Cmd+F12 -> SL.ExecuteJSFile ...)
#      – das braucht einmalig die Bedienungshilfen-Freigabe fuer das Terminal.
#      Ohne Freigabe: Befehl wird angezeigt und liegt in der Zwischenablage.
#   4. Auf das Ergebnis-Log warten und die Zusammenfassung ausgeben.
#
# Aufruf:
#   tools/validate-premiere.sh [pfad/zum/projekt.prproj] [--keep-ae] [--no-type]
#
#   --keep-ae   After Effects NICHT beenden (z. B. um den AE-Konflikt gezielt
#               noch einmal zu reproduzieren/testen)
#   --no-type   Konsolen-Befehl nicht automatisch tippen, nur anzeigen
#
set -euo pipefail

REPO="/Users/whykiki/srv/git/whykiki-stream-companion"
AUTORUN="$REPO/premiere/extendscript/run_poc_autorun.jsx"
TIMELINE="$REPO/examples/comments_timeline.json"
MAPPING="$REPO/examples/template_mapping.json"
MOGRT="/Users/whykiki/Daten/StableAudio/Github/StableAudio Helper Scripts/knowledge_base_docs/lyraaa Finetuning Video/ChatItem 1.mogrt"
AUTOSAVE_DIR="/Users/whykiki/Daten/StableAudio/Github/StableAudio Helper Scripts/knowledge_base_docs/lyraaa Finetuning Video/Adobe Premiere Pro Auto-Save"
POC_LOG="$REPO/examples/whykiki_poc_log.txt"
ERROR_FILE="$REPO/.validate_poc_error.txt"
CONSOLE_CMD="SL.ExecuteJSFile $AUTORUN"
PREMIERE_APP="Adobe Premiere Pro 2026"

KEEP_AE=0
NO_TYPE=0
PROJECT=""

for arg in "$@"; do
  case "$arg" in
    --keep-ae) KEEP_AE=1 ;;
    --no-type) NO_TYPE=1 ;;
    *.prproj)  PROJECT="$arg" ;;
    *) echo "Unbekanntes Argument: $arg"; exit 1 ;;
  esac
done

log()  { printf '\033[1;36m[validate]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warnung]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fehler]\033[0m %s\n' "$*"; exit 1; }

# ---------------------------------------------------------------- 1. Preflight
log "Preflight ..."
[[ -f "$AUTORUN" ]]  || fail "Launcher fehlt: $AUTORUN"
[[ -f "$TIMELINE" ]] || fail "Timeline-Fixture fehlt: $TIMELINE"
[[ -f "$MAPPING" ]]  || fail "Mapping fehlt: $MAPPING"
[[ -e "$MOGRT" ]]    || fail "MOGRT fehlt: $MOGRT"

if [[ "$KEEP_AE" -eq 0 ]]; then
  if pgrep -f 'After Effects 2026.app' >/dev/null 2>&1; then
    warn "After Effects laeuft – wird beendet (blockiert sonst DynamicLink, Befund V-5)."
    pkill -f 'After Effects 2026.app' 2>/dev/null || true
    sleep 3
    pkill -9 -f 'After Effects 2026.app' 2>/dev/null || true
  fi
  pkill -f 'AdobeCrashReport' 2>/dev/null || true
else
  warn "--keep-ae gesetzt: After Effects bleibt am Leben (AE-Konflikt-Test)."
fi

rm -f "$ERROR_FILE"
LOG_MTIME_BEFORE=0
[[ -f "$POC_LOG" ]] && LOG_MTIME_BEFORE=$(stat -f %m "$POC_LOG")

# ----------------------------------------------------- 2. Projekt bestimmen
if [[ -z "$PROJECT" ]]; then
  PROJECT=$(ls -t "$AUTOSAVE_DIR"/*.prproj 2>/dev/null | head -1 || true)
  [[ -n "$PROJECT" ]] || fail "Kein Autosave gefunden – Projektpfad als Argument uebergeben."
  log "Juengstes Autosave: $(basename "$PROJECT")"
fi
[[ -f "$PROJECT" ]] || fail "Projekt nicht gefunden: $PROJECT"

if pgrep -f 'Premiere Pro 2026.app/Contents/MacOS/Adobe Premiere Pro' >/dev/null 2>&1; then
  log "Premiere laeuft bereits – Projekt wird dort geoeffnet."
else
  log "Starte Premiere ..."
fi
open -a "$PREMIERE_APP" "$PROJECT"

log "Warte auf Premiere (Projekt laden) ..."
for i in $(seq 1 24); do
  sleep 5
  pgrep -f 'Premiere Pro 2026.app/Contents/MacOS/Adobe Premiere Pro' >/dev/null 2>&1 && break
done
sleep 20  # Projektladezeit

cat <<EOF

  WICHTIG: In Premiere muss jetzt eine Sequenz mit >=3 Videospuren AKTIV sein
  (Schnittfenster angeklickt). Fuer einen frischen Lauf: neue Sequenz anlegen.

EOF
read -r -p "Weiter mit Enter, wenn die Zielsequenz aktiv ist ... "

# ------------------------------------------- 3. Konsolen-Befehl ausfuehren
printf '%s' "$CONSOLE_CMD" | pbcopy
log "Konsolen-Befehl liegt in der Zwischenablage."

if [[ "$NO_TYPE" -eq 0 ]]; then
  log "Versuche, den Befehl automatisch zu tippen (Cmd+F12 -> Befehl -> Enter) ..."
  if osascript <<'APPLESCRIPT' 2>/dev/null
tell application "System Events"
  tell (first process whose name contains "Premiere")
    set frontmost to true
  end tell
  delay 1
  key code 111 using {command down} -- Cmd+F12: Konsole oeffnen
  delay 2
  keystroke "v" using {command down}  -- Befehl einfuegen
  delay 1
  keystroke return
end tell
APPLESCRIPT
  then
    log "Befehl gesendet."
  else
    warn "Automatisches Tippen fehlgeschlagen (Bedienungshilfen-Freigabe fehlt?)."
    warn "Manuell: In Premiere Cmd+F12 druecken, Cmd+V, Enter."
    warn "Befehl: $CONSOLE_CMD"
  fi
else
  log "Manuell ausfuehren: In Premiere Cmd+F12, dann einfuegen (Cmd+V), Enter."
  log "Befehl: $CONSOLE_CMD"
fi

# ----------------------------------------------------- 4. Auf Ergebnis warten
log "Warte auf Abschluss (max. 30 min – Lade-Dialoge NICHT abbrechen!) ..."
DEADLINE=$(( $(date +%s) + 1800 ))
while [[ $(date +%s) -lt $DEADLINE ]]; do
  if [[ -f "$ERROR_FILE" ]]; then
    fail "ExtendScript-Fehler: $(cat "$ERROR_FILE")"
  fi
  if [[ -f "$POC_LOG" ]]; then
    MTIME_NOW=$(stat -f %m "$POC_LOG")
    if [[ "$MTIME_NOW" -gt "$LOG_MTIME_BEFORE" ]] && grep -q 'Fertig:' "$POC_LOG"; then
      echo
      log "================ ERGEBNIS ================"
      grep -E '\[(INFO|FEHLER)\]|Fertig:' "$POC_LOG" | tail -5
      WARNUNGEN=$(grep -c 'WARNUNG' "$POC_LOG" || true)
      log "Warnungen im Log: $WARNUNGEN (Details: $POC_LOG)"
      if grep -q 'Fertig: 10/10 MOGRTs platziert, 10 Kommentartexte gesetzt, 0 Fehler' "$POC_LOG"; then
        log "VOLLER PASS – Gate-Kriterien B2-B5 erfuellt. Jetzt visuell pruefen"
        log "(Playhead auf 02:17) und ergebnis-2026-06-05.md aktualisieren."
      else
        warn "Lauf beendet, aber nicht 10/10+10 – Log pruefen: $POC_LOG"
      fi
      cp "$POC_LOG" "$REPO/docs/validierung/extendscript_log.txt"
      log "Log nach docs/validierung/extendscript_log.txt kopiert."
      exit 0
    fi
  fi
  sleep 10
done

fail "Timeout: kein Abschluss innerhalb von 30 min. Premiere-Konsole pruefen."
