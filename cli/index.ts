#!/usr/bin/env node
/**
 * WhyKiki Stream Companion – CLI (Vorstufe der MCP-Tools aus MVP 4).
 *
 * Kommandos:
 *   wsc import   --projekt <id> --datei <pfad> [--format csv|json] [--projekte-ordner <pfad>]
 *   wsc build    --projekt <id> [--offset <s>] [--dauer <s>] [--spur <n>]
 *                [--max-gleichzeitig <n>] [--highlight-ab <n>] [--blockliste w1,w2]
 *                [--min-laenge <n>] [--keine-duplikatfilter] [--projekte-ordner <pfad>]
 *   wsc validate --datei <pfad>
 *   wsc export   --projekt <id> [--ziel <pfad>] [--projekte-ordner <pfad>]
 *
 * Beispiel (kompletter Durchlauf):
 *   wsc import --projekt 2020-04-12-balkonkonzert --datei kommentare.csv
 *   wsc build  --projekt 2020-04-12-balkonkonzert --offset -12.5
 *   wsc validate --datei projects/2020-04-12-balkonkonzert/processed/comments_timeline.json
 */

import path from "node:path";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import {
  Protokoll,
  bauesTimeline,
  exportiereNormalisiert,
  exportiereTimeline,
  ladeProjekt,
  schreibeLog,
  validiereTimelineDokument,
  type BuilderOptions,
  type Comment,
} from "../core/index.js";
import { CsvAdapter } from "../adapters/csv/index.js";
import { JsonAdapter } from "../adapters/json/index.js";
import { FacebookAdapter } from "../adapters/facebook/index.js";
import { entdeckeVideos } from "../adapters/facebook/discovery.js";

const HILFE = `
WhyKiki Stream Companion – Core CLI (MVP 2)

Kommandos:
  discover   Videos aus Facebook-Datenexport (your_videos.json) auflisten
             und optional als Projekt übernehmen
  import     Rohdaten (CSV/JSON/Facebook) einlesen und normalisieren
  build      Timeline aus normalisierten Kommentaren bauen
  validate   comments_timeline.json validieren
  export     Timeline an einen Zielort kopieren
  hilfe      Diese Hilfe anzeigen

Wichtige Optionen:
  --projekt <id>            Projekt-ID (Ordnername unter projects/)
  --projekte-ordner <pfad>  Wurzel der Projekte (Standard: ./projects)
  --datei <pfad>            Eingabedatei (discover/import/validate)
  --format csv|json|facebook  Eingabeformat erzwingen (sonst per Endung;
                            facebook = Kommentar-Exporter-JSON)
  --video <index>           discover: dieses Video als Projekt übernehmen
  --offset <s>              Offset-Korrektur in Sekunden (build, auch negativ)
  --dauer <s>               Standard-Einblenddauer (build, Standard 6)
  --spur <n>                Ziel-Videospur 0-basiert (build, Standard 2)
  --max-gleichzeitig <n>    Flutgrenze (build, Standard 3)
  --highlight-ab <n>        Highlight ab n Reaktionen (build, Standard 20)
  --min-laenge <n>          Filter: Mindestlänge (build, Standard 2)
  --blockliste w1,w2        Filter: Blockwörter (build)
  --keine-duplikatfilter    Filter: Duplikate behalten (build)
  --ziel <pfad>             Zielpfad (export)
`;

