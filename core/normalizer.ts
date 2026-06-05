/**
 * Comment Normalizer – das im Briefing geforderte eigenständige Modul,
 * das Rohdaten aller Plattformen in das gemeinsame Datenmodell wandelt
 * (Review-Befund 15: vorher dreifach duplizierte Logik in den Adaptern).
 *
 * Aufgabenteilung:
 *   Adapter   = kennt das QUELLFORMAT (CSV-Spalten, Exporter-Aliasse, …)
 *               und liefert RohKommentar-Objekte.
 *   Normalizer = kennt das ZIELMODELL: Zeitableitung, Encoding-Reparatur,
 *               Defaults, Plattform-Zuordnung aus den Metadaten.
 */

import type { Comment, Plattform, StreamMeta } from "./types.js";

/** Zwischenformat: was ein Adapter aus seiner Quelle herauslesen kann. */
export interface RohKommentar {
  id?: string;
  author_name?: string;
  author_handle?: string;
  author_avatar_url?: string;
  message: string;
  /** ISO-/Datumsstring, sofern vorhanden. */
  created_at?: string;
  /** Unix-Zeit (Sekunden oder Millisekunden), sofern vorhanden. */
  created_at_unix?: number;
  /** Explizite Position im Video, sofern die Quelle sie liefert. */
  relative_time_seconds?: number;
  reactions?: number;
  badges?: string[];
  confidence?: number;
}

export interface NormalisierKontext {
  platform: Plattform;
  stream_id: string;
  video_id: string;
  /** Streamstart in ms seit Epoch, NaN wenn unbekannt. */
  stream_start_ms: number;
}

/**
 * Kontext aus Adapter-Metadaten bauen. Die Plattform kommt aus den
 * Metadaten (echte Plattform), NICHT aus dem Dateiformat des Adapters
 * (Review-Befund 14); das Format dient nur als Fallback.
 */
export function kontextAusMeta(
  meta: Partial<StreamMeta>,
  formatFallback: Plattform
): NormalisierKontext {
  return {
    platform: meta.platform ?? formatFallback,
    stream_id: meta.stream_id ?? "",
    video_id: meta.video_id ?? "",
    stream_start_ms: meta.started_at ? Date.parse(meta.started_at) : NaN,
  };
}

/**
 * Wandelt einen RohKommentar in das gemeinsame Comment-Modell.
 * Wirft, wenn keine zeitliche Zuordnung möglich ist.
 */
export function normalisiereKommentar(
  roh: RohKommentar,
  kontext: NormalisierKontext,
  fallbackId: string
): Comment {
  const nachricht = repariereMojibake(roh.message.trim());

  // --- Absolutes Datum ermitteln -----------------------------------------
  let erstellt = "";
  if (typeof roh.created_at_unix === "number" && Number.isFinite(roh.created_at_unix)) {
    const ms = roh.created_at_unix > 1e12 ? roh.created_at_unix : roh.created_at_unix * 1000;
    erstellt = new Date(ms).toISOString();
  } else if (typeof roh.created_at === "string" && roh.created_at.trim() !== "") {
    erstellt = roh.created_at.trim();
  }

  // --- Relative Zeit: explizite Angabe > Datum minus Streamstart ----------
  let relativ =
    typeof roh.relative_time_seconds === "number" && Number.isFinite(roh.relative_time_seconds)
      ? roh.relative_time_seconds
      : NaN;

  if (Number.isNaN(relativ)) {
    const t = Date.parse(erstellt);
    if (!Number.isNaN(t) && !Number.isNaN(kontext.stream_start_ms)) {
      relativ = (t - kontext.stream_start_ms) / 1000;
    }
  }
  if (Number.isNaN(relativ)) {
    throw new Error(
      `${fallbackId}: keine Zeit ermittelbar – Quelle braucht relative_time_seconds ` +
        `oder ein Datum plus 'started_at' in den Projektmetadaten.`
    );
  }
  // Negative Zeiten werden bewusst durchgereicht – der Timeline Builder
  // filtert sie kontrolliert (Review-Befund 8).

  // Fehlendes Datum aus Streamstart + relativer Zeit ableiten
  if (erstellt === "" && !Number.isNaN(kontext.stream_start_ms)) {
    erstellt = new Date(kontext.stream_start_ms + relativ * 1000).toISOString();
  }

  return {
    id: roh.id && roh.id !== "" ? roh.id : fallbackId,
    platform: kontext.platform,
    stream_id: kontext.stream_id,
    video_id: kontext.video_id,
    author_name: repariereMojibake(roh.author_name?.trim() || "Unbekannt"),
    author_handle: roh.author_handle ?? "",
    author_avatar_url: roh.author_avatar_url ?? "",
    message: nachricht,
    created_at: erstellt,
    relative_time_seconds: relativ,
    reactions: typeof roh.reactions === "number" && Number.isFinite(roh.reactions) ? roh.reactions : 0,
    badges: roh.badges ?? [],
    confidence: roh.confidence !== undefined ? clamp01(roh.confidence) : 1.0,
  };
}

// ---------------------------------------------------------------------------
// Gemeinsame Helfer (vorher in JSON-/Facebook-Adapter dupliziert)
// ---------------------------------------------------------------------------

/** Erstes vorhandenes Feld aus einer Liste von Alias-Namen. */
export function alias(o: Record<string, unknown>, namen: string[]): unknown {
  for (const n of namen) {
    if (o[n] !== undefined && o[n] !== null) return o[n];
  }
  return undefined;
}

/** Tolerante Zahl-Koersion ("3", "3,5", 3.5 → Zahl; sonst Standard). */
export function zahl(wert: unknown, standard = NaN): number {
  if (typeof wert === "number" && Number.isFinite(wert)) return wert;
  if (typeof wert === "string" && wert.trim() !== "") {
    const n = Number(wert.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return standard;
}

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 1.0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Repariert die bekannte Mojibake-Eigenheit von Social-Media-Exporten:
 * UTF-8-Bytes wurden als Windows-1252 fehlinterpretiert
 * ("fÃ¼r" statt "für", "ðŸŽ¶" statt "🎶"). Generisch im Normalizer,
 * weil auch CSV-Exporte von Drittanbieter-Tools betroffen sind.
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
  return repariert.includes("�") ? s : repariert;
}

/** CP1252-Sonderzeichen (0x80-0x9F) zurueck auf ihre Bytewerte. */
const CP1252_RUECKWAERTS: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84,
  "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88,
  "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
  "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93,
  "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b,
  "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
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
