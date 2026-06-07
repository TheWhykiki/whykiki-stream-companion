/**
 * Diagnostiziert bestehende Clips auf allen Videospuren:
 * Startzeit, getMGTComponent() und bekannte Textparameter.
 * Start in Premiere-Konsole:
 *   SL.ExecuteJSFile /Users/whykiki/srv/git/whykiki-stream-companion/premiere/extendscript/diagnose_existing_mogrts.jsx
 */

(function () {
  var REPO = "/Users/whykiki/srv/git/whykiki-stream-companion";
  var TICKS_PRO_SEKUNDE = 254016000000;
  var zielStarts = [135, 220, 302, 450, 551, 765, 920, 1085, 1310, 1533];
  var zielNamen = ["c-0001", "c-0002", "c-0003", "c-0004", "c-0005", "c-0006", "c-0007", "c-0008", "c-0009", "c-0010"];
  var zeilen = [];

  function log(s) {
    zeilen.push(s);
    $.writeln(s);
  }

  function sekundenVonTime(zeit) {
    if (!zeit) return 0;
    if (zeit.seconds !== undefined) return Number(zeit.seconds);
    if (zeit.ticks !== undefined) return Number(zeit.ticks) / TICKS_PRO_SEKUNDE;
    return Number(zeit) || 0;
  }

  var seq = app.project.activeSequence;
  if (!seq) {
    log("Keine aktive Sequenz.");
  } else {
    log("Projekt: " + app.project.name + " | Sequenz: " + seq.name);
    var spuren = seq.videoTracks;
    var spurAnzahl = spuren.numTracks || spuren.numItems || spuren.length || 0;
    log("Videospuren: " + spurAnzahl);

    for (var s = 0; s < spurAnzahl; s++) {
      var spur = spuren[s];
      if (!spur || !spur.clips) continue;
      var clips = spur.clips;
      var anzahl = clips.numItems || clips.length || 0;
      log("V" + (s + 1) + "-Clips: " + anzahl);

      for (var i = 0; i < anzahl; i++) {
        var clip = clips[i];
        var start = sekundenVonTime(clip.start);
        var ende = sekundenVonTime(clip.end);
        var ziel = "";
        for (var z = 0; z < zielStarts.length; z++) {
          if (Math.abs(start - zielStarts[z]) <= 0.2) ziel = zielNamen[z];
        }
        if (!ziel) continue;
        var komponente = null;
        try {
          komponente = clip.getMGTComponent();
        } catch (e) {
          komponente = null;
        }
        log(ziel + " | V" + (s + 1) + " Clip " + i + ": start=" + start + " end=" + ende + " name=" + clip.name + " mgt=" + (!!komponente));
        if (komponente) {
          log("  Message=" + wertVonParam(komponente, "Message"));
          log("  ChatHeader=" + wertVonParam(komponente, "ChatHeader"));
        }
      }
    }
  }

  function wertVonParam(komponente, name) {
    try {
      var param = komponente.properties.getParamForDisplayName(name);
      if (!param) return "<kein Param>";
      var wert = param.getValue();
      if (typeof wert === "string" && wert.length > 180) {
        return wert.substring(0, 180) + "...";
      }
      return String(wert);
    } catch (e) {
      return "<Fehler: " + e.message + ">";
    }
  }

  var datei = new File(REPO + "/docs/validierung/mgt_diagnose.txt");
  datei.encoding = "UTF-8";
  datei.open("w");
  datei.write(zeilen.join("\n"));
  datei.close();
})();
