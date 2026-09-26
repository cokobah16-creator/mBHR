// @vitest-environment node
//
// Owner decision 2.7 (docs/clinical/CLINICAL_LOGIC_CHANGES.md): the held-back
// diagnosis table fills in no clinical status, verification status or
// category, so FHIR publishes only what staff chose. CI never applies
// 20260125091822 (so pgTAP cannot check it); this reads the SQL instead.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFERRED = join(ROOT, "supabase", "migrations-deferred");
const SQL = readFileSync(join(DEFERRED, "20260125091822_add_immunizations_conditions_sdoh.sql"), "utf8");
const COLUMNS = ["clinical_status", "verification_status", "category"];

describe("public.conditions fills in no status (owner decision 2.7)", () => {
  it("creates clinical_status, verification_status and category with no default", () => {
    const table = /CREATE TABLE IF NOT EXISTS conditions \(([\s\S]*?)\n\);/.exec(SQL)?.[1] ?? "";
    const lines = table.split("\n").map((l) => l.trim());
    for (const col of COLUMNS) {
      const line = lines.find((l) => l.startsWith(`${col} `));
      expect(line, col).toBeDefined();
      expect(line, col).not.toMatch(/\bDEFAULT\b/i);
      expect(line, col).toMatch(/^\w+ text CHECK \(/);
    }
    expect(lines.find((l) => l.startsWith("verification_status "))).toContain(
      "('unconfirmed', 'provisional', 'differential', 'confirmed', 'refuted', 'entered-in-error')",
    );
  });

  it("drops the defaults from an older copy of the table", () => {
    expect(SQL).toMatch(
      /ALTER TABLE conditions\s+ALTER COLUMN clinical_status DROP DEFAULT,\s+ALTER COLUMN verification_status DROP DEFAULT,\s+ALTER COLUMN category DROP DEFAULT;/,
    );
  });

  it("no held-back migration sets a default on conditions again", () => {
    for (const file of readdirSync(DEFERRED).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(DEFERRED, file), "utf8");
      expect(sql, file).not.toMatch(/ALTER\s+TABLE\s+(IF\s+EXISTS\s+)?(ONLY\s+)?(public\.)?conditions\b[^;]*SET\s+DEFAULT/i);
    }
  });
});
