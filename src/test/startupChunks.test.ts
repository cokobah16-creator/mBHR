import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

/*
 * vite.config.ts puts these app folders into their own chunks (manualChunks).
 * If a module loaded at startup (statically imported from src/main.tsx)
 * lives in one of them, the entry chunk and that chunk import each other and
 * the production build can fail at start-up with a TDZ ReferenceError.
 * Keep this list in step with manualChunks.
 */
const MANUAL_CHUNK_DIRS = [
  "/features/gamification/",
  "/features/analytics/",
  "/features/pharmacy/",
  "/features/patient-portal/",
  "/features/tickets/",
  "/features/labs/",
  "/features/triage/",
  "/features/vitals/",
  "/pages/admin/",
];

const SRC = join(process.cwd(), "src");
const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm;

function resolve(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p) && !p.endsWith("/")) {
      try {
        readFileSync(p);
        return p;
      } catch {
        // a directory: try the next candidate
      }
    }
  }
  return null;
}

function typeOnly(statement: string): boolean {
  if (/^\s*(import|export)\s+type\b/.test(statement)) return true;
  const named = statement.match(/\{([^}]*)\}/);
  if (!named || /^\s*import\s+\w/.test(statement)) return false;
  return named[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .every((s) => s.startsWith("type "));
}

function startupModules(): Map<string, string> {
  const seen = new Map<string, string>();
  const stack: [string, string][] = [[join(SRC, "main.tsx"), "(entry)"]];
  while (stack.length) {
    const [file, parent] = stack.pop()!;
    if (seen.has(file)) continue;
    seen.set(file, parent);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(IMPORT_RE)) {
      if (typeOnly(m[0])) continue;
      const target = resolve(m[1], file);
      if (target) stack.push([target, file]);
    }
  }
  return seen;
}

describe("startup bundle", () => {
  it("does not statically import modules that vite puts in manual chunks", () => {
    const offenders = [...startupModules()]
      .filter(([file]) => MANUAL_CHUNK_DIRS.some((dir) => file.includes(dir)))
      .map(([file, parent]) => `${file.replace(SRC, "src")} (imported by ${parent.replace(SRC, "src")})`);
    expect(offenders).toEqual([]);
  });
});
