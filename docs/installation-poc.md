# Installation und Test – Premiere-Proof-of-Concept (MVP 1)

## Voraussetzungen

- Adobe Premiere Pro **25.6 oder neuer** (UXP-Unterstützung ist ab 25.6 GA)
- **UXP Developer Tool (UDT) 2.2+** – über die Creative Cloud App installierbar
- Ein Testprojekt mit geöffneter, aktiver Sequenz
- Ein beliebiges `.mogrt` mit mindestens einem Textfeld (Envato, VideoHive oder eigenes After-Effects-Template)

## Teil A: UXP-Panel laden

1. **Entwicklermodus in Premiere aktivieren:**
   Einstellungen → Plugins → „Entwicklermodus aktivieren" → Premiere neu starten.

2. **Panel im UDT registrieren:**
   UXP Developer Tool öffnen → „Add Plugin" → die Datei `premiere/uxp-panel/manifest.json` auswählen.

3. **Laden:**
   Im UDT beim Eintrag „WhyKiki Stream Companion (PoC)" auf **Load & Watch** klicken (lädt bei Dateiänderungen automatisch neu; Manifest-Änderungen erfordern Unload + Load).

4. **Panel öffnen:**
   In Premiere: Fenster → UXP-Plug-ins → „WhyKiki Stream Companion".

## Teil B: Testablauf im Panel

1. **Timeline laden:** `examples/comments_timeline.json` auswählen. Das Panel validiert die Datei und zeigt eine Vorschau der ersten 10 Kommentare.
2. **MOGRT wählen:** dein Test-MOGRT auswählen.
3. **Mapping:** `examples/template_mapping.json` laden und die Feldnamen unter `fields` an die Anzeigenamen deines MOGRT anpassen (z. B. `"comment_text": "Source Text"` → exakter Name des Textparameters im Essential-Graphics-Panel). Anschließend „Mapping speichern".
4. **Platzieren:** „10 Kommentare in Sequenz platzieren". Das Panel fügt pro Kommentar das MOGRT an der richtigen Position ein und setzt einen Sequenzmarker mit Autor und Kommentartext.
5. **Protokoll:** Alle Schritte, Warnungen und Fehler erscheinen im Protokollbereich und lassen sich als Textdatei speichern.

### Erwartetes Ergebnis

- 10 MOGRTs auf der konfigurierten Videospur (Standard: V3, Index 2), an den Zeitpunkten aus der Timeline-JSON
- 10 Sequenzmarker mit Autorenname und Kommentartext
- Protokoll mit Erfolgs-/Fehlermeldungen pro Kommentar
- **Warnung zur Textbefüllung:** siehe unten

## Teil C: ExtendScript-Fallback (Textbefüllung)

Die UXP-API kann den Source-Text von MOGRTs derzeit nicht beschreiben (siehe [`uxp-api-status.md`](uxp-api-status.md)). Für den vollständigen PoC inklusive Textbefüllung:

1. In Premiere: **Datei → Skripte → Skript ausführen …**
2. `premiere/extendscript/whykiki_poc.jsx` auswählen.
3. Den drei Dateidialogen folgen: Timeline-JSON → MOGRT → Mapping (Abbrechen = Standard-Mapping).
4. Das Skript fügt bis zu 10 MOGRTs ein, **setzt Kommentartext und Autorenname**, setzt die Clipdauer und erzeugt Marker.
5. Das Protokoll liegt danach als `whykiki_poc_log.txt` im Ordner der Timeline-JSON.

### Hinweise zum Fallback

- `getMGTComponent()` funktioniert für **After-Effects-MOGRTs**. Bei Premiere-eigenen Graphics-MOGRTs liegt der Text in regulären Graphics-Komponenten; das Skript versucht in diesem Fall den String-Pfad und protokolliert das Ergebnis.
- Manche Templates verlangen zusätzlich die Anpassung von `fontTextRunLength` – das Skript erledigt das automatisch, wenn das Feld existiert.
- ExtendScript wird von Adobe noch bis September 2026 unterstützt; sobald Adobe die Source-Text-API in UXP nachliefert, wandert die Textbefüllung ins Panel.

## Fehlerbehebung

| Problem | Ursache / Lösung |
|---|---|
| „Keine aktive Sequenz gefunden" | Sequenz im Projektfenster doppelklicken, dann erneut platzieren. |
| `insertMogrtFromPath` liefert nichts | Existiert die Ziel-Videospur (Standard V3)? Ggf. Spur anlegen oder `video_track` im Mapping/JSON senken. |
| Parameter nicht gefunden | Feldname in `template_mapping.json` muss exakt dem Anzeigenamen im Essential-Graphics-Panel entsprechen (Groß-/Kleinschreibung). |
| Panel erscheint nicht | Entwicklermodus aktiv? Premiere ≥ 25.6? UDT: Unload + Load nach Manifest-Änderungen. |
| Umlaute kaputt im Fallback-Log | Timeline-JSON muss UTF-8-codiert sein (ohne BOM). |
