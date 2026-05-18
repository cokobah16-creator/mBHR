/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) continue;
      out.push(full);
    }
  }
  return out;
}

const SRC = join(process.cwd(), "src");

describe("src/ invariants", () => {
  it("never references SERVICE_ROLE — the service-role key must stay backend-only", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC)) {
      const content = readFileSync(file, "utf8");
      if (content.includes("SERVICE_ROLE")) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(
      offenders,
      `SERVICE_ROLE found in:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("does not import the dangerouslyDisableSandbox flag (paranoia check)", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC)) {
      const content = readFileSync(file, "utf8");
      if (content.includes("dangerouslyDisableSandbox")) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
