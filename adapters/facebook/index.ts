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
 * Antworten (replies) werden flach in die Kommentarliste übernommen.
 *
 * Die relative Zeit wird aus Kommentardatum minus Streamstart
 * (meta.started_at, z. B. aus dem DYI-Export via 'wsc discover')
 * berechnet, sofern keine explizite Sekundenangabe vorliegt.
 */

import { readFile } from "node:fs/promises";
import type {
  AdapterEingabe,
  Comment,
  PlattformAdapter,
} from "../../core/types.js";

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

    const streamStart = eingabe.meta.started_at
      ? Date.parse(eingabe.meta.started_at)
      : NaN;

    // Antworten flach einsammeln (Eltern-ID merken)
    const flach: Array<{ eintrag: Record<string, unknown>; elternId: string | null }> = [];
    liste.forEach((e, i) => {
      sammle(e, null, flach, i);
    });

    const kommentare: Comment[] = [];
    flach.forEach(({ eintrag, elternId }, index) => {
      const k = normalisiere(eintrag, index, eingabe, streamStart, elternId);
      if (k) kommentare.push(k);
    });

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
  elternId: string | null,
  ziel: Array<{ eintrag: Record<string, unknown>; elternId: string | null }>,
  index: number
): void {
  if (typeof roh !== "object" || roh === null) return;
  const o = roh as Record<string, unknown>;
  ziel.push({ eintrag: o, elternId });

  const eigeneId = String(alias(o, ["id", "commentId", "commentUrl"]) ?? `fb-${index + 1}`);
  const antworten = alias(o, ["replies", "answers", "children"]);
  if (Array.isArray(antworten)) {
    antworten.forEach((a, i) => sammle(a, eigeneId, ziel, index * 1000 + i));
  }
}

