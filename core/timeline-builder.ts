/**
 * Timeline Builder – das wichtigste Modul des Core.
 *
 * Entscheidet, wann Kommentare erscheinen, wie lange sie sichtbar sind,
 * welche priorisiert werden, wie Fluten behandelt und Gruppen gebildet
 * werden. Enthält keinerlei Plattform- oder Design-Logik.
 *
 * Pipeline:
 *   Kommentare → Filter → Offset-Korrektur → Sortierung →
 *   Flutbehandlung/Gruppierung → Highlight-Markierung → TimelineDocument
 *
 * Überarbeitung nach Review (Befunde 5–7, 18, 24):
 *  - Das Sichtfenster wird ausschließlich aus den tatsächlich
 *    übernommenen Einträgen abgeleitet (eine Quelle der Wahrheit).
 *  - min_gap-Verschiebungen sind durch max_shift_seconds begrenzt;
 *    danach wird verworfen statt entkoppelt. Clamp nach Verschiebung.
 *  - Eine Flut-Gruppe endet, sobald wieder ein freier Slot existiert.
 *  - Duplikatfilter arbeitet mit Zeitfenster.
 *  - Statistik wird am Ende aus dem Endzustand abgeleitet;
 *    Invariante: Summe aller Kategorien == eingegangen.
 */

import type {
  BuilderOptions,
  Comment,
  StreamMeta,
  TimelineDocument,
  TimelineEntry,
} from "./types.js";
import { STANDARD_BUILDER_OPTIONEN } from "./types.js";
import { Protokoll } from "./log.js";

export interface BuildErgebnis {
  dokument: TimelineDocument;
  statistik: {
    eingegangen: number;
    gefiltert_leer: number;
    gefiltert_kurz: number;
    gefiltert_blockliste: number;
    gefiltert_duplikat: number;
    gefiltert_ausserhalb: number;
    verworfen_flut: number;
    verworfen_drift: number;
    gruppen: number;
    highlights: number;
    uebernommen: number;
  };
}

