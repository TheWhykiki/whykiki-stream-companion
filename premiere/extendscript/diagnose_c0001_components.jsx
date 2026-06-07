/**
 * Diagnostiziert normale TrackItem-Komponenten des c-0001-Clips.
 *
 * Start in Premiere-Konsole:
 *   SL.ExecuteJSFile /Users/whykiki/srv/git/whykiki-stream-companion/premiere/extendscript/diagnose_c0001_components.jsx
 */

(function () {
  var REPO = "/Users/whykiki/srv/git/whykiki-stream-companion";
  var LOG = REPO + "/docs/validierung/c0001_components.txt";
  var TICKS_PRO_SEKUNDE = 254016000000;
  var zeilen = [];

  function log(s) {
    zeilen.push(s);
    $.writeln(s);
  }

  function speichern() {
    var f = new File(LOG);
    f.encoding = "UTF-8";
    f.open("w");
    f.write(zeilen.join("\n"));
    f.close();
  }

  function sekundenVonTime(zeit) {
    if (!zeit) return 0;
    if (zeit.seconds !== undefined) return Number(zeit.seconds);
    if (zeit.ticks !== undefined) return Number(zeit.ticks) / TICKS_PRO_SEKUNDE;
    return Number(zeit) || 0;
  }

  function anzahlVon(coll) {
    if (!coll) return 0;
    return coll.numItems || coll.numProperties || coll.length || 0;
  }

  function itemVon(coll, i) {
    if (!coll) return null;
    if (coll[i]) return coll[i];
    if (coll.getParamAtIndex) return coll.getParamAtIndex(i);
    if (coll.getParam) return coll.getParam(i);
    return null;
  }

  try {
    var seq = app.project.activeSequence;
    var spur = seq.videoTracks[2];
    var clips = spur.clips;
    var ziel = null;
    for (var i = 0; i < clips.numItems; i++) {
      var clip = clips[i];
      if (Math.abs(sekundenVonTime(clip.start) - 135) <= 0.08) {
        ziel = clip;
        break;
      }
    }
    if (!ziel) {
      log("c-0001 nicht gefunden.");
      speichern();
      return;
    }

    log("Clip: name=" + ziel.name + " start=" + sekundenVonTime(ziel.start) + " end=" + sekundenVonTime(ziel.end));
    try {
      log("getMGTComponent=" + (!!ziel.getMGTComponent()));
    } catch (eMgt) {
      log("getMGTComponent Fehler: " + eMgt.message);
    }

    var komponenten = ziel.components;
    var kAnzahl = anzahlVon(komponenten);
    log("components=" + kAnzahl);
    for (var k = 0; k < kAnzahl; k++) {
      var komponente = itemVon(komponenten, k);
      if (!komponente) continue;
      log("Component " + k + ": name=" + komponente.name + " displayName=" + komponente.displayName + " matchName=" + komponente.matchName);
      var props = komponente.properties;
      var pAnzahl = anzahlVon(props);
      log("  properties=" + pAnzahl);
      for (var p = 0; p < pAnzahl; p++) {
        var param = itemVon(props, p);
        if (!param) continue;
        var wert = "";
        try {
          wert = String(param.getValue());
        } catch (eWert) {
          wert = "<getValue Fehler: " + eWert.message + ">";
        }
        if (wert.length > 220) wert = wert.substring(0, 220) + "...";
        log("  Param " + p + ": name=" + param.name + " displayName=" + param.displayName + " value=" + wert);
      }
    }
  } catch (e) {
    log("FEHLER: " + e.toString() + (e.line ? " | Zeile: " + e.line : ""));
  }
  speichern();
})();
