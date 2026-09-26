// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mapPatient, mapGender } from "../mappers/patient";
import { mapEncounter, mapVisitStatus } from "../mappers/encounter";
import { mapVitalsRow, parseObservationId, mapVitalSign } from "../mappers/observation";
import { mapCondition } from "../mappers/condition";
import { conditionDefinition } from "../resources/condition";
import { validateResource } from "../validation/validate";
import { VITAL_SIGNS } from "../terminology/codeSystems";
import { CONDITION_A, PATIENT_A, VISIT_A, VITALS_A } from "./fixtures";

const ctx = { patientFhirIds: new Map([[PATIENT_A.id, PATIENT_A.fhir_id]]) };

describe("Patient mapper", () => {
  const p = mapPatient(PATIENT_A);

  it("publishes the FHIR id, never the internal row id or private columns", () => {
    expect(p.id).toBe(PATIENT_A.fhir_id);
    const json = JSON.stringify(p);
    for (const secret of [PATIENT_A.id, "secret-auth-uid", "patient-photos", "portal"]) {
      expect(json).not.toContain(secret);
    }
    expect(p.identifier).toEqual([
      { use: "usual", system: "https://mbhr.app/identifiers/patient", value: PATIENT_A.fhir_id },
    ]);
  });

  it("maps name, telecom, gender, birth date and address", () => {
    // No name.use, telecom use or address use: mBHR does not record them (not guessed).
    expect(p.name).toEqual([{ family: "Okafor", given: ["Ada", "Chioma"], text: "Ada Chioma Okafor" }]);
    expect(p.telecom).toEqual([
      { system: "phone", value: "08000000001" },
      { system: "email", value: "ada@example.org" },
    ]);
    expect(p.gender).toBe("female");
    expect(p.birthDate).toBe("1984-03-02");
    expect(p.address).toEqual([{ text: "12 Example Street", district: "Oshimili South", state: "Delta" }]);
  });

  it("does not assert active for an ordinary record, and marks a merged one replaced", () => {
    expect(p.active).toBeUndefined();
    const merged = mapPatient({ ...PATIENT_A, merged_into: "01HZZSURVIVOR" }, "0b3c1d2e-1111-4aaa-8bbb-00000000000f");
    expect(merged.active).toBe(false);
    expect(merged.link).toEqual([{ other: { reference: "Patient/0b3c1d2e-1111-4aaa-8bbb-00000000000f" }, type: "replaced-by" }]);
  });

  it("versions from updated_at and never invents a time", () => {
    expect(p.meta).toEqual({
      versionId: String(Date.parse("2026-05-01T10:30:00Z")),
      lastUpdated: "2026-05-01T10:30:00.000Z",
      source: "https://mbhr.app",
    });
    const noTimes = mapPatient({ ...PATIENT_A, updated_at: null, created_at: null });
    expect(noTimes.meta).toEqual({ versionId: "0", source: "https://mbhr.app" });
  });

  it("maps local sex values without guessing", () => {
    expect(mapGender("M")).toBe("male");
    expect(mapGender("f")).toBe("female");
    // "other" is also the app's default when nothing was chosen: not an assertion.
    expect(mapGender("other")).toBeUndefined();
    expect(mapGender("intersex?")).toBe("unknown");
    expect(mapGender(undefined)).toBeUndefined();
  });

  it("is valid", () => expect(validateResource(p)).toEqual([]));
});

describe("Encounter mapper", () => {
  it("maps a visit, keeping the queue out of it", () => {
    const e = mapEncounter(VISIT_A, ctx)!;
    expect(e).toMatchObject({
      resourceType: "Encounter",
      id: VISIT_A.id,
      status: "finished",
      class: { code: "AMB" },
      subject: { reference: `Patient/${PATIENT_A.fhir_id}` },
      period: { start: "2026-05-01T08:15:00.000Z" },
      location: [{ location: { display: "Asaba outreach" } }],
    });
    expect(validateResource(e)).toEqual([]);
  });

  it("never guesses a status", () => {
    expect(mapVisitStatus("open")).toBe("in-progress");
    expect(mapVisitStatus("closed")).toBe("finished");
    expect(mapVisitStatus("waiting-room")).toBe("unknown");
    expect(mapVisitStatus(undefined)).toBe("unknown");
  });

  it("drops a visit whose patient the caller cannot see", () => {
    expect(mapEncounter(VISIT_A, { patientFhirIds: new Map() })).toBeNull();
  });
});

