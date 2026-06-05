# Konzept und Entwicklungsplan

Stand: 05.06.2026 · Basis: kritisches Review des Gesamtstands (MVP 1–3) plus Plattform-Recherchen

## 1. Wo wir stehen

Drei MVPs sind implementiert und gepusht: das Premiere-PoC-Panel (UXP + ExtendScript-Fallback), der Core Timeline Builder (TypeScript, CLI `wsc`) und der dateibasierte Facebook-Adapter. 19 Unit-Tests, durchgespielte Beispiel-Workflows.

**Aber:** Ein unabhängiges Code-Review (siehe Abschnitt 3) und eine ehrliche Prozessbetrachtung zeigen erhebliche Lücken. Dieses Dokument benennt sie schonungslos und leitet daraus den Plan ab.

## 2. Die zentrale Selbstkritik: das PoC-Gate wurde verletzt

Das Briefing ist eindeutig: *„Erst wenn dieser Nachweis funktioniert, beginnt die Entwicklung der Plattformadapter."* Der Nachweis – MOGRTs automatisch in einer **echten** Premiere-Sequenz platzieren – wurde **nie erbracht**. Das UXP-Panel wurde syntaktisch geprüft, aber nie in Premiere geladen; der ExtendScript-Fallback nie ausgeführt. Trotzdem wurden MVP 2 und 3 gebaut.

Das Risiko ist real: Das Review fand mehrere unverifizierte API-Annahmen im Panel (Promise- vs. Sync-Rückgaben, Handle-Stabilität über Lock-Grenzen) und einen mit hoher Wahrscheinlichkeit fatalen Fehler im ExtendScript-Fallback (kein natives `JSON` in ES3 – die Textbefüllung, der **Hauptzweck** des Fallbacks, schlägt damit vermutlich komplett fehl). Falls der Premiere-Pfad so nicht funktioniert, sind Teile des Unterbaus auf Sand gebaut.

**Konsequenz:** Phase 0 des Plans ist die Validierung in echter Umgebung – vor jedem weiteren Feature.

## 3. Review-Befunde (Zusammenfassung)

Vollständiges Review mit 24 Befunden; die wichtigsten nach Schweregrad:

### Kritisch (reproduziert)

| # | Befund | Ort |
|---|---|---|
| K1 | `created_at: ""` (legale Adapter-Ausgabe bei reiner Sekundenangabe) lässt die Validierung und damit `wsc build` hart scheitern – die dokumentierte Minimal-CSV ist unbrauchbar | `core/validate.ts` ↔ Adapter |
| K2 | **Offset wird doppelt angewendet**: Builder rechnet `offset_seconds` ein UND Panel/JSX addieren ihn erneut → alle Overlays doppelt verschoben | `timeline-builder.ts` ↔ `main.js`/`whykiki_poc.jsx` |
| K3 | `npm test` ist auf aktuellem Node kaputt (Verzeichnis-Argument wird nicht mehr als Discovery-Root akzeptiert) | `package.json` |
| K4 | `npm run validate:examples` wirft sofort `ReferenceError` (CJS-`require` in ESM-Paket) – lief nachweislich nie | `tests/validate_examples.js` |

### Hoch

Flutbehandlung hat drei echte Logikfehler: `group_id` „leckt" auf Nicht-Flut-Kommentare (Gruppe endet erst bei komplett leerem Fenster), die Fenster-Buchhaltung (`aktiveEnden`) divergiert nach Verdrängungen vom echten Zustand, und der `min_gap`-Drift ist unbegrenzt (300-Kommentar-Flut → 2,5 Minuten Verschiebung ohne Confidence-Abwertung, Verschiebung kann hinters Videoende rutschen). Dazu: Facebook-Adapter clemmt negative Zeiten auf 0 statt sie den Builder-Filter durchlaufen zu lassen; CSV-Parser scheitert an Excel-typischem UTF-8-BOM; UXP-Panel erwartet `insertMogrtFromPath` synchron und nutzt Param-Handles über Lock-Grenzen hinweg.

### Mittel/Niedrig (Auswahl)

`platform`-Feld trägt das Dateiformat („csv", „json") statt der echten Plattform; massive Code-Duplikation zwischen JSON- und Facebook-Adapter, weil das im Briefing geforderte **Comment-Normalizer-Modul fehlt**; ID-Kollisionen bei verschachtelten Facebook-Antworten; CLI-Parser ohne `parseArgs`-Robustheit; eval-basiertes JSON-Parsing im ExtendScript (Codeausführungsrisiko mit Fremddaten!); Duplikatfilter ohne Zeitfenster; keine CI, kein ESLint, keine e2e-Tests – **deshalb blieben K1–K4 unentdeckt**.

