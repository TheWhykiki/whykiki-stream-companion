/**
 * JSON-Adapter – liest Kommentar-Rohdaten aus JSON-Dateien.
 *
 * Akzeptierte Formen:
 *  1. Array von Kommentar-Objekten:               [ {...}, {...} ]
 *  2. Objekt mit 'comments'-Array:                { "comments": [ ... ] }
 *  3. comments_normalized.json (eigenes Format):  { "version": "1.0", "comments": [...] }
 *
 * Feldnamen werden tolerant gemappt (z. B. author/name/user → author_name),
 * damit Exporte fremder Tools ohne Vorverarbeitung nutzbar sind.
 */

import { readFile } from "node:fs/promises";
import type {
  AdapterEingabe,
  Comment,
  PlattformAdapter,
} from "../../core/types.js";

export class JsonAdapter implements PlattformAdapter {
  readonly plattform = "json" as const;

  async lese(eingabe: AdapterEingabe): Promise<Comment[]> {
    const inhalt = await readFile(eingabe.dateipfad, "utf8");
    let roh: unknown;
    try {
      roh = JSON.parse(inhalt);
    } catch (e) {
      throw new Error(`JSON nicht parsbar: ${(e as Error).message}`);
    }

    const liste = extrahiereListe(roh);
    if (!liste) {
      throw new Error(
        "JSON-Struktur nicht erkannt: erwartet Array oder Objekt mit 'comments'-Array."
      );
    }

    const streamStart = eingabe.meta.started_at
      ? Date.parse(eingabe.meta.started_at)
      : NaN;

    return liste.map((eintrag, i) =>
      normalisiereEintrag(eintrag, i, eingabe, streamStart)
    );
  }
}

function extrahiereListe(roh: unknown): unknown[] | null {
  if (Array.isArray(roh)) return roh;
  if (typeof roh === "object" && roh !== null) {
    const o = roh as Record<string, unknown>;
    if (Array.isArray(o.comments)) return o.comments;
    if (Array.isArray(o.entries)) {
      // comments_timeline.json als Quelle: comment-Objekte herausziehen
      return (o.entries as Array<Record<string, unknown>>).map((e) => e.comment);
    }
  }
  return null;
}

/** Erstes vorhandenes Feld aus einer Liste von Alias-Namen. */
function alias(o: Record<string, unknown>, namen: string[]): unknown {
  for (const n of namen) {
    if (o[n] !== undefined && o[n] !== null) return o[n];
  }
  return undefined;
}

function normalisiereEintrag(
  roh: unknown,
  index: number,
  eingabe: AdapterEingabe,
  streamStart: number
): Comment {
  if (typeof roh !== "object" || roh === null) {
    throw new Error(`Eintrag ${index + 1}: kein Objekt.`);
  }
  const o = roh as Record<string, unknown>;

  const nachricht = alias(o, ["message", "text", "content", "comment"]);
  if (typeof nachricht !== "string" || nachricht.length === 0) {
    throw new Error(`Eintrag ${index + 1}: Nachrichtentext fehlt (message/text/content).`);
  }

  const erstelltRoh = alias(o, ["created_at", "timestamp", "time", "date"]);
  const erstellt = typeof erstelltRoh === "string" ? erstelltRoh : "";

  let relativ = zahl(alias(o, ["relative_time_seconds", "offset_seconds", "video_offset", "seconds"]));
  if (Number.isNaN(relativ)) {
    const t = Date.parse(erstellt);
    if (!Number.isNaN(t) && !Number.isNaN(streamStart)) {
      relativ = (t - streamStart) / 1000;
    }
  }
  if (Number.isNaN(relativ) || relativ < 0) {
    throw new Error(
      `Eintrag ${index + 1}: keine relative Zeit ermittelbar (relative_time_seconds oder created_at + started_at nötig).`
    );
  }

  const reaktionen = alias(o, ["reactions", "likes", "like_count", "reaction_count"]);
  const badgesRoh = alias(o, ["badges"]);

  return {
    id: String(alias(o, ["id", "comment_id"]) ?? `json-${index + 1}`),
    platform: "json",
    stream_id: String(alias(o, ["stream_id"]) ?? eingabe.meta.stream_id ?? ""),
    video_id: String(alias(o, ["video_id"]) ?? eingabe.meta.video_id ?? ""),
    author_name: String(alias(o, ["author_name", "author", "name", "user", "username"]) ?? "Unbekannt"),
    author_handle: String(alias(o, ["author_handle", "handle", "user_id"]) ?? ""),
    author_avatar_url: String(alias(o, ["author_avatar_url", "avatar", "avatar_url"]) ?? ""),
    message: nachricht,
    created_at: erstellt,
    relative_time_seconds: relativ,
    reactions: Number.isNaN(zahl(reaktionen)) ? 0 : zahl(reaktionen),
    badges: Array.isArray(badgesRoh) ? badgesRoh.map(String) : [],
    confidence: clamp01(zahl(alias(o, ["confidence"]), 1.0)),
  };
}

function zahl(wert: unknown, standard = NaN): number {
  if (typeof wert === "number" && Number.isFinite(wert)) return wert;
  if (typeof wert === "string" && wert.trim() !== "") {
    const n = Number(wert.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return standard;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 1.0;
  return Math.min(1, Math.max(0, n));
}
