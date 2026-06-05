# Validierungsplan: Premiere-PoC (Phase 0, Briefing-Gate)

Ziel: Den Nachweis erbringen, den das Briefing fordert – 10 Kommentare landen automatisch als MOGRTs in einer **echten** Premiere-Sequenz, mit Markern, Dauer und Textbefüllung. Erst danach gilt das PoC-Gate als geschlossen.

Geschätzte Dauer: 45–60 Minuten. Jeder Checkpoint hat ein erwartetes Ergebnis – bitte pro Punkt PASS/FAIL notieren (Vorlage am Ende).

Arbeitsmappe fuer die Durchfuehrung: [`validierung/`](validierung/). Die ausfuellbare Ergebnisdatei liegt unter
[`validierung/ergebnis-2026-06-05.md`](validierung/ergebnis-2026-06-05.md); die beiden Logs sollen als
[`validierung/panel_log.txt`](validierung/panel_log.txt) und
[`validierung/extendscript_log.txt`](validierung/extendscript_log.txt) abgelegt werden.

---

## 0. Voraussetzungen (einmalig, ~15 min)

| # | Schritt | Details |
|---|---|---|
| V1 | Premiere Pro **25.6+** installiert | Version notieren: Hilfe → Über Premiere Pro |
| V2 | **UXP Developer Tool (UDT) 2.2+** | Über die Creative-Cloud-App installieren |
| V3 | Entwicklermodus aktivieren | Premiere: Einstellungen → Plugins → „Entwicklermodus aktivieren" → **Premiere neu starten** |
| V4 | Test-MOGRT mit Textfeld | Am besten ein **After-Effects-erstelltes** MOGRT (Envato/VideoHive-Lower-Third oder eigenes). Wichtig: Es muss mind. ein Textfeld im Essential-Graphics-Panel haben. Notiere den **exakten Anzeigenamen** des Textfelds (z. B. „Source Text", „Title", „Name") |
| V5 | Testprojekt | Neues Premiere-Projekt, eine Sequenz (beliebiges Video oder Farbfläche, ≥ 30 min lang wäre ideal – die Beispielkommentare liegen bei 135 s bis 1533 s), Sequenz geöffnet/aktiv. **Mindestens 3 Videospuren** (V3 = Zielspur, Index 2) |
| V6 | Mapping anpassen | In `examples/template_mapping.json` unter `fields` die Anzeigenamen deines MOGRT eintragen (`comment_text` = Pflichtfeld, `author_name` optional, nicht vorhandene Felder auf `null`) |

---

## Block A: UXP-Panel (~20 min)

### A1 – Panel laden
UDT öffnen → „Add Plugin" → `premiere/uxp-panel/manifest.json` → **Load**. Dann in Premiere: Fenster → UXP-Plug-ins → „WhyKiki Stream Companion".

**Erwartet:** Panel öffnet sich, Protokollzeile „WhyKiki Stream Companion PoC bereit."
**Bei FAIL:** UDT-Konsole (Debug-Button) öffnen, Fehlermeldung kopieren.

### A2 – Timeline laden
Button „comments_timeline.json laden" → `examples/comments_timeline.json`.

**Erwartet:** Status „… – 10 Kommentare (Projekt: 2020-04-12-balkonkonzert)", Vorschau zeigt 10 Kommentare mit Zeiten (02:15, 03:40, …). Umlaute und Emoji korrekt.

### A3 – MOGRT wählen
**Erwartet:** Pfad erscheint grün im Status, Button „Platzieren" wird aktiv.

### A4 – Mapping laden
Dein angepasstes `template_mapping.json` laden.

**Erwartet:** Status zeigt Dateiname + Template-Name.

### A5 – Platzieren (der Kernmoment)
Button „10 Kommentare in Sequenz platzieren".

**Erwartet:** 10 MOGRTs auf **V3**, an den Positionen **02:15, 03:40, 05:02, 07:30, 09:11, 12:45, 15:20, 18:05, 21:50, 25:33**. Protokoll: pro Kommentar „MOGRT bei … eingefügt".
**Genau prüfen:** Liegen die Clips exakt an diesen Zeiten (Playhead hinstellen)? Das validiert TickTime/Sekunden-Umrechnung.
**Bekanntes Risiko (Review-Befund 10):** Falls Fehlermeldung „insertMogrtFromPath lieferte kein TrackItem zurück" → genauen Protokolltext notieren, das ist der wichtigste Einzelbefund der ganzen Validierung.

### A6 – Marker
**Erwartet:** 10 Sequenzmarker mit Autorenname im Titel und Kommentartext als Kommentar (Marker-Panel öffnen).
**Möglicher Befund:** Marker-API-Signatur ist unverifiziert – Warnungen im Protokoll notieren.

### A7 – Dauer
**Erwartet (vermutlich):** Warnung „Dauer setzen über UXP nicht verfügbar – Standarddauer des MOGRT bleibt aktiv". Das ist OK und dokumentiert. Falls Dauer doch gesetzt wird: melden, dann gibt es die API inzwischen.

### A8 – Textbefüllung
**Erwartet (vermutlich):** Pro Kommentar Warnung „… konnte nicht gesetzt werden (bekannte UXP-Grenze)". Das bestätigt die Adobe-Limitierung.
**Falls Texte erscheinen:** Sofort melden – dann hat Adobe nachgeliefert und der ExtendScript-Fallback kann entfallen!
**Falls stattdessen „Parameter nicht gefunden":** Feldname im Mapping stimmt nicht mit dem Essential-Graphics-Anzeigenamen überein → Schreibweise prüfen, A5 wiederholen.

### A9 – Protokoll sichern
„Protokoll speichern" → Datei als `docs/validierung/panel_log.txt` ins Repo legen.

---

## Block B: ExtendScript-Fallback (~15 min)

Vorher: die in Block A platzierten Clips aus der Sequenz löschen (oder neue Sequenz).

### B1 – Skript starten
Datei → Skripte → Skript ausführen … → `premiere/extendscript/whykiki_poc.jsx`. Drei Dialoge: Timeline-JSON → MOGRT → Mapping (oder Abbrechen für Standard).

**Erwartet:** Kein Skriptfehler beim Start. 
**Bekanntes Risiko:** `#include "whykiki_json.jsxinc"` – die Datei muss im selben Ordner liegen wie das .jsx (im Repo der Fall). Fehlermeldung „Datei nicht gefunden" → Pfad notieren.

### B2 – Platzierung
**Erwartet:** 10 MOGRTs auf V3 an denselben Zeiten wie in A5 (validiert die Ticks-Umrechnung: 254016000000 Ticks/s).

### B3 – Dauer
**Erwartet:** Jeder Clip exakt so lang wie `duration_seconds` im JSON (6–8 s, per Clip prüfen: 5–8 s je nach Kommentar).

### B4 – Textbefüllung (Hauptzweck des Fallbacks!)
**Erwartet:** Kommentartext und ggf. Autorenname stehen **sichtbar im Bild** bzw. im Essential-Graphics-Panel des Clips.
**Bekanntes Risiko:** `getMGTComponent()` funktioniert nur bei After-Effects-MOGRTs. Bei einem Premiere-erstellten MOGRT erwartet das Log „getMGTComponent() lieferte nichts". Dann bitte mit einem AE-MOGRT wiederholen.
**Umlaute/Emoji prüfen:** „Wunderschön! Grüße vom Nachbarbalkon 🎶" muss korrekt erscheinen.

### B5 – Marker + Abschlussdialog
**Erwartet:** 10 Marker; Abschlussdialog „Fertig: 10/10 MOGRTs platziert, 10 Kommentartexte gesetzt, 0 Fehler."

### B6 – Log sichern
`whykiki_poc_log.txt` liegt im Ordner der Timeline-JSON → als `docs/validierung/extendscript_log.txt` ins Repo.

---

## Block C: Fehlerfälle (optional, ~10 min, macht die Validierung belastbar)

| # | Test | Erwartet |
|---|---|---|
| C1 | Platzieren ohne aktive Sequenz (Sequenz-Tab schließen) | Saubere Fehlermeldung „Keine aktive Sequenz gefunden", kein Absturz |
| C2 | Sequenz mit nur 2 Videospuren | Fehler pro Kommentar im Protokoll, kein Absturz, Zusammenfassung zählt 10 Fehler |
| C3 | Mapping mit absichtlich falschem Feldnamen | Warnung „Parameter '…' nicht gefunden", MOGRTs trotzdem platziert |
| C4 | Kaputtes JSON laden (z. B. Komma löschen) | Validierungsfehler im Panel, kein Absturz |

---

## Ergebnis-Vorlage (bitte ausfüllen und mir zurückgeben)

```
Premiere-Version:        25.__
UDT-Version:             __
MOGRT:                   [Name/Quelle, AE- oder Premiere-erstellt?]
Textfeld-Anzeigename:    __

A1 Panel lädt:           PASS / FAIL: __
A2 Timeline laden:       PASS / FAIL: __
A3 MOGRT wählen:         PASS / FAIL: __
A4 Mapping laden:        PASS / FAIL: __
A5 Platzierung+Zeiten:   PASS / FAIL: __
A6 Marker:               PASS / FAIL: __
A7 Dauer-Warnung:        WIE ERWARTET / ANDERS: __
A8 Text-Warnung:         WIE ERWARTET / TEXT GING (!) / PARAMETER FEHLT: __

B1 Skriptstart:          PASS / FAIL: __
B2 Platzierung:          PASS / FAIL: __
B3 Dauer:                PASS / FAIL: __
B4 TEXTBEFÜLLUNG:        PASS / FAIL: __   ← wichtigster Punkt
B5 Marker+Dialog:        PASS / FAIL: __

C1–C4 (optional):        __
Logs angehängt:          panel_log.txt / extendscript_log.txt
```

Mit den beiden Logs + ausgefüllter Vorlage kann ich jeden Fehlschlag gezielt fixen. Wenn A5 und B4 PASS sind, ist das Briefing-Gate offiziell geschlossen und P2 (YouTube/Twitch) startet auf festem Fundament.
