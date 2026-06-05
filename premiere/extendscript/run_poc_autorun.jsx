/**
 * Headless-Launcher fuer whykiki_poc.jsx – keine Dateidialoge.
 *
 * Start in Premiere ueber die versteckte Konsole (Cmd+F12):
 *   SL.ExecuteJSFile /Users/whykiki/srv/git/whykiki-stream-companion/premiere/extendscript/run_poc_autorun.jsx
 *
 * Oder automatisiert via tools/validate-premiere.sh.
 *
 * Hinweise aus der Validierung 2026-06-05:
 *  - SL.ExecuteJSFile verarbeitet #include nicht -> $.evalFile noetig.
 *  - $.fileName ist unter SL.ExecuteJSFile leer -> absolute Pfade.
 *  - Voraussetzung: Projekt offen, Zielsequenz aktiv, KEIN After Effects
 *    parallel (blockiert sonst den MOGRT-Import via DynamicLink).
 */

var REPO = "/Users/whykiki/srv/git/whykiki-stream-companion";

$.global.WHYKIKI_TIMELINE = REPO + "/examples/comments_timeline.json";
$.global.WHYKIKI_MAPPING = REPO + "/examples/template_mapping.json";
$.global.WHYKIKI_MOGRT =
    "/Users/whykiki/Daten/StableAudio/Github/StableAudio Helper Scripts/" +
    "knowledge_base_docs/lyraaa Finetuning Video/ChatItem 1.mogrt";

var __fehlerDatei = new File(REPO + "/.validate_poc_error.txt");
try {
    $.evalFile(REPO + "/premiere/extendscript/whykiki_poc.jsx");
} catch (e) {
    __fehlerDatei.encoding = "UTF-8";
    __fehlerDatei.open("w");
    __fehlerDatei.write("FEHLER: " + e.toString() + (e.line ? " | Zeile: " + e.line : ""));
    __fehlerDatei.close();
} finally {
    $.global.WHYKIKI_TIMELINE = undefined;
    $.global.WHYKIKI_MAPPING = undefined;
    $.global.WHYKIKI_MOGRT = undefined;
}
