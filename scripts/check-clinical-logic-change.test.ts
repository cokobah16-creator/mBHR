import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLINICAL_CONTENT_RULES,
  CLINICAL_DOC,
  CLINICAL_PATH_RULES,
  OPT_OUT_PHRASE,
  changedLinesFromDiff,
  contentRuleCandidates,
  declaresNoClinicalChange,
  evaluateGate,
  formatReport,
  globToRegExp,
  isIgnored,
  matchClinicalContent,
  matchClinicalPaths,
  matchesGlob,
  normalisePath,
  parseArgs,
  run,
} from "./check-clinical-logic-change.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "check-clinical-logic-change.mjs");
const TEMPLATE = join(ROOT, ".github", "pull_request_template.md");

type Match = { file: string; area: string; term?: string };

describe("globToRegExp / matchesGlob", () => {
  it("matches ** across folders, including none", () => {
    expect(matchesGlob("src/features/labs/labWorklist.ts", "src/features/labs/**")).toBe(true);
    expect(matchesGlob("src/features/labs/a/b/c.tsx", "src/features/labs/**")).toBe(true);
    expect(matchesGlob("supabase/migrations/x.sql", "supabase/migrations/**/*.sql")).toBe(true);
    expect(matchesGlob("supabase/migrations/a/x.sql", "supabase/migrations/**/*.sql")).toBe(true);
  });

  it("keeps * inside one folder and does not match look-alike folders", () => {
    expect(matchesGlob("src/features/labs2/x.ts", "src/features/labs/**")).toBe(false);
    expect(matchesGlob("src/i18n/locales/en.json", "src/i18n/locales/*.json")).toBe(true);
    expect(matchesGlob("src/i18n/locales/old/en.json", "src/i18n/locales/*.json")).toBe(false);
    expect(matchesGlob("src/db/migrations/0002-vitals-ranges.ts", "src/db/migrations/*vitals*")).toBe(true);
  });

  it("supports ? and {a,b}, and treats dots literally", () => {
    expect(matchesGlob("a/x.tsx", "a/*.{ts,tsx}")).toBe(true);
    expect(matchesGlob("a/x.ts", "a/*.{ts,tsx}")).toBe(true);
    expect(matchesGlob("a/x.js", "a/*.{ts,tsx}")).toBe(false);
    expect(matchesGlob("a/b.ts", "a/?.ts")).toBe(true);
    expect(matchesGlob("a/bb.ts", "a/?.ts")).toBe(false);
    expect(globToRegExp("src/utils/vitals.ts").test("src/utils/vitalsXts")).toBe(false);
  });
});

describe("normalisePath / isIgnored", () => {
  it("normalises ./ prefixes and backslashes", () => {
    expect(normalisePath("./src/utils/vitals.ts")).toBe("src/utils/vitals.ts");
    expect(normalisePath("src\\utils\\vitals.ts")).toBe("src/utils/vitals.ts");
    expect(normalisePath("  src/a.ts \n")).toBe("src/a.ts");
  });

  it("ignores tests, never clinical sources", () => {
    expect(isIgnored("src/utils/vitals.test.ts")).toBe(true);
    expect(isIgnored("src/features/labs/labWorklist.test.ts")).toBe(true);
    expect(isIgnored("e2e/vitals-entry.spec.ts")).toBe(true);
    expect(isIgnored("src/test/setup.ts")).toBe(true);
    expect(isIgnored("src/utils/vitals.ts")).toBe(false);
  });
});

