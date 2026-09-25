#!/usr/bin/env node
// Clinical logic gate.
//
// A pull request that changes clinical logic must record the change in
// docs/clinical/CLINICAL_LOGIC_CHANGES.md, or say "No clinical logic change"
// in its description. This script lists the changed files that hold clinical
// logic and fails when neither is true. How the gate works and what to do
// when it fails: docs/clinical/CLINICAL_LOGIC_CHANGES.md, section 1.
//
// Usage
//   node scripts/check-clinical-logic-change.mjs --base <sha> --head <sha>
//   node scripts/check-clinical-logic-change.mjs <changed file> [...]
//
// With --base/--head (or BASE_SHA/HEAD_SHA) the changed files come from
// `git diff --name-only --no-renames <base>...<head>`, and content rules read
// only the changed lines. With file names, content rules read the whole file.
// The pull request description is read from the PR_BODY environment variable.
//
// Exit codes: 0 pass, 1 clinical logic changed but not recorded,
// 2 usage or git error.
//
// Plain Node, no dependencies. The exported functions are pure and are unit
// tested in scripts/check-clinical-logic-change.test.ts. The script prints
// file names and the matched rule only, never file contents.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CLINICAL_DOC = "docs/clinical/CLINICAL_LOGIC_CHANGES.md";
export const OPT_OUT_PHRASE = "No clinical logic change";

/**
 * Files where clinical rules live. Found by searching the code for triage,
 * vitals ranges and flags, lab interpretation, allergy, interaction, dosing,
 * expiry (FEFO), decision support and patient-facing advice. Keep this list
 * current: add new clinical files in the same pull request that creates
 * them. The unit test fails when a listed file no longer exists.
 */
export const CLINICAL_PATH_RULES = [
  {
    area: "Triage and queue priority",
    paths: [
      "src/features/triage/**",
      "src/features/tickets/TicketIssuer.tsx",
      "src/services/queuePriority.ts",
      "src/services/queueManagement.ts",
      "src/services/predictiveQueue.ts",
      "src/sync/queueSync.ts",
    ],
  },
  {
    area: "Vitals ranges, flags and categories",
    paths: [
      "src/utils/vitals.ts",
      "src/db/seedVitalsRanges.ts",
      "src/db/migrations/*vitals*",
      "src/validation/schemas.ts",
      "src/components/VitalsForm.tsx",
      "src/components/EnhancedVitalsInput.tsx",
      "src/components/SmartVitalsInput.tsx",
      "src/components/patient/ClinicalSummaryPanel.tsx",
      "src/components/patient/PatientContextHeader.tsx",
    ],
  },
  {
    area: "Lab results: interpretation, review, release and worklist order",
    paths: [
      "src/features/labs/**",
      "src/services/labs.ts",
      "src/services/portalLabResults.ts",
    ],
  },
  {
    area: "Medication: prescribing, dispensing, allergies, interactions, expiry (FEFO) and reminders",
    paths: [
      "src/utils/allergyMatch.ts",
      "src/utils/allergyActive.ts",
      "src/services/allergies.ts",
      "src/components/AllergyWarning.tsx",
      "src/components/AllergyManager.tsx",
      "src/components/DispenseForm.tsx",
      // A glob, not the file name: the file may be removed, and a pull
      // request that removes it still changes interaction logic.
      "src/services/smartMedication*.ts",
      "src/features/pharmacy/fefo.ts",
      "src/features/pharmacy/Dispense.tsx",
      "src/features/pharmacy/RxForm.tsx",
      "src/features/pharmacy/visitConsultation.ts",
      "src/services/pharmacyCommands.ts",
      "src/services/pharmacyCommandsModel.ts",
      "src/services/sms.ts",
      "src/services/messageTemplates.ts",
    ],
  },
  {
    area: "Clinical alerts and decision support",
    paths: [
      "src/services/clinicalDecisionSupport.ts",
      "src/features/clinical/**",
      "src/components/SmartSOAPInput.tsx",
    ],
  },
  {
    area: "Patient-facing medical advice (patient portal)",
    paths: [
      "src/features/patient-portal/portalStatus.ts",
      "src/features/patient-portal/EmergencyHelp.tsx",
      "src/features/patient-portal/PatientDashboard.tsx",
      "src/features/patient-portal/LabResults.tsx",
      "src/features/patient-portal/PrescriptionRefills.tsx",
    ],
  },
  {
    area: "Training content that teaches clinical practice",
    paths: [
      "src/features/gamification/KnowledgeBlitz.tsx",
      "src/features/gamification/VitalsPrecision*.tsx",
      "src/features/gamification/QueueMaestro.tsx",
      "src/features/vitals/**",
    ],
  },
  {
    // Editing this list can switch the gate off for a file, so a change to
    // the gate itself must be recorded or declared like any other.
    area: "The clinical logic gate itself (the list of clinical files)",
    paths: ["scripts/check-clinical-logic-change.mjs"],
  },
];

