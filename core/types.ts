/**
 * WhyKiki Stream Companion – zentrales Datenmodell.
 *
 * Grundprinzip 1: Kommentare sind Daten. Design wird niemals in
 * Kommentardaten gespeichert – hier existieren ausschließlich Inhalts-
 * und Zeitinformationen.
 */

/** Unterstützte Plattformen (erweiterbar über weitere Adapter). */
export type Plattform =
  | "facebook"
  | "youtube"
  | "twitch"
  | "instagram"
  | "csv"
  | "json";

/**
 * Normalisierter Kommentar – das gemeinsame Datenmodell, das jeder
 * Adapter erzeugen MUSS (internes Format laut Briefing).
 */
export interface Comment {
  id: string;
  platform: Plattform;
  stream_id: string;
  video_id: string;
  author_name: string;
  author_handle: string;
  author_avatar_url: string;
  message: string;
  /** ISO-8601-Zeitstempel der Erstellung. */
  created_at: string;
  /** Sekunden relativ zum Streamstart (vor Offset-Korrektur). */
  relative_time_seconds: number;
  /** Reaktionsanzahl (Likes, Herzen, …) aggregiert. */
  reactions: number;
  badges: string[];
  /** 0..1 – Vertrauen in die zeitliche Zuordnung. */
  confidence: number;
}

/** Platzierungsinformation eines Kommentars auf der Videotimeline. */
export interface TimelinePlacement {
  start_seconds: number;
  duration_seconds: number;
  video_track: number;
  audio_track: number;
  highlight: boolean;
  /** Gruppen-ID bei Kommentarfluten/Clustern, sonst null. */
  group_id: string | null;
}

/** Ein Eintrag der fertigen Timeline. */
export interface TimelineEntry {
  comment: Comment;
  timeline: TimelinePlacement;
}

/** Stream-/Videometadaten. */
export interface StreamMeta {
  platform: Plattform;
  stream_id: string;
  video_id: string;
  title: string;
  started_at: string;
  duration_seconds: number;
}

/**
 * Wurzelformat von comments_timeline.json (Schema v1.1).
 *
 * Verbindliche Regel: ALLE Zeitwerte sind final. Konsumenten (UXP-Panel,
 * ExtendScript, Overlay-Renderer) verrechnen nichts mehr – der Offset ist
 * bereits in start_seconds eingearbeitet (Review-Befund 2).
 */
export interface TimelineDocument {
  version: "1.1";
  generator: string;
  project_id: string;
  stream: StreamMeta;
  /** Bereits in start_seconds eingerechneter Offset – rein deklarativ. */
  offset_seconds_applied: number;
  entries: TimelineEntry[];
}

/** Wurzelformat von comments_normalized.json. */
export interface NormalizedDocument {
  version: "1.0";
  generator: string;
  project_id: string;
  stream: StreamMeta;
  comments: Comment[];
}

/** Konfiguration des Timeline Builders. */
export interface BuilderOptions {
  /** Offset-Korrektur in Sekunden (Video beginnt später/früher als Chat). */
  offset_seconds: number;
  /** Standard-Einblenddauer in Sekunden. */
  default_duration_seconds: number;
  /** Ziel-Videospur (0-basiert). */
  video_track: number;
  /** Ziel-Audiospur (0-basiert). */
  audio_track: number;
  /** Maximal gleichzeitig sichtbare Kommentare (Flutbehandlung). */
  max_concurrent: number;
  /** Mindestabstand zwischen zwei Einblendungen in Sekunden. */
  min_gap_seconds: number;
  /**
   * Maximale Verschiebung durch min_gap in Sekunden – darüber hinaus wird
   * der Kommentar verworfen statt vom realen Moment entkoppelt
   * (Review-Befund 7).
   */
  max_shift_seconds: number;
  /** Duplikate nur innerhalb dieses Zeitfensters filtern (Review-Befund 24). */
  filter_duplicate_window_seconds: number;
  /** Ab dieser Reaktionszahl wird ein Kommentar als Highlight markiert. */
  highlight_min_reactions: number;
  /** Filter: Mindestlänge der Nachricht in Zeichen. */
  filter_min_length: number;
  /** Filter: Nachrichten, die eines dieser Worte enthalten, fliegen raus. */
  filter_blocklist: string[];
  /** Filter: identische aufeinanderfolgende Nachrichten desselben Autors entfernen. */
  filter_duplicates: boolean;
  /** Kommentare außerhalb der Videolänge verwerfen (wenn Dauer bekannt). */
  clamp_to_video: boolean;
}

export const STANDARD_BUILDER_OPTIONEN: BuilderOptions = {
  offset_seconds: 0,
  default_duration_seconds: 6,
  video_track: 2,
  audio_track: 0,
  max_concurrent: 3,
  min_gap_seconds: 0.5,
  max_shift_seconds: 10,
  filter_duplicate_window_seconds: 60,
  highlight_min_reactions: 20,
  filter_min_length: 2,
  filter_blocklist: [],
  filter_duplicates: true,
  clamp_to_video: true,
};

/** Ergebnis einer Validierung. */
export interface Validierungsergebnis {
  gueltig: boolean;
  fehler: string[];
  warnungen: string[];
}

/** Rohdaten-Eingabe eines Adapters. */
export interface AdapterEingabe {
  /** Pfad zur Quelldatei (CSV, JSON, …). */
  dateipfad: string;
  /** Projekt-/Stream-Metadaten, soweit bekannt. */
  meta: Partial<StreamMeta> & { project_id?: string };
}

/** Gemeinsames Interface aller Plattformadapter (Grundprinzip 4). */
export interface PlattformAdapter {
  readonly plattform: Plattform;
  /** Liest Rohdaten und liefert normalisierte Kommentare. */
  lese(eingabe: AdapterEingabe): Promise<Comment[]>;
}
