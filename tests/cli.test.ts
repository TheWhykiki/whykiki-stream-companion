/**
 * e2e-Tests für die CLI: kompletter Durchlauf import → build → validate
 * über echte Prozessaufrufe (Review-Befund 19).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);

// dist/tests/ → Repo-Wurzel zwei Ebenen höher
const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(wurzel, "dist", "cli", "index.js");

async function cli(args: string[]): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [CLI, ...args]);
    return { code: 0, out: stdout + stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

test("e2e: import → build → validate mit Beispiel-CSV", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "wsc-e2e-"));

  // Projekt mit Metadaten vorbereiten
  const meta = {
    platform: "csv",
    stream_id: "s1",
    video_id: "v1",
    title: "e2e-Test",
    started_at: "2020-04-12T18:00:00+02:00",
    duration_seconds: 3600,
  };
  const quellOrdner = path.join(tmp, "p1", "source");
  await exec(process.execPath, ["-e", `require("fs").mkdirSync(${JSON.stringify(quellOrdner)}, {recursive:true})`]);
  await writeFile(path.join(quellOrdner, "metadata.json"), JSON.stringify(meta));

  const imp = await cli([
    "import", "--projekt", "p1",
    "--datei", path.join(wurzel, "examples", "comments_raw.csv"),
    "--projekte-ordner", tmp,
  ]);
  assert.equal(imp.code, 0, "import muss mit Exit-Code 0 enden:\n" + imp.out);

  const build = await cli(["build", "--projekt", "p1", "--projekte-ordner", tmp]);
  assert.equal(build.code, 0, "build muss mit Exit-Code 0 enden:\n" + build.out);

  const timelinePfad = path.join(tmp, "p1", "processed", "comments_timeline.json");
  await access(timelinePfad);
  const timeline = JSON.parse(await readFile(timelinePfad, "utf8"));
  assert.ok(timeline.entries.length >= 9, "Timeline muss Einträge enthalten");

  const val = await cli(["validate", "--datei", timelinePfad]);
  assert.equal(val.code, 0, "validate muss mit Exit-Code 0 enden:\n" + val.out);
});

test("e2e-Regression K1: Minimal-CSV ohne created_at ist baubar", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "wsc-k1-"));
  const csv = path.join(tmp, "minimal.csv");
  await writeFile(
    csv,
    "id,author_name,message,relative_time_seconds\n" +
      "1,Tester,Hallo Welt,10\n" +
      "2,Testerin,Zweiter Kommentar,20\n"
  );

  const imp = await cli(["import", "--projekt", "k1", "--datei", csv, "--projekte-ordner", tmp]);
  assert.equal(imp.code, 0, "import:\n" + imp.out);

  // Vor dem Fix scheiterte build hier an 'created_at ist kein gültiger ISO-Zeitstempel'
  const build = await cli(["build", "--projekt", "k1", "--projekte-ordner", tmp]);
  assert.equal(build.code, 0, "build (K1-Regression):\n" + build.out);

  const timeline = JSON.parse(
    await readFile(path.join(tmp, "k1", "processed", "comments_timeline.json"), "utf8")
  );
  assert.equal(timeline.entries.length, 2);
});

test("e2e: validate mit ungültiger Datei liefert Exit-Code 1", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "wsc-inv-"));
  const kaputt = path.join(tmp, "kaputt.json");
  await writeFile(kaputt, JSON.stringify({ version: "1.0", entries: [{}] }));

  const val = await cli(["validate", "--datei", kaputt]);
  assert.equal(val.code, 1);
});

test("e2e: unbekanntes Kommando liefert Exit-Code 1 mit Hinweis", async () => {
  const res = await cli(["quatsch"]);
  assert.equal(res.code, 1);
  assert.match(res.out, /Unbekanntes Kommando/);
});

test("e2e-Regression BOM: Excel-CSV mit UTF-8-BOM wird importiert", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "wsc-bom-"));
  const csv = path.join(tmp, "bom.csv");
  await writeFile(
    csv,
    "﻿id,author_name,message,relative_time_seconds\n1,Tester,Mit BOM,5\n"
  );

  const imp = await cli(["import", "--projekt", "bom", "--datei", csv, "--projekte-ordner", tmp]);
  assert.equal(imp.code, 0, "BOM-CSV muss importierbar sein:\n" + imp.out);
});