/**
 * Files that hold clinical rules alongside other things. They count only
 * when a changed line matches the pattern (new migration files: every line).
 */
export const CLINICAL_CONTENT_RULES = [
  {
    area: "Server-side clinical rules (database migration)",
    paths: ["supabase/migrations/**/*.sql"],
    // "_" counts as a word break, so lab_results.interpretation and
    // app_queue_priority_rank match too.
    pattern:
      /(?<![a-z0-9])(interpretations?|lab[ _](?:review|release|withhold)[a-z_]*|reference[ _]ranges?|vitals?[ _]ranges?|thresholds?|triage|priority|priorities|downgrade[a-z_]*|expiry[ _]date|fefo|rx[ _]dispense|allerg[a-z]*|contraindicat[a-z]*|interactions?|dos(?:e|es|age|ing)|insulin|spo2|systolic|diastolic|bmi)(?![a-z0-9])/i,
  },
  {
    area: "Patient-facing advice and clinical labels (translations)",
    paths: ["src/i18n/locales/*.json"],
    pattern:
      /"(portal\.vital\.[\w.]+|portal\.home\.notEmergency|portal\.emergency\.[\w.]+|vitals\.(?:normal|abnormal|high|low)|triage\.[\w.]+|medical\.[\w.]+|pharmacy\.(?:dosage|directions|withFood|beforeFood|asNeeded|expiry\.[\w.]+))"\s*:/,
  },
  {
    area: "Who may make clinical decisions (role permissions)",
    paths: ["src/auth/roles.ts", "src/utils/permissions.ts"],
    // A clinical permission being granted or changed (consult: lower triage
    // priority, acknowledge alerts, prescribe; lab_review; lab_release).
    // "consult: false" on a new role does not count.
    pattern:
      /(?<![a-z0-9_])(consult|lab_review|lab_release|prescribe)(?![a-z0-9_])["']?\s*:\s*(?!\s|false\b)/,
  },
  {
    area: "Patient-facing medical advice (patient portal copy)",
    paths: ["src/features/patient-portal/**/*.{ts,tsx}"],
    pattern:
      /(?<![a-z0-9])(hospital|emergency|unwell|symptoms?|side effects?|prompt attention|seek (?:medical )?(?:help|care|advice)|(?:take|stop|skip) (?:it|this|your|the) (?:medicine|medication|tablets?|dose)|dos(?:e|es|age|ing)|diagnos[a-z]*|usual range|normal range)(?![a-z0-9])/i,
  },
];

/** Tests do not change clinical behaviour; they never trigger the gate. */
export const IGNORED_PATHS = [
  "**/*.test.*",
  "**/*.spec.*",
  "src/test/**",
  "e2e/**",
];

function escapeRegExp(text) {
  return text.replace(/[.+^${}()|[\]\\*?]/g, "\\$&");
}

/**
 * Glob to RegExp. Supports `**` (any number of folders), `*` (within one
 * folder), `?` (one character) and `{a,b}` (literal alternatives).
 */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        re += escapeRegExp(c);
      } else {
        const options = glob.slice(i + 1, end).split(",").map(escapeRegExp);
        re += `(?:${options.join("|")})`;
        i = end;
      }
    } else {
      re += escapeRegExp(c);
    }
  }
  return new RegExp(`^${re}$`);
}

const globCache = new Map();
export function matchesGlob(path, glob) {
  let re = globCache.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    globCache.set(glob, re);
  }
  return re.test(path);
}

export function matchesAny(path, globs) {
  return globs.some((g) => matchesGlob(path, g));
}

/** Repo-relative, forward slashes, no leading "./". */
export function normalisePath(path) {
  return String(path ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "");
}

export function isIgnored(path) {
  return matchesAny(normalisePath(path), IGNORED_PATHS);
}

/** Changed files that are on the clinical-logic list: [{ file, area }]. */
export function matchClinicalPaths(files, rules = CLINICAL_PATH_RULES) {
  const out = [];
  const seen = new Set();
  for (const raw of files) {
    const file = normalisePath(raw);
    if (!file || seen.has(file) || isIgnored(file)) continue;
    seen.add(file);
    const rule = rules.find((r) => matchesAny(file, r.paths));
    if (rule) out.push({ file, area: rule.area });
  }
  return out;
}

