import { describe, it, expect } from "vitest";
import {
  can,
  getRoleDisplayName,
  portalInviteRefusal,
  rolePermissionMatrix,
  rolesWithPermission,
  type Role,
} from "./roles";

const sorted = (values: Iterable<string>) => [...values].sort();

describe("registration_lead", () => {
  const { roles } = rolePermissionMatrix();

  it("holds register, queue, portal_manage and portal_invite only", () => {
    expect(sorted(roles.registration_lead)).toEqual([
      "portal_invite",
      "portal_manage",
      "queue",
      "register",
    ]);
  });

  it("has no vitals (owner decision: registration, not clinical)", () => {
    expect(can("registration_lead", "vitals")).toBe(false);
    // Volunteers keep vitals; the lead is the volunteer set minus vitals
    // plus portal_invite.
    expect(can("volunteer", "vitals")).toBe(true);
    expect(sorted(roles.registration_lead)).toEqual(
      sorted([
        ...roles.volunteer.filter((p) => p !== "vitals"),
        "portal_invite",
      ]),
    );
  });

  it("holds no clinical, pharmacy, export or admin permission", () => {
    for (const permission of [
      "vitals",
      "consult",
      "dispense",
      "inventory",
      "export",
      "users",
      "approve_phi_conflicts",
      "audit_access",
      "resolve_conflicts",
      "lab_review",
      "merge_patients",
      "lab_release",
    ] as const) {
      expect(can("registration_lead", permission)).toBe(false);
    }
  });

  it("is shown as \"Registration lead\"", () => {
    expect(getRoleDisplayName("registration_lead")).toBe("Registration lead");
  });
});

describe("portal_invite", () => {
  it("is held by registration_lead, lead_clinician and admin only", () => {
    expect(sorted(rolesWithPermission("portal_invite"))).toEqual([
      "admin",
      "lead_clinician",
      "registration_lead",
    ]);
    for (const role of [
      "volunteer",
      "nurse",
      "doctor",
      "pharmacist",
      "auditor",
      "guest",
    ] as Role[]) {
      expect(can(role, "portal_invite")).toBe(false);
    }
  });

  it("is separate from portal_manage: volunteers enable access but do not invite", () => {
    expect(can("volunteer", "portal_manage")).toBe(true);
    expect(can("volunteer", "portal_invite")).toBe(false);
    // Every inviter can also manage access.
    for (const role of rolesWithPermission("portal_invite")) {
      expect(can(role, "portal_manage")).toBe(true);
    }
  });

  it("has a plain refusal that names the roles that can invite", () => {
    expect(portalInviteRefusal()).toBe(
      "Your role cannot send portal invitations. Roles that can: Admin, Lead Clinician, Registration lead.",
    );
  });
});

describe("confirmed role policy", () => {
  it("queue includes pharmacist", () => {
    expect(sorted(rolesWithPermission("queue"))).toEqual([
      "admin",
      "doctor",
      "lead_clinician",
      "nurse",
      "pharmacist",
      "registration_lead",
      "volunteer",
    ]);
  });

  it("merge_patients includes auditor and excludes volunteer", () => {
    expect(can("auditor", "merge_patients")).toBe(true);
    expect(can("volunteer", "merge_patients")).toBe(false);
    expect(can("registration_lead", "merge_patients")).toBe(false);
  });

  it("lab_release is held by the lab_review holders: doctor, lead_clinician, admin", () => {
    expect(sorted(rolesWithPermission("lab_release"))).toEqual(
      sorted(rolesWithPermission("lab_review")),
    );
    expect(sorted(rolesWithPermission("lab_review"))).toEqual([
      "admin",
      "doctor",
      "lead_clinician",
    ]);
  });

  it("guest holds nothing", () => {
    expect(rolePermissionMatrix().roles.guest).toEqual([]);
  });
});
