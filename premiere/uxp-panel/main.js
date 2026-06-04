/**
 * WhyKiki Stream Companion – Premiere-Proof-of-Concept (MVP 1)
 *
 * UXP-Panel für Premiere Pro 25.6+ (Vanilla JS, kein Build-Step).
 *
 * Aufgaben laut Briefing:
 *  - comments_timeline.json laden
 *  - MOGRT auswählen
 *  - Mapping speichern
 *  - 10 Testkommentare automatisch in die aktive Sequenz platzieren
 *  - Dauer setzen (soweit UXP es erlaubt, sonst protokollierter Fallback)
 *  - Fehler protokollieren
 *
 * Bekannte API-Grenze (Stand 06/2026, siehe docs/uxp-api-status.md):
 * UXP kann MOGRTs einfügen und Marker setzen, aber den Source-Text eines
 * MOGRT NICHT beschreiben. Die Textbefüllung übernimmt der ExtendScript-
 * Fallback (premiere/extendscript/whykiki_poc.jsx) auf Basis derselben
 * Timeline-Daten. Dieses Panel versucht die Textbefüllung dennoch über
 * ComponentParam und protokolliert das Ergebnis pro Kommentar.
 */

/* global require, document */

const ppro = require("premierepro");
const uxpStorage = require("uxp").storage;
const lfs = uxpStorage.localFileSystem;

const MAX_KOMMENTARE = 10;

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

const zustand = {
  timeline: null,        // geparste comments_timeline.json
  timelineDateiName: "",
  mogrtPfad: "",         // absoluter Pfad zur .mogrt-Datei
  mapping: standardMapping(),
  mappingGeladen: false,
};

