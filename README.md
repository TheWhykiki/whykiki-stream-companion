# WhyKiki Stream Companion

Plattformübergreifende Produktions- und Archivierungssuite für Livestreams und Videoinhalte. Das System liest Kommentare, Chats, Reaktionen und Metadaten aus Livestreams und Videoarchiven aus, synchronisiert sie zeitlich mit dem Videomaterial und stellt sie automatisiert in Adobe Premiere Pro als editierbare Overlays bereit.

Der Schwerpunkt liegt ausdrücklich nicht auf Transkriptionen oder Untertiteln, sondern auf der **Rekonstruktion der Zuschauerinteraktion**.

## Grundprinzipien

1. Kommentare sind Daten – Design wird niemals in Kommentardaten gespeichert.
2. Design wird ausschließlich durch MOGRTs oder Overlay-Templates bestimmt.
3. Premiere ist Schnittsystem – Premiere stellt Kommentare nur dar, berechnet sie nicht.
4. Jede Plattform wird über Adapter angebunden.
5. Der gesamte Workflow muss später durch KI-Agenten steuerbar sein (MCP).

## Aktueller Stand: MVP 1 – Premiere-Proof-of-Concept

Der PoC besteht aus zwei Teilen:

| Komponente | Pfad | Aufgabe |
|---|---|---|
| UXP-Panel | `premiere/uxp-panel/` | Timeline-JSON laden, MOGRT wählen, Mapping speichern, MOGRTs platzieren, Marker setzen, Protokoll |
| ExtendScript-Fallback | `premiere/extendscript/whykiki_poc.jsx` | Kompletter Ablauf inkl. **Textbefüllung** und Clipdauer |

**Warum zwei Teile?** Die UXP-API in Premiere Pro 25.x kann MOGRTs einfügen und Marker setzen, aber den Source-Text eines MOGRT derzeit **nicht beschreiben** (bestätigte Adobe-Limitierung, Stand 06/2026). Details und Quellen: [`docs/uxp-api-status.md`](docs/uxp-api-status.md).

Installation und Testablauf: [`docs/installation-poc.md`](docs/installation-poc.md)

## Projektstruktur

```
whykiki-stream-companion/
├── core/          # Kernlogik (Projekt-, Datei-, Timeline-Verarbeitung) – folgt in MVP 2
├── adapters/      # Plattformadapter (facebook, youtube, twitch, instagram, csv, json) – folgt in MVP 2/3
├── premiere/      # Premiere-Integration (UXP-Panel + ExtendScript-Fallback) ← MVP 1
├── mcp/           # MCP-Server – folgt in MVP 4
├── templates/     # MOGRT-/Overlay-Templates und Mapping-Profile
├── docs/          # Dokumentation
├── examples/      # Beispieldaten (comments_timeline.json, template_mapping.json)
└── tests/         # Tests und Validierungsskripte
```

## Datenformate

### comments_timeline.json

Ausgabe des (künftigen) Timeline Builders, Eingabe für die Premiere-Integration. Pro Eintrag: normalisierter Kommentar (`comment`, gemäß internem Datenmodell aus dem Briefing) plus Platzierungsinformation (`timeline`: `start_seconds`, `duration_seconds`, `video_track`, `audio_track`, `highlight`, `group_id`). Beispiel: [`examples/comments_timeline.json`](examples/comments_timeline.json)

### template_mapping.json

Mapping-Profil eines MOGRT: ordnet die logischen Felder (`comment_text`, `author_name`, `avatar`, `timestamp`, `reaction_count`) den Anzeigenamen der Template-Parameter zu. Das Projekt ist niemals auf ein bestimmtes MOGRT fest verdrahtet. Beispiel: [`examples/template_mapping.json`](examples/template_mapping.json)

## Roadmap

- **MVP 1** – Premiere-Proof-of-Concept ✅ (dieses Repo, Stand jetzt)
- **MVP 2** – Core Timeline Builder (CSV/JSON-Import, Offset-Korrektur, Filter, Export)
- **MVP 3** – Facebook-Adapter (Discovery, Kommentar-Import, Archivierung)
- **MVP 4** – MCP-Server (Tools, Resources, Agentenintegration)
- **MVP 5** – Weitere Plattformen (YouTube, Twitch, Instagram)
