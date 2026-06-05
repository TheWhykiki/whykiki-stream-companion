/**
 * Unit-Tests für den Facebook-Adapter und die Video-Discovery.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FacebookAdapter, repariereMojibake } from "../adapters/facebook/index.js";
import { entdeckeVideos } from "../adapters/facebook/discovery.js";
import type { StreamMeta } from "../core/types.js";

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const META: StreamMeta = {
  platform: "facebook",
  stream_id: "fb-1",
  video_id: "v1",
  title: "Balkonkonzert",
  started_at: "2020-04-12T18:00:00+02:00", // = Unix 1586707200
  duration_seconds: 3600,
};

// ---------------------------------------------------------------------------
// Mojibake
// ---------------------------------------------------------------------------

test("repariereMojibake: stellt Umlaute und Emoji wieder her", () => {
  assert.equal(repariereMojibake("WunderschÃ¶n fÃ¼r GrÃ¼ÃŸe"), "Wunderschön für Grüße");
  assert.equal(repariereMojibake("Balkonkonzert ðŸŽ¶"), "Balkonkonzert 🎶");
});

test("repariereMojibake: lässt korrekte Strings unangetastet", () => {
  assert.equal(repariereMojibake("Schön, dass ihr dabei seid! 🎶"), "Schön, dass ihr dabei seid! 🎶");
  assert.equal(repariereMojibake("Hello World"), "Hello World");
});

// ---------------------------------------------------------------------------
// Facebook-Adapter (Kommentar-Exporter-Format)
// ---------------------------------------------------------------------------

test("FacebookAdapter: liest Exporter-JSON, flacht Antworten ab, sortiert", async () => {
  const adapter = new FacebookAdapter();
  const kommentare = await adapter.lese({
    dateipfad: path.join(wurzel, "examples", "facebook", "comments_export.json"),
    meta: META,
  });

  // 6 Einträge im Export: 5 Top-Level (1 ohne Text → übersprungen) + 1 Antwort
  assert.equal(kommentare.length, 5);

  // Sortierung nach relativer Zeit
  const zeiten = kommentare.map((k) => k.relative_time_seconds);
  assert.deepEqual(zeiten, [...zeiten].sort((a, b) => a - b));

  // Relative Zeit aus ISO-Datum minus Streamstart
  const martina = kommentare.find((k) => k.author_name === "Martina K.")!;
  assert.equal(martina.relative_time_seconds, 135);
  assert.equal(martina.message, "Wunderschön! Grüße vom Nachbarbalkon 🎶"); // Mojibake repariert
  assert.equal(martina.reactions, 12);
  assert.equal(martina.author_handle, "martina.k");
  assert.equal(martina.platform, "facebook");

  // Antwort trägt Badge und wurde abgeflacht
  const antwort = kommentare.find((k) => k.author_name === "Kiki")!;
  assert.deepEqual(antwort.badges, ["antwort"]);

  // Unix-Timestamp-Variante (Heike, likesCount-Alias)
  const heike = kommentare.find((k) => k.author_name === "Heike Brandt")!;
  assert.equal(heike.relative_time_seconds, 2733);
  assert.equal(heike.reactions, 31);
});

test("FacebookAdapter: Fehler ohne Zeitbezug", async () => {
  const { writeFile, mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const dir = await mkdtemp(path.join(os.tmpdir(), "wsc-fb-"));
  const datei = path.join(dir, "ohne-zeit.json");
  await writeFile(datei, JSON.stringify([{ name: "X", comment: "Hallo" }]));

  const adapter = new FacebookAdapter();
  await assert.rejects(
    () => adapter.lese({ dateipfad: datei, meta: { ...META, started_at: "" } }),
    /keine Zeit ermittelbar/
  );
});

// ---------------------------------------------------------------------------
// Discovery (DYI your_videos.json)
// ---------------------------------------------------------------------------

test("Discovery: findet Videos im DYI-Export inkl. Mojibake-Reparatur", async () => {
  const videos = await entdeckeVideos(
    path.join(wurzel, "examples", "facebook", "your_videos.json")
  );
  assert.equal(videos.length, 2);

  const erstes = videos[0]!;
  assert.equal(erstes.index, 1);
  assert.equal(erstes.unix_timestamp, 1586707200);
  assert.equal(erstes.aufgenommen_am, "2020-04-12T16:00:00.000Z");
  assert.equal(erstes.beschreibung, "Balkonkonzert für die Nachbarschaft 🎶");
  assert.ok(erstes.datei_uri.endsWith("balkonkonzert_20200412.mp4"));
});
