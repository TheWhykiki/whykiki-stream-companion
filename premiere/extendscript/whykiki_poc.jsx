/**
 * WhyKiki Stream Companion – ExtendScript-Fallback (MVP 1)
 *
 * Zweck: Die UXP-API kann (Stand 06/2026) den Source-Text von MOGRTs nicht
 * beschreiben. Dieses Skript übernimmt als Fallback den kompletten PoC-Ablauf
 * inklusive Textbefüllung:
 *
 *  - comments_timeline.json laden (Dateidialog)
 *  - MOGRT wählen (Dateidialog)
 *  - template_mapping.json laden (Dateidialog, optional)
 *  - bis zu 10 Kommentare in die aktive Sequenz einfügen
 *  - Kommentartext + Autorenname in die MOGRT-Parameter schreiben
 *  - Clipdauer setzen
 *  - Sequenzmarker pro Kommentar erzeugen
 *  - Protokoll als Datei neben der Timeline-JSON ablegen
 *
 * Ausführen: Premiere Pro → Datei → Skripte → Skript ausführen … → diese Datei.
 * Voraussetzung: Projekt und Zielsequenz sind geöffnet/aktiv.
 *
 * Hinweis: getMGTComponent() funktioniert für After-Effects-MOGRTs.
 * Bei Premiere-eigenen Graphics-MOGRTs liegt der Text in regulären
 * Graphics-Komponenten – siehe docs/uxp-api-status.md.
 */

/* eslint-disable */

// JSON-Polyfill für ExtendScript (ES3 hat kein natives JSON-Objekt)
#include "whykiki_json.jsxinc"

