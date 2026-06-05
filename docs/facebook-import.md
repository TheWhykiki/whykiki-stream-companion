# Facebook-Import: Datenbeschaffung und Workflow (Stand: 06/2026)

## Die ehrliche Ausgangslage für private Profile

Die Recherche (Quellen unten) ergibt für Livestreams auf **privaten Profilen** drei harte Fakten:

1. **Graph API liefert keine fremden Kommentare.** Auch mit eigener Meta-App im Development Mode (Berechtigungen `user_videos`, `user_posts` ohne App-Review nutzbar) bekommst du nur deine eigenen Inhalte. Kommentare Dritter auf Profil-Videos gibt die API aus Datenschutzgründen nicht heraus – das ist seit den API-Lockdowns nach Cambridge Analytica so und gilt unverändert.
2. **Der Facebook-Datenexport enthält nur eigene Inhalte.** „Deine Informationen herunterladen" (DSGVO-Export) liefert deine Videos, Metadaten und *deine eigenen* Kommentare – aber niemals die Kommentare deiner Zuschauer. Das ist Metas DSGVO-Begründung: fremde Kommentare sind personenbezogene Daten der anderen Person.
3. **Live-Replays werden seit 19.02.2025 nach 30 Tagen gelöscht.** Ältere Live-Videos wurden 2025 in Wellen entfernt (mit Download-Frist). Falls deine alten Streams noch nicht gesichert sind: **prüfe das sofort** – die Videodateien selbst stecken im Datenexport bzw. waren über Metas Download-Tool zu sichern.

**Konsequenz:** Der Facebook-Adapter arbeitet dateibasiert mit zwei Quellen:

| Quelle | Liefert | Kommando |
|---|---|---|
| Datenexport (DYI), `your_videos.json` | Video-Discovery: Titel, Streamstart-Zeitstempel, Videodatei | `wsc discover` |
| Kommentar-Export-Tool (Drittanbieter) | Die eigentlichen Zuschauerkommentare | `wsc import --format facebook` |

## Schritt 1: Facebook-Datenexport anfordern (Video-Metadaten)

1. Facebook → Einstellungen → **„Deine Informationen herunterladen"**
2. Format: **JSON** (nicht HTML!), Medienqualität nach Bedarf
3. Zeitraum: alles oder gezielt die Stream-Jahre
4. Mindestens auswählen: **Beiträge** (enthält `posts/your_videos.json` und die Videodateien)
5. Export liegt nach Aufbereitung unter: `your_facebook_activity/posts/your_videos.json` (ältere Exporte: `your_activity_across_facebook/...`)

Dann:

```bash
# Videos auflisten
node dist/cli/index.js discover --datei pfad/zum/export/posts/your_videos.json

# Video Nr. 3 als Projekt übernehmen (schreibt metadata.json mit Streamstart)
node dist/cli/index.js discover --datei .../your_videos.json --video 3 --projekt 2020-04-12-balkonkonzert
```

Der Adapter repariert dabei automatisch die bekannte Encoding-Eigenheit der Facebook-Exporte (UTF-8 als CP1252 fehlkodiert, „fÃ¼r" → „für").

## Schritt 2: Kommentare beschaffen (Drittanbieter-Export)

Solange das Video noch auf Facebook existiert, können Kommentar-Export-Tools die Kommentarliste ziehen. Gängige Optionen (de-facto einheitliches JSON-Format, alle vom Adapter unterstützt):

- **exportcomments.com** – URL des Videos einwerfen, JSON/CSV-Export; „private posts"-Modus für nicht-öffentliche Beiträge (Browser-Erweiterung mit eigener Session)
- **Apify facebook-comments-scraper** – JSON-Array mit `text`, `date`, `likesCount`, `profileUrl`, verschachtelten `replies`
- **ESuit Comments Exporter** (Chrome-Erweiterung) – arbeitet mit der eingeloggten Session, daher auch für „Nur Freunde"-Videos

Hinweis: Diese Tools bewegen sich bei nicht-öffentlichen Inhalten in einer ToS-Grauzone (eigenes Video, eigener Account – aber Scraping). Für die eigenen Streams mit dem eigenen Account ist das Risiko überschaubar; eine offizielle Alternative existiert schlicht nicht.

Erwartetes Format (Aliasse werden erkannt):

```json
{ "comments": [ {
  "name": "Kommentator",            // oder author, profileName
  "comment": "Text",                 // oder text, message
  "date": "2020-04-12T18:02:15",    // oder timestamp (Unix-Sekunden)
  "likes": 12,                       // oder likesCount
  "profileUrl": "https://facebook.com/...",
  "replies": [ { ... } ]             // werden abgeflacht, Badge "antwort"
} ] }
```

```bash
node dist/cli/index.js import --projekt 2020-04-12-balkonkonzert --datei kommentare.json --format facebook
node dist/cli/index.js build  --projekt 2020-04-12-balkonkonzert
```

Die relative Zeit jedes Kommentars wird aus Kommentardatum minus Streamstart (`started_at` aus Schritt 1) berechnet. Feinjustierung per `wsc build --offset <sekunden>`.

## Für die Zukunft: auf eine Seite streamen

Wer künftige Livestreams über eine **Facebook-Seite** (Page) laufen lässt, bekommt den sauberen API-Weg: `GET /{video-id}/comments` mit `pages_read_engagement` funktioniert für eigene Seiten schon im Development Mode, inklusive `live_broadcast_timestamp` pro Kommentar (= exakte relative Zeit statt Datumsrechnung). Der Graph-API-Modus des Adapters ist dafür vorgesehen und wird ergänzt, sobald eine Seite vorhanden ist. Kurzfassung App-Setup:

1. https://developers.facebook.com → „Meine Apps" → App erstellen (Typ: Business)
2. Produkt „Facebook Login" hinzufügen, im Graph API Explorer Page-Token mit `pages_read_engagement` + `pages_show_list` erzeugen
3. Development Mode reicht für eigene Seiten – kein App-Review nötig

## Quellen

- Permissions Reference: https://developers.facebook.com/docs/permissions/reference/user_videos
- Access Levels (Development Mode ohne Review): https://developers.facebook.com/docs/graph-api/overview/access-levels/
- Video-Comments-Edge: https://developers.facebook.com/docs/graph-api/reference/video/comments/
- Live-Video-Speicherrichtlinie (30 Tage, Feb 2025): https://about.fb.com/news/2025/02/updating-our-facebook-live-video-storage-policy/
- DYI enthält keine fremden Kommentare: https://blog.x1discovery.com/2020/10/20/facebook-download-your-information-function-omits-significant-amounts-of-evidence/ und https://privacyinternational.org/long-read/3372/no-facebook-not-telling-you-everything
- Export-Tools: https://exportcomments.com/export-facebook-comments, https://apify.com/apify/facebook-comments-scraper, https://esuit.dev/product/export-comments-for-facebook/
