/**
 * WhyKiki Stream Companion – Core-Modul (öffentliche API).
 *
 * Enthält keinerlei Plattformlogik (Grundprinzip: Adapter liefern,
 * der Core verarbeitet).
 */

export * from "./types.js";
export { Protokoll, type LogStufe } from "./log.js";
export { validiereKommentar, validiereTimelineDokument } from "./validate.js";
export {
  alias,
  clamp01,
  kontextAusMeta,
  normalisiereKommentar,
  repariereMojibake,
  zahl,
  type NormalisierKontext,
  type RohKommentar,
} from "./normalizer.js";
export { bauesTimeline, type BuildErgebnis } from "./timeline-builder.js";
export {
  ladeProjekt,
  exportiereTimeline,
  exportiereNormalisiert,
  schreibeLog,
  type Projekt,
} from "./project.js";
