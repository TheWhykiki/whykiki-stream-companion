# Premiere-PoC-Validierung

Diese Mappe sammelt die Nachweise fuer das offene Phase-0-Gate aus
`docs/premiere-validierung.md`.

## Dateien

- `cowork-auftrag.md` - kurze Uebergabe fuer die externe Premiere-Pruefung.
- `ergebnis-2026-06-05.md` - ausfuellbare PASS/FAIL-Vorlage fuer Cowork.
- `panel_log.txt` - hier das gespeicherte UXP-Panel-Protokoll ablegen.
- `extendscript_log.txt` - hier das ExtendScript-Protokoll ablegen.

## Abnahme

Das Gate ist erst geschlossen, wenn die Ergebnisdatei belegt:

1. Das UXP-Panel platziert 10 MOGRTs korrekt in einer echten Premiere-Sequenz.
2. Die MOGRTs liegen auf V3 an den erwarteten Zeiten.
3. Marker werden gesetzt oder API-Warnungen sind sauber dokumentiert.
4. Der ExtendScript-Fallback setzt Kommentartexte sichtbar in das MOGRT.
5. Beide Logs liegen in dieser Mappe.

Wenn ein Punkt fehlschlaegt, bleibt das Gate offen. Dann den Blocker in
`ergebnis-2026-06-05.md` dokumentieren, gezielt fixen und denselben Test
wiederholen.