describe("Observation mapper (vital signs)", () => {
  const obs = mapVitalsRow(VITALS_A, ctx);
  const byKind = Object.fromEntries(obs.map((o) => [o.id!.slice(VITALS_A.id.length + 1), o]));

  it("publishes one Observation per measured value with stable ids", () => {
    expect(Object.keys(byKind).sort()).toEqual(["bp", "height", "spo2", "temperature", "weight"]);
    expect(parseObservationId(`${VITALS_A.id}-heart-rate`)).toEqual({ vitalsId: VITALS_A.id, kind: "heart-rate" });
    expect(parseObservationId("nonsense")).toBeNull();
  });

  it("never turns a missing value into zero and never publishes an impossible zero", () => {
    expect(byKind.bmi).toBeUndefined(); // bmi is null
    expect(byKind["heart-rate"]).toBeUndefined(); // pulse_bpm is 0
    const hr = VITAL_SIGNS.find((d) => d.kind === "heart-rate")!;
    expect(mapVitalSign({ ...VITALS_A, pulse_bpm: null }, hr, ctx)).toBeNull();
  });

  it("keeps values and units exactly, in UCUM", () => {
    expect(byKind.weight.valueQuantity).toEqual({ value: 61.5, unit: "kg", system: "http://unitsofmeasure.org", code: "kg" });
    expect(byKind.temperature.valueQuantity).toMatchObject({ value: 36.8, code: "Cel" });
    expect(byKind.spo2.valueQuantity).toMatchObject({ value: 97, code: "%" });
  });

  it("publishes blood pressure as a panel with two components", () => {
    const bp = byKind.bp;
    expect(bp.code.coding?.[0]).toMatchObject({ system: "http://loinc.org", code: "85354-9" });
    expect(bp.component?.map((c) => [c.code.coding?.[0].code, c.valueQuantity?.value, c.valueQuantity?.code])).toEqual([
      ["8480-6", 128, "mm[Hg]"],
      ["8462-4", 84, "mm[Hg]"],
    ]);
    expect(bp.valueQuantity).toBeUndefined();
    // The panel code means "blood pressure"; the column codes belong to
    // the components they describe.
    expect(bp.code.coding).toEqual([expect.objectContaining({ system: "http://loinc.org", code: "85354-9" })]);
    expect(bp.component?.map((c) => c.code.coding?.[1])).toEqual([
      { system: "https://mbhr.app/codes/vitals", code: "systolic" },
      { system: "https://mbhr.app/codes/vitals", code: "diastolic" },
    ]);
  });

  it("keeps the local code next to LOINC, links the encounter, and publishes no interpretation", () => {
    expect(byKind.height.code.coding).toContainEqual({ system: "https://mbhr.app/codes/vitals", code: "height_cm" });
    expect(byKind.height.encounter).toEqual({ reference: `Encounter/${VISIT_A.id}` });
    expect(byKind.height.effectiveDateTime).toBe("2026-05-01T08:40:00.000Z");
    expect(JSON.stringify(obs)).not.toContain("interpretation");
    expect(JSON.stringify(obs)).not.toContain("referenceRange");
  });

  it("all are valid vital-signs Observations", () => {
    for (const o of obs) {
      expect(o.status).toBe("final");
      expect(o.category?.[0].coding?.[0].code).toBe("vital-signs");
      expect(validateResource(o)).toEqual([]);
    }
  });
});