async function main(): Promise<number> {
  const [, , kommando, ...rest] = process.argv;
  const opt = parseArgumente(rest);
  const log = new Protokoll();

  try {
    switch (kommando) {
      case "discover":
        return await cmdDiscover(opt, log);
      case "import":
        return await cmdImport(opt, log);
      case "build":
        return await cmdBuild(opt, log);
      case "validate":
        return await cmdValidate(opt, log);
      case "export":
        return await cmdExport(opt, log);
      case "hilfe":
      case "--help":
      case "-h":
      case undefined:
        console.log(HILFE);
        return kommando === undefined ? 1 : 0;
      default:
        console.error(`Unbekanntes Kommando: '${kommando}'. Siehe 'wsc hilfe'.`);
        return 1;
    }
  } catch (e) {
    log.fehler((e as Error).message);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// discover
// ---------------------------------------------------------------------------

async function cmdDiscover(opt: Map<string, string>, log: Protokoll): Promise<number> {
  const datei = pflicht(opt, "datei");
  if (!existsSync(datei)) {
    throw new Error(`Datei nicht gefunden: ${datei}`);
  }

  const videos = await entdeckeVideos(datei);
  if (videos.length === 0) {
    log.warnung("Keine Videos im Export gefunden.");
    return 1;
  }

  log.ok(`${videos.length} Videos im Facebook-Export gefunden:`);
  for (const v of videos) {
    console.log(
      `  [${v.index}] ${v.aufgenommen_am || "ohne Datum"}  ${v.titel}` +
        (v.datei_uri ? `  (${v.datei_uri})` : "")
    );
  }

  // Optional: Video als Projekt übernehmen
  if (opt.has("video")) {
    const index = Number(opt.get("video"));
    const video = videos.find((v) => v.index === index);
    if (!video) {
      throw new Error(`Video mit Index ${index} nicht gefunden (1–${videos.length}).`);
    }
    const projektId =
      opt.get("projekt") ??
      `${(video.aufgenommen_am || "0000").substring(0, 10)}-${slug(video.titel)}`;
    const projekteOrdner = opt.get("projekte-ordner") ?? "projects";
    const projekt = await ladeProjekt(projekteOrdner, projektId, log);

    const metadata = {
      platform: "facebook",
      stream_id: "",
      video_id: String(index),
      title: video.titel,
      started_at: video.aufgenommen_am,
      duration_seconds: 0,
      quelle: { dyi_datei: path.resolve(datei), dyi_video_uri: video.datei_uri },
    };
    const metaPfad = path.join(projekt.wurzel, "source", "metadata.json");
    await writeFile(metaPfad, JSON.stringify(metadata, null, 2), "utf8");
    log.ok(`Projekt '${projektId}' angelegt, Metadaten archiviert: ${metaPfad}`);
    log.info("Nächster Schritt: Kommentar-Export importieren mit " +
      `'wsc import --projekt ${projektId} --datei <export.json> --format facebook'.`);
  }

  return 0;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[äöüß]/g, (z) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" })[z] ?? z)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 40) || "video"
  );
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

async function cmdImport(opt: Map<string, string>, log: Protokoll): Promise<number> {
  const projektId = pflicht(opt, "projekt");
  const datei = pflicht(opt, "datei");
  const projekteOrdner = opt.get("projekte-ordner") ?? "projects";

  if (!existsSync(datei)) {
    throw new Error(`Eingabedatei nicht gefunden: ${datei}`);
  }

  const format = (opt.get("format") ?? erkenneFormat(datei)).toLowerCase();
  const projekt = await ladeProjekt(projekteOrdner, projektId, log);

  let adapter;
  switch (format) {
    case "csv": adapter = new CsvAdapter(); break;
    case "json": adapter = new JsonAdapter(); break;
    case "facebook": adapter = new FacebookAdapter(); break;
    default:
      throw new Error(`Unbekanntes Format '${format}' (csv, json oder facebook).`);
  }
  log.info(`Import (${format}): ${datei}`);

  const kommentare = await adapter.lese({
    dateipfad: datei,
    meta: { ...projekt.meta, project_id: projektId },
  });

  // Rohdaten ins Projekt archivieren
  const rohZiel = path.join(projekt.wurzel, "source", path.basename(datei));
  if (path.resolve(datei) !== path.resolve(rohZiel)) {
    await copyFile(datei, rohZiel);
    log.info(`Rohdaten archiviert: ${rohZiel}`);
  }

  await exportiereNormalisiert(projekt, kommentare, log);
  await schreibeLog(projekt, log, "import");
  return 0;
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

async function cmdBuild(opt: Map<string, string>, log: Protokoll): Promise<number> {
  const projektId = pflicht(opt, "projekt");
  const projekteOrdner = opt.get("projekte-ordner") ?? "projects";
  const projekt = await ladeProjekt(projekteOrdner, projektId, log);

  const quelle = path.join(projekt.wurzel, "processed", "comments_normalized.json");
  if (!existsSync(quelle)) {
    throw new Error(`Keine normalisierten Kommentare gefunden (${quelle}). Zuerst 'wsc import' ausführen.`);
  }
  const dokument = JSON.parse(await readFile(quelle, "utf8"));
  const kommentare: Comment[] = dokument.comments ?? [];
  log.info(`Normalisierte Kommentare geladen: ${kommentare.length}`);

  const builderOptionen: Partial<BuilderOptions> = {};
  if (opt.has("offset")) builderOptionen.offset_seconds = Number(opt.get("offset"));
  if (opt.has("dauer")) builderOptionen.default_duration_seconds = Number(opt.get("dauer"));
  if (opt.has("spur")) builderOptionen.video_track = Number(opt.get("spur"));
  if (opt.has("max-gleichzeitig")) builderOptionen.max_concurrent = Number(opt.get("max-gleichzeitig"));
  if (opt.has("highlight-ab")) builderOptionen.highlight_min_reactions = Number(opt.get("highlight-ab"));
  if (opt.has("min-laenge")) builderOptionen.filter_min_length = Number(opt.get("min-laenge"));
  if (opt.has("blockliste")) {
    builderOptionen.filter_blocklist = (opt.get("blockliste") ?? "")
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
  }
  if (opt.has("keine-duplikatfilter")) builderOptionen.filter_duplicates = false;

  const { dokument: timeline, statistik } = bauesTimeline(
    kommentare,
    projekt.meta,
    projektId,
    builderOptionen,
    log
  );

  const ergebnis = validiereTimelineDokument(timeline);
  ergebnis.warnungen.forEach((w) => log.warnung(w));
  if (!ergebnis.gueltig) {
    ergebnis.fehler.forEach((f) => log.fehler(f));
    throw new Error("Gebaute Timeline ist ungültig – Abbruch ohne Export.");
  }

  await exportiereTimeline(projekt, timeline, log);
  log.info(`Statistik: ${JSON.stringify(statistik)}`);
  await schreibeLog(projekt, log, "build");
  return 0;
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

async function cmdValidate(opt: Map<string, string>, log: Protokoll): Promise<number> {
  const datei = pflicht(opt, "datei");
  if (!existsSync(datei)) {
    throw new Error(`Datei nicht gefunden: ${datei}`);
  }
  const roh = JSON.parse(await readFile(datei, "utf8"));
  const ergebnis = validiereTimelineDokument(roh);

  ergebnis.warnungen.forEach((w) => log.warnung(w));
  if (ergebnis.gueltig) {
    log.ok(`Gültig: ${datei} (${(roh.entries ?? []).length} Einträge).`);
    return 0;
  }
  ergebnis.fehler.forEach((f) => log.fehler(f));
  log.fehler(`Ungültig: ${ergebnis.fehler.length} Fehler.`);
  return 1;
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

async function cmdExport(opt: Map<string, string>, log: Protokoll): Promise<number> {
  const projektId = pflicht(opt, "projekt");
  const projekteOrdner = opt.get("projekte-ordner") ?? "projects";
  const projekt = await ladeProjekt(projekteOrdner, projektId, log);

  const quelle = path.join(projekt.wurzel, "processed", "comments_timeline.json");
  if (!existsSync(quelle)) {
    throw new Error(`Keine Timeline gefunden (${quelle}). Zuerst 'wsc build' ausführen.`);
  }

  const ziel = opt.get("ziel") ?? path.join(projekt.wurzel, "exports", "comments_timeline.json");
  await copyFile(quelle, ziel);
  log.ok(`Timeline exportiert nach: ${ziel}`);
  return 0;
}

// ---------------------------------------------------------------------------
// Argument-Parsing (bewusst ohne Fremdpaket)
// ---------------------------------------------------------------------------

function parseArgumente(args: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) continue;
    const name = a.slice(2);
    const naechstes = args[i + 1];
    if (naechstes !== undefined && !naechstes.startsWith("--")) {
      map.set(name, naechstes);
      i++;
    } else {
      map.set(name, "true"); // Flag ohne Wert
    }
  }
  return map;
}

function pflicht(opt: Map<string, string>, name: string): string {
  const wert = opt.get(name);
  if (!wert || wert === "true") {
    throw new Error(`Option --${name} ist erforderlich. Siehe 'wsc hilfe'.`);
  }
  return wert;
}

function erkenneFormat(datei: string): string {
  const endung = path.extname(datei).toLowerCase();
  if (endung === ".csv") return "csv";
  if (endung === ".json") return "json";
  throw new Error(`Format nicht erkennbar an Endung '${endung}' – bitte --format angeben.`);
}

process.exitCode = await main();
