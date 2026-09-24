import { describe, it, expect } from "vitest";
import { rolePermissionMatrix } from "./roles";

/*
 * The role -> permission matrix lives twice: ROLE_PERMISSIONS in
 * src/auth/roles.ts (the app) and public.app_role_has_permission() in the
 * database (every row-level security rule). They must match, or the app
 * offers actions the server refuses (or the reverse). This test reads the
 * newest migration that defines the function and compares the two.
 */

// Source text of every migration, keyed "/supabase/migrations/<file>.sql".
// Vite resolves this at transform time, so the test needs no Node APIs.
const MIGRATIONS = import.meta.glob("/supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const DEFINITION = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.app_role_has_permission\s*\(/i;

/** The latest migration (by file name, i.e. timestamp) that defines the function. */
function latestDefinition(): { file: string; sql: string } {
  const files = Object.keys(MIGRATIONS)
    .filter((file) => DEFINITION.test(MIGRATIONS[file]))
    .sort();
  const file = files[files.length - 1];
  return { file, sql: file ? MIGRATIONS[file] : "" };
}

/** Role -> granted permissions, parsed from the function's CASE expression. */
function parseMatrix(sql: string): Map<string, Set<string>> {
  const start = sql.search(DEFINITION);
  const bodyStart = sql.indexOf("$$", start);
  const bodyEnd = sql.indexOf("$$", bodyStart + 2);
  const body = sql.slice(bodyStart + 2, bodyEnd).replace(/--[^\n]*/g, "");
  const matrix = new Map<string, Set<string>>();
  const branch =
    /WHEN\s+'([a-z_]+)'\s+THEN\s+p_permission\s*=\s*ANY\s*\(\s*ARRAY\s*\[([^\]]*)\]\s*\)/gi;
  for (const match of body.matchAll(branch)) {
    const permissions = [...match[2].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    matrix.set(match[1], new Set(permissions));
  }
  return matrix;
}

const sorted = (values: Iterable<string>) => [...values].sort();

describe("role permission matrix: app and database agree", () => {
  const { file, sql } = latestDefinition();
  const server = parseMatrix(sql);
  const { roles, all } = rolePermissionMatrix();

  it("finds the database definition", () => {
    expect(file).toMatch(/\.sql$/);
    expect(server.size).toBeGreaterThan(0);
  });

  for (const role of Object.keys(roles) as (keyof typeof roles)[]) {
    it(`grants ${role} the same permissions`, () => {
      // A role with no branch in the CASE falls to ELSE false: no permissions.
      expect(sorted(server.get(role) ?? [])).toEqual(sorted(roles[role]));
    });
  }

  it("has no database role the app does not know", () => {
    const appRoles = new Set(Object.keys(roles));
    expect(sorted(server.keys()).filter((role) => !appRoles.has(role))).toEqual([]);
  });

  it("uses no permission name the app does not know", () => {
    const known = new Set<string>(all);
    const unknown = new Set<string>();
    for (const permissions of server.values()) {
      for (const permission of permissions) {
        if (!known.has(permission)) unknown.add(permission);
      }
    }
    expect(sorted(unknown)).toEqual([]);
  });
});
