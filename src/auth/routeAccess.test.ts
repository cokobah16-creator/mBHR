import { describe, it, expect } from "vitest";
import { can, rolePermissionMatrix, type Role } from "./roles";
import {
  INVENTORY_ROLES,
  PATIENT_RECORD_ROLES,
  QUEUE_ROLES,
  roleIn,
} from "./routeAccess";

const ALL_ROLES = Object.keys(rolePermissionMatrix().roles) as Role[];

describe("who may open patient records, the queue and stock", () => {
  it("patient records are for staff who see patients at a station", () => {
    for (const role of ALL_ROLES) {
      const station =
        can(role, "register") || can(role, "vitals") || can(role, "consult") || can(role, "dispense");
      expect(roleIn(role, PATIENT_RECORD_ROLES)).toBe(station);
    }
    expect(PATIENT_RECORD_ROLES).toEqual(
      expect.arrayContaining(["volunteer", "nurse", "doctor", "pharmacist", "admin", "registration_lead"]),
    );
  });

  it("the queue is for holders of the queue permission", () => {
    for (const role of ALL_ROLES) {
      expect(roleIn(role, QUEUE_ROLES)).toBe(can(role, "queue"));
    }
  });

  it("stock is for station staff and stock managers", () => {
    for (const role of ALL_ROLES) {
      expect(roleIn(role, INVENTORY_ROLES)).toBe(
        roleIn(role, PATIENT_RECORD_ROLES) || can(role, "inventory"),
      );
    }
  });

  it("gives no access without a staff role", () => {
    for (const roles of [PATIENT_RECORD_ROLES, QUEUE_ROLES, INVENTORY_ROLES]) {
      expect(roleIn("guest", roles)).toBe(false);
      expect(roleIn(undefined, roles)).toBe(false);
      expect(roleIn(null, roles)).toBe(false);
    }
  });
});
