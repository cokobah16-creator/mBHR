import { describe, it, expect } from "vitest";
import type { Role } from "@/auth/roles";
import {
  ADMIN_SECTIONS,
  adminSectionsForRole,
  canOpenAdminEntry,
  hasAnyAdminEntry,
  canManagePortalEnrollment,
  canUseSystemTools,
  type AdminSection,
} from "./adminSections";

function ids(role: Role | null | undefined): string[] {
  return adminSectionsForRole(role).flatMap((s) => s.entries.map((e) => e.id));
}

function findEntry(id: string) {
  const entry = ADMIN_SECTIONS.flatMap((s) => s.entries).find(
    (e) => e.id === id,
  );
  if (!entry) throw new Error(`missing entry ${id}`);
  return entry;
}

describe("admin sections", () => {
  it("has the five sections in order", () => {
    expect(ADMIN_SECTIONS.map((s) => s.id)).toEqual([
      "outreach",
      "access",
      "data",
      "interop",
      "system",
    ]);
  });

  it("uses unique ids and in-app paths", () => {
    const all = ADMIN_SECTIONS.flatMap((s) => s.entries);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    for (const e of all) {
      expect(e.to.startsWith("/")).toBe(true);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
    }
  });
});

describe("adminSectionsForRole", () => {
  it("shows an admin every entry", () => {
    const all = ADMIN_SECTIONS.flatMap((s) => s.entries.map((e) => e.id));
    expect(ids("admin")).toEqual(all);
    expect(adminSectionsForRole("admin")).toHaveLength(5);
  });

  it("shows no entries when nobody is signed in", () => {
    expect(ids(null)).toEqual([]);
    expect(ids(undefined)).toEqual([]);
    expect(hasAnyAdminEntry(null)).toBe(false);
  });

  it("mirrors the App.tsx guards for a nurse", () => {
    expect(ids("nurse")).toEqual(["outreach-reports", "conflicts"]);
  });

  it("mirrors the App.tsx guards for a doctor", () => {
    expect(ids("doctor")).toEqual(["outreach-reports", "conflicts"]);
  });

  it("mirrors the App.tsx guards for a pharmacist", () => {
    expect(ids("pharmacist")).toEqual(["pharmacy-reports"]);
    expect(adminSectionsForRole("pharmacist").map((s) => s.id)).toEqual([
      "outreach",
    ]);
  });

  it("gives volunteers and guests nothing", () => {
    expect(ids("volunteer")).toEqual([]);
    expect(ids("guest")).toEqual([]);
    expect(hasAnyAdminEntry("volunteer")).toBe(false);
  });

  it("follows the RBAC matrix for permission-based entries", () => {
    // auditor and lead_clinician hold the export permission but not users;
    // both approve sync conflicts, so the conflicts route admits them too.
    expect(ids("auditor")).toEqual(["conflicts", "fhir-export"]);
    expect(ids("lead_clinician")).toEqual(["conflicts", "fhir-export"]);
  });

  it("drops sections whose entries are all hidden", () => {
    const sections: AdminSection[] = [
      {
        id: "system",
        title: "System",
        description: "d",
        entries: [
          {
            id: "only-admin",
            title: "t",
            description: "d",
            to: "/x",
            access: { kind: "roles", roles: ["admin"] },
          },
        ],
      },
    ];
    expect(adminSectionsForRole("nurse", sections)).toEqual([]);
    expect(adminSectionsForRole("admin", sections)).toHaveLength(1);
  });

  it("does not mutate the source sections", () => {
    const before = ADMIN_SECTIONS.map((s) => s.entries.length);
    adminSectionsForRole("nurse");
    expect(ADMIN_SECTIONS.map((s) => s.entries.length)).toEqual(before);
  });
});

describe("canOpenAdminEntry", () => {
  it("uses the users permission for staff accounts", () => {
    const users = findEntry("users");
    expect(canOpenAdminEntry("admin", users)).toBe(true);
    expect(canOpenAdminEntry("doctor", users)).toBe(false);
  });

  it("uses role lists for guarded routes", () => {
    const conflicts = findEntry("conflicts");
    expect(canOpenAdminEntry("nurse", conflicts)).toBe(true);
    expect(canOpenAdminEntry("pharmacist", conflicts)).toBe(false);
  });
});

describe("action-level rules", () => {
  it("limits portal enrollment and system tools to admins", () => {
    expect(canManagePortalEnrollment("admin")).toBe(true);
    expect(canManagePortalEnrollment("doctor")).toBe(false);
    expect(canManagePortalEnrollment(null)).toBe(false);
    expect(canUseSystemTools("admin")).toBe(true);
    expect(canUseSystemTools("nurse")).toBe(false);
  });
});
