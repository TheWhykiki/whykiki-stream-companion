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
    gruppen: 0,
    highlights: 0,
    uebernommen: 0,
  };

  // -------------------------------------------------------------------------
  // 1. Kommentarfilter
  // -------------------------------------------------------------------------

  const blockliste = opt.filter_blocklist.map((w) => w.toLowerCase());
  let letzteNachrichtProAutor = new Map<string, string>();

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
      if (letzteNachrichtProAutor.get(schluessel) === klein) {
        statistik.gefiltert_duplikat++;
        log.info(`Filter (Duplikat): ${k.id}`);
        continue;
      }
      letzteNachrichtProAutor.set(schluessel, klein);
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
  // Regel: Maximal opt.max_concurrent gleichzeitig sichtbare Kommentare.
  // Bei Überlauf innerhalb eines Sichtfensters wird priorisiert:
  // Highlights/Reaktionen zuerst, Rest wird verworfen und das Fenster
  // als Gruppe markiert (group_id), damit spätere Module (z. B. eine
  // "Flut"-Anzeige) darauf reagieren können.
  // -------------------------------------------------------------------------

  const eintraege: TimelineEntry[] = [];
  let aktiveEnden: number[] = []; // Endzeiten aktuell sichtbarer Kommentare
  let gruppenZaehler = 0;
  let aktuelleGruppe: string | null = null;
  let letzterStart = -Infinity;

  for (const p of platziert) {
    const dauer = opt.default_duration_seconds;

    // Mindestabstand erzwingen (verschiebt nach hinten, nicht verwerfen)
    let start = p.start;
    if (start - letzterStart < opt.min_gap_seconds) {
      start = letzterStart + opt.min_gap_seconds;
    }

    // Abgelaufene Einblendungen aus dem Fenster entfernen
    aktiveEnden = aktiveEnden.filter((ende) => ende > start);

    if (aktiveEnden.length >= opt.max_concurrent) {
      // Flut: Kommentar konkurriert mit bereits sichtbaren.
      // Priorität: Reaktionen. Schwächster sichtbarer Eintrag bleibt,
      // neuer Kommentar wird nur übernommen, wenn er stärker ist als der
      // schwächste im Fenster – andernfalls verworfen.
      const schwaechster = schwaechsterImFenster(eintraege, start);
      if (
        schwaechster &&
        p.kommentar.reactions > schwaechster.comment.reactions
      ) {
        // Schwächsten verdrängen (aus Timeline entfernen)
        const idx = eintraege.indexOf(schwaechster);
        eintraege.splice(idx, 1);
        statistik.verworfen_flut++;
        log.info(
          `Flut: ${schwaechster.comment.id} verdrängt durch ${p.kommentar.id} (Reaktionen ${schwaechster.comment.reactions} < ${p.kommentar.reactions}).`
        );
      } else {
        statistik.verworfen_flut++;
        if (aktuelleGruppe === null) {
          gruppenZaehler++;
          aktuelleGruppe = `flut-${String(gruppenZaehler).padStart(3, "0")}`;
          statistik.gruppen++;
          // Sichtbare Einträge des Fensters nachträglich der Gruppe zuordnen
          for (const e of eintraege) {
            if (e.timeline.start_seconds + e.timeline.duration_seconds > start) {
              e.timeline.group_id = aktuelleGruppe;
            }
          }
        }
        log.info(`Flut: ${p.kommentar.id} verworfen (Gruppe ${aktuelleGruppe}).`);
        continue;
      }
    } else if (aktiveEnden.length === 0) {
      aktuelleGruppe = null; // Fenster leer → Flut beendet
    }

    const highlight = p.kommentar.reactions >= opt.highlight_min_reactions;
    if (highlight) statistik.highlights++;

    eintraege.push({
      comment: p.kommentar,
      timeline: {
        start_seconds: runde(start),
        duration_seconds: dauer,
        video_track: opt.video_track,
        audio_track: opt.audio_track,
        highlight,
        group_id: aktuelleGruppe,
      },
    });

    aktiveEnden.push(start + dauer);
    letzterStart = start;
  }

  eintraege.sort((a, b) => a.timeline.start_seconds - b.timeline.start_seconds);
  statistik.uebernommen = eintraege.length;

  log.ok(
    `Timeline gebaut: ${statistik.uebernommen}/${statistik.eingegangen} Kommentare übernommen, ` +
      `${statistik.highlights} Highlights, ${statistik.gruppen} Flut-Gruppen.`
  );

  const dokument: TimelineDocument = {
    version: "1.0",
    generator: "whykiki-stream-companion",
    project_id: projectId,
    stream: meta,
    offset_seconds: opt.offset_seconds,
    entries: eintraege,
  };

  return { dokument, statistik };
}

function schwaechsterImFenster(
  eintraege: TimelineEntry[],
  zeitpunkt: number
): TimelineEntry | null {
  let schwaechster: TimelineEntry | null = null;
  for (const e of eintraege) {
    const sichtbar =
      e.timeline.start_seconds <= zeitpunkt &&
      e.timeline.start_seconds + e.timeline.duration_seconds > zeitpunkt;
    if (!sichtbar) continue;
    if (e.timeline.highlight) continue; // Highlights werden nie verdrängt
    if (
      schwaechster === null ||
      e.comment.reactions < schwaechster.comment.reactions
    ) {
      schwaechster = e;
    }
  }
  return schwaechster;
}

function runde(n: number): number {
  return Math.round(n * 1000) / 1000;
}