function standardMapping() {
  return {
    version: "1.0",
    template: {
      name: "Unbenanntes Template",
      source: "custom",
      authoring: "after_effects",
      mogrt_path: "",
    },
    fields: {
      comment_text: "Source Text",
      author_name: "Author Name",
      avatar: null,
      timestamp: null,
      reaction_count: null,
    },
    defaults: {
      duration_seconds: 6,
      video_track: 2,
      audio_track: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Protokoll
// ---------------------------------------------------------------------------

const logZeilen = [];

function log(stufe, nachricht) {
  const zeit = new Date().toISOString().substring(11, 19);
  const zeile = `[${zeit}] [${stufe.toUpperCase()}] ${nachricht}`;
  logZeilen.push(zeile);

  const logElement = document.getElementById("log");
  const div = document.createElement("div");
  const cssKlasse = { info: "log-info", ok: "log-ok", warnung: "log-warnung", fehler: "log-fehler" }[stufe] || "log-info";
  div.className = cssKlasse;
  div.textContent = zeile;
  logElement.appendChild(div);
  logElement.scrollTop = logElement.scrollHeight;
}

function setzeStatus(elementId, text, klasse) {
  const el = document.getElementById(elementId);
  el.textContent = text;
  el.className = "status" + (klasse ? " " + klasse : "");
}

// ---------------------------------------------------------------------------
// Validierung
// ---------------------------------------------------------------------------

function validiereTimeline(daten) {
  const fehler = [];
  if (!daten || typeof daten !== "object") {
    fehler.push("Datei enthält kein JSON-Objekt.");
    return fehler;
  }
  if (!Array.isArray(daten.entries) || daten.entries.length === 0) {
    fehler.push("Feld 'entries' fehlt oder ist leer.");
    return fehler;
  }
  daten.entries.forEach((eintrag, i) => {
    const c = eintrag.comment;
    const t = eintrag.timeline;
    if (!c || typeof c.message !== "string" || c.message.length === 0) {
      fehler.push(`Eintrag ${i + 1}: comment.message fehlt.`);
    }
    if (!c || typeof c.author_name !== "string") {
      fehler.push(`Eintrag ${i + 1}: comment.author_name fehlt.`);
    }
    if (!t || typeof t.start_seconds !== "number" || t.start_seconds < 0) {
      fehler.push(`Eintrag ${i + 1}: timeline.start_seconds fehlt oder ist ungültig.`);
    }
  });
  return fehler;
}

// ---------------------------------------------------------------------------
// Schritt 1: Timeline laden
// ---------------------------------------------------------------------------

async function timelineLaden() {
  try {
    const datei = await lfs.getFileForOpening({ types: ["json"] });
    if (!datei) {
      log("info", "Timeline-Auswahl abgebrochen.");
      return;
    }
    const inhalt = await datei.read();
    const daten = JSON.parse(inhalt);

    const fehler = validiereTimeline(daten);
    if (fehler.length > 0) {
      fehler.forEach((f) => log("fehler", "Validierung: " + f));
      setzeStatus("statusTimeline", `Validierung fehlgeschlagen (${fehler.length} Fehler).`, "fehler");
      return;
    }

    zustand.timeline = daten;
    zustand.timelineDateiName = datei.name;

    const anzahl = daten.entries.length;
    setzeStatus(
      "statusTimeline",
      `${datei.name} – ${anzahl} Kommentare (Projekt: ${daten.project_id || "unbekannt"})`,
      "ok"
    );
    log("ok", `Timeline geladen: ${datei.name}, ${anzahl} Kommentare.`);

    // Kurze Vorschau der ersten Kommentare anzeigen
    const vorschau = daten.entries
      .slice(0, MAX_KOMMENTARE)
      .map((e) => `• [${formatiereZeit(e.timeline.start_seconds)}] ${e.comment.author_name}: ${e.comment.message}`)
      .join("\n");
    document.getElementById("vorschau").textContent = vorschau;

    aktualisierePlatzierenButton();
  } catch (err) {
    log("fehler", "Timeline konnte nicht geladen werden: " + err.message);
    setzeStatus("statusTimeline", "Fehler beim Laden.", "fehler");
  }
}

function formatiereZeit(sekunden) {
  const m = Math.floor(sekunden / 60);
  const s = Math.floor(sekunden % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Schritt 2: MOGRT wählen
// ---------------------------------------------------------------------------

async function mogrtWaehlen() {
  try {
    // .mogrt ist kein Standard-Dateityp – daher alle Dateien zulassen und Endung prüfen.
    const datei = await lfs.getFileForOpening({ types: ["mogrt", "*"] });
    if (!datei) {
      log("info", "MOGRT-Auswahl abgebrochen.");
      return;
    }
    if (!datei.name.toLowerCase().endsWith(".mogrt")) {
      log("warnung", `Gewählte Datei '${datei.name}' hat keine .mogrt-Endung.`);
    }
    zustand.mogrtPfad = datei.nativePath;
    zustand.mapping.template.mogrt_path = datei.nativePath;

    setzeStatus("statusMogrt", datei.nativePath, "ok");
    log("ok", "MOGRT gewählt: " + datei.nativePath);
    aktualisierePlatzierenButton();
  } catch (err) {
    log("fehler", "MOGRT-Auswahl fehlgeschlagen: " + err.message);
  }
}

// ---------------------------------------------------------------------------
// Schritt 3: Mapping laden / speichern
// ---------------------------------------------------------------------------

async function mappingLaden() {
  try {
    const datei = await lfs.getFileForOpening({ types: ["json"] });
    if (!datei) return;
    const daten = JSON.parse(await datei.read());

    if (!daten.fields || typeof daten.fields.comment_text !== "string") {
      log("fehler", "Mapping ungültig: 'fields.comment_text' fehlt.");
      setzeStatus("statusMapping", "Mapping ungültig.", "fehler");
      return;
    }

    zustand.mapping = Object.assign(standardMapping(), daten);
    zustand.mappingGeladen = true;
    if (zustand.mogrtPfad) {
      zustand.mapping.template.mogrt_path = zustand.mogrtPfad;
    }
    setzeStatus("statusMapping", `${datei.name} (Template: ${zustand.mapping.template.name})`, "ok");
    log("ok", "Mapping geladen: " + datei.name);
  } catch (err) {
    log("fehler", "Mapping konnte nicht geladen werden: " + err.message);
  }
}

async function mappingSpeichern() {
  try {
    const datei = await lfs.getFileForSaving("template_mapping.json", { types: ["json"] });
    if (!datei) return;
    await datei.write(JSON.stringify(zustand.mapping, null, 2));
    log("ok", "Mapping gespeichert: " + datei.nativePath);
  } catch (err) {
    log("fehler", "Mapping konnte nicht gespeichert werden: " + err.message);
  }
}

// ---------------------------------------------------------------------------
// Schritt 4: Kommentare platzieren
// ---------------------------------------------------------------------------

function aktualisierePlatzierenButton() {
  const bereit = Boolean(zustand.timeline && zustand.mogrtPfad);
  document.getElementById("btnPlatzieren").disabled = !bereit;
}

async function kommentarePlatzieren() {
  const knopf = document.getElementById("btnPlatzieren");
  knopf.disabled = true;
  setzeStatus("statusPlatzieren", "Platzierung läuft …");

  let erfolge = 0;
  let textErfolge = 0;
  let fehlschlaege = 0;

  try {
    const projekt = await ppro.Project.getActiveProject();
    if (!projekt) {
      throw new Error("Kein aktives Premiere-Projekt gefunden. Bitte Projekt öffnen.");
    }
    const sequenz = await projekt.getActiveSequence();
    if (!sequenz) {
      throw new Error("Keine aktive Sequenz gefunden. Bitte Sequenz öffnen.");
    }

    log("info", `Starte Platzierung in Projekt '${projekt.name}' …`);

    const eintraege = zustand.timeline.entries.slice(0, MAX_KOMMENTARE);
    const offset = Number(zustand.timeline.offset_seconds) || 0;
    const standard = zustand.mapping.defaults || {};

    for (let i = 0; i < eintraege.length; i++) {
      const eintrag = eintraege[i];
      const kommentar = eintrag.comment;
      const tl = eintrag.timeline || {};

      const startSekunden = (Number(tl.start_seconds) || 0) + offset;
      const dauerSekunden = Number(tl.duration_seconds) || Number(standard.duration_seconds) || 6;
      const videoSpur = Number.isInteger(tl.video_track) ? tl.video_track : (standard.video_track || 2);
      const audioSpur = Number.isInteger(tl.audio_track) ? tl.audio_track : (standard.audio_track || 0);

      try {
        const trackItem = await mogrtEinfuegen(projekt, sequenz, startSekunden, videoSpur, audioSpur);
        erfolge++;
        log("ok", `${kommentar.id}: MOGRT bei ${formatiereZeit(startSekunden)} auf V${videoSpur + 1} eingefügt.`);

        // Dauer setzen – in der aktuellen UXP-API nicht zuverlässig verfügbar,
        // daher Feature-Detection mit protokolliertem Fallback.
        await dauerSetzen(projekt, trackItem, startSekunden, dauerSekunden, kommentar.id);

        // Textbefüllung versuchen (bekannte UXP-Grenze, siehe Kopfkommentar).
        const textOk = await textBefuellen(projekt, trackItem, kommentar);
        if (textOk) textErfolge++;

        // Sequenzmarker pro Kommentar setzen.
        await markerSetzen(projekt, sequenz, startSekunden, kommentar);
      } catch (err) {
        fehlschlaege++;
        log("fehler", `${kommentar.id}: Platzierung fehlgeschlagen – ${err.message}`);
      }
    }

    const zusammenfassung =
      `Fertig: ${erfolge}/${eintraege.length} MOGRTs platziert, ` +
      `${textErfolge} Texte gesetzt, ${fehlschlaege} Fehler.`;
    log(fehlschlaege > 0 ? "warnung" : "ok", zusammenfassung);
    if (textErfolge < erfolge) {
      log(
        "warnung",
        "Hinweis: Source-Text ist über UXP derzeit nicht beschreibbar (Adobe-Limitierung). " +
        "Für die Textbefüllung den ExtendScript-Fallback nutzen: premiere/extendscript/whykiki_poc.jsx"
      );
    }
    setzeStatus("statusPlatzieren", zusammenfassung, fehlschlaege > 0 ? "fehler" : "ok");
  } catch (err) {
    log("fehler", "Abbruch: " + err.message);
    setzeStatus("statusPlatzieren", err.message, "fehler");
  } finally {
    knopf.disabled = false;
  }
}

/**
 * Fügt das gewählte MOGRT an der angegebenen Position ein.
 * insertMogrtFromPath ist eine Direktmethode (keine Action) und wird
 * in lockedAccess ausgeführt.
 */
async function mogrtEinfuegen(projekt, sequenz, startSekunden, videoSpur, audioSpur) {
  const editor = ppro.SequenceEditor.getEditor(sequenz);
  const startzeit = ppro.TickTime.createWithSeconds(startSekunden);

  let ergebnis = [];
  await projekt.lockedAccess(() => {
    ergebnis = editor.insertMogrtFromPath(zustand.mogrtPfad, startzeit, videoSpur, audioSpur);
  });

  if (!ergebnis || ergebnis.length === 0) {
    throw new Error("insertMogrtFromPath lieferte kein TrackItem zurück.");
  }
  return ergebnis[0];
}

/**
 * Versucht die Clipdauer zu setzen. Die UXP-API bietet hierfür (Stand 06/2026)
 * keine dokumentierte stabile Methode – daher Feature-Detection.
 */
async function dauerSetzen(projekt, trackItem, startSekunden, dauerSekunden, kommentarId) {
  try {
    if (typeof trackItem.createSetEndAction === "function") {
      const ende = ppro.TickTime.createWithSeconds(startSekunden + dauerSekunden);
      await projekt.lockedAccess(() => {
        projekt.executeTransaction((compound) => {
          compound.addAction(trackItem.createSetEndAction(ende));
        }, "WhyKiki: Clipdauer setzen");
      });
      log("ok", `${kommentarId}: Dauer auf ${dauerSekunden}s gesetzt.`);
    } else {
      log(
        "warnung",
        `${kommentarId}: Dauer setzen über UXP nicht verfügbar – Standarddauer des MOGRT bleibt aktiv ` +
        `(Fallback: ExtendScript).`
      );
    }
  } catch (err) {
    log("warnung", `${kommentarId}: Dauer konnte nicht gesetzt werden – ${err.message}`);
  }
}

/**
 * Versucht, Kommentartext und Autorenname in die MOGRT-Parameter zu schreiben.
 * Erwartung laut API-Status: schlägt für Source-Text fehl (UXP-Limitierung).
 * Rückgabe: true, wenn mindestens der Kommentartext gesetzt werden konnte.
 */
async function textBefuellen(projekt, trackItem, kommentar) {
  const felder = zustand.mapping.fields || {};
  const zuSetzen = [
    { feldName: felder.comment_text, wert: kommentar.message, bezeichnung: "Kommentartext" },
    { feldName: felder.author_name, wert: kommentar.author_name, bezeichnung: "Autorenname" },
  ].filter((e) => typeof e.feldName === "string" && e.feldName.length > 0);

  let kommentartextGesetzt = false;

  for (const ziel of zuSetzen) {
    try {
      const param = await findeParameter(projekt, trackItem, ziel.feldName);
      if (!param) {
        log("warnung", `${kommentar.id}: Parameter '${ziel.feldName}' nicht gefunden (${ziel.bezeichnung}).`);
        continue;
      }
      const keyframe = param.createKeyframe(ziel.wert);
      await projekt.lockedAccess(() => {
        projekt.executeTransaction((compound) => {
          compound.addAction(param.createSetValueAction(keyframe, true));
        }, "WhyKiki: MOGRT-Text setzen");
      });
      log("ok", `${kommentar.id}: ${ziel.bezeichnung} gesetzt ('${ziel.feldName}').`);
      if (ziel.bezeichnung === "Kommentartext") kommentartextGesetzt = true;
    } catch (err) {
      log(
        "warnung",
        `${kommentar.id}: ${ziel.bezeichnung} konnte nicht gesetzt werden – ${err.message} ` +
        `(bekannte UXP-Grenze, ExtendScript-Fallback nutzen).`
      );
    }
  }

  return kommentartextGesetzt;
}

/**
 * Durchsucht die Komponentenkette des TrackItems nach einem Parameter
 * mit passendem displayName. UXP bietet kein getParamForDisplayName,
 * daher Iteration über alle Komponenten und Parameter.
 */
async function findeParameter(projekt, trackItem, anzeigeName) {
  let gefunden = null;
  await projekt.lockedAccess(() => {
    const kette = trackItem.getComponentChain();
    const anzahlKomponenten = kette.getComponentCount();
    for (let k = 0; k < anzahlKomponenten && !gefunden; k++) {
      const komponente = kette.getComponentAtIndex(k);
      const anzahlParameter = komponente.getParamCount();
      for (let p = 0; p < anzahlParameter; p++) {
        const param = komponente.getParam(p);
        if (param && param.displayName === anzeigeName) {
          gefunden = param;
          break;
        }
      }
    }
  });
  return gefunden;
}

/**
 * Setzt einen Sequenzmarker an der Kommentarposition.
 */
async function markerSetzen(projekt, sequenz, startSekunden, kommentar) {
  try {
    const marker = await ppro.Markers.getMarkers(sequenz);
    const startzeit = ppro.TickTime.createWithSeconds(startSekunden);
    const dauer = ppro.TickTime.createWithSeconds(0);
    const name = `${kommentar.author_name} (${kommentar.id})`;

    await projekt.lockedAccess(() => {
      projekt.executeTransaction((compound) => {
        compound.addAction(
          marker.createAddMarkerAction(name, "Comment", startzeit, dauer, kommentar.message)
        );
      }, "WhyKiki: Kommentar-Marker setzen");
    });
    log("ok", `${kommentar.id}: Marker gesetzt.`);
  } catch (err) {
    log("warnung", `${kommentar.id}: Marker konnte nicht gesetzt werden – ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Protokoll speichern / leeren
// ---------------------------------------------------------------------------

async function logSpeichern() {
  try {
    const zeitstempel = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    const datei = await lfs.getFileForSaving(`whykiki_poc_log_${zeitstempel}.txt`, { types: ["txt"] });
    if (!datei) return;
    await datei.write(logZeilen.join("\n"));
    log("ok", "Protokoll gespeichert: " + datei.nativePath);
  } catch (err) {
    log("fehler", "Protokoll konnte nicht gespeichert werden: " + err.message);
  }
}

function logLeeren() {
  logZeilen.length = 0;
  document.getElementById("log").textContent = "";
}

// ---------------------------------------------------------------------------
// Initialisierung
// ---------------------------------------------------------------------------

document.getElementById("btnTimelineLaden").addEventListener("click", timelineLaden);
document.getElementById("btnMogrtWaehlen").addEventListener("click", mogrtWaehlen);
document.getElementById("btnMappingLaden").addEventListener("click", mappingLaden);
document.getElementById("btnMappingSpeichern").addEventListener("click", mappingSpeichern);
document.getElementById("btnPlatzieren").addEventListener("click", kommentarePlatzieren);
document.getElementById("btnLogSpeichern").addEventListener("click", logSpeichern);
document.getElementById("btnLogLeeren").addEventListener("click", logLeeren);

log("info", "WhyKiki Stream Companion PoC bereit. Premiere Pro 25.6+ erforderlich.");
