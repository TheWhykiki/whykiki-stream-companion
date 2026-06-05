/**
 * Launcher fuer whykiki_poc.jsx ueber die Premiere-Konsole.
 *
 * Validierungsbefund 2026-06-05: Premiere Pro 26.x (macOS) hat kein Menue
 * "Datei > Skripte" mehr. Skripte lassen sich aber ueber die versteckte
 * Konsole (Cmd+F12) starten:
 *
 *   SL.ExecuteJSFile /pfad/zu/run_poc_via_console.jsx
 *
 * Wichtig: SL.ExecuteJSFile verarbeitet die #include-Direktive NICHT
 * (Skript bricht still ab). $.evalFile dagegen schon - daher dieser
 * Launcher.
 */

var __fehlerDatei = new File("/Users/whykiki/srv/git/whykiki-stream-companion/.tmp_poc_error.txt");
try {
    // Hinweis: $.fileName ist unter SL.ExecuteJSFile leer – absoluter Pfad noetig.
    $.evalFile("/Users/whykiki/srv/git/whykiki-stream-companion/premiere/extendscript/whykiki_poc.jsx");
    __fehlerDatei.encoding = "UTF-8";
    __fehlerDatei.open("w");
    __fehlerDatei.write("OK – kein Fehler beim evalFile.");
    __fehlerDatei.close();
} catch (e) {
    __fehlerDatei.encoding = "UTF-8";
    __fehlerDatei.open("w");
    __fehlerDatei.write("FEHLER: " + e.toString() + (e.line ? " | Zeile: " + e.line : "") + (e.fileName ? " | Datei: " + e.fileName : ""));
    __fehlerDatei.close();
}
