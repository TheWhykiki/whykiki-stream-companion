/**
 * Validierung des Datenmodells und der Timeline-Dokumente.
 */

import type {
  Comment,
  TimelineDocument,
  Validierungsergebnis,
} from "./types.js";

const KOMMENTAR_PFLICHTFELDER: Array<keyof Comment> = [
  "id",
  "platform",
  "stream_id",
  "video_id",
  "author_name",
  "author_handle",
  "author_avatar_url",
  "message",
  "created_at",
  "relative_time_seconds",
  "reactions",
  "badges",
  "confidence",
];

export function validiereKommentar(roh: unknown, kontext: string): string[] {
  const fehler: string[] = [];
  if (typeof roh !== "object" || roh === null) {
    return [`${kontext}: kein Objekt.`];
  }
  const c = roh as Record<string, unknown>;

  for (const feld of KOMMENTAR_PFLICHTFELDER) {
    if (c[feld] === undefined) {
      fehler.push(`${kontext}: Feld '${feld}' fehlt.`);
    }
  }
  if (typeof c.message === "string" && c.message.trim().length === 0) {
    fehler.push(`${kontext}: message ist leer.`);
  }
  if (typeof c.relative_time_seconds !== "number" || c.relative_time_seconds < 0) {
    fehler.push(`${kontext}: relative_time_seconds muss >= 0 sein.`);
  }
  if (typeof c.confidence !== "number" || c.confidence < 0 || c.confidence > 1) {
    fehler.push(`${kontext}: confidence muss zwischen 0 und 1 liegen.`);
  }
  // Leerer created_at ist erlaubt (Adapter mit reiner Sekundenangabe);
  // nur ein nicht-leerer, unparsbarer Wert ist ein Fehler (Review-Befund 1).
  if (
    typeof c.created_at === "string" &&
    c.created_at !== "" &&
    Number.isNaN(Date.parse(c.created_at))
  ) {
    fehler.push(`${kontext}: created_at ist kein gültiger ISO-Zeitstempel.`);
  }
  return fehler;
}

export function validiereTimelineDokument(roh: unknown): Validierungsergebnis {
  const fehler: string[] = [];
  const warnungen: string[] = [];

  if (typeof roh !== "object" || roh === null) {
    return { gueltig: false, fehler: ["Dokument ist kein Objekt."], warnungen };
  }
  const doc = roh as Omit<Partial<TimelineDocument>, "version"> &
    Record<string, unknown> & { version?: string };

  // Schema v1.1: offset_seconds_applied (rein deklarativ);
  // v1.0 (offset_seconds) wird mit Warnung weiter akzeptiert.
  if (doc.version !== "1.0" && doc.version !== "1.1") {
    fehler.push("version muss '1.0' oder '1.1' sein.");
  }
  if (doc.version === "1.0") {
    warnungen.push(
      "Schema v1.0 ist veraltet – bitte mit aktuellem Builder neu exportieren (v1.1, offset_seconds_applied)."
    );
    if (typeof doc.offset_seconds !== "number") {
      fehler.push("offset_seconds fehlt oder ist keine Zahl.");
    }
  } else if (typeof doc.offset_seconds_applied !== "number") {
    fehler.push("offset_seconds_applied fehlt oder ist keine Zahl.");
  }
  if (typeof doc.project_id !== "string" || doc.project_id.length === 0) {
    fehler.push("project_id fehlt.");
  }
  if (!Array.isArray(doc.entries)) {
    fehler.push("entries fehlt oder ist kein Array.");
    return { gueltig: false, fehler, warnungen };
  }
  if (doc.entries.length === 0) {
    warnungen.push("entries ist leer – Timeline enthält keine Kommentare.");
  }

  const ids = new Set<string>();
  let vorherigerStart = -Infinity;

  doc.entries.forEach((eintrag, i) => {
    const kontext = `Eintrag ${i + 1}`;
    const e = eintrag as unknown as Record<string, unknown>;

    fehler.push(...validiereKommentar(e.comment, `${kontext}/comment`));

    const t = e.timeline as Record<string, unknown> | undefined;
    if (!t || typeof t !== "object") {
      fehler.push(`${kontext}: timeline fehlt.`);
      return;
    }
    if (typeof t.start_seconds !== "number" || t.start_seconds < 0) {
      fehler.push(`${kontext}: timeline.start_seconds muss >= 0 sein.`);
    }
    if (typeof t.duration_seconds !== "number" || t.duration_seconds <= 0) {
      fehler.push(`${kontext}: timeline.duration_seconds muss > 0 sein.`);
    }
    if (!Number.isInteger(t.video_track) || (t.video_track as number) < 0) {
      fehler.push(`${kontext}: timeline.video_track muss ganzzahlig >= 0 sein.`);
    }
    if (!Number.isInteger(t.audio_track) || (t.audio_track as number) < 0) {
      fehler.push(`${kontext}: timeline.audio_track muss ganzzahlig >= 0 sein.`);
    }
    if (typeof t.highlight !== "boolean") {
      fehler.push(`${kontext}: timeline.highlight muss boolean sein.`);
    }

    const c = e.comment as Record<string, unknown> | undefined;
    const id = c?.id;
    if (typeof id === "string") {
      if (ids.has(id)) fehler.push(`${kontext}: doppelte Kommentar-ID '${id}'.`);
      ids.add(id);
    }

    const start = typeof t.start_seconds === "number" ? t.start_seconds : NaN;
    if (!Number.isNaN(start)) {
      if (start < vorherigerStart) {
        fehler.push(`${kontext}: nicht chronologisch sortiert.`);
      }
      vorherigerStart = start;
    }
  });

  return { gueltig: fehler.length === 0, fehler, warnungen };
}
