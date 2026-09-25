// Clinical dates in the device FHIR export: records downloaded by sync hold
// ISO strings, records made on this device hold Date objects. Both must
// export the recorded time, never the time of the export.

import { describe, expect, it } from "vitest";

import type { Consultation, Dispense, PatientAllergy, Visit, Vital } from "../../../db";
import {
  adaptDexieAllergy,
  adaptDexieConsultation,
  adaptDexieDispense,
  adaptDexieVisit,
  adaptDexieVital,
  toIso,
} from "../dexieAdapters";

const RECORDED = "2026-03-14T09:30:00.000Z";

describe("toIso", () => {
  it("accepts a Date or an ISO string", () => {
    expect(toIso(new Date(RECORDED))).toBe(RECORDED);
    expect(toIso(RECORDED)).toBe(RECORDED);
    expect(toIso("2026-03-14T10:30:00+01:00")).toBe(RECORDED);
  });

  it("gives nothing for a missing or unreadable value", () => {
    expect(toIso(undefined)).toBeUndefined();
    expect(toIso(null)).toBeUndefined();
    expect(toIso("")).toBeUndefined();
    expect(toIso("not a date")).toBeUndefined();
    expect(toIso(new Date("invalid"))).toBeUndefined();
  });
});

describe("device export dates for records downloaded by sync", () => {
  it("dates a vitals reading to when it was taken", () => {
    const vital = {
      id: "v1",
      patientId: "p1",
      visitId: "visit-1",
      systolic: 120,
      diastolic: 80,
      takenAt: RECORDED,
    } as unknown as Vital;

    const observations = adaptDexieVital(vital);

    expect(observations.length).toBeGreaterThan(0);
    for (const o of observations) expect(o.effectiveDateTime).toBe(RECORDED);
  });

  it("leaves the time out when the reading has none", () => {
    const vital = {
      id: "v2",
      patientId: "p1",
      visitId: "visit-1",
      systolic: 120,
      diastolic: 80,
    } as unknown as Vital;

    for (const o of adaptDexieVital(vital)) expect(o.effectiveDateTime).toBeUndefined();
  });

  it("dates a dispense, a visit and a consultation to their recorded times", () => {
    const dispense = {
      id: "d1",
      patientId: "p1",
      visitId: "visit-1",
      itemName: "Paracetamol",
      qty: 10,
      dispensedBy: "Pharmacist",
      dispensedAt: RECORDED,
    } as unknown as Dispense;
    const visit = {
      id: "visit-1",
      patientId: "p1",
      startedAt: RECORDED,
      siteName: "Site A",
      status: "closed",
    } as unknown as Visit;
    const consultation = {
      id: "c1",
      patientId: "p1",
      visitId: "visit-1",
      providerName: "Dr A",
      soapSubjective: "Headache",
      createdAt: RECORDED,
    } as unknown as Consultation;

    expect(adaptDexieDispense(dispense).authoredOn).toBe(RECORDED);
    expect(adaptDexieVisit(visit).period?.start).toBe(RECORDED);
    const report = adaptDexieConsultation(consultation);
    expect(report.effectiveDateTime).toBe(RECORDED);
    expect(report.issued).toBe(RECORDED);
  });

  it("keeps an allergy onset date stored as text", () => {
    const allergy = {
      id: "a1",
      patientId: "p1",
      allergen: "Penicillin",
      allergyType: "medication",
      severity: "severe",
      onsetDate: RECORDED,
      createdAt: RECORDED,
    } as unknown as PatientAllergy;

    expect(adaptDexieAllergy(allergy).onsetDateTime).toBe(RECORDED);
  });
});
