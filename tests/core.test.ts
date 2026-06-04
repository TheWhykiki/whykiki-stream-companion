/**
 * Unit-Tests für Core und Adapter (node:test, läuft gegen dist/).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bauesTimeline } from "../core/timeline-builder.js";
import { validiereTimelineDokument } from "../core/validate.js";
import { CsvAdapter, parseCsv } from "../adapters/csv/index.js";
import { JsonAdapter } from "../adapters/json/index.js";
import type { Comment, StreamMeta } from "../core/types.js";

// dist/tests/ → Repo-Wurzel liegt zwei Ebenen höher
const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const META: StreamMeta = {
  platform: "csv",
  stream_id: "s1",
  video_id: "v1",
  title: "Test",
  started_at: "2020-04-12T18:00:00+02:00",
  duration_seconds: 3600,
};

function kommentar(teil: Partial<Comment>): Comment {
  return {
    id: "c1",
    platform: "csv",
    stream_id: "s1",
    video_id: "v1",
    author_name: "Tester",
    author_handle: "tester",
    author_avatar_url: "",
    message: "Hallo Welt",
    created_at: "2020-04-12T18:01:00+02:00",
    relative_time_seconds: 60,
    reactions: 0,
    badges: [],
    confidence: 1,
    ...teil,
  };
}

// ---------------------------------------------------------------------------
// CSV-Parser
// ---------------------------------------------------------------------------

test("parseCsv: Anführungszeichen, eingebettete Trenner, Umbrüche", () => {
  const zeilen = parseCsv('a,b,c\n"x,1","y""q",z\n');
  assert.deepEqual(zeilen[0], ["a", "b", "c"]);
  assert.deepEqual(zeilen[1], ["x,1", 'y"q', "z"]);
});

test("parseCsv: Semikolon-Trenner wird erkannt", () => {
  const zeilen = parseCsv("a;b\n1;2\n");
  assert.deepEqual(zeilen[1], ["1", "2"]);
});

// ---------------------------------------------------------------------------
// CSV-Adapter
// ---------------------------------------------------------------------------

test("CsvAdapter: liest Beispiel-CSV und normalisiert", async () => {
  const adapter = new CsvAdapter();
  const kommentare = await adapter.lese({
    dateipfad: path.join(wurzel, "examples", "comments_raw.csv"),
    meta: META,
  });
  assert.equal(kommentare.length, 12);
  const erster = kommentare[0]!;
  assert.equal(erster.id, "c-0001");
  assert.equal(erster.platform, "csv");
  assert.equal(erster.relative_time_seconds, 135);
  assert.equal(erster.reactions, 12);
  const mitBadge = kommentare.find((k) => k.id === "c-0009")!;
  assert.deepEqual(mitBadge.badges, ["fan"]);
});

// ---------------------------------------------------------------------------
// JSON-Adapter
// ---------------------------------------------------------------------------

test("JsonAdapter: liest comments_timeline.json (entries-Form)", async () => {
  const adapter = new JsonAdapter();
  const kommentare = await adapter.lese({
    dateipfad: path.join(wurzel, "examples", "comments_timeline.json"),
    meta: META,
  });
  assert.equal(kommentare.length, 10);
  assert.equal(kommentare[0]!.author_name, "Martina K.");
});

test("JsonAdapter: tolerantes Feld-Mapping (text/author/likes)", async () => {
  const { writeFile, mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const dir = await mkdtemp(path.join(os.tmpdir(), "wsc-test-"));
  const datei = path.join(dir, "fremd.json");
  await writeFile(
    datei,
    JSON.stringify([
      { author: "Anna", text: "Super Stream!", seconds: 42, likes: 7 },
    ])
  );
  const adapter = new JsonAdapter();
  const kommentare = await adapter.lese({ dateipfad: datei, meta: META });
  assert.equal(kommentare[0]!.author_name, "Anna");
  assert.equal(kommentare[0]!.message, "Super Stream!");
  assert.equal(kommentare[0]!.relative_time_seconds, 42);
  assert.equal(kommentare[0]!.reactions, 7);
});

// ---------------------------------------------------------------------------
// Timeline Builder
// ---------------------------------------------------------------------------

test("Builder: Offset-Korrektur verschiebt Startzeiten", () => {
  const { dokument } = bauesTimeline(
    [kommentar({ relative_time_seconds: 100 })],
    META,
    "p1",
    { offset_seconds: -10 }
  );
  assert.equal(dokument.entries[0]!.timeline.start_seconds, 90);
  assert.equal(dokument.offset_seconds, -10);
});

test("Builder: Kommentare vor 0s und nach Videoende fliegen raus", () => {
  const { dokument, statistik } = bauesTimeline(
    [
      kommentar({ id: "a", relative_time_seconds: 5, message: "zu früh" }),
      kommentar({ id: "b", relative_time_seconds: 4000, message: "zu spät" }),
    ],
    META,
    "p1",
    { offset_seconds: -10 }
  );
  assert.equal(dokument.entries.length, 0);
  assert.equal(statistik.gefiltert_ausserhalb, 2);
});

test("Builder: Filter (leer, zu kurz, Blockliste, Duplikate)", () => {
  const { statistik } = bauesTimeline(
    [
      kommentar({ id: "leer", message: "   ", relative_time_seconds: 1 }),
      kommentar({ id: "kurz", message: "!", relative_time_seconds: 2 }),
      kommentar({ id: "block", message: "Kauft meine Coins!", relative_time_seconds: 3 }),
      kommentar({ id: "orig", message: "Tolles Lied", relative_time_seconds: 100 }),
      kommentar({ id: "dup", message: "Tolles Lied", relative_time_seconds: 101 }),
    ],
    META,
    "p1",
    { filter_blocklist: ["coins"] }
  );
  assert.equal(statistik.gefiltert_leer, 1);
  assert.equal(statistik.gefiltert_kurz, 1);
  assert.equal(statistik.gefiltert_blockliste, 1);
  assert.equal(statistik.gefiltert_duplikat, 1);
  assert.equal(statistik.uebernommen, 1);
});

test("Builder: Highlight-Markierung ab Schwellwert", () => {
  const { dokument, statistik } = bauesTimeline(
    [
      kommentar({ id: "normal", reactions: 5, relative_time_seconds: 10, message: "ganz nett" }),
      kommentar({ id: "top", reactions: 50, relative_time_seconds: 100, message: "MEGA!" }),
    ],
    META,
    "p1",
    { highlight_min_reactions: 20 }
  );
  assert.equal(statistik.highlights, 1);
  assert.equal(dokument.entries.find((e) => e.comment.id === "top")!.timeline.highlight, true);
});

test("Builder: Flutbehandlung begrenzt gleichzeitige Kommentare", () => {
  const flut: Comment[] = [];
  for (let i = 0; i < 10; i++) {
    flut.push(
      kommentar({
        id: `f${i}`,
        message: `Nachricht ${i}`,
        relative_time_seconds: 100 + i * 0.1,
        reactions: 0,
      })
    );
  }
  const { dokument, statistik } = bauesTimeline(flut, META, "p1", {
    max_concurrent: 3,
    min_gap_seconds: 0,
    default_duration_seconds: 6,
  });
  assert.equal(dokument.entries.length, 3);
  assert.equal(statistik.verworfen_flut, 7);
  assert.ok(statistik.gruppen >= 1);
  assert.ok(dokument.entries.every((e) => e.timeline.group_id !== null));
});

test("Builder: starker Kommentar verdrängt schwachen bei Flut", () => {
  const eingabe: Comment[] = [
    kommentar({ id: "schwach1", relative_time_seconds: 100, reactions: 1, message: "a1" }),
    kommentar({ id: "schwach2", relative_time_seconds: 100.5, reactions: 2, message: "a2" }),
    kommentar({ id: "schwach3", relative_time_seconds: 101, reactions: 3, message: "a3" }),
    kommentar({ id: "stark", relative_time_seconds: 101.5, reactions: 99, message: "wow" }),
  ];
  const { dokument } = bauesTimeline(eingabe, META, "p1", {
    max_concurrent: 3,
    min_gap_seconds: 0,
    highlight_min_reactions: 1000,
  });
  const ids = dokument.entries.map((e) => e.comment.id);
  assert.ok(ids.includes("stark"), "starker Kommentar muss übernommen werden");
  assert.ok(!ids.includes("schwach1"), "schwächster muss verdrängt sein");
});

test("Builder: Mindestabstand wird erzwungen", () => {
  const { dokument } = bauesTimeline(
    [
      kommentar({ id: "a", relative_time_seconds: 10, message: "eins" }),
      kommentar({ id: "b", relative_time_seconds: 10.1, message: "zwei" }),
    ],
    META,
    "p1",
    { min_gap_seconds: 0.5, max_concurrent: 5 }
  );
  const [a, b] = dokument.entries;
  assert.ok(
    b!.timeline.start_seconds - a!.timeline.start_seconds >= 0.5 - 1e-9
  );
});

// ---------------------------------------------------------------------------
// Validierung
// ---------------------------------------------------------------------------

test("Validierung: gebaute Timeline ist gültig", () => {
  const { dokument } = bauesTimeline(
    [kommentar({}), kommentar({ id: "c2", message: "Noch einer", relative_time_seconds: 200 })],
    META,
    "p1"
  );
  const ergebnis = validiereTimelineDokument(dokument);
  assert.deepEqual(ergebnis.fehler, []);
  assert.equal(ergebnis.gueltig, true);
});

test("Validierung: erkennt doppelte IDs und falsche Sortierung", () => {
  const { dokument } = bauesTimeline([kommentar({})], META, "p1");
  const kaputt = structuredClone(dokument);
  kaputt.entries.push(structuredClone(kaputt.entries[0]!));
  kaputt.entries[1]!.timeline.start_seconds = 1; // vor Eintrag 1 → unsortiert
  const ergebnis = validiereTimelineDokument(kaputt);
  assert.equal(ergebnis.gueltig, false);
  assert.ok(ergebnis.fehler.some((f) => f.includes("doppelte Kommentar-ID")));
  assert.ok(ergebnis.fehler.some((f) => f.includes("chronologisch")));
});