/** Changed files that a content rule may apply to (content not read yet). */
export function contentRuleCandidates(files, rules = CLINICAL_CONTENT_RULES) {
  return [
    ...new Set(
      files
        .map(normalisePath)
        .filter((f) => f && !isIgnored(f) && rules.some((r) => matchesAny(f, r.paths))),
    ),
  ];
}

/**
 * Added and removed lines of a unified diff (without the leading + or -).
 * File headers (---, +++) are skipped; only lines inside hunks count.
 */
export function changedLinesFromDiff(diff) {
  const lines = [];
  let inHunk = false;
  for (const line of String(diff ?? "").split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
    } else if (line.startsWith("@@")) {
      inHunk = true;
    } else if (inHunk && (line.startsWith("+") || line.startsWith("-"))) {
      lines.push(line.slice(1));
    }
  }
  return lines;
}

/**
 * First content rule the text matches for this file:
 * { file, area, term } or null. `text` is the changed lines (or, without a
 * diff, the whole file).
 */
export function matchClinicalContent(file, text, rules = CLINICAL_CONTENT_RULES) {
  const path = normalisePath(file);
  if (!path || isIgnored(path)) return null;
  const body = Array.isArray(text) ? text.join("\n") : String(text ?? "");
  for (const rule of rules) {
    if (!matchesAny(path, rule.paths)) continue;
    const m = rule.pattern.exec(body);
    if (m) return { file: path, area: rule.area, term: (m[1] ?? m[0]).trim() };
  }
  return null;
}

/**
 * True when the author wrote "No clinical logic change" in the description.
 * Text in HTML comments (template instructions) and in unticked checkboxes
 * does not count, so the unedited pull request template never passes.
 * Case and spacing do not matter.
 */
export function declaresNoClinicalChange(body) {
  if (!body) return false;
  const text = String(body)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:[-*+]|\d+[.)])\s+\[ \]/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  return text.includes(OPT_OUT_PHRASE.toLowerCase());
}

/**
 * The gate's decision.
 * @param {object} input
 * @param {string[]} input.changedFiles  repo-relative paths
 * @param {string} [input.prBody]
 * @param {Record<string, string|string[]>} [input.contentByFile]
 *   changed lines (or whole file) for content-rule candidates
 * @param {boolean} [input.docExists]  false when CLINICAL_DOC is missing
 */
export function evaluateGate({ changedFiles, prBody = "", contentByFile = {}, docExists = true }) {
  const files = [...new Set((changedFiles ?? []).map(normalisePath).filter(Boolean))];
  const matches = matchClinicalPaths(files);
  const byPath = new Set(matches.map((m) => m.file));
  for (const file of contentRuleCandidates(files)) {
    if (byPath.has(file)) continue;
    const hit = matchClinicalContent(file, contentByFile[file]);
    if (hit) matches.push(hit);
  }
  const docChanged = files.includes(CLINICAL_DOC);
  const optedOut = declaresNoClinicalChange(prBody);

  let reason;
  if (!docExists) reason = "doc-missing";
  else if (matches.length === 0) reason = "no-clinical-files";
  else if (docChanged) reason = "doc-updated";
  else if (optedOut) reason = "declared-no-change";
  else reason = "not-recorded";

  return {
    ok: reason !== "doc-missing" && reason !== "not-recorded",
    reason,
    matches,
    docChanged,
    optedOut,
  };
}

function listMatches(matches) {
  return matches
    .map((m) => `  - ${m.file}\n      ${m.area}${m.term ? ` (mentions "${m.term}")` : ""}`)
    .join("\n");
}

