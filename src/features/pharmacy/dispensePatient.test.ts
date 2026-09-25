import { describe, it, expect } from "vitest";
import type { Patient } from "@/db";
import { matchMedicationToAllergen } from "@/utils/allergyMatch";
import { dispensePatientBlock, resolveDispensePatient, sexAgeLabel } from "./dispensePatient";

function patient(id: string, extra: Partial<Patient> = {}): Patient {
  return {
    id,
    givenName: "Musa",
    familyName: "Ibrahim",
    sex: "male",
    dob: "1990-01-01",
    address: "",
    state: "",
    lga: "",
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
    ...extra,
  } as Patient;
}

function lookup(rows: Patient[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { get: (id: string) => Promise.resolve(byId.get(id)) };
}

describe("resolveDispensePatient", () => {
  it("returns the record itself when it was never merged", async () => {
    const r = await resolveDispensePatient(lookup([patient("p1")]), "p1");
    expect(r.ok).toBe(true);
    expect(r.chain).toEqual(["p1"]);
    if (r.ok) expect(r.patient.id).toBe("p1");
  });

  it("follows mergeInto to the kept record", async () => {
    const r = await resolveDispensePatient(
      lookup([patient("lost", { mergeInto: "mid" }), patient("mid", { mergeInto: "kept" }), patient("kept")]),
      "lost",
    );
    expect(r.ok).toBe(true);
    expect(r.chain).toEqual(["lost", "mid", "kept"]);
    if (r.ok) expect(r.patient.id).toBe("kept");
  });

  it("treats a null mergeInto as not merged", async () => {
    const row = patient("p1");
    (row as unknown as { mergeInto: null }).mergeInto = null;
    const r = await resolveDispensePatient(lookup([row]), "p1");
    expect(r.ok).toBe(true);
  });

  it("is blocked when the prescription's patient is not on this device", async () => {
    const r = await resolveDispensePatient(lookup([]), "ghost");
    expect(r).toEqual({ ok: false, reason: "not_found", chain: ["ghost"] });
    expect(dispensePatientBlock(r)).toMatch(/blocked/);
  });

  it("is blocked when the kept record is missing from this device", async () => {
    const r = await resolveDispensePatient(lookup([patient("lost", { mergeInto: "kept" })]), "lost");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("merge_unresolved");
    expect(dispensePatientBlock(r)).toMatch(/merged/);
  });

  it("is blocked when merges loop", async () => {
    const r = await resolveDispensePatient(
      lookup([patient("a", { mergeInto: "b" }), patient("b", { mergeInto: "a" })]),
      "a",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("merge_unresolved");
  });

  it("does not block a resolved patient, nor before resolution", async () => {
    const r = await resolveDispensePatient(lookup([patient("p1")]), "p1");
    expect(dispensePatientBlock(r)).toBeNull();
    expect(dispensePatientBlock(undefined)).toBeNull();
  });
});

describe("allergy check after a merge", () => {
  it("finds an allergy moved to the kept record for a prescription under the merged-away id", async () => {
    // The merge moved the allergy from "lost" to "kept"; the open
    // prescription still names "lost".
    const allergies = [{ patientId: "kept", allergen: "Penicillin" }];
    const r = await resolveDispensePatient(
      lookup([patient("lost", { mergeInto: "kept" }), patient("kept")]),
      "lost",
    );
    const onChain = allergies.filter((a) => r.chain.includes(a.patientId)).map((a) => a.allergen);
    expect(onChain).toEqual(["Penicillin"]);
    expect(matchMedicationToAllergen("Amoxicillin", onChain[0])).toBeTruthy();
  });
});

describe("sexAgeLabel", () => {
  it("tells apart same-name patients by sex and age", () => {
    expect(sexAgeLabel({ sex: "female" }, 34)).toBe("Female · 34 years");
    expect(sexAgeLabel({ sex: "male" }, null)).toBe("Male");
  });
});
