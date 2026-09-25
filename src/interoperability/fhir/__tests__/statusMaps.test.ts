// @vitest-environment node
//
// Every status map (terminology/status/index.ts) against the rules the
// owner set: unknown stays unknown, and no status is promoted.

import { describe, expect, it } from "vitest";
import { STATUS_MAPS } from "../terminology/status";
import { ENCOUNTER_STATUS, applyStatusMap, explainStatus, mapEncounterStatus, sourceValuesFor } from "../terminology/statusMaps";

/** FHIR values that assert something definite about care that happened or is settled. */
const DEFINITE = new Set([
  "final",
  "finished",
  "completed",
  "active",
  "confirmed",
  "amended",
  "corrected",
  "current",
  "resolved",
  "inactive",
  "refuted",
  "on-hold",
  "stopped",
  "declined",
  "revoked",
  "cancelled",
  "entered-in-error",
  "in-progress",
  "preparation",
  "registered",
  "partial",
  "preliminary",
  "rejected",
  "proposed",
  "draft",
  "superseded",
]);

/** A source value that says the thing is not done or not settled must never map to one of these. */
const PROMOTIONS: { source: RegExp; never: string[] }[] = [
  { source: /pend|order|request|await|draft|queue|preliminary|unreviewed|collected|sent|in[_ -]?progress/, never: ["final", "completed", "finished", "amended", "corrected"] },
  { source: /cancel|void|revok|abandon/, never: ["finished", "completed", "final", "active"] },
  { source: /inactive|resolved|withdraw|expired|revoked|stopped|ended/, never: ["active"] },
  { source: /suspect|provisional|differential|unconfirmed|possible|presumed/, never: ["confirmed"] },
  { source: /^not[_ -]|refus|declin|not[_ -]handed/, never: ["completed", "final"] },
];

describe("every status map", () => {
  it("is listed and well formed", () => {
    expect(STATUS_MAPS.length).toBeGreaterThanOrEqual(3);
    const elements = STATUS_MAPS.map((m) => `${m.element} <- ${m.source}`);
    expect(new Set(elements).size).toBe(elements.length);
    for (const m of STATUS_MAPS) {
      expect(m.valueSet, m.element).toMatch(/^http:\/\/hl7\.org\/fhir\/ValueSet\/|^http:\/\/terminology\.hl7\.org\//);
      for (const r of m.rules) {
        expect(m.allowed, `${m.element}: ${r.fhir}`).toContain(r.fhir);
        expect(r.reason.length, m.element).toBeGreaterThan(10);
        for (const s of r.source) expect(s, m.element).toBe(s.toLowerCase());
      }
      // A source value belongs to one rule only.
      const all = m.rules.flatMap((r) => [...r.source]);
      expect(new Set(all).size, m.element).toBe(all.length);
    }
  });

  it("keeps unknown unknown: a missing or unrecognised value never becomes a definite status", () => {
    for (const m of STATUS_MAPS) {
      for (const fb of [m.missing, m.unrecognised]) {
        expect(fb.fhir === null || fb.fhir === "unknown", `${m.element}: fallback ${fb.fhir}`).toBe(true);
        if (fb.fhir !== null) expect(DEFINITE.has(fb.fhir), m.element).toBe(false);
      }
      for (const raw of [null, undefined, "", "somethingnew", 0, false]) {
        const r = applyStatusMap(m, raw);
        expect(r === null || r === "unknown", `${m.element} <- ${String(raw)}`).toBe(true);
      }
    }
  });

  it("never promotes a status", () => {
    for (const m of STATUS_MAPS) {
      for (const rule of m.rules) {
        for (const s of rule.source) {
          for (const p of PROMOTIONS) {
            if (p.source.test(s)) expect(p.never, `${m.element}: "${s}" -> ${rule.fhir}`).not.toContain(rule.fhir);
          }
        }
      }
    }
  });
});

describe("Encounter.status", () => {
  it("maps what the app writes and nothing else", () => {
    expect(mapEncounterStatus("open")).toBe("in-progress");
    expect(mapEncounterStatus("Closed")).toBe("finished");
    expect(mapEncounterStatus("cancelled")).toBe("cancelled");
    expect(mapEncounterStatus(null)).toBe("unknown");
    expect(mapEncounterStatus("archived")).toBe("unknown");
    // Compared exactly (like the search filter): padded values are not guessed.
    expect(mapEncounterStatus(" closed")).toBe("unknown");
    expect(explainStatus(ENCOUNTER_STATUS, "cancelled").reason).toMatch(/never shown as finished/);
    expect(sourceValuesFor(ENCOUNTER_STATUS, "finished")).toEqual(["closed", "completed", "finished"]);
  });
});
