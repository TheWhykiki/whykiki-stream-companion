#!/usr/bin/env node
/**
 * Validiert die Beispieldaten in examples/ gegen die PoC-Erwartungen.
 * Aufruf: node tests/validate_examples.js
 */

const fs = require("fs");
const path = require("path");

const basis = path.join(__dirname, "..");
let fehler = 0;

function pruefe(bedingung, nachricht) {
  if (bedingung) {
    console.log("  OK      " + nachricht);
  } else {
    console.error("  FEHLER  " + nachricht);
    fehler++;
  }
}

function ladeJson(relativerPfad) {
  const voll = path.join(basis, relativerPfad);
  return JSON.parse(fs.readFileSync(voll, "utf8"));
}

// ---------------------------------------------------------------------------
console.log("Prüfe examples/comments_timeline.json");
const timeline = ladeJson("examples/comments_timeline.json");

pruefe(typeof timeline.project_id === "string" && timeline.project_id.length > 0, "project_id vorhanden");
pruefe(timeline.version === "1.1", "Schema-Version 1.1");
pruefe(typeof timeline.offset_seconds_applied === "number", "offset_seconds_applied ist Zahl");
pruefe(Array.isArray(timeline.entries), "entries ist Array");
pruefe(timeline.entries.length === 10, `genau 10 Einträge (gefunden: ${timeline.entries.length})`);

const kommentarPflicht = [
  "id", "platform", "stream_id", "video_id", "author_name", "author_handle",
  "author_avatar_url", "message", "created_at", "relative_time_seconds",
  "reactions", "badges", "confidence",
];

let vorherigerStart = -1;
const ids = new Set();

timeline.entries.forEach((eintrag, i) => {
  const n = i + 1;
  const c = eintrag.comment;
  const t = eintrag.timeline;

  kommentarPflicht.forEach((feld) => {
    pruefe(c && c[feld] !== undefined, `Eintrag ${n}: comment.${feld} vorhanden`);
  });
  pruefe(t && typeof t.start_seconds === "number" && t.start_seconds >= 0, `Eintrag ${n}: start_seconds gültig`);
  pruefe(t && typeof t.duration_seconds === "number" && t.duration_seconds > 0, `Eintrag ${n}: duration_seconds gültig`);
  pruefe(t && Number.isInteger(t.video_track) && t.video_track >= 0, `Eintrag ${n}: video_track gültig`);
  pruefe(c && c.relative_time_seconds === t.start_seconds, `Eintrag ${n}: relative_time_seconds == start_seconds (Offset 0)`);
  pruefe(t.start_seconds > vorherigerStart, `Eintrag ${n}: chronologisch sortiert`);
  vorherigerStart = t.start_seconds;
  pruefe(!ids.has(c.id), `Eintrag ${n}: comment.id eindeutig`);
  ids.add(c.id);
});

// ---------------------------------------------------------------------------
console.log("\nPrüfe examples/template_mapping.json");
const mapping = ladeJson("examples/template_mapping.json");

pruefe(mapping.fields && typeof mapping.fields.comment_text === "string", "fields.comment_text vorhanden");
["comment_text", "author_name", "avatar", "timestamp", "reaction_count"].forEach((feld) => {
  pruefe(feld in mapping.fields, `fields.${feld} definiert (auch null erlaubt)`);
});
pruefe(mapping.defaults && typeof mapping.defaults.duration_seconds === "number", "defaults.duration_seconds vorhanden");
pruefe(Number.isInteger(mapping.defaults.video_track), "defaults.video_track vorhanden");

// ---------------------------------------------------------------------------
console.log("\nPrüfe premiere/uxp-panel/manifest.json");
const manifest = ladeJson("premiere/uxp-panel/manifest.json");

pruefe(manifest.manifestVersion === 5, "manifestVersion ist 5");
pruefe(manifest.host && manifest.host.app === "premierepro", "host.app ist 'premierepro'");
pruefe(manifest.host && /^\d+\.\d+/.test(manifest.host.minVersion || ""), "host.minVersion gesetzt");
pruefe(Array.isArray(manifest.entrypoints) && manifest.entrypoints[0].type === "panel", "Panel-Entrypoint vorhanden");
pruefe(manifest.requiredPermissions && manifest.requiredPermissions.localFileSystem === "fullAccess", "localFileSystem: fullAccess");
pruefe(typeof manifest.main === "string", "main gesetzt");

// ---------------------------------------------------------------------------
console.log("");
if (fehler > 0) {
  console.error(`Validierung fehlgeschlagen: ${fehler} Fehler.`);
  process.exit(1);
} else {
  console.log("Alle Prüfungen bestanden.");
}
