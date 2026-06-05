/**
 * JSON-Adapter – liest Kommentar-Rohdaten aus JSON-Dateien.
 *
 * Akzeptierte Formen:
 *  1. Array von Kommentar-Objekten:               [ {...}, {...} ]
 *  2. Objekt mit 'comments'-Array:                { "comments": [ ... ] }
 *  3. comments_normalized.json (eigenes Format):  { "version": "...", "comments": [...] }
 *  4. comments_timeline.json (entries-Form):      comment-Objekte werden extrahiert
 *
 * Feldnamen werden tolerant gemappt (z. B. author/name/user → author_name).
 * Die Normalisierung übernimmt der Comment Normalizer (core/normalizer.ts);
 * die Plattform kommt aus den Projektmetadaten (Review-Befund 14).
 */

import { readFile } from "node:fs/promises";
import type {
  AdapterEingabe,
  Comment,
  PlattformAdapter,
} from "../../core/types.js";
import {
  alias,
  clamp01,
  kontextAusMeta,
  normalisiereKommentar,
  zahl,
  type RohKommentar,
} from "../../core/normalizer.js";

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

    const kontext = kontextAusMeta(eingabe.meta, "json");

    return liste.map((eintrag, i) => {
      if (typeof eintrag !== "object" || eintrag === null) {
        throw new Error(`Eintrag ${i + 1}: kein Objekt.`);
      }
      return normalisiereKommentar(
        zuRohKommentar(eintrag as Record<string, unknown>, i),
        kontext,
        `json-${i + 1}`
      );
    });
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

function zuRohKommentar(o: Record<string, unknown>, index: number): RohKommentar {
  const nachricht = alias(o, ["message", "text", "content", "comment"]);
  if (typeof nachricht !== "string" || nachricht.length === 0) {
    throw new Error(`Eintrag ${index + 1}: Nachrichtentext fehlt (message/text/content).`);
  }

  const datumRoh = alias(o, ["created_at", "timestamp", "time", "date"]);
  const explizit = zahl(alias(o, ["relative_time_seconds", "offset_seconds", "video_offset", "seconds"]));
  const reaktionen = zahl(alias(o, ["reactions", "likes", "like_count", "reaction_count"]));
  const badgesRoh = alias(o, ["badges"]);
  const confidenceRoh = zahl(alias(o, ["confidence"]));

  const roh: RohKommentar = {
    message: nachricht,
    author_name: String(alias(o, ["author_name", "author", "name", "user", "username"]) ?? ""),
    author_handle: String(alias(o, ["author_handle", "handle", "user_id"]) ?? ""),
    author_avatar_url: String(alias(o, ["author_avatar_url", "avatar", "avatar_url"]) ?? ""),
    badges: Array.isArray(badgesRoh) ? badgesRoh.map(String) : [],
  };

  const id = alias(o, ["id", "comment_id"]);
  if (id !== undefined) roh.id = String(id);
  if (Number.isFinite(explizit)) roh.relative_time_seconds = explizit;
  if (Number.isFinite(reaktionen)) roh.reactions = reaktionen;
  if (Number.isFinite(confidenceRoh)) roh.confidence = clamp01(confidenceRoh);
  if (typeof datumRoh === "number") roh.created_at_unix = datumRoh;
  else if (typeof datumRoh === "string") roh.created_at = datumRoh;

  return roh;
}
