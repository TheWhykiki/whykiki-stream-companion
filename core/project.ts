/**
 * Projekt- und Dateiverwaltung.
 *
 * Arbeitet mit der Projektordnerstruktur aus dem Briefing:
 *
 * projects/<project_id>/
 *   source/      video.mp4, metadata.json, comments_raw.json|csv
 *   processed/   comments_normalized.json, comments_timeline.json
 *   premiere/    template_mapping.json, import_package.json
 *   previews/
 *   exports/
 *   logs/
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  Comment,
  NormalizedDocument,
  StreamMeta,
  TimelineDocument,
} from "./types.js";
import { Protokoll } from "./log.js";

export interface Projekt {
  id: string;
  wurzel: string;
  meta: StreamMeta;
}

const STANDARD_META: StreamMeta = {
  platform: "json",
  stream_id: "",
  video_id: "",
  title: "",
  started_at: "",
  duration_seconds: 0,
};

/**
 * Lädt ein Projekt (oder legt die Ordnerstruktur an).
 * metadata.json in source/ liefert die Stream-Metadaten, falls vorhanden.
 */
export async function ladeProjekt(
  projekteOrdner: string,
  projectId: string,
  log?: Protokoll
): Promise<Projekt> {
  const wurzel = path.join(projekteOrdner, projectId);
  for (const unter of ["source", "processed", "premiere", "previews", "exports", "logs"]) {
    await mkdir(path.join(wurzel, unter), { recursive: true });
  }

  let meta: StreamMeta = { ...STANDARD_META };
  const metaPfad = path.join(wurzel, "source", "metadata.json");
  if (existsSync(metaPfad)) {
    try {
      const roh = JSON.parse(await readFile(metaPfad, "utf8"));
      meta = { ...STANDARD_META, ...roh };
      log?.info(`Metadaten geladen: ${metaPfad}`);
    } catch (e) {
      log?.warnung(`metadata.json nicht lesbar (${(e as Error).message}) – Standardwerte aktiv.`);
    }
  } else {
    log?.info("Keine metadata.json gefunden – Standardwerte aktiv.");
  }

  return { id: projectId, wurzel, meta };
}

export async function exportiereNormalisiert(
  projekt: Projekt,
  kommentare: Comment[],
  log?: Protokoll
): Promise<string> {
  const dokument: NormalizedDocument = {
    version: "1.0",
    generator: "whykiki-stream-companion",
    project_id: projekt.id,
    stream: projekt.meta,
    comments: kommentare,
  };
  const ziel = path.join(projekt.wurzel, "processed", "comments_normalized.json");
  await writeFile(ziel, JSON.stringify(dokument, null, 2), "utf8");
  log?.ok(`Normalisierte Kommentare exportiert: ${ziel} (${kommentare.length} Stück)`);
  return ziel;
}

export async function exportiereTimeline(
  projekt: Projekt,
  dokument: TimelineDocument,
  log?: Protokoll
): Promise<string> {
  const ziel = path.join(projekt.wurzel, "processed", "comments_timeline.json");
  await writeFile(ziel, JSON.stringify(dokument, null, 2), "utf8");
  log?.ok(`Timeline exportiert: ${ziel} (${dokument.entries.length} Einträge)`);
  return ziel;
}

export async function schreibeLog(
  projekt: Projekt,
  log: Protokoll,
  name: string
): Promise<string> {
  const zeitstempel = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const ziel = path.join(projekt.wurzel, "logs", `${name}_${zeitstempel}.log`);
  await writeFile(ziel, log.alsText(), "utf8");
  return ziel;
}