function normalisiere(
  o: Record<string, unknown>,
  index: number,
  eingabe: AdapterEingabe,
  streamStart: number,
  elternId: string | null
): Comment | null {
  const nachricht = alias(o, ["comment", "text", "message", "content"]);
  if (typeof nachricht !== "string" || nachricht.trim().length === 0) {
    return null; // Einträge ohne Text (z. B. reine Sticker) überspringen
  }

  // Zeit: explizite Sekundenangabe > Datum minus Streamstart
  let relativ = zahl(alias(o, ["relative_time_seconds", "time_in_video", "offset_seconds", "seconds"]));
  let erstellt = "";

  const datumRoh = alias(o, ["date", "created_time", "created_at", "timestamp", "time"]);
  if (typeof datumRoh === "number") {
    // Unix-Sekunden (DYI/Apify-Stil)
    const ms = datumRoh > 1e12 ? datumRoh : datumRoh * 1000;
    erstellt = new Date(ms).toISOString();
  } else if (typeof datumRoh === "string" && datumRoh.trim() !== "") {
    erstellt = datumRoh;
  }

  if (Number.isNaN(relativ)) {
    const t = Date.parse(erstellt);
    if (!Number.isNaN(t) && !Number.isNaN(streamStart)) {
      relativ = (t - streamStart) / 1000;
    }
  }
  if (Number.isNaN(relativ)) {
    throw new Error(
      `Kommentar ${index + 1}: keine Zeit ermittelbar – Export braucht 'date'/'timestamp' ` +
        `und das Projekt 'started_at' in metadata.json (siehe 'wsc discover').`
    );
  }
  // Negative Zeiten (Kommentare vor Streamstart, z. B. unter dem
  // Ankündigungspost) werden bewusst NICHT geclemmt – der Timeline Builder
  // filtert sie kontrolliert und zählt sie in der Statistik (Review-Befund 8).

  // Fehlt das absolute Datum, aber die relative Zeit ist bekannt und der
  // Streamstart liegt vor: created_at ableiten (Review-Befund 1).
  if (erstellt === "" && !Number.isNaN(streamStart)) {
    erstellt = new Date(streamStart + relativ * 1000).toISOString();
  }

  const likes = zahl(alias(o, ["likes", "likesCount", "like_count", "reactions", "reactionsCount"]), 0);
  const profilUrl = String(alias(o, ["profileUrl", "profile_url", "authorUrl"]) ?? "");

  const badges: string[] = [];
  if (elternId !== null) badges.push("antwort");

  return {
    id: String(alias(o, ["id", "commentId", "commentUrl"]) ?? `fb-${index + 1}`),
    platform: "facebook",
    stream_id: eingabe.meta.stream_id ?? "",
    video_id: eingabe.meta.video_id ?? "",
    author_name: repariereMojibake(String(alias(o, ["name", "author", "profileName", "username"]) ?? "Unbekannt")),
    author_handle: profilUrl ? profilUrl.replace(/^https?:\/\/(www\.)?facebook\.com\//, "") : "",
    author_avatar_url: String(alias(o, ["avatar", "avatarUrl", "profilePicture"]) ?? ""),
    message: repariereMojibake(nachricht.trim()),
    created_at: erstellt,
    relative_time_seconds: relativ,
    reactions: Number.isNaN(likes) ? 0 : likes,
    badges,
    confidence: erstellt ? 1.0 : 0.5,
  };
}

function alias(o: Record<string, unknown>, namen: string[]): unknown {
  for (const n of namen) {
    if (o[n] !== undefined && o[n] !== null) return o[n];
  }
  return undefined;
}

function zahl(wert: unknown, standard = NaN): number {
  if (typeof wert === "number" && Number.isFinite(wert)) return wert;
  if (typeof wert === "string" && wert.trim() !== "") {
    const n = Number(wert.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return standard;
}

/**
 * Repariert die bekannte Mojibake-Eigenheit von Facebook-Exporten:
 * UTF-8-Bytes wurden als Latin-1 fehlinterpretiert ("fÃ¼r" statt "für").
 * Wird nur angewendet, wenn typische Indikatoren vorhanden sind.
 */
export function repariereMojibake(s: string): string {
  if (!istMojibakeVerdaechtig(s)) return s;

  const bytes: number[] = [];
  for (const zeichen of s) {
    const byte = zuCp1252Byte(zeichen);
    if (byte === null) return s; // echtes Unicode (z. B. korrektes Emoji) -> kein Mojibake
    bytes.push(byte);
  }

  const repariert = Buffer.from(bytes).toString("utf8");
  return repariert.includes("\uFFFD") ? s : repariert;
}

/** CP1252-Sonderzeichen (0x80-0x9F) zurueck auf ihre Bytewerte. */
const CP1252_RUECKWAERTS: Record<string, number> = {
  "\u20AC": 0x80, "\u201A": 0x82, "\u0192": 0x83, "\u201E": 0x84,
  "\u2026": 0x85, "\u2020": 0x86, "\u2021": 0x87, "\u02C6": 0x88,
  "\u2030": 0x89, "\u0160": 0x8a, "\u2039": 0x8b, "\u0152": 0x8c,
  "\u017D": 0x8e, "\u2018": 0x91, "\u2019": 0x92, "\u201C": 0x93,
  "\u201D": 0x94, "\u2022": 0x95, "\u2013": 0x96, "\u2014": 0x97,
  "\u02DC": 0x98, "\u2122": 0x99, "\u0161": 0x9a, "\u203A": 0x9b,
  "\u0153": 0x9c, "\u017E": 0x9e, "\u0178": 0x9f,
};

function zuCp1252Byte(zeichen: string): number | null {
  const code = zeichen.codePointAt(0)!;
  if (code <= 0xff) return code;
  return CP1252_RUECKWAERTS[zeichen] ?? null;
}

/** Prueft auf UTF-8-Startbyte gefolgt von gueltigem Folgebyte (0x80-0xBF). */
function istMojibakeVerdaechtig(s: string): boolean {
  for (let i = 0; i < s.length - 1; i++) {
    const start = s.charCodeAt(i);
    const istStartbyte =
      start === 0xc2 || start === 0xc3 || // 2-Byte-Sequenzen (Umlaute etc.)
      (start >= 0xe0 && start <= 0xef) || // 3-Byte-Sequenzen
      (start >= 0xf0 && start <= 0xf4);   // 4-Byte-Sequenzen (Emoji)
    if (!istStartbyte) continue;
    const folgebyte = zuCp1252Byte(s[i + 1]!);
    if (folgebyte !== null && folgebyte >= 0x80 && folgebyte <= 0xbf) return true;
  }
  return false;
}
