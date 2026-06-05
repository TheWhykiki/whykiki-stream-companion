/**
 * CSV-Adapter – liest Kommentar-Rohdaten aus CSV-Dateien und erzeugt
 * das normalisierte Comment-Format.
 *
 * Erwartete Spalten (Header-Zeile, Reihenfolge egal, Groß-/Kleinschreibung egal):
 *   id, author_name, message               → Pflicht
 *   author_handle, author_avatar_url,
 *   created_at, relative_time_seconds,
 *   reactions, badges, confidence          → optional
 *
 * 'badges' als durch | getrennte Liste (z. B. "fan|mod").
 * Fehlt relative_time_seconds, wird sie aus created_at und
 * meta.started_at berechnet.
 */

import { readFile } from "node:fs/promises";
import type {
  AdapterEingabe,
  Comment,
  PlattformAdapter,
} from "../../core/types.js";

export class CsvAdapter implements PlattformAdapter {
  readonly plattform = "csv" as const;

  async lese(eingabe: AdapterEingabe): Promise<Comment[]> {
    // UTF-8-BOM entfernen (Excel-Export "CSV UTF-8", Review-Befund 12)
    const inhalt = (await readFile(eingabe.dateipfad, "utf8")).replace(/^﻿/, "");
    const zeilen = parseCsv(inhalt);
    if (zeilen.length < 2) {
      throw new Error("CSV enthält keine Datenzeilen (Header + mind. 1 Zeile erwartet).");
    }

    const kopf = zeilen[0]!.map((s) => s.trim().toLowerCase());
    const spalte = (name: string): number => kopf.indexOf(name);

    for (const pflicht of ["id", "author_name", "message"]) {
      if (spalte(pflicht) === -1) {
        throw new Error(`CSV-Pflichtspalte '${pflicht}' fehlt im Header.`);
      }
    }

    const streamStart = eingabe.meta.started_at
      ? Date.parse(eingabe.meta.started_at)
      : NaN;

    const kommentare: Comment[] = [];

    for (let i = 1; i < zeilen.length; i++) {
      const zeile = zeilen[i]!;
      if (zeile.length === 1 && zeile[0]!.trim() === "") continue; // Leerzeile

      const wert = (name: string): string => {
        const idx = spalte(name);
        return idx >= 0 ? (zeile[idx] ?? "").trim() : "";
      };

      let createdAt = wert("created_at");
      let relativ = zahlOderNaN(wert("relative_time_seconds"));

      if (Number.isNaN(relativ)) {
        // Aus created_at und Streamstart ableiten
        const erstellt = Date.parse(createdAt);
        if (!Number.isNaN(erstellt) && !Number.isNaN(streamStart)) {
          relativ = (erstellt - streamStart) / 1000;
        }
      }
      if (Number.isNaN(relativ) || relativ < 0) {
        throw new Error(
          `CSV Zeile ${i + 1}: relative_time_seconds fehlt und ist nicht aus created_at/started_at ableitbar.`
        );
      }

      // created_at ableiten, wenn nur die relative Zeit vorliegt (Review-Befund 1)
      if (createdAt === "" && !Number.isNaN(streamStart)) {
        createdAt = new Date(streamStart + relativ * 1000).toISOString();
      }

      kommentare.push({
        id: wert("id"),
        platform: "csv",
        stream_id: eingabe.meta.stream_id ?? "",
        video_id: eingabe.meta.video_id ?? "",
        author_name: wert("author_name"),
        author_handle: wert("author_handle"),
        author_avatar_url: wert("author_avatar_url"),
        message: wert("message"),
        created_at: createdAt,
        relative_time_seconds: relativ,
        reactions: zahlOder(wert("reactions"), 0),
        badges: wert("badges") ? wert("badges").split("|").map((b) => b.trim()).filter(Boolean) : [],
        confidence: zahlOder(wert("confidence"), 1.0),
      });
    }

    return kommentare;
  }
}

function zahlOderNaN(s: string): number {
  if (s === "") return NaN;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function zahlOder(s: string, standard: number): number {
  const n = zahlOderNaN(s);
  return Number.isNaN(n) ? standard : n;
}

/**
 * Minimaler RFC-4180-CSV-Parser (Anführungszeichen, eingebettete Kommas,
 * Zeilenumbrüche in Feldern). Trennzeichen: Komma oder Semikolon
 * (automatisch anhand der Header-Zeile erkannt).
 */
export function parseCsv(inhalt: string): string[][] {
  // Trennzeichen erkennen: erstes Vorkommen außerhalb von Anführungszeichen
  const ersteZeile = inhalt.split(/\r?\n/, 1)[0] ?? "";
  const trenner = erkenneTrenner(ersteZeile);

  const zeilen: string[][] = [];
  let feld = "";
  let zeile: string[] = [];
  let inAnfuehrung = false;

  for (let i = 0; i < inhalt.length; i++) {
    const z = inhalt[i]!;

    if (inAnfuehrung) {
      if (z === '"') {
        if (inhalt[i + 1] === '"') {
          feld += '"';
          i++;
        } else {
          inAnfuehrung = false;
        }
      } else {
        feld += z;
      }
    } else if (z === '"') {
      inAnfuehrung = true;
    } else if (z === trenner) {
      zeile.push(feld);
      feld = "";
    } else if (z === "\n" || z === "\r") {
      if (z === "\r" && inhalt[i + 1] === "\n") i++;
      zeile.push(feld);
      feld = "";
      zeilen.push(zeile);
      zeile = [];
    } else {
      feld += z;
    }
  }
  if (feld !== "" || zeile.length > 0) {
    zeile.push(feld);
    zeilen.push(zeile);
  }
  return zeilen;
}

function erkenneTrenner(headerZeile: string): string {
  let inAnf = false;
  for (const z of headerZeile) {
    if (z === '"') inAnf = !inAnf;
    else if (!inAnf && z === ";") return ";";
    else if (!inAnf && z === ",") return ",";
  }
  return ",";
}