## 4. Strategische Kritik und Konsequenzen

**a) Der MOGRT-Weg ist fragiler als geplant.** UXP kann Source-Text nicht setzen (Adobe-Limitierung), der ExtendScript-Fallback läuft nur bis September 2026 und ist aktuell vermutlich kaputt (K-Befund JSON/ES3). Das Briefing sieht den **Overlay-Fallback** (Timeline-JSON → HTML/CSS-Renderer → transparentes Video → Premiere-Import) ohnehin vor – er sollte vom „Fallback" zum **gleichberechtigten zweiten Render-Pfad** aufgewertet werden: vollständig in unserer Hand, kein Adobe-API-Risiko, und mit HTML/CSS (deine Kernkompetenz) hervorragend gestaltbar. MOGRT bleibt erster Pfad für editierbare Overlays; der Renderer garantiert, dass das Produkt **immer** liefert.

**b) Kommentar-Archivierung ist zeitkritisch geworden.** Die Plattform-Recherche zeigt: FB-Page-Lives und Replays löschen nach 30 Tagen, Twitch-VODs nach 7/14/60 Tagen, Instagram/TikTok-Live-Chat ist nachträglich gar nicht beschaffbar. Das Produkt ist damit nicht nur ein Schnitt-Werkzeug, sondern eine **Archivierungs-Pipeline mit Harvesting-Charakter**: Kommentare müssen routinemäßig kurz nach jedem Stream gesichert werden. Das gehört ins Konzept (zeitgesteuertes `wsc harvest` für API-Quellen).

**c) Prioritäten bei neuen Adaptern.** YouTube (yt-dlp `live_chat.json` mit `videoOffsetTimeMsec`) und Twitch (TwitchDownloaderCLI mit `content_offset_seconds`) liefern als einzige Quellen **native relative Zeitstempel** – höchste Datenqualität bei geringstem Aufwand (reine Parser). Sie kommen vor dem FB-Page-API-Adapter. Instagram/TikTok-Live-Capture (Echtzeit-Listener) ist ein eigenes, späteres Kapitel mit anderer Architektur.

## 5. Zielarchitektur (Konsolidierung)

```
Quelle                       Adapter (nur Format → Roh-Records)
─────────────────────────    ──────────────────────────────────
CSV / generisches JSON       adapters/csv, adapters/json
Facebook Exporter/DYI        adapters/facebook
YouTube live_chat.json       adapters/youtube      (P2)
Twitch chat.json             adapters/twitch       (P2)
FB Page Graph API            adapters/facebook-api (P3, harvest)
                                      │
                                      ▼
                     core/normalizer.ts   ← NEU: ein Modul für
                     (Alias-Mapping, Zahl-/Datums-Koersion,      
                      Zeitableitung, Mojibake, Defaults,
                      Validierung, platform aus meta)
                                      │
                                      ▼
                     core/timeline-builder.ts (überarbeitet:
                      Fenster-Buchhaltung aus eintraege abgeleitet,
                      max_shift, Gruppen-Ende bei freiem Slot,
                      Statistik aus Endzustand)
                                      │
                                      ▼
                     comments_timeline.json  (Schema v1.1:
                      offset_seconds → offset_seconds_applied,
                      rein deklarativ – Konsumenten rechnen NICHT)
                            │                    │
                            ▼                    ▼
              Premiere-Pfad A:          Premiere-Pfad B:
              UXP-Panel (MOGRT,         Overlay-Renderer (P4):
              editierbar) +             HTML/CSS → transparentes
              ExtendScript-Fallback     WebM/ProRes → Import
              (mit json2, solange       (deterministisch, kein
              Adobe-Support läuft)      Adobe-API-Risiko)
                                      │
                                      ▼
                     mcp/ (P3): Tools spiegeln CLI-Kommandos
                     discover, import, build, validate, export,
                     harvest, create_premiere_package
```

Verbindliche Schema-Regel ab v1.1: **Alle Zeitwerte in `comments_timeline.json` sind final.** Konsumenten (Panel, JSX, Renderer) verrechnen nichts mehr – das beerdigt die K2-Fehlerklasse dauerhaft.

## 6. Phasenplan

