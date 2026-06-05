## Imported Claude Cowork project instructions

Current priority: close the Premiere-PoC validation gate before starting new
adapters or feature work.

Use this handoff first:

- `docs/validierung/cowork-auftrag.md`

The gate is not closed by local tests alone. It requires evidence from a real
Premiere Pro 25.6+ environment:

1. UXP panel places 10 MOGRTs correctly in a real sequence.
2. ExtendScript fallback places 10 MOGRTs and visibly fills comment text.
3. `docs/validierung/ergebnis-2026-06-05.md` is completed.
4. `docs/validierung/panel_log.txt` and
   `docs/validierung/extendscript_log.txt` contain the real logs.

Do not start P2 YouTube/Twitch adapter work until the validation result is
documented as PASS or the concrete blocker is fixed and retested.