describe("Condition mapper", () => {
  it("keeps a provisional diagnosis provisional", () => {
    const c = mapCondition(CONDITION_A, ctx)!;
    expect(c.verificationStatus?.coding?.[0].code).toBe("provisional");
    expect(c.clinicalStatus?.coding?.[0].code).toBe("active");
    expect(c.category?.[0].coding?.[0]).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/condition-category",
      code: "encounter-diagnosis",
    });
    expect(validateResource(c)).toEqual([]);
  });

  it("uses the local code only, unless a verified mapping exists", () => {
    const local = mapCondition(CONDITION_A, ctx)!;
    expect(local.code).toEqual({
      coding: [{ system: "https://mbhr.app/codes/condition", code: "MAL", display: "Malaria" }],
      text: "Malaria",
    });
    const verified = new Map([["MAL", [{ localCode: "MAL", system: "http://hl7.org/fhir/sid/icd-10", code: "B54", display: "Unspecified malaria" }]]]);
    const mapped = mapCondition(CONDITION_A, ctx, verified)!;
    expect(mapped.code?.coding).toHaveLength(2);
    expect(mapped.code?.coding?.[1]).toEqual({ system: "http://hl7.org/fhir/sid/icd-10", code: "B54", display: "Unspecified malaria" });
  });

  it("does not publish notes or the recorder", () => {
    const json = JSON.stringify(mapCondition(CONDITION_A, ctx));
    expect(json).not.toContain("private clinician note");
    expect(json).not.toContain("Dr Example");
  });

  it("omits clinicalStatus on entered-in-error (con-5) and keeps the error status", () => {
    const c = mapCondition({ ...CONDITION_A, verification_status: "entered-in-error" }, ctx)!;
    expect(c.clinicalStatus).toBeUndefined();
    expect(c.verificationStatus?.coding?.[0].code).toBe("entered-in-error");
    expect(validateResource(c)).toEqual([]);
  });

  it("publishes an end date only beside an ended clinical status (con-4)", () => {
    const ended = { ...CONDITION_A, abatement_date: "2026-03-01" };
    for (const status of ["inactive", "remission", "resolved"]) {
      const c = mapCondition({ ...ended, clinical_status: status }, ctx)!;
      expect(c.abatementDateTime, status).toBe("2026-03-01");
      expect(validateResource(c), status).toEqual([]);
    }
    // No clinical status is published for these, so the date is left out
    // and no ended status is inferred from it.
    for (const row of [
      { ...ended, verification_status: "entered-in-error", clinical_status: "resolved" },
      { ...ended, clinical_status: null },
      { ...ended, clinical_status: "cured?" },
      { ...ended, clinical_status: "active" },
      { ...ended, clinical_status: "relapse" },
    ]) {
      const c = mapCondition(row, ctx)!;
      expect("abatementDateTime" in c, JSON.stringify(row.clinical_status)).toBe(false);
      expect(validateResource(c)).toEqual([]);
    }
  });

  it("refuses a Condition that is abated without an ended clinical status (con-4)", () => {
    const base = { resourceType: "Condition", id: "c1", subject: { reference: "Patient/p1" }, abatementDateTime: "2026-03-01" };
    expect(validateResource(base).map((i) => i.path)).toContain("abatement[x]");
    expect(
      validateResource({
        ...base,
        clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
      }).map((i) => i.path),
    ).toContain("abatement[x]");
    expect(
      validateResource({
        ...base,
        clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "resolved" }] },
      }).map((i) => i.path),
    ).not.toContain("abatement[x]");
  });

  it("drops unknown status values rather than inventing one", () => {
    const c = mapCondition({ ...CONDITION_A, clinical_status: "cured?", verification_status: null }, ctx)!;
    expect(c.clinicalStatus).toBeUndefined();
    expect(c.verificationStatus).toBeUndefined();
  });

  it("leaves out a stored 'confirmed', the column's default, and publishes every other verification code", () => {
    // public.conditions.verification_status has DEFAULT 'confirmed': a row
    // written without one is not a confirmed diagnosis.
    const c = mapCondition({ ...CONDITION_A, verification_status: "confirmed" }, ctx)!;
    expect("verificationStatus" in c).toBe(false);
    expect(c.clinicalStatus?.coding?.[0].code).toBe("active"); // unchanged
    expect(validateResource(c)).toEqual([]);
    for (const raw of ["Confirmed", " confirmed "]) {
      expect("verificationStatus" in mapCondition({ ...CONDITION_A, verification_status: raw }, ctx)!, raw).toBe(false);
    }
    for (const code of ["unconfirmed", "provisional", "differential", "refuted", "entered-in-error"]) {
      expect(mapCondition({ ...CONDITION_A, verification_status: code }, ctx)!.verificationStatus, code).toStrictEqual({
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code }],
      });
    }
    // Search cannot find what the read leaves out: there is no
    // verification-status parameter (an unknown parameter is refused).
    expect(conditionDefinition.searchParams.map((p) => p.name)).not.toContain("verification-status");
    // The published notes say so, so a missing verificationStatus is not read as "unconfirmed".
    expect(conditionDefinition.notes?.join(" ")).toMatch(
      /verificationStatus is left out when the stored value is 'confirmed'.*cannot be told apart.*does not mean the diagnosis is unconfirmed/,
    );
  });
});

describe("validator", () => {
  it("catches the mistakes a mapper could make", () => {
    const issues = validateResource({
      resourceType: "Observation",
      id: "bad id!",
      meta: { lastUpdated: "yesterday" },
      status: "done",
      code: { coding: [] },
      subject: { reference: "public.patients/123" },
      valueQuantity: { value: "12" },
    });
    const paths = issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(["id", "meta.lastUpdated", "status", "Observation.code.coding", "Observation.subject.reference", "Observation.valueQuantity.value"]),
    );
  });
});

describe("conformance examples", () => {
  it("every example passes the structural checks", async () => {
    const { conformanceExamples } = await import("../conformance/examples");
    const examples = conformanceExamples();
    expect(Object.keys(examples).length).toBeGreaterThanOrEqual(15);
    for (const [name, r] of Object.entries(examples)) {
      if (["Patient", "Encounter", "Observation", "Condition"].includes(r.resourceType)) {
        expect(validateResource(r), name).toEqual([]);
      }
    }
  });

  it("a vitals row without a measurement time claims no vital-signs profile", () => {
    const [o] = mapVitalsRow({ ...VITALS_A, taken_at: null }, ctx);
    expect(o.meta?.profile).toBeUndefined();
    expect(o.effectiveDateTime).toBeUndefined();
  });
});
