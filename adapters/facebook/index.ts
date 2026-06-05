/**
 * Facebook-Adapter – Kommentar-Import für Streams von privaten Profilen.
 *
 * WICHTIG (Rechercheergebnis, Stand 06/2026, siehe docs/facebook-import.md):
 * Die Graph API liefert für private Profile KEINE Kommentare Dritter, und
 * der Facebook-Datenexport ("Deine Informationen herunterladen") enthält
 * ausschließlich eigene Inhalte. Dieser Adapter liest daher die Dateien
 * gängiger Kommentar-Export-Tools (exportcomments.com, Apify, ESuit, …),
 * deren Format de facto konvergiert:
 *
 *   { "name"|"author"|"profileName": "...",
 *     "comment"|"text"|"message":    "...",
 *     "date"|"timestamp":            ISO-String oder Unix-Sekunden,
 *     "likes"|"likesCount":          3,
 *     "profileUrl":                  "...",
 *     "replies":                     [ ...gleiche Struktur... ] }
 *
 * Akzeptiert: Array, { comments: [...] } oder { data: [...] }.
 * Antworten (replies) werden flach übernommen (Badge "antwort",
 * pfadbasierte IDs wie fb-3-r1 gegen Kollisionen, Review-Befund 16).
 *
 * Die Normalisierung (Zeitableitung, Mojibake-Reparatur, Defaults)
 * übernimmt der Comment Normalizer (core/normalizer.ts).
 */

import { readFile } from "node:fs/promises";
import type {
  AdapterEingabe,
  Comment,
  PlattformAdapter,
} from "../../core/types.js";
import {
  alias,
  kontextAusMeta,
  normalisiereKommentar,
  zahl,
  type RohKommentar,
} from "../../core/normalizer.js";

// Re-Export für bestehende Konsumenten/Tests
export { repariereMojibake } from "../../core/normalizer.js";

export class FacebookAdapter implements PlattformAdapter {
  readonly plattform = "facebook" as const;

  async lese(eingabe: AdapterEingabe): Promise<Comment[]> {
    const inhalt = await readFile(eingabe.dateipfad, "utf8");
    let roh: unknown;
    try {
      roh = JSON.parse(inhalt);
    } catch (e) {
      throw new Error(`Facebook-Export nicht parsbar: ${(e as Error).message}`);
    }

    const liste = extrahiereListe(roh);
    if (!liste) {
      throw new Error(
        "Struktur nicht erkannt: erwartet Array, { comments: [...] } oder { data: [...] }."
      );
    }

    const kontext = kontextAusMeta(eingabe.meta, "facebook");

    // Antworten flach einsammeln, IDs pfadbasiert vergeben
    const flach: Array<{ eintrag: Record<string, unknown>; fallbackId: string; istAntwort: boolean }> = [];
    liste.forEach((e, i) => sammle(e, `fb-${i + 1}`, false, flach));

    const kommentare: Comment[] = [];
    for (const { eintrag, fallbackId, istAntwort } of flach) {
      const rohKommentar = zuRohKommentar(eintrag, istAntwort);
      if (!rohKommentar) continue; // Einträge ohne Text (z. B. reine Sticker)
      kommentare.push(normalisiereKommentar(rohKommentar, kontext, fallbackId));
    }

    kommentare.sort((a, b) => a.relative_time_seconds - b.relative_time_seconds);
    return kommentare;
  }
}

function extrahiereListe(roh: unknown): unknown[] | null {
  if (Array.isArray(roh)) return roh;
  if (typeof roh === "object" && roh !== null) {
    const o = roh as Record<string, unknown>;
    if (Array.isArray(o.comments)) return o.comments;
    if (Array.isArray(o.data)) return o.data;
  }
  return null;
}

function sammle(
  roh: unknown,
  fallbackId: string,
  istAntwort: boolean,
  ziel: Array<{ eintrag: Record<string, unknown>; fallbackId: string; istAntwort: boolean }>
): void {
  if (typeof roh !== "object" || roh === null) return;
  const o = roh as Record<string, unknown>;
  ziel.push({ eintrag: o, fallbackId, istAntwort });

  const antworten = alias(o, ["replies", "answers", "children"]);
  if (Array.isArray(antworten)) {
    antworten.forEach((a, i) => sammle(a, `${fallbackId}-r${i + 1}`, true, ziel));
  }
}

/** Exporter-Aliasse → RohKommentar; null bei Einträgen ohne Text. */
function zuRohKommentar(o: Record<string, unknown>, istAntwort: boolean): RohKommentar | null {
  const nachricht = alias(o, ["comment", "text", "message", "content"]);
  if (typeof nachricht !== "string" || nachricht.trim().length === 0) {
    return null;
  }

  const datumRoh = alias(o, ["date", "created_time", "created_at", "timestamp", "time"]);
  const profilUrl = String(alias(o, ["profileUrl", "profile_url", "authorUrl"]) ?? "");
  const explizit = zahl(alias(o, ["relative_time_seconds", "time_in_video", "offset_seconds", "seconds"]));

  const badges: string[] = [];
  if (istAntwort) badges.push("antwort");

  const roh: RohKommentar = {
    message: nachricht,
    author_name: String(alias(o, ["name", "author", "profileName", "username"]) ?? ""),
    author_handle: profilUrl ? profilUrl.replace(/^https?:\/\/(www\.)?facebook\.com\//, "") : "",
    author_avatar_url: String(alias(o, ["avatar", "avatarUrl", "profilePicture"]) ?? ""),
    reactions: zahl(alias(o, ["likes", "likesCount", "like_count", "reactions", "reactionsCount"]), 0),
    badges,
  };

  const eigeneId = alias(o, ["id", "commentId", "commentUrl"]);
  if (eigeneId !== undefined) roh.id = String(eigeneId);
  if (Number.isFinite(explizit)) roh.relative_time_seconds = explizit;
  if (typeof datumRoh === "number") roh.created_at_unix = datumRoh;
  else if (typeof datumRoh === "string") roh.created_at = datumRoh;

  return roh;
}