### P0 – Validieren und reparieren (sofort, vor allem anderen)

1. K1–K4 fixen plus BOM-Fix und Facebook-Clamp (alle < 1 h Aufwand pro Stück).
2. ExtendScript: json2.js einbinden, `eval` durch `JSON.parse` ersetzen.
3. UXP-Panel: Promise-Verhalten defensiv behandeln, Param-Suche + Transaktion in einen Lock-Block ziehen.
4. **Du lädst das Panel in Premiere 25.x und wir validieren den PoC gemeinsam an einer echten Sequenz mit echtem MOGRT** – Logs zurück ins Repo, Befunde einarbeiten. Das Briefing-Gate wird damit nachträglich geschlossen.
5. CI (GitHub Actions: build + test + validate:examples) und e2e-CLI-Test, damit diese Fehlerklasse nie wieder unbemerkt bleibt.

**Abnahme:** 10 Kommentare landen in einer echten Sequenz, Marker gesetzt, Texte via ExtendScript befüllt, CI grün.

### P1 – Konsolidieren (direkt danach)

Normalizer-Modul extrahieren (Duplikation JSON/Facebook/CSV auflösen, `platform` aus Meta, Mojibake generisch), Timeline-Builder-Logikfehler beheben (Fenster-Buchhaltung, max_shift, Gruppenregel, Statistik-Invariante als Property-Test), CLI auf `node:util parseArgs`, Schema v1.1. **Abnahme:** alte Beispiele laufen unverändert, neue Regressionstests für jeden Review-Befund.

### P2 – YouTube- und Twitch-Adapter (höchster Nutzen pro Aufwand)

Parser für yt-dlp-`live_chat.json` (JSONL, `videoOffsetTimeMsec`) und TwitchDownloaderCLI-`chat.json` (`content_offset_seconds`), inkl. Doku, wie die Tools aufzurufen sind. Beide liefern native Offsets → beste Timeline-Qualität im ganzen System. **Abnahme:** echter alter Stream von dir (YouTube oder Twitch) läuft durch die komplette Pipeline bis in die Premiere-Sequenz.

### P3 – FB-Page-API-Adapter + MCP-Server

`wsc harvest` gegen die Graph API (Page-Token, Dev-Mode-App, `live_broadcast_timestamp`), als zeitgesteuerter Job ausgelegt (30-Tage-Fenster). Danach MCP-Server (MVP 4 des Briefings): dünner Wrapper um die Core-API, Tools wie im Briefing definiert, Resources auf die Projektordner. **Abnahme:** Agent (Claude) führt discover → import → build → validate eigenständig über MCP aus.

### P4 – Overlay-Renderer (Pfad B)

HTML/CSS-Templates (UIKit-tauglich), Rendering Timeline-JSON → transparentes Video (Puppeteer + Frame-Capture oder CSS-Animation + Screen-Recording-Pipeline, Entscheidung per Spike), Mapping-Profile wie bei MOGRTs. **Abnahme:** identische Timeline ergibt wahlweise MOGRT-Overlays oder gerendertes Overlay-Video.

### P5 – Live-Capture (Instagram/TikTok) und Komfort

Echtzeit-Listener als eigener Daemon (IG-Polling/Webhooks offiziell, TikTokLive inoffiziell mit klarer Risiko-Doku), Browser-GUI für den Core (lokaler Webserver, dein bevorzugter Bedienweg), Whisper/Highlights gemäß „Spätere Erweiterungen".

## 7. Risiken

| Risiko | Eintritt | Gegenmaßnahme |
|---|---|---|
| UXP-API verhält sich anders als dokumentiert | mittel | P0-Validierung an echter Premiere vor allem Weiteren |
| ExtendScript-Support endet 09/2026, Adobe liefert Source-Text-API nicht nach | mittel–hoch | Overlay-Renderer (P4) als unabhängiger Pfad; Adobe-Changelog monatlich prüfen |
| Inoffizielle Tools (yt-dlp, TwitchDownloader) brechen | niedrig–mittel | Adapter konsumieren Datei-Output statt APIs nachzubauen; Format-Fixtures in Tests |
| Plattform-Löschfristen vernichten Material | **läuft bereits** | Harvesting-Doku sofort, `wsc harvest` in P3; kurzfristig manuelle Sicherung |
| Ein-Personen-Projekt, Wissensverlust | mittel | Doku-Disziplin beibehalten (docs/ pro Thema), CI als Sicherheitsnetz |
