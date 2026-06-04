# UXP-API-Status für Premiere Pro 25.x (Stand: 04.06.2026)

Rechercheergebnis zur Frage, welche PoC-Funktionen die UXP-API abdeckt und wo der ExtendScript-Fallback greifen muss.

## Übersicht

| Fähigkeit | UXP (25.6+) | ExtendScript | PoC-Entscheidung |
|---|---|---|---|
| MOGRT aus Pfad einfügen | ✅ `SequenceEditor.insertMogrtFromPath()` | ✅ `sequence.importMGT()` | UXP-Panel |
| MOGRT aus CC Library | ✅ `insertMogrtFromLibrary()` | ✅ `importMGTFromLibrary()` | nicht im PoC |
| Numerische/Bool-Parameter setzen | ⚠️ teilweise (`ComponentParam.createSetValueAction`) | ✅ | UXP-Panel (mit Protokoll) |
| **Source-Text setzen** | ❌ **nicht möglich** | ✅ `getMGTComponent()` + JSON-Textdokument | **ExtendScript-Fallback** |
| Clipdauer setzen | ⚠️ keine dokumentierte stabile API | ✅ `trackItem.end = time` | ExtendScript-Fallback (UXP: Feature-Detection) |
| Sequenzmarker | ✅ `Markers.createAddMarkerAction()` | ✅ `sequence.markers.createMarker()` | UXP-Panel |
| Datei-I/O | ✅ `fs` / `localFileSystem` (Manifest-Permission) | ✅ `File` | beide |

## Details

### Source-Text-Limitierung (zentraler Befund)

Der Textparameter („Source Text") eines MOGRT wird über `ComponentParam` nicht nutzbar exponiert: Lesen liefert `null` bzw. „value type is unsupported", Schreiben ist nicht möglich. Mehrfach unabhängig bestätigt im offiziellen Adobe-Entwicklerforum (Tests 02/2026 und 24.03.2026); Adobe-Staff-Antwort vom 19.03.2026: „No updates available."

Quelle: https://forums.creativeclouddeveloper.com/t/mogrt-parameters-in-uxp-availabilty/11408

**Konsequenz:** Das UXP-Panel versucht die Textbefüllung trotzdem (Feature-Detection, sauber protokolliert), damit der Code sofort profitiert, sobald Adobe nachliefert. Bis dahin übernimmt `premiere/extendscript/whykiki_poc.jsx` die Textbefüllung.

### Relevante UXP-APIs (alle ab Min-Version 25.0, GA ab Premiere 25.6)

```js
const ppro = require("premierepro");

// Projekt & Sequenz
const project  = await ppro.Project.getActiveProject();
const sequence = await project.getActiveSequence();

// MOGRT einfügen (Direktmethode, in lockedAccess ausführen)
const editor = ppro.SequenceEditor.getEditor(sequence);
project.lockedAccess(() => {
  const items = editor.insertMogrtFromPath(pfad, ppro.TickTime.createWithSeconds(t), vSpur, aSpur);
});

// Parameter (Schreiben via Action in executeTransaction)
const chain = trackItem.getComponentChain();         // VideoComponentChain
const comp  = chain.getComponentAtIndex(i);          // Component
const param = comp.getParam(p);                      // ComponentParam (Suche nur per Index + displayName)
compound.addAction(param.createSetValueAction(param.createKeyframe(wert), true));

// Marker
const markers = await ppro.Markers.getMarkers(sequence);
compound.addAction(markers.createAddMarkerAction(name, "Comment", start, dauer, kommentar));
```

Wichtig: `insertMogrtFromPath` ist eine Direktmethode (kein Action-Objekt) → nur `lockedAccess`. Parameter- und Marker-Änderungen sind Actions → `lockedAccess` + `executeTransaction`.

### ExtendScript-Fallback

```js
// Einfügen (Zeit in Ticks, 254016000000 Ticks/Sekunde)
var item = app.project.activeSequence.importMGT(pfad, ticksString, vSpur, aSpur);

// Text setzen (AE-MOGRTs: Wert ist ein JSON-Textdokument)
var comp  = item.getMGTComponent();
var param = comp.properties.getParamForDisplayName("Source Text");
var doc   = JSON.parse(param.getValue());
doc.textEditValue = "Neuer Text";
param.setValue(JSON.stringify(doc), true);
```

Einschränkungen: `getMGTComponent()` zielt auf After-Effects-MOGRTs; ExtendScript-Support läuft laut Adobe bis September 2026.

## Quellen

- SequenceEditor: https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/sequenceeditor/
- Project (lockedAccess/executeTransaction): https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/project/
- ComponentParam: https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/componentparam/
- Markers: https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/markers/
- Manifest v5: https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/
- Datei-I/O: https://developer.adobe.com/premiere-pro/uxp/resources/recipes/filesystem-operations/
- Source-Text-Thread (Forum): https://forums.creativeclouddeveloper.com/t/mogrt-parameters-in-uxp-availabilty/11408
- ExtendScript `importMGT`: https://ppro-scripting.docsforadobe.dev/sequence/sequence/
- PProPanel-Beispiel (Source-Text-Muster): https://github.com/Adobe-CEP/Samples/blob/master/PProPanel/jsx/PPRO/Premiere.jsx
- Offizielle UXP-Samples: https://github.com/AdobeDocs/uxp-premiere-pro-samples

**Wiedervorlage:** Adobe-Changelog (https://developer.adobe.com/premiere-pro/uxp/changelog/) regelmäßig auf Source-Text-Unterstützung prüfen – dann entfällt der ExtendScript-Fallback.
