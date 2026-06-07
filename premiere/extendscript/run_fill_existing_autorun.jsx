/**
 * Headless-Launcher fuer den Hybrid-Pfad:
 * UXP platziert MOGRTs, ExtendScript befuellt danach bestehende Clips.
 *
 * Start in Premiere ueber die versteckte Konsole (Cmd+F12):
 *   SL.ExecuteJSFile /Users/whykiki/srv/git/whykiki-stream-companion/premiere/extendscript/run_fill_existing_autorun.jsx
 */

var REPO = "/Users/whykiki/srv/git/whykiki-stream-companion";

$.global.WHYKIKI_MODE = "fill-existing";
$.global.WHYKIKI_TIMELINE = REPO + "/examples/comments_timeline.json";
$.global.WHYKIKI_MAPPING = REPO + "/examples/template_mapping.json";
$.global.WHYKIKI_NO_ALERT = true;
$.global.WHYKIKI_PLAYHEAD_SECONDS = 1312;

var __fehlerDatei = new File(REPO + "/.validate_poc_error.txt");
try {
    $.evalFile(REPO + "/premiere/extendscript/whykiki_poc.jsx");
} catch (e) {
    __fehlerDatei.encoding = "UTF-8";
    __fehlerDatei.open("w");
    __fehlerDatei.write("FEHLER: " + e.toString() + (e.line ? " | Zeile: " + e.line : ""));
    __fehlerDatei.close();
} finally {
    $.global.WHYKIKI_MODE = undefined;
    $.global.WHYKIKI_TIMELINE = undefined;
    $.global.WHYKIKI_MAPPING = undefined;
    $.global.WHYKIKI_NO_ALERT = undefined;
    $.global.WHYKIKI_PLAYHEAD_SECONDS = undefined;
}
