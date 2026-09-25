import { describe, it, expect } from "vitest";
import { isStaffRole, rolePermissionMatrix } from "./roles";
import {
  KNOWN_STAFF_ROLES,
  PROVISIONABLE_ROLES,
  STAFF_ADMIN_ROLES,
} from "../../supabase/functions/_shared/staff/constants";

/*
 * The staff-admin edge function keeps its own copy of the app's staff roles
 * (supabase/functions/_shared/staff/constants.ts), because Deno cannot
 * import src/auth/roles.ts. The copy must match ROLE_PERMISSIONS, or the
 * function would treat a real staff member as having no role (or the
 * reverse). constants.ts has no imports, so it can be imported here the same
 * way src/services/fhir/types.ts imports the shared FHIR types.
 */

const sorted = (values: Iterable<string>) => [...values].sort();

describe("staff roles: app and staff-admin function agree", () => {
  const appRoles = Object.keys(rolePermissionMatrix().roles);

  it("KNOWN_STAFF_ROLES is every app role other than guest", () => {
    expect(sorted(KNOWN_STAFF_ROLES)).toEqual(
      sorted(appRoles.filter((role) => role !== "guest")),
    );
  });

  it("every known staff role is a staff role in the app", () => {
    for (const role of KNOWN_STAFF_ROLES) {
      expect(isStaffRole(role)).toBe(true);
    }
    expect(KNOWN_STAFF_ROLES).not.toContain("guest");
  });

  it("lists each role once", () => {
    expect(new Set(KNOWN_STAFF_ROLES).size).toBe(KNOWN_STAFF_ROLES.length);
    expect(new Set(PROVISIONABLE_ROLES).size).toBe(PROVISIONABLE_ROLES.length);
  });

  it("PROVISIONABLE_ROLES are all known staff roles", () => {
    for (const role of PROVISIONABLE_ROLES) {
      expect(KNOWN_STAFF_ROLES).toContain(role);
    }
    expect(PROVISIONABLE_ROLES).not.toContain("guest");
  });

  it("only administrators may call the function", () => {
    expect([...STAFF_ADMIN_ROLES]).toEqual(["admin"]);
    expect(KNOWN_STAFF_ROLES).toContain("admin");
  });
});