describe("clinical-logic list", () => {
  it("names only files and folders that exist, so renames update the list", () => {
    // A literal path must exist; for a glob, the folder before the wildcard.
    const target = (p: string) =>
      /[*?{]/.test(p) ? p.split(/[*?{]/)[0].replace(/\/[^/]*$/, "") : p;
    const missing: string[] = [];
    for (const rule of [...CLINICAL_PATH_RULES, ...CLINICAL_CONTENT_RULES]) {
      for (const p of rule.paths) {
        if (!existsSync(join(ROOT, target(p)))) missing.push(p);
      }
    }
    expect(missing).toEqual([]);
  });

  it("covers each area the owner named", () => {
    const text = [...CLINICAL_PATH_RULES, ...CLINICAL_CONTENT_RULES]
      .map((r) => r.area)
      .join(" | ")
      .toLowerCase();
    for (const word of [
      "triage",
      "vitals",
      "lab",
      "medication",
      "allergies",
      "decision support",
      "patient-facing",
      "training",
      "database",
    ]) {
      expect(text).toContain(word);
    }
  });
});

describe("matchClinicalPaths", () => {
  it("finds clinical files and names their area", () => {
    const got = matchClinicalPaths([
      "src/utils/vitals.ts",
      "src/features/labs/labWorklist.ts",
      "src/features/pharmacy/fefo.ts",
      "src/utils/allergyMatch.ts",
      "src/services/queuePriority.ts",
      "src/services/clinicalDecisionSupport.ts",
      "src/features/patient-portal/portalStatus.ts",
      "src/features/gamification/KnowledgeBlitz.tsx",
      "README.md",
      "src/components/Layout.tsx",
    ]) as Match[];
    expect(got.map((m) => m.file)).toEqual([
      "src/utils/vitals.ts",
      "src/features/labs/labWorklist.ts",
      "src/features/pharmacy/fefo.ts",
      "src/utils/allergyMatch.ts",
      "src/services/queuePriority.ts",
      "src/services/clinicalDecisionSupport.ts",
      "src/features/patient-portal/portalStatus.ts",
      "src/features/gamification/KnowledgeBlitz.tsx",
    ]);
    expect(got[0].area).toMatch(/vitals/i);
    expect(got[1].area).toMatch(/lab/i);
    expect(got[2].area).toMatch(/FEFO/);
    expect(got[7].area).toMatch(/training/i);
  });

  it("covers a removed clinical file and changes to the gate's own list", () => {
    const got = matchClinicalPaths([
      "src/services/smartMedication.ts",
      "scripts/check-clinical-logic-change.mjs",
      "scripts/check-clinical-logic-change.test.ts",
    ]) as Match[];
    expect(got.map((m) => m.file)).toEqual([
      "src/services/smartMedication.ts",
      "scripts/check-clinical-logic-change.mjs",
    ]);
    expect(got[1].area).toMatch(/gate itself/i);
  });

  it("skips tests and duplicates, and accepts ./ paths", () => {
    const got = matchClinicalPaths([
      "src/utils/vitals.test.ts",
      "./src/utils/vitals.ts",
      "src/utils/vitals.ts",
      "",
    ]) as Match[];
    expect(got).toEqual([{ file: "src/utils/vitals.ts", area: expect.any(String) }]);
  });
});

describe("changedLinesFromDiff", () => {
  it("returns added and removed lines inside hunks only", () => {
    const diff = [
      "diff --git a/x.sql b/x.sql",
      "index 1111111..2222222 100644",
      "--- a/x.sql",
      "+++ b/x.sql",
      "@@ -1,2 +1,2 @@",
      " unchanged context interpretation",
      "-old line",
      "+new line",
      "+++counter is content, not a header",
      "diff --git a/y.sql b/y.sql",
      "--- a/y.sql",
      "+++ b/y.sql",
    ].join("\n");
    expect(changedLinesFromDiff(diff)).toEqual([
      "old line",
      "new line",
      "++counter is content, not a header",
    ]);
  });

  it("handles an empty diff", () => {
    expect(changedLinesFromDiff("")).toEqual([]);
    expect(changedLinesFromDiff(undefined)).toEqual([]);
  });
});

describe("matchClinicalContent", () => {
  const mig = "supabase/migrations/20270101000000_example.sql";

  it("flags migrations that touch clinical rules", () => {
    for (const line of [
      "ALTER TABLE public.lab_results ALTER COLUMN interpretation DROP DEFAULT;",
      "CREATE OR REPLACE FUNCTION public.app_queue_priority_rank(p text)",
      "SELECT public.lab_release_result(r.id, 'ok');",
      "CREATE POLICY patient_allergies_select ON public.patient_allergies",
      "  lot.expiry_date >= (now() AT TIME ZONE 'Africa/Lagos')::date",
      "INSERT INTO vitals_ranges (metric, low, high) VALUES ('spo2', 95, 100);",
    ]) {
      expect(matchClinicalContent(mig, [line])).not.toBeNull();
    }
    expect(matchClinicalContent(mig, ["interpretation text"])?.term).toBe("interpretation");
  });

  it("does not flag migrations without clinical terms", () => {
    expect(
      matchClinicalContent(mig, [
        "CREATE INDEX IF NOT EXISTS idx_appointments_created ON public.appointments(created_at);",
        "-- closed visits, submitted forms",
        "GRANT EXECUTE ON FUNCTION public.portal_access_status(uuid) TO authenticated;",
      ]),
    ).toBeNull();
  });

  it("flags clinical translation keys only", () => {
    const loc = "src/i18n/locales/ha.json";
    expect(matchClinicalContent(loc, ['  "portal.vital.status.normal": "Lafiya",'])).not.toBeNull();
    expect(matchClinicalContent(loc, ['  "portal.home.notEmergency": "…",'])).not.toBeNull();
    expect(matchClinicalContent(loc, ['  "pharmacy.dosage": "…",'])).not.toBeNull();
    expect(matchClinicalContent(loc, ['  "nav.games": "Wasanni",'])).toBeNull();
    expect(matchClinicalContent(loc, ['  "pharmacy.quantity": "…",'])).toBeNull();
  });

  it("flags clinical permissions being granted, not a new role's false", () => {
    const roles = "src/auth/roles.ts";
    expect(matchClinicalContent(roles, ["    consult: true,"])).not.toBeNull();
    expect(matchClinicalContent(roles, ["    lab_review: true,"])).not.toBeNull();
    expect(matchClinicalContent(roles, ["    consult: false,", "    lab_release:   false,"])).toBeNull();
    expect(matchClinicalContent(roles, ["    portal_invite: true,"])).toBeNull();
    expect(matchClinicalContent(roles, ['  | "consult" // Perform consultations'])).toBeNull();
    expect(
      matchClinicalContent("src/utils/permissions.ts", ['  prescribe: ["doctor", "nurse", "admin"] as Role[],']),
    ).not.toBeNull();
  });

  it("flags patient-portal copy that gives medical advice", () => {
    const f = "src/features/patient-portal/PortalHome.tsx";
    expect(matchClinicalContent(f, ["If you feel very unwell, go to the nearest hospital."])).not.toBeNull();
    expect(matchClinicalContent(f, ["Take your medicine with food."])).not.toBeNull();
    expect(matchClinicalContent(f, ["const [emergencyOpen, setEmergencyOpen] = useState(false);"])).toBeNull();
    expect(matchClinicalContent(f, ['<h2 className="text-h1">Your visits</h2>'])).toBeNull();
  });

  it("ignores files no content rule covers, and tests", () => {
    expect(matchClinicalContent("src/components/Layout.tsx", ["interpretation"])).toBeNull();
    expect(
      matchClinicalContent("src/features/patient-portal/PortalHome.test.tsx", ["nearest hospital"]),
    ).toBeNull();
  });

  it("lists content-rule candidates without tests or duplicates", () => {
    expect(
      contentRuleCandidates([
        "supabase/migrations/1.sql",
        "./supabase/migrations/1.sql",
        "src/features/patient-portal/PortalHome.test.tsx",
        "src/auth/roles.ts",
        "README.md",
      ]),
    ).toEqual(["supabase/migrations/1.sql", "src/auth/roles.ts"]);
  });
});

describe("declaresNoClinicalChange", () => {
  it("accepts the phrase written by the author", () => {
    expect(declaresNoClinicalChange("No clinical logic change")).toBe(true);
    expect(declaresNoClinicalChange("Refactor only.\n\nNo clinical logic change.")).toBe(true);
    expect(declaresNoClinicalChange("no  clinical\nlogic change")).toBe(true);
    expect(declaresNoClinicalChange("- [x] No clinical logic change.")).toBe(true);
    expect(declaresNoClinicalChange("* [X] No clinical logic change")).toBe(true);
  });

  it("does not count comments, unticked boxes or other wording", () => {
    expect(declaresNoClinicalChange("")).toBe(false);
    expect(declaresNoClinicalChange(null)).toBe(false);
    expect(declaresNoClinicalChange("<!-- write: No clinical logic change -->")).toBe(false);
    expect(declaresNoClinicalChange("- [ ] No clinical logic change.")).toBe(false);
    expect(declaresNoClinicalChange("1. [ ] No clinical logic change")).toBe(false);
    expect(declaresNoClinicalChange("<!-- unclosed comment\nNo clinical logic change")).toBe(false);
    expect(declaresNoClinicalChange("Clinical logic changed: see the doc.")).toBe(false);
  });

  it("does not pass the unedited pull request template", () => {
    const template = readFileSync(TEMPLATE, "utf8");
    expect(template).toContain(OPT_OUT_PHRASE);
    expect(declaresNoClinicalChange(template)).toBe(false);
    const ticked = template.replace(/- \[ \] (No clinical logic change)/, "- [x] $1");
    expect(ticked).not.toBe(template);
    expect(declaresNoClinicalChange(ticked)).toBe(true);
  });
});

describe("evaluateGate", () => {
  it("passes when no clinical file changed", () => {
    const r = evaluateGate({ changedFiles: ["README.md", "src/components/Layout.tsx"] });
    expect(r).toMatchObject({ ok: true, reason: "no-clinical-files", matches: [] });
  });

  it("fails when a clinical file changed and nothing was recorded", () => {
    const r = evaluateGate({ changedFiles: ["src/utils/vitals.ts", "README.md"], prBody: "Tidy up." });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not-recorded");
    expect(r.matches.map((m: Match) => m.file)).toEqual(["src/utils/vitals.ts"]);
  });

  it("passes when the clinical logic record is updated in the same pull request", () => {
    const r = evaluateGate({ changedFiles: ["src/utils/vitals.ts", CLINICAL_DOC] });
    expect(r).toMatchObject({ ok: true, reason: "doc-updated", docChanged: true });
    expect(r.matches).toHaveLength(1);
  });

  it("passes when the author says there is no clinical logic change", () => {
    const r = evaluateGate({
      changedFiles: ["src/features/labs/labWorklist.ts"],
      prBody: "Rename only. No clinical logic change.",
    });
    expect(r).toMatchObject({ ok: true, reason: "declared-no-change", optedOut: true });
  });

  it("uses content rules for migrations, and skips them when the lines are not clinical", () => {
    const mig = "supabase/migrations/20270101000000_x.sql";
    const flagged = evaluateGate({
      changedFiles: [mig],
      contentByFile: { [mig]: ["ALTER TABLE public.lab_results ALTER COLUMN interpretation SET DEFAULT 'normal';"] },
    });
    expect(flagged.ok).toBe(false);
    expect(flagged.matches[0]).toMatchObject({ file: mig, term: "interpretation" });

    const clean = evaluateGate({
      changedFiles: [mig],
      contentByFile: { [mig]: ["CREATE INDEX idx ON public.sites(name);"] },
    });
    expect(clean.ok).toBe(true);
  });

  it("does not list a file twice when a path rule and a content rule both apply", () => {
    const f = "src/features/patient-portal/portalStatus.ts";
    const r = evaluateGate({ changedFiles: [f], contentByFile: { [f]: ["go to the nearest hospital"] } });
    expect(r.matches).toHaveLength(1);
    expect((r.matches[0] as Match).term).toBeUndefined();
  });

  it("fails when the clinical logic record is missing", () => {
    const r = evaluateGate({ changedFiles: ["README.md"], docExists: false });
    expect(r).toMatchObject({ ok: false, reason: "doc-missing" });
  });
});

describe("formatReport", () => {
  it("lists matched files and both ways to pass", () => {
    const text = formatReport(
      evaluateGate({ changedFiles: ["src/utils/vitals.ts", "src/features/pharmacy/fefo.ts"] }),
    );
    expect(text).toContain("FAILED");
    expect(text).toContain("src/utils/vitals.ts");
    expect(text).toContain("src/features/pharmacy/fefo.ts");
    expect(text).toContain(CLINICAL_DOC);
    expect(text).toContain(`"${OPT_OUT_PHRASE}"`);
  });

  it("names the matched term for content rules", () => {
    const mig = "supabase/migrations/1.sql";
    const text = formatReport(
      evaluateGate({ changedFiles: [mig], contentByFile: { [mig]: ["triage_level text"] } }),
    );
    expect(text).toContain('mentions "triage"');
  });

  it("reports a pass in one line when nothing clinical changed", () => {
    expect(formatReport(evaluateGate({ changedFiles: ["README.md"] }))).toMatch(/^Clinical logic gate: passed\./);
  });
});

describe("parseArgs", () => {
  it("reads flags, positional files and the environment fallback", () => {
    expect(parseArgs(["--base", "a1", "--head", "b2"])).toMatchObject({ base: "a1", head: "b2", files: [] });
    expect(parseArgs(["--base=a1", "--head=b2"])).toMatchObject({ base: "a1", head: "b2" });
    expect(parseArgs([], { BASE_SHA: "x", HEAD_SHA: "y" })).toMatchObject({ base: "x", head: "y" });
    expect(parseArgs(["src/a.ts", "src/b.ts"]).files).toEqual(["src/a.ts", "src/b.ts"]);
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});

describe("run", () => {
  const capture = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, sinks: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
  };

  it("fails for a clinical file without a record, with a CI annotation", () => {
    const c = capture();
    const code = run({
      argv: ["src/utils/vitals.ts"],
      env: { PR_BODY: "", GITHUB_ACTIONS: "true" },
      cwd: ROOT,
      ...c.sinks,
    });
    expect(code).toBe(1);
    expect(c.err.join("\n")).toContain("src/utils/vitals.ts");
    expect(c.out.join("\n")).toContain("::error title=Clinical logic gate::");
  });

  it("passes with the phrase in the description", () => {
    const c = capture();
    const code = run({
      argv: ["src/utils/vitals.ts"],
      env: { PR_BODY: "No clinical logic change" },
      cwd: ROOT,
      ...c.sinks,
    });
    expect(code).toBe(0);
    expect(c.out.join("\n")).toContain("passed");
  });

  it("returns 2 without files or a base and head", () => {
    const c = capture();
    expect(run({ argv: [], env: {}, cwd: ROOT, ...c.sinks })).toBe(2);
    expect(c.err.join("\n")).toContain("Usage");
  });

  it("runs as a command", () => {
    const res = spawnSync(process.execPath, [SCRIPT, "README.md"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PR_BODY: "" },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Clinical logic gate: passed.");
  });
});