/** Plain-English report for the CI log. */
export function formatReport(result) {
  const { reason, matches } = result;
  const lines = [];
  if (reason === "doc-missing") {
    lines.push(
      "Clinical logic gate: FAILED",
      "",
      `${CLINICAL_DOC} is missing. It is the record of clinical logic changes and`,
      "the blocking checklist for clinical review. Restore it.",
    );
    return lines.join("\n");
  }
  if (reason === "no-clinical-files") {
    return "Clinical logic gate: passed. No file on the clinical-logic list was changed.";
  }
  if (reason === "doc-updated") {
    lines.push(
      `Clinical logic gate: passed. ${CLINICAL_DOC} is updated in this pull request.`,
      "",
      "Files with clinical logic changed here:",
      listMatches(matches),
      "",
      "Reviewers: check that each change above has a change-log row, and an",
      "unticked checklist item where a clinician must decide. Production use",
      "still needs a qualified clinician's sign-off.",
    );
    return lines.join("\n");
  }
  if (reason === "declared-no-change") {
    lines.push(
      `Clinical logic gate: passed. The description says "${OPT_OUT_PHRASE}".`,
      "",
      "Files on the clinical-logic list changed here:",
      listMatches(matches),
      "",
      "Reviewers: confirm that these changes do not alter clinical behaviour.",
    );
    return lines.join("\n");
  }
  lines.push(
    "Clinical logic gate: FAILED",
    "",
    "This pull request changes files that hold clinical logic:",
    listMatches(matches),
    "",
    "Do one of these:",
    `  1. Record the change in ${CLINICAL_DOC}: add a row to the`,
    "     change log and, for anything a clinician must review, an unticked",
    "     item in the blocking checklist.",
    "  2. If clinical behaviour does not change (for example a rename, layout",
    "     or a refactor with the same results), write",
    `     "${OPT_OUT_PHRASE}" in the pull request description`,
    "     (outside comments; tick the box if you use the template), then",
    "     re-run this check.",
    "",
    `How the gate works: ${CLINICAL_DOC}, section 1.`,
  );
  return lines.join("\n");
}

/** Command-line arguments; BASE_SHA and HEAD_SHA are used when flags are absent. */
export function parseArgs(argv, env = {}) {
  const out = { base: env.BASE_SHA || "", head: env.HEAD_SHA || "", files: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") out.base = argv[++i] ?? "";
    else if (a === "--head") out.head = argv[++i] ?? "";
    else if (a.startsWith("--base=")) out.base = a.slice("--base=".length);
    else if (a.startsWith("--head=")) out.head = a.slice("--head=".length);
    else if (a === "-h" || a === "--help") out.help = true;
    else out.files.push(a);
  }
  return out;
}

const USAGE = [
  "Usage:",
  "  node scripts/check-clinical-logic-change.mjs --base <sha> --head <sha>",
  "  node scripts/check-clinical-logic-change.mjs <changed file> [...]",
  "The pull request description is read from PR_BODY.",
].join("\n");

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Runs the gate and returns the exit code. `out` and `err` receive text.
 */
export function run({
  argv = [],
  env = {},
  cwd = REPO_ROOT,
  out = (s) => console.log(s),
  err = (s) => console.error(s),
} = {}) {
  const args = parseArgs(argv, env);
  if (args.help) {
    out(USAGE);
    return 0;
  }

  let changedFiles;
  const contentByFile = {};
  if (args.files.length > 0) {
    changedFiles = args.files.map(normalisePath).filter(Boolean);
    for (const file of contentRuleCandidates(changedFiles)) {
      const full = join(cwd, file);
      contentByFile[file] = existsSync(full) ? readFileSync(full, "utf8") : "";
    }
  } else if (args.base && args.head) {
    const range = `${args.base}...${args.head}`;
    try {
      changedFiles = git(["diff", "--name-only", "--no-renames", range], cwd)
        .split(/\r?\n/)
        .map(normalisePath)
        .filter(Boolean);
      for (const file of contentRuleCandidates(changedFiles)) {
        contentByFile[file] = changedLinesFromDiff(
          git(["diff", "--no-renames", "--unified=0", range, "--", file], cwd),
        );
      }
    } catch (e) {
      const detail = e && e.stderr ? String(e.stderr).trim() : String(e?.message ?? e);
      err(
        `Clinical logic gate: could not list the files changed between ${args.base} and ${args.head}.\n` +
          `${detail}\n` +
          "The checkout needs the full history of both commits (fetch-depth: 0).",
      );
      return 2;
    }
  } else {
    err(USAGE);
    return 2;
  }

  const result = evaluateGate({
    changedFiles,
    prBody: env.PR_BODY ?? "",
    contentByFile,
    docExists: existsSync(join(cwd, CLINICAL_DOC)),
  });
  const report = formatReport(result);
  if (result.ok) {
    out(report);
    return 0;
  }
  err(report);
  if (env.GITHUB_ACTIONS === "true") {
    // Workflow commands are read from standard output.
    out(
      `::error title=Clinical logic gate::Clinical logic changed but not recorded. ` +
        `Update ${CLINICAL_DOC} or write "${OPT_OUT_PHRASE}" in the pull request description.`,
    );
  }
  return 1;
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = run({ argv: process.argv.slice(2), env: process.env });
}