(function () {
  var MAX_KOMMENTARE = 10;
  var TICKS_PRO_SEKUNDE = 254016000000; // Premiere-Konstante

  var protokoll = [];

  function log(stufe, nachricht) {
    var zeile = "[" + stufe + "] " + nachricht;
    protokoll.push(zeile);
    $.writeln(zeile);
  }

  // -------------------------------------------------------------------------
  // JSON lesen – über das eingebundene Polyfill (strukturvalidierter Parser,
  // kein nacktes eval mehr; Review-Befunde 9 und 13).
  // -------------------------------------------------------------------------

  function leseJsonDatei(datei) {
    datei.encoding = "UTF-8";
    if (!datei.open("r")) {
      throw new Error("Datei konnte nicht geöffnet werden: " + datei.fsName);
    }
    var inhalt = datei.read();
    datei.close();
    return JSON.parse(inhalt);
  }

  // -------------------------------------------------------------------------
  // Dateien wählen
  // -------------------------------------------------------------------------

  var timelineDatei = File.openDialog("comments_timeline.json wählen", "*.json");
  if (!timelineDatei) {
    alert("Abgebrochen: keine Timeline-Datei gewählt.");
    return;
  }

  var mogrtDatei = File.openDialog("MOGRT-Datei wählen", "*.mogrt");
  if (!mogrtDatei) {
    alert("Abgebrochen: kein MOGRT gewählt.");
    return;
  }

  var mappingDatei = File.openDialog("template_mapping.json wählen (Abbrechen = Standard-Mapping)", "*.json");

  // -------------------------------------------------------------------------
  // Daten laden
  // -------------------------------------------------------------------------

  var timeline, mapping;
  try {
    timeline = leseJsonDatei(timelineDatei);
  } catch (e) {
    alert("Timeline-JSON konnte nicht gelesen werden:\n" + e.message);
    return;
  }

  if (mappingDatei) {
    try {
      mapping = leseJsonDatei(mappingDatei);
    } catch (e) {
      alert("Mapping-JSON konnte nicht gelesen werden:\n" + e.message);
      return;
    }
  } else {
    mapping = {
      fields: { comment_text: "Source Text", author_name: "Author Name" },
      defaults: { duration_seconds: 6, video_track: 2, audio_track: 0 }
    };
    log("INFO", "Kein Mapping gewählt – Standard-Mapping aktiv.");
  }

  if (!timeline.entries || timeline.entries.length === 0) {
    alert("Timeline enthält keine Einträge ('entries' fehlt oder leer).");
    return;
  }

  // -------------------------------------------------------------------------
  // Premiere-Umgebung prüfen
  // -------------------------------------------------------------------------

  if (!app.project) {
    alert("Kein Projekt geöffnet.");
    return;
  }
  var sequenz = app.project.activeSequence;
  if (!sequenz) {
    alert("Keine aktive Sequenz. Bitte Sequenz öffnen.");
    return;
  }

  log("INFO", "Projekt: " + app.project.name + " | Sequenz: " + sequenz.name);
  log("INFO", "MOGRT: " + mogrtDatei.fsName);

  // -------------------------------------------------------------------------
  // Kommentare platzieren
  // -------------------------------------------------------------------------

  // WICHTIG: timeline.offset_seconds ist rein deklarativ – der Timeline
  // Builder hat den Offset bereits eingerechnet. NICHT erneut addieren
  // (Review-Befund 2).
  var standard = mapping.defaults || {};
  var erfolge = 0;
  var textErfolge = 0;
  var fehlschlaege = 0;

  var anzahl = Math.min(timeline.entries.length, MAX_KOMMENTARE);

  for (var i = 0; i < anzahl; i++) {
    var eintrag = timeline.entries[i];
    var kommentar = eintrag.comment || {};
    var tl = eintrag.timeline || {};
    var kid = kommentar.id || ("eintrag-" + (i + 1));

    var startSekunden = Number(tl.start_seconds) || 0;
    var dauerSekunden = Number(tl.duration_seconds) || Number(standard.duration_seconds) || 6;
    var videoSpur = (tl.video_track !== undefined) ? tl.video_track : (standard.video_track || 2);
    var audioSpur = (tl.audio_track !== undefined) ? tl.audio_track : (standard.audio_track || 0);

    try {
      // 1) MOGRT einfügen (Zeit in Ticks als String)
      var startTicks = String(Math.round(startSekunden * TICKS_PRO_SEKUNDE));
      var trackItem = sequenz.importMGT(mogrtDatei.fsName, startTicks, videoSpur, audioSpur);

      if (!trackItem) {
        throw new Error("importMGT lieferte kein TrackItem (Spur V" + (videoSpur + 1) + " vorhanden?).");
      }
      erfolge++;
      log("OK", kid + ": MOGRT bei " + startSekunden + "s auf V" + (videoSpur + 1) + " eingefügt.");

      // 2) Dauer setzen
      try {
        var ende = new Time();
        ende.seconds = startSekunden + dauerSekunden;
        trackItem.end = ende;
        log("OK", kid + ": Dauer auf " + dauerSekunden + "s gesetzt.");
      } catch (eDauer) {
        log("WARNUNG", kid + ": Dauer konnte nicht gesetzt werden – " + eDauer.message);
      }

      // 3) Text befüllen
      var moComp = trackItem.getMGTComponent();
      if (moComp) {
        if (setzeTextParameter(moComp, mapping.fields.comment_text, kommentar.message, kid, "Kommentartext")) {
          textErfolge++;
        }
        if (mapping.fields.author_name) {
          setzeTextParameter(moComp, mapping.fields.author_name, kommentar.author_name, kid, "Autorenname");
        }
      } else {
        log("WARNUNG", kid + ": getMGTComponent() lieferte nichts – ist das MOGRT mit After Effects erstellt?");
      }

      // 4) Marker setzen
      try {
        var marker = sequenz.markers.createMarker(startSekunden);
        marker.name = (kommentar.author_name || "Unbekannt") + " (" + kid + ")";
        marker.comments = kommentar.message || "";
        log("OK", kid + ": Marker gesetzt.");
      } catch (eMarker) {
        log("WARNUNG", kid + ": Marker konnte nicht gesetzt werden – " + eMarker.message);
      }
    } catch (e) {
      fehlschlaege++;
      log("FEHLER", kid + ": " + e.message);
    }
  }

  // -------------------------------------------------------------------------
  // Source-Text-Parameter setzen (JSON-Textdokument-Muster)
  // -------------------------------------------------------------------------

  function setzeTextParameter(moComp, feldName, wert, kid, bezeichnung) {
    if (!feldName || wert === undefined || wert === null) return false;
    try {
      var param = moComp.properties.getParamForDisplayName(feldName);
      if (!param) {
        log("WARNUNG", kid + ": Parameter '" + feldName + "' nicht gefunden (" + bezeichnung + ").");
        return false;
      }
      var roh = param.getValue();
      var textDoc;
      try {
        textDoc = JSON.parse(roh);
      } catch (eParse) {
        // Kein JSON-Textdokument → einfacher String-Parameter
        param.setValue(String(wert), true);
        log("OK", kid + ": " + bezeichnung + " gesetzt (String-Parameter '" + feldName + "').");
        return true;
      }
      textDoc.textEditValue = String(wert);
      // Manche Templates verlangen die Anpassung der Run-Länge:
      if (textDoc.fontTextRunLength !== undefined) {
        textDoc.fontTextRunLength = String(wert).length;
      }
      param.setValue(JSON.stringify(textDoc), true);
      log("OK", kid + ": " + bezeichnung + " gesetzt ('" + feldName + "').");
      return true;
    } catch (e) {
      log("WARNUNG", kid + ": " + bezeichnung + " konnte nicht gesetzt werden – " + e.message);
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Protokoll schreiben
  // -------------------------------------------------------------------------

  var zusammenfassung =
    "Fertig: " + erfolge + "/" + anzahl + " MOGRTs platziert, " +
    textErfolge + " Kommentartexte gesetzt, " + fehlschlaege + " Fehler.";
  log("INFO", zusammenfassung);

  try {
    var logDatei = new File(timelineDatei.parent.fsName + "/whykiki_poc_log.txt");
    logDatei.encoding = "UTF-8";
    if (logDatei.open("w")) {
      logDatei.write(protokoll.join("\n"));
      logDatei.close();
      log("INFO", "Protokoll gespeichert: " + logDatei.fsName);
    }
  } catch (eLog) {
    log("WARNUNG", "Protokoll konnte nicht gespeichert werden: " + eLog.message);
  }

  alert(zusammenfassung + "\n\nDetails: whykiki_poc_log.txt im Ordner der Timeline-JSON.");
})();
