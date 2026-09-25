import { describe, it, expect } from "vitest";
import {
  approveDeniedMessage,
  canApproveDecision,
  canResolveConflict,
  decisionNeedsApproval,
  permissionForSensitivity,
  recordWritePermission,
  resolveDeniedMessage,
  roleCanApprove,
  rolesWhoCanResolve,
} from "./conflictPermissions";
import {
  conflictPriority,
  getFieldPHISensitivity,
  overallPHISensitivity,
} from "./sensitivity";

const lowVitals = { phiSensitivity: "low" as const, entityType: "vitals" };
const highPatient = { phiSensitivity: "high" as const, entityType: "patients" };

describe("canResolveConflict", () => {
  it("lets resolve_conflicts roles decide conflicts without high PHI", () => {
    expect(canResolveConflict("nurse", lowVitals)).toBe(true);
    expect(canResolveConflict("doctor", lowVitals)).toBe(true);
    expect(canResolveConflict("pharmacist", lowVitals)).toBe(false);
    expect(canResolveConflict("volunteer", lowVitals)).toBe(false);
  });

  it("needs approve_phi_conflicts for high-sensitivity conflicts", () => {
    expect(canResolveConflict("nurse", highPatient)).toBe(false);
    expect(canResolveConflict("doctor", highPatient)).toBe(false);
    expect(canResolveConflict("lead_clinician", highPatient)).toBe(true);
    expect(canResolveConflict("auditor", highPatient)).toBe(true);
    expect(canResolveConflict("admin", highPatient)).toBe(true);
  });

  it("also needs the record's write permission for stock and staff accounts", () => {
    expect(canResolveConflict("nurse", { phiSensitivity: "none", entityType: "inventory" })).toBe(false);
    expect(canResolveConflict("admin", { phiSensitivity: "none", entityType: "inventory" })).toBe(true);
    expect(canResolveConflict("lead_clinician", { phiSensitivity: "none", entityType: "app_users" })).toBe(false);
  });

  it("needs the same permission whichever name the record type uses", () => {
    for (const role of ["nurse", "doctor", "lead_clinician", "auditor"] as const) {
      expect(canResolveConflict(role, { phiSensitivity: "none", entityType: "users" })).toBe(false);
      expect(canResolveConflict(role, { phiSensitivity: "none", entityType: "app_users" })).toBe(false);
    }
    expect(canResolveConflict("admin", { phiSensitivity: "none", entityType: "users" })).toBe(true);
    expect(recordWritePermission("users")).toBe("users");
    expect(recordWritePermission("app_users")).toBe("users");
    expect(recordWritePermission("inventory")).toBe("inventory");
    expect(recordWritePermission("vitals")).toBeNull();
    expect(recordWritePermission("constructor")).toBeNull();
  });

  it("refuses when there is no signed-in role", () => {
    expect(canResolveConflict(undefined, lowVitals)).toBe(false);
    expect(canResolveConflict(null, lowVitals)).toBe(false);
  });

  it("maps sensitivity to the permission named in the RBAC matrix", () => {
    expect(permissionForSensitivity("high")).toBe("approve_phi_conflicts");
    expect(permissionForSensitivity("medium")).toBe("resolve_conflicts");
  });
});

describe("approval", () => {
  it("keeps the queue's approver hierarchy", () => {
    expect(roleCanApprove("admin", "lead_clinician")).toBe(true);
    expect(roleCanApprove("auditor", "lead_clinician")).toBe(true);
    expect(roleCanApprove("lead_clinician", "lead_clinician")).toBe(true);
    expect(roleCanApprove("lead_clinician", "admin")).toBe(false);
    expect(roleCanApprove("auditor", "auditor")).toBe(true);
    expect(roleCanApprove("lead_clinician", "auditor")).toBe(false);
    expect(roleCanApprove("nurse", null)).toBe(true);
  });

  it("requires both the permission and the hierarchy", () => {
    const c = { ...highPatient, requiredApproverRole: "lead_clinician" as const };
    expect(canApproveDecision("lead_clinician", c)).toBe(true);
    expect(canApproveDecision("doctor", c)).toBe(false);
    const adminOnly = { phiSensitivity: "high" as const, entityType: "consultations", requiredApproverRole: "admin" as const };
    expect(canApproveDecision("lead_clinician", adminOnly)).toBe(false);
    expect(canApproveDecision("admin", adminOnly)).toBe(true);
  });

  it("sends decisions for approval only when an approver is named and it is not a dismissal", () => {
    expect(decisionNeedsApproval({ requiredApproverRole: "admin" }, "keep_local")).toBe(true);
    expect(decisionNeedsApproval({ requiredApproverRole: "admin" }, "ignore")).toBe(false);
    expect(decisionNeedsApproval({ requiredApproverRole: null }, "keep_remote")).toBe(false);
    expect(decisionNeedsApproval({ requiredApproverRole: undefined }, "keep_remote")).toBe(false);
  });
});

describe("messages", () => {
  it("names the roles derived from the permission matrix", () => {
    expect(rolesWhoCanResolve(highPatient)).toEqual(["Admin", "Auditor", "Lead Clinician"]);
    expect(resolveDeniedMessage(highPatient)).toBe(
      "This conflict includes high-sensitivity patient details. Only Admin, Auditor or Lead Clinician can resolve it.",
    );
    expect(
      approveDeniedMessage({ ...highPatient, requiredApproverRole: "admin" }),
    ).toBe("Only Admin can approve this decision.");
  });
});

describe("sensitivity (unchanged rules moved from the conflict queue)", () => {
  it("classifies fields", () => {
    expect(getFieldPHISensitivity("givenName")).toBe("high");
    expect(getFieldPHISensitivity("lga")).toBe("medium");
    expect(getFieldPHISensitivity("systolic")).toBe("low");
    expect(getFieldPHISensitivity("status")).toBe("none");
  });

  it("takes the highest field sensitivity", () => {
    expect(overallPHISensitivity([{ phiSensitivity: "low" }, { phiSensitivity: "medium" }])).toBe("medium");
    expect(overallPHISensitivity([])).toBe("none");
  });

  it("derives priority", () => {
    expect(conflictPriority("sync_conflict", "high", "patients")).toBe("critical");
    expect(conflictPriority("sync_conflict", "high", "consultations")).toBe("high");
    expect(conflictPriority("duplicate", "none", "patients")).toBe("high");
    expect(conflictPriority("sync_conflict", "medium", "patients")).toBe("medium");
    expect(conflictPriority("sync_conflict", "low", "vitals")).toBe("low");
  });
});
