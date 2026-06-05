# Cowork-Auftrag: Premiere-PoC-Gate validieren

## Ziel

Schliesse das offene Phase-0-Gate des Projekts. Der Nachweis ist erst erbracht,
wenn in einer echten Premiere-Pro-Sequenz 10 Kommentare automatisch als MOGRTs
platziert werden und der ExtendScript-Fallback die Kommentartexte sichtbar setzt.

## Aktueller Stand

Die lokalen P0/P1-Fixes sind umgesetzt und lokal geprueft:

- `npm run build` erfolgreich.
- `npm run validate:examples` erfolgreich.
- `npm test` erfolgreich, 28/28 Tests bestanden.

Das Gate ist trotzdem noch offen, weil die Premiere-Schicht externe Evidenz aus
einer echten Premiere-Instanz braucht.

## Dateien

| Zweck | Pfad |
|---|---|
| Voller Testplan | `docs/premiere-validierung.md` |
| Ausfuellbare Ergebnisvorlage | `docs/validierung/ergebnis-2026-06-05.md` |
| UXP-Log-Ziel | `docs/validierung/panel_log.txt` |
| ExtendScript-Log-Ziel | `docs/validierung/extendscript_log.txt` |
| UXP-Manifest | `premiere/uxp-panel/manifest.json` |
| ExtendScript-Fallback | `premiere/extendscript/whykiki_poc.jsx` |
| Timeline-Fixture | `examples/comments_timeline.json` |
| Mapping-Fixture | `examples/template_mapping.json` |

## Auftrag

1. Premiere Pro 25.6+ und UXP Developer Tool 2.2+ bereitstellen.
2. Entwicklermodus in Premiere aktivieren und Premiere neu starten.
3. Neues Testprojekt mit aktiver Sequenz anlegen.
4. Sequenz mit mindestens 3 Videospuren vorbereiten; Zielspur ist V3.
5. After-Effects-MOGRT mit mindestens einem editierbaren Textfeld verwenden.
6. Exakten Anzeigenamen des Textfelds in `examples/template_mapping.json`
   unter `fields.comment_text` eintragen.
7. Block A aus `docs/premiere-validierung.md` ausfuehren: UXP-Panel laden,
   Timeline/MOGRT/Mapping waehlen, 10 Kommentare platzieren.
8. `docs/validierung/panel_log.txt` mit dem Panel-Protokoll ersetzen.
9. Block B aus `docs/premiere-validierung.md` ausfuehren: Clips loeschen oder
   neue Sequenz nehmen, `premiere/extendscript/whykiki_poc.jsx` starten.
10. `docs/validierung/extendscript_log.txt` mit dem ExtendScript-Log ersetzen.
11. `docs/validierung/ergebnis-2026-06-05.md` vollstaendig ausfuellen.

## Mindestabnahme

Das Gate darf nur geschlossen werden, wenn diese Punkte belegt sind:

- UXP platziert 10 MOGRTs auf V3.
- UXP-Zeiten stimmen: 02:15, 03:40, 05:02, 07:30, 09:11, 12:45, 15:20,
  18:05, 21:50, 25:33.
- ExtendScript platziert 10 MOGRTs auf V3.
- ExtendScript-Zeiten stimmen.
- ExtendScript setzt die Clipdauer gemaess `duration_seconds`.
- ExtendScript setzt Kommentartext sichtbar ins MOGRT.
- Beide Logs sind abgelegt.

## Wenn etwas fehlschlaegt

Gate offen lassen. Den genauen Fehler, Premiere-Version, MOGRT-Typ, Feldnamen
und Log-Auszug in `ergebnis-2026-06-05.md` dokumentieren. Danach nur den
konkreten Blocker fixen und denselben Test wiederholen.

Nicht mit YouTube-/Twitch-Adaptern starten, solange dieses Gate offen ist.
