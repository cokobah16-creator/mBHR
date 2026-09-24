import { describe, it, expect } from "vitest";
import { canResolveOnDevice, deviceConflictSensitivity } from "./deviceResolution";

const vitals = { entityType: "vitals", conflicts: [{ field: "systolic" }, { field: "pulseBpm" }] };
const patientName = { entityType: "patients", conflicts: [{ field: "givenName" }] };
const consultNote = { entityType: "consultations", conflicts: [{ field: "soapPlan" }] };
const stock = { entityType: "inventory", conflicts: [{ field: "onHandQty" }] };

describe("canResolveOnDevice", () => {
  it("lets clinical staff settle low-sensitivity conflicts on the device", () => {
    expect(deviceConflictSensitivity(vitals)).toBe("low");
    expect(canResolveOnDevice("nurse", vitals)).toBe(true);
    expect(canResolveOnDevice("doctor", vitals)).toBe(true);
  });

  it("sends high-PHI conflicts to the review queue, even for admins", () => {
    // The queue requires a lead clinician (patients) or admin approval.
    expect(canResolveOnDevice("admin", patientName)).toBe(false);
    expect(canResolveOnDevice("lead_clinician", patientName)).toBe(false);
    expect(canResolveOnDevice("admin", consultNote)).toBe(false);
  });

  it("needs the record's own write permission for stock", () => {
    expect(canResolveOnDevice("nurse", stock)).toBe(false);
    expect(canResolveOnDevice("admin", stock)).toBe(true);
  });

  it("refuses roles without resolve_conflicts and signed-out users", () => {
    expect(canResolveOnDevice("volunteer", vitals)).toBe(false);
    expect(canResolveOnDevice("pharmacist", vitals)).toBe(false);
    expect(canResolveOnDevice(null, vitals)).toBe(false);
  });
});
