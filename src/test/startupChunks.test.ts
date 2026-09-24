import { describe, it, expect } from "vitest";

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

// Source text of every module under src, keyed "/src/...". Vite resolves
// this at transform time, so the test needs no Node APIs.
const SOURCES = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm;

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return "/" + out.join("/");
}

function resolve(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = "/src/" + spec.slice(2);
  else if (spec.startsWith(".")) base = normalize(from.slice(0, from.lastIndexOf("/")) + "/" + spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (SOURCES[base + ext] !== undefined) return base + ext;
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
  const stack: [string, string][] = [["/src/main.tsx", "(entry)"]];
  while (stack.length) {
    const [file, parent] = stack.pop()!;
    if (seen.has(file)) continue;
    seen.set(file, parent);
    for (const m of (SOURCES[file] ?? "").matchAll(IMPORT_RE)) {
      if (typeOnly(m[0])) continue;
      const target = resolve(m[1], file);
      if (target) stack.push([target, file]);
    }
  }
  return seen;
}

describe("startup bundle", () => {
  it("finds the app's startup modules", () => {
    // Guards the test itself: if the glob or resolver breaks, the check
    // below would pass vacuously.
    const modules = startupModules();
    expect(modules.has("/src/App.tsx")).toBe(true);
    expect(modules.has("/src/components/Layout.tsx")).toBe(true);
  });

  it("does not statically import modules that vite puts in manual chunks", () => {
    const offenders = [...startupModules()]
      .filter(([file]) => MANUAL_CHUNK_DIRS.some((dir) => file.includes(dir)))
      .map(([file, parent]) => `${file} (imported by ${parent})`);
    expect(offenders).toEqual([]);
  });
});
