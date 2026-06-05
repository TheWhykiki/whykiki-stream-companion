/**
 * Facebook Video Discovery – liest your_videos.json aus dem
 * Facebook-Datenexport ("Deine Informationen herunterladen", DYI)
 * und liefert die Videoliste für die Projektanlage.
 *
 * Pfad im Export (Stand 2025/2026, variiert je nach Exportdatum):
 *   your_facebook_activity/posts/your_videos.json
 *   (älter: your_activity_across_facebook/posts/your_videos.json)
 *
 * Der Export enthält NUR eigene Inhalte – Video-Metadaten und -Dateien,
 * aber keine Kommentare Dritter (siehe docs/facebook-import.md).
 */

import { readFile } from "node:fs/promises";
import { repariereMojibake } from "./index.js";

export interface EntdecktesVideo {
  index: number;
  titel: string;
  beschreibung: string;
  /** ISO-8601 – aus dem Unix-Timestamp des Exports. */
  aufgenommen_am: string;
  unix_timestamp: number;
  /** Relativer Pfad zur Videodatei innerhalb des Exports. */
  datei_uri: string;
}

export function parseDyiVideos(rohJson: string): EntdecktesVideo[] {
  let roh: unknown;
  try {
    roh = JSON.parse(rohJson);
  } catch (e) {
    throw new Error(`your_videos.json nicht parsbar: ${(e as Error).message}`);
  }

  // Formen: Array direkt oder { videos_v2: [...] } / { videos: [...] }
  let liste: unknown[] | null = null;
  if (Array.isArray(roh)) liste = roh;
  else if (typeof roh === "object" && roh !== null) {
    const o = roh as Record<string, unknown>;
    for (const schluessel of ["videos_v2", "videos", "your_videos"]) {
      if (Array.isArray(o[schluessel])) {
        liste = o[schluessel] as unknown[];
        break;
      }
    }
  }
  if (!liste) {
    throw new Error("Struktur nicht erkannt: erwartet Array oder { videos_v2: [...] }.");
  }

  const videos: EntdecktesVideo[] = [];

  liste.forEach((eintrag, i) => {
    if (typeof eintrag !== "object" || eintrag === null) return;
    const o = eintrag as Record<string, unknown>;

    // Medien aus attachments[].data[].media ziehen (DYI-Posts-Form)
    // oder direkt flache Form (uri/creation_timestamp auf oberster Ebene).
    const medien = extrahiereMedien(o);
    const ts =
      typeof o.timestamp === "number"
        ? o.timestamp
        : medien?.creation_timestamp ?? 0;

    videos.push({
      index: i + 1,
      titel: repariereMojibake(String(o.title ?? medien?.title ?? `Video ${i + 1}`)),
      beschreibung: repariereMojibake(String(medien?.description ?? "")),
      aufgenommen_am: ts > 0 ? new Date(ts * 1000).toISOString() : "",
      unix_timestamp: ts,
      datei_uri: String(medien?.uri ?? ""),
    });
  });

  return videos.filter((v) => v.unix_timestamp > 0 || v.datei_uri !== "");
}

interface Medien {
  uri?: string;
  title?: string;
  description?: string;
  creation_timestamp?: number;
}

function extrahiereMedien(o: Record<string, unknown>): Medien | null {
  // Flache Form
  if (typeof o.uri === "string") {
    return o as Medien;
  }
  // Posts-Form: attachments[].data[].media
  const attachments = o.attachments;
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      const data = (a as Record<string, unknown>)?.data;
      if (Array.isArray(data)) {
        for (const d of data) {
          const media = (d as Record<string, unknown>)?.media;
          if (typeof media === "object" && media !== null) {
            return media as Medien;
          }
        }
      }
    }
  }
  return null;
}

export async function entdeckeVideos(dateipfad: string): Promise<EntdecktesVideo[]> {
  const inhalt = await readFile(dateipfad, "utf8");
  return parseDyiVideos(inhalt);
}