export function bauesTimeline(
  kommentare: Comment[],
  meta: StreamMeta,
  projectId: string,
  optionen?: Partial<BuilderOptions>,
  protokoll?: Protokoll
): BuildErgebnis {
  const opt: BuilderOptions = { ...STANDARD_BUILDER_OPTIONEN, ...optionen };
  const log = protokoll ?? new Protokoll({ still: true });

  const statistik: BuildErgebnis["statistik"] = {
    eingegangen: kommentare.length,
    gefiltert_leer: 0,
    gefiltert_kurz: 0,
    gefiltert_blockliste: 0,
    gefiltert_duplikat: 0,
    gefiltert_ausserhalb: 0,
    verworfen_flut: 0,
    verworfen_drift: 0,
    gruppen: 0,
    highlights: 0,
    uebernommen: 0,
  };

  // -------------------------------------------------------------------------
  // 1. Kommentarfilter
  // -------------------------------------------------------------------------

  const blockliste = opt.filter_blocklist.map((w) => w.toLowerCase());
  const letzteProAutor = new Map<string, { text: string; zeit: number }>();

  const gefiltert: Comment[] = [];
  for (const k of [...kommentare].sort(
    (a, b) => a.relative_time_seconds - b.relative_time_seconds
  )) {
    const text = k.message.trim();

    if (text.length === 0) {
      statistik.gefiltert_leer++;
      continue;
    }
    if (text.length < opt.filter_min_length) {
      statistik.gefiltert_kurz++;
      log.info(`Filter (zu kurz): ${k.id} '${text}'`);
      continue;
    }
    const klein = text.toLowerCase();
    if (blockliste.some((w) => klein.includes(w))) {
      statistik.gefiltert_blockliste++;
      log.info(`Filter (Blockliste): ${k.id}`);
      continue;
    }
    if (opt.filter_duplicates) {
      const schluessel = k.author_handle || k.author_name;
      const letzte = letzteProAutor.get(schluessel);
      if (
        letzte &&
        letzte.text === klein &&
        k.relative_time_seconds - letzte.zeit <= opt.filter_duplicate_window_seconds
      ) {
        statistik.gefiltert_duplikat++;
        log.info(`Filter (Duplikat innerhalb ${opt.filter_duplicate_window_seconds}s): ${k.id}`);
        continue;
      }
      letzteProAutor.set(schluessel, { text: klein, zeit: k.relative_time_seconds });
    }
    gefiltert.push(k);
  }

  // -------------------------------------------------------------------------
  // 2. Offset-Korrektur + Begrenzung auf Videolänge
  // -------------------------------------------------------------------------

  interface Platziert {
    kommentar: Comment;
    start: number;
  }

  const platziert: Platziert[] = [];
  for (const k of gefiltert) {
    const start = k.relative_time_seconds + opt.offset_seconds;
    if (start < 0) {
      statistik.gefiltert_ausserhalb++;
      log.info(`Außerhalb (vor 0s nach Offset): ${k.id}`);
      continue;
    }
    if (
      opt.clamp_to_video &&
      meta.duration_seconds > 0 &&
      start > meta.duration_seconds
    ) {
      statistik.gefiltert_ausserhalb++;
      log.info(`Außerhalb (nach Videoende): ${k.id}`);
      continue;
    }
    platziert.push({ kommentar: k, start });
  }

  // -------------------------------------------------------------------------
  // 3. Flutbehandlung und Gruppierung
  //
  // Das Sichtfenster wird stets aus den tatsächlich übernommenen Einträgen
  // abgeleitet (keine getrennte Buchhaltung, Review-Befund 6). Regel:
  // maximal opt.max_concurrent gleichzeitig sichtbare Kommentare. Bei
  // Überlauf gewinnt der reaktionsstärkere Kommentar (Highlights werden
  // nie verdrängt); der Rest wird verworfen und das Fenster als Gruppe
  // markiert. Eine Gruppe endet, sobald wieder ein freier Slot existiert
  // (Review-Befund 5).
  // -------------------------------------------------------------------------

  const eintraege: TimelineEntry[] = [];
  let gruppenZaehler = 0;
  let aktuelleGruppe: string | null = null;
  let letzterStart = -Infinity;

  /** Tatsächlich sichtbare Einträge zum Zeitpunkt t (einzige Quelle der Wahrheit). */
  function sichtbareUm(t: number): TimelineEntry[] {
    // Einträge sind chronologisch – rückwärts suchen reicht, sobald
    // start + maximale Dauer unter t liegt, kann abgebrochen werden.
    const ergebnis: TimelineEntry[] = [];
    for (let i = eintraege.length - 1; i >= 0; i--) {
      const e = eintraege[i]!;
      if (e.timeline.start_seconds + e.timeline.duration_seconds <= t) {
        // Chronologie: alles davor endet noch früher, sobald wir
        // max. Dauer Abstand haben.
        if (t - e.timeline.start_seconds > opt.default_duration_seconds * 2) break;
        continue;
      }
      if (e.timeline.start_seconds <= t) ergebnis.push(e);
    }
    return ergebnis;
  }

  for (const p of platziert) {
    const dauer = opt.default_duration_seconds;

    // Mindestabstand erzwingen – aber begrenzt (Review-Befund 7)
    let start = p.start;
    if (start - letzterStart < opt.min_gap_seconds) {
      start = letzterStart + opt.min_gap_seconds;
    }
    if (start - p.start > opt.max_shift_seconds) {
      statistik.verworfen_drift++;
      log.info(
        `Drift: ${p.kommentar.id} verworfen (Verschiebung ${runde(start - p.start)}s > max ${opt.max_shift_seconds}s).`
      );
      continue;
    }
    // Clamp NACH der Verschiebung erneut prüfen
    if (opt.clamp_to_video && meta.duration_seconds > 0 && start > meta.duration_seconds) {
      statistik.gefiltert_ausserhalb++;
      log.info(`Außerhalb (nach Videoende durch Verschiebung): ${p.kommentar.id}`);
      continue;
    }

    let sichtbar = sichtbareUm(start);

    // Freier Slot vorhanden → laufende Flut-Gruppe endet (Review-Befund 5)
    if (sichtbar.length < opt.max_concurrent) {
      aktuelleGruppe = null;
    }

    if (sichtbar.length >= opt.max_concurrent) {
      // Flut: Gruppe sicherstellen und sichtbare Einträge zuordnen
      if (aktuelleGruppe === null) {
        gruppenZaehler++;
        aktuelleGruppe = `flut-${String(gruppenZaehler).padStart(3, "0")}`;
        for (const e of sichtbar) {
          e.timeline.group_id = aktuelleGruppe;
        }
      }

      const schwaechster = schwaechsterVon(sichtbar);
      if (schwaechster && p.kommentar.reactions > schwaechster.comment.reactions) {
        // Schwächsten verdrängen
        eintraege.splice(eintraege.indexOf(schwaechster), 1);
        statistik.verworfen_flut++;
        log.info(
          `Flut: ${schwaechster.comment.id} verdrängt durch ${p.kommentar.id} ` +
            `(Reaktionen ${schwaechster.comment.reactions} < ${p.kommentar.reactions}).`
        );
      } else {
        statistik.verworfen_flut++;
        log.info(`Flut: ${p.kommentar.id} verworfen (Gruppe ${aktuelleGruppe}).`);
        continue;
      }
    }

    const highlight = p.kommentar.reactions >= opt.highlight_min_reactions;

    eintraege.push({
      comment: p.kommentar,
      timeline: {
        start_seconds: runde(start),
        duration_seconds: runde(dauer),
        video_track: opt.video_track,
        audio_track: opt.audio_track,
        highlight,
        group_id: aktuelleGruppe,
      },
    });

    letzterStart = start;
  }

  eintraege.sort((a, b) => a.timeline.start_seconds - b.timeline.start_seconds);

  // Statistik aus dem Endzustand ableiten (Review-Befund 18)
  statistik.uebernommen = eintraege.length;
  statistik.highlights = eintraege.filter((e) => e.timeline.highlight).length;
  statistik.gruppen = gruppenZaehler;

  const summe =
    statistik.uebernommen +
    statistik.gefiltert_leer +
    statistik.gefiltert_kurz +
    statistik.gefiltert_blockliste +
    statistik.gefiltert_duplikat +
    statistik.gefiltert_ausserhalb +
    statistik.verworfen_flut +
    statistik.verworfen_drift;
  if (summe !== statistik.eingegangen) {
    // Darf nie passieren – lieber laut werden als stillschweigend falsch zählen.
    log.warnung(
      `Statistik-Invariante verletzt: Summe ${summe} != eingegangen ${statistik.eingegangen}.`
    );
  }

  log.ok(
    `Timeline gebaut: ${statistik.uebernommen}/${statistik.eingegangen} Kommentare übernommen, ` +
      `${statistik.highlights} Highlights, ${statistik.gruppen} Flut-Gruppen.`
  );

  const dokument: TimelineDocument = {
    version: "1.1",
    generator: "whykiki-stream-companion",
    project_id: projectId,
    stream: meta,
    offset_seconds_applied: opt.offset_seconds,
    entries: eintraege,
  };

  return { dokument, statistik };
}

/** Schwächster (reaktionsärmster) Nicht-Highlight-Eintrag einer Menge. */
function schwaechsterVon(eintraege: TimelineEntry[]): TimelineEntry | null {
  let schwaechster: TimelineEntry | null = null;
  for (const e of eintraege) {
    if (e.timeline.highlight) continue; // Highlights werden nie verdrängt
    if (schwaechster === null || e.comment.reactions < schwaechster.comment.reactions) {
      schwaechster = e;
    }
  }
  return schwaechster;
}

function runde(n: number): number {
  return Math.round(n * 1000) / 1000;
}
