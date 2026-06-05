/**
 * CSV-Adapter – liest Kommentar-Rohdaten aus CSV-Dateien.
 *
 * Erwartete Spalten (Header-Zeile, Reihenfolge egal, Groß-/Kleinschreibung egal):
 *   id, author_name, message               → Pflicht
 *   author_handle, author_avatar_url,
 *   created_at, relative_time_seconds,
 *   reactions, badges, confidence          → optional
 *
 * 'badges' als durch | getrennte Liste (z. B. "fan|mod").
 * Trennzeichen: Komma oder Semikolon (automatisch erkannt), UTF-8-BOM
 * wird entfernt (Excel-Export). Die Normalisierung übernimmt der
 * Comment Normalizer; die Plattform kommt aus den Projektmetadaten.
 */

import { readFile } from "node:fs/promises";
import type {
  AdapterEingabe,
  Comment,
  PlattformAdapter,
} from "../../core/types.js";
import {
  clamp01,
  kontextAusMeta,
  normalisiereKommentar,
  zahl,
  type RohKommentar,
} from "../../core/normalizer.js";

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

    const kontext = kontextAusMeta(eingabe.meta, "csv");
    const kommentare: Comment[] = [];

    for (let i = 1; i < zeilen.length; i++) {
      const zeile = zeilen[i]!;
      if (zeile.length === 1 && zeile[0]!.trim() === "") continue; // Leerzeile

      const wert = (name: string): string => {
        const idx = spalte(name);
        return idx >= 0 ? (zeile[idx] ?? "").trim() : "";
      };

      const roh: RohKommentar = {
        message: wert("message"),
        author_name: wert("author_name"),
        author_handle: wert("author_handle"),
        author_avatar_url: wert("author_avatar_url"),
        badges: wert("badges")
          ? wert("badges").split("|").map((b) => b.trim()).filter(Boolean)
          : [],
      };

      if (wert("id") !== "") roh.id = wert("id");
      if (wert("created_at") !== "") roh.created_at = wert("created_at");

      const relativ = zahl(wert("relative_time_seconds"));
      if (Number.isFinite(relativ)) roh.relative_time_seconds = relativ;

      const reaktionen = zahl(wert("reactions"));
      if (Number.isFinite(reaktionen)) roh.reactions = reaktionen;

      const confidence = zahl(wert("confidence"));
      if (Number.isFinite(confidence)) roh.confidence = clamp01(confidence);

      try {
        kommentare.push(normalisiereKommentar(roh, kontext, `csv-${i + 1}`));
      } catch (e) {
        throw new Error(`CSV Zeile ${i + 1}: ${(e as Error).message}`);
      }
    }

    return kommentare;
  }
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
