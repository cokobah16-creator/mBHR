// @vitest-environment node
//
// AllergyIntolerance <- public.patient_allergies: the mapper and its value
// tables, the type's own validation rules (ait-1, ait-2), and the gateway end
// to end against the in-memory Supabase: who may read allergies, enumeration
// protection, every search parameter, merged patients, opaque ids, the
// "no known allergies" caveat on every searchset, allergies whose patient
// does not resolve (never dropped silently), the recorder through the staff
// directory, and that nothing private is ever served.
//
// Synthetic fixtures only (no real patient data).

import { describe, expect, it } from "vitest";
import { handleFhirRequest } from "../gateway/handler";
import { Postgrest, type FetchLike } from "../gateway/postgrest";
import { capabilityStatement } from "../capability/capabilityStatement";
import { READ_PERMISSIONS } from "../authorization/permissions";
import { validateResource } from "../validation/validate";
import { applyStatusMap, explainStatus, knownSourceValues } from "../terminology/statusMaps";
import { STATUS_MAPS } from "../terminology/status";
import {
  ALLERGY_CATEGORY,
  ALLERGY_CLINICAL_STATUS,
  ALLERGY_CRITICALITY,
  ALLERGY_REACTION_SEVERITY,
  ALLERGY_STATUS_MAPS,
  ALLERGY_VERIFICATION_STATUS,
} from "../terminology/status/allergy";
import {
  ALLERGY_CLINICAL_SYSTEM,
  ALLERGY_COLUMNS,
  ALLERGY_NKA_CAVEAT,
  isActiveSource,
  mapAllergy,
  mapAllergyClinicalStatus,
  validateAllergyIntolerance,
  type AllergyMapContext,
} from "../mappers/allergy";
import {
  allergyIntoleranceModule,
  allergyLeftOutWarning,
  definition,
  leftOutOnPage,
  type ExaminedRow,
} from "../resources/allergyIntolerance";
import type { QueryCtx } from "../resources/module";
import { fakeSupabase, makeToken, type FakeOptions, type FakeUser, type RpcHandler } from "./fakeSupabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PATIENT_A = {
  id: "01HZZALGPATIENTA0000000000",
  fhir_id: "a1a1a1a1-0000-4000-8000-00000000000a",
  given_name: "Ngozi",
  family_name: "Eze",
  email: "ngozi@example.org",
  auth_uid: "auth-uid-of-patient-a",
  merged_into: null as string | null,
  merged_at: null as string | null,
};
/** Merged into A; one allergy row still carries its old id. */
const PATIENT_M = {
  ...PATIENT_A,
  id: "01HZZALGPATIENTM0000000000",
  fhir_id: "a1a1a1a1-0000-4000-8000-00000000000d",
  merged_into: PATIENT_A.id,
  merged_at: "2026-06-01T10:00:00+00:00",
};
const PATIENT_B = { ...PATIENT_A, id: "01HZZALGPATIENTB0000000000", fhir_id: "a1a1a1a1-0000-4000-8000-00000000000b", email: null };
/** Has no allergy rows at all. */
const PATIENT_C = { ...PATIENT_A, id: "01HZZALGPATIENTC0000000000", fhir_id: "a1a1a1a1-0000-4000-8000-00000000000c", email: null };
/**
 * Merged away, but its kept record is missing (an orphaned tombstone): its
 * merge chain does not end, so no allergy filed under it can name a patient.
 */
const PATIENT_T = {
  ...PATIENT_A,
  id: "01HZZALGPATIENTT0000000000",
  fhir_id: "a1a1a1a1-0000-4000-8000-00000000000e",
  email: null,
  merged_into: null as string | null,
  merged_at: "2026-06-01T10:00:00+00:00" as string | null,
};

/** app_users.id of a doctor (an auth uid): never published, only its Practitioner id. */
const DOCTOR_ACCOUNT = "5b7a0c2e-3d4f-4a1b-9c8d-7e6f5a4b3c2d";
/** A staff account made on a tablet (device ULID): not in the staff directory. */
const DEVICE_STAFF = "01HZZDEVICESTAFF0000000000";
const PRACTITIONER_ID = "7c1e5f0a-0000-4000-8000-000000000001";
const STAFF_NOTE = "STAFF NOTE: patient unsure, ask the mother";

const BASE = {
  patient_id: PATIENT_A.id,
  allergen: "Penicillin",
  allergy_type: "medication",
  reaction: "Rash",
  severity: "moderate",
  onset_date: "2026-04-01" as string | null,
  notes: STAFF_NOTE,
  is_active: true as unknown,
  created_at: "2026-05-01T09:00:00+00:00",
  updated_at: "2026-05-02T10:00:00+00:00",
  created_by: DOCTOR_ACCOUNT as string | null,
  _dirty: 0,
  _synced_at: null,
};

/** Active, life-threatening, recorded by a doctor in the staff directory. */
const AL_ACTIVE = {
  ...BASE,
  id: "a0000000-0000-4000-8000-000000000001",
  allergen: " Penicillin, codeine ",
  reaction: "Rash, swelling of the lips",
  severity: "life-threatening",
};
/** Marked inactive by staff; recorded by a device-made account. */
const AL_INACTIVE = {
  ...BASE,
  id: "a0000000-0000-4000-8000-000000000002",
  allergen: "Shellfish",
  allergy_type: "food",
  reaction: "Hives",
  severity: "severe",
  is_active: false,
  created_by: DEVICE_STAFF,
  onset_date: null,
};
/** is_active missing (only possible on a drifted database): never active. */
const AL_UNKNOWN = {
  ...BASE,
  id: "a0000000-0000-4000-8000-000000000003",
  allergen: "House dust",
  allergy_type: "environmental",
  is_active: null,
};
/** Type other, blank allergen and reaction, the form's default severity. */
const AL_OTHER = {
  ...BASE,
  id: "a0000000-0000-4000-8000-000000000004",
  allergen: "   ",
  allergy_type: "other",
  reaction: "",
  severity: "mild",
  created_by: "patient-submitted",
};
/** Still filed under the merged-away record M. */
const AL_MERGED = {
  ...BASE,
  id: "a0000000-0000-4000-8000-000000000005",
  patient_id: PATIENT_M.id,
  allergen: "Sulfa drugs",
  reaction: "Vomiting",
  severity: "severe",
  created_by: "legacy:account 7",
};
/** A tablet-made id (ULID), kept as stored. */
const AL_DEVICE = {
  ...BASE,
  id: "01HZZALLERGYDEVICE00000000",
  allergen: "Aspirin",
  reaction: "Wheeze",
  severity: "mild",
};
const AL_B = { ...BASE, id: "a0000000-0000-4000-8000-000000000006", patient_id: PATIENT_B.id, allergen: "Peanuts", allergy_type: "food" };
/** A life-threatening allergy filed under the orphaned tombstone T. */
const AL_TOMB = {
  ...BASE,
  id: "c0000000-0000-4000-8000-000000000001",
  patient_id: PATIENT_T.id,
  allergen: "Amoxicillin",
  reaction: "Anaphylaxis",
  severity: "life-threatening",
};

const ALL_ROWS = [AL_ACTIVE, AL_INACTIVE, AL_UNKNOWN, AL_OTHER, AL_MERGED, AL_DEVICE, AL_B];

const MAP_CTX: AllergyMapContext = {
  patientFhirIds: new Map([
    [PATIENT_A.id, PATIENT_A.fhir_id],
    [PATIENT_M.id, PATIENT_A.fhir_id],
    [PATIENT_B.id, PATIENT_B.fhir_id],
  ]),
  practitionerIds: new Map([[DOCTOR_ACCOUNT, PRACTITIONER_ID]]),
};

// ---------------------------------------------------------------------------
// Gateway harness
// ---------------------------------------------------------------------------

const ENV = {
  FHIR_ENABLED: "true",
  FHIR_PATIENT_ACCESS_ENABLED: "true",
  FHIR_BASE_URL: "https://mbhr.app/fhir/R4",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
};

const DOCTOR = makeToken("doctor-1");
const NURSE = makeToken("nurse-1");
const PHARMACIST = makeToken("pharm-1");
const REGISTRAR = makeToken("registrar-1");
const AUDITOR = makeToken("auditor-1");
const LAB_ONLY = makeToken("lab-1");
const STOCK_ONLY = makeToken("stock-1");
const PAT_A = makeToken("portal-a");
const PAT_B = makeToken("portal-b");

const USERS: Record<string, FakeUser> = {
  [DOCTOR]: { id: "doctor-1", role: "doctor", permissions: ["consult", "lab_review", "register", "vitals", "queue"] },
  [NURSE]: { id: "nurse-1", role: "nurse", permissions: ["register", "vitals", "queue", "portal_manage"] },
  [PHARMACIST]: { id: "pharm-1", role: "pharmacist", permissions: ["dispense", "inventory", "queue"] },
  [REGISTRAR]: { id: "registrar-1", role: "registration_lead", permissions: ["register", "portal_invite", "queue"] },
  [AUDITOR]: { id: "auditor-1", role: "auditor", permissions: ["audit_access", "export"] },
  [LAB_ONLY]: { id: "lab-1", role: "lead_clinician", permissions: ["lab_review", "lab_release"] },
  [STOCK_ONLY]: { id: "stock-1", role: "admin", permissions: ["inventory", "users"] },
  [PAT_A]: { id: "portal-a", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_A.id] },
  [PAT_B]: { id: "portal-b", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_B.id] },
};

const DIRECTORY: Record<string, { fhir_id: string; full_name: string; role: string }> = {
  [DOCTOR_ACCOUNT]: { fhir_id: PRACTITIONER_ID, full_name: "Dr Example", role: "doctor" },
};

/** public.fhir_staff_directory in p_source_ids mode, with the migration's checks. */
const staffDirectory: RpcHandler = (body, user) => {
  if (user.kind === "patient" || !user.role) return new Response(JSON.stringify({ code: "42501" }), { status: 403 });
  const ids = (body.p_source_ids as string[] | null) ?? [];
  if (ids.length > 200 || ids.some((i) => !/^[A-Za-z0-9._-]{1,128}$/.test(i))) {
    return new Response(JSON.stringify({ code: "22023" }), { status: 400 });
  }
  return ids
    .filter((i) => DIRECTORY[i])
    .map((i) => ({ ...DIRECTORY[i], source_id: i, active: true, created_at: null, updated_at: null }));
};

function setup(overrides: Partial<FakeOptions> = {}, wrap?: (f: FetchLike) => FetchLike) {
  const fake = fakeSupabase({
    users: USERS,
    tables: {
      patients: [PATIENT_A, PATIENT_M, PATIENT_B, PATIENT_C],
      patient_allergies: ALL_ROWS,
    },
    rpcs: { fhir_staff_directory: staffDirectory },
    ...overrides,
  });
  const fetchImpl = wrap ? wrap(fake.fetchImpl) : fake.fetchImpl;
  const logs: string[] = [];
  const call = (path: string, token?: string, headers: Record<string, string> = {}) => {
    const h = new Headers(headers);
    if (token) h.set("Authorization", `Bearer ${token}`);
    return handleFhirRequest(new Request(`https://mbhr.app${path}`, { headers: h }), {
      env: ENV,
      fetchImpl,
      randomId: () => "11111111-2222-4333-8444-555555555555",
      log: (l) => logs.push(l),
      now: () => new Date("2026-09-25T12:00:00Z"),
    });
  };
  const allergyQueries = () => fake.calls.filter((c) => c.url.includes("/rest/v1/patient_allergies")).map((c) => decodeURIComponent(c.url));
  const directoryCalls = () => fake.calls.filter((c) => c.url.endsWith("/rpc/fhir_staff_directory")).map((c) => c.body as Json);
  return { ...fake, call, logs, allergyQueries, directoryCalls };
}

/** A database whose patient_allergies.id is uuid: any other id is refused with 22P02. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidIdColumn(inner: FetchLike): FetchLike {
  return async (input, init) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/patient_allergies")) {
      for (const [k, v] of url.searchParams) {
        const m = /^(?:eq|gt)\.(.*)$/.exec(v);
        if (k === "id" && m && !UUID_RE.test(m[1])) {
          return new Response(JSON.stringify({ code: "22P02", message: `invalid input syntax for type uuid: "${m[1]}"` }), { status: 400 });
        }
      }
    }
    return inner(input, init);
  };
}

async function json(res: Response): Promise<Json> {
  return (await res.json()) as Json;
}
const matches = (b: Json): Json[] => b.entry.filter((e: Json) => e.search.mode === "match").map((e: Json) => e.resource);
const outcomes = (b: Json): Json[] => b.entry.filter((e: Json) => e.search.mode === "outcome").flatMap((e: Json) => e.resource.issue);
const ids = (b: Json): string[] => matches(b).map((r) => r.id);
const status = (r: Json): string | undefined => r.clinicalStatus?.coding?.[0]?.code;
const byPatient = (fhirId: string, extra = "") => `/fhir/R4/AllergyIntolerance?patient=Patient/${fhirId}${extra}`;

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

describe("AllergyIntolerance mapper", () => {
  it("maps every recorded field of an active allergy", () => {
    const a = mapAllergy(AL_ACTIVE, MAP_CTX);
    // toEqual is exact: no verificationStatus, type, note or anything else.
    expect(a).toEqual({
      resourceType: "AllergyIntolerance",
      id: AL_ACTIVE.id,
      meta: {
        versionId: String(Date.parse("2026-05-02T10:00:00Z")),
        lastUpdated: "2026-05-02T10:00:00.000Z",
        source: "https://mbhr.app",
      },
      patient: { reference: `Patient/${PATIENT_A.fhir_id}` },
      clinicalStatus: { coding: [{ system: ALLERGY_CLINICAL_SYSTEM, code: "active" }] },
      // No category: "medication" is the form's pre-selected type, so it may
      // mean nobody chose one.
      criticality: "high",
      code: { text: "Penicillin, codeine" },
      onsetDateTime: "2026-04-01",
      recordedDate: "2026-05-01T09:00:00.000Z",
      recorder: { reference: `Practitioner/${PRACTITIONER_ID}` },
      // life-threatening: criticality high, and reaction severity severe
      // (the top of the reaction scale).
      reaction: [{ manifestation: [{ text: "Rash, swelling of the lips" }], severity: "severe" }],
    });
    expect(validateResource(a, validateAllergyIntolerance)).toEqual([]);
  });

  it("maps an inactive allergy as inactive, with its category and reaction severity", () => {
    const a = mapAllergy(AL_INACTIVE, MAP_CTX)!;
    expect(a.clinicalStatus).toEqual({ coding: [{ system: ALLERGY_CLINICAL_SYSTEM, code: "inactive" }] });
    expect(a.category).toEqual(["food"]);
    expect(a.criticality).toBeUndefined(); // severe is not a criticality
    expect(a.reaction).toEqual([{ manifestation: [{ text: "Hives" }], severity: "severe" }]);
    expect(a.onsetDateTime).toBeUndefined(); // no onset recorded: not invented
    expect(a.recorder).toBeUndefined(); // device-made account: not in the directory
    expect(validateResource(a, validateAllergyIntolerance)).toEqual([]);
  });

  it("gives a record with no is_active no clinical status, so validation withholds it (ait-1)", () => {
    const a = mapAllergy(AL_UNKNOWN, MAP_CTX)!;
    expect(a.clinicalStatus).toBeUndefined();
    expect(a.verificationStatus).toBeUndefined();
    const issues = validateResource(a, validateAllergyIntolerance);
    expect(issues).toEqual([{ path: "clinicalStatus", message: expect.stringMatching(/^ait-1/) }]);
  });

  it("publishes a blank allergen without a code, 'other' without a category, and no mild severity", () => {
    const a = mapAllergy(AL_OTHER, MAP_CTX)!;
    expect(a.code).toBeUndefined();
    expect(a.category).toBeUndefined();
    expect(a.criticality).toBeUndefined();
    expect(a.reaction).toBeUndefined(); // "" is no reaction
    expect(a.recorder).toBeUndefined(); // "patient-submitted" is not a staff member
    expect(status(a)).toBe("active");
    expect(validateResource(a, validateAllergyIntolerance)).toEqual([]);
  });

  it("publishes no category for the pre-selected type medication, as for the pre-selected mild", () => {
    // A food allergy saved without changing the form's pre-selected choices.
    const a = mapAllergy({ ...AL_ACTIVE, allergen: "Peanuts", allergy_type: "medication", severity: "mild", reaction: "Hives" }, MAP_CTX)!;
    expect("category" in a).toBe(false);
    expect(a.criticality).toBeUndefined();
    expect(a.reaction).toStrictEqual([{ manifestation: [{ text: "Hives" }] }]);
    expect(validateResource(a, validateAllergyIntolerance)).toEqual([]);
    // Types someone chose are still published.
    expect(mapAllergy({ ...AL_ACTIVE, allergy_type: "food" }, MAP_CTX)!.category).toStrictEqual(["food"]);
    expect(mapAllergy({ ...AL_ACTIVE, allergy_type: "environmental" }, MAP_CTX)!.category).toStrictEqual(["environment"]);
    for (const row of ALL_ROWS.filter((r) => r.allergy_type === "medication")) {
      const m = mapAllergy(row, MAP_CTX);
      if (m) expect("category" in m, row.id).toBe(false);
    }
  });

  it("publishes no reaction (and so no reaction severity) without reaction text", () => {
    for (const reaction of [null, "", "   "]) {
      const a = mapAllergy({ ...AL_INACTIVE, reaction }, MAP_CTX)!;
      expect(a.reaction, String(reaction)).toBeUndefined();
    }
  });

  it("keeps free text as free text: a list stays one record, 'None' is not turned into a code", () => {
    const list = mapAllergy({ ...AL_ACTIVE, allergen: "Penicillin, codeine and sulfa" }, MAP_CTX)!;
    expect(list.code).toEqual({ text: "Penicillin, codeine and sulfa" });
    for (const text of ["None", "NKDA", "No known allergies"]) {
      const a = mapAllergy({ ...AL_ACTIVE, allergen: text }, MAP_CTX)!;
      expect(a.code, text).toEqual({ text });
      expect(JSON.stringify(a)).not.toMatch(/snomed|"coding":\[\{"system":"http:\/\/snomed/);
    }
  });

  it("names the kept record for a row still filed under a merged-away record", () => {
    const a = mapAllergy(AL_MERGED, MAP_CTX)!;
    expect(a.patient).toEqual({ reference: `Patient/${PATIENT_A.fhir_id}` });
    expect(JSON.stringify(a)).not.toContain(PATIENT_M.fhir_id);
  });

  it("withholds a row whose patient does not resolve, or that has no id", () => {
    expect(mapAllergy({ ...AL_ACTIVE, patient_id: "01HZZUNKNOWNPATIENT0000000" }, MAP_CTX)).toBeNull();
    expect(mapAllergy({ ...AL_ACTIVE, patient_id: null }, MAP_CTX)).toBeNull();
    expect(mapAllergy({ ...AL_ACTIVE, id: null }, MAP_CTX)).toBeNull();
    expect(mapAllergy({ ...AL_ACTIVE, id: "" }, MAP_CTX)).toBeNull();
  });

  it("leaves the recorder out without a directory entry, and never publishes the account id", () => {
    const none = mapAllergy(AL_ACTIVE, { patientFhirIds: MAP_CTX.patientFhirIds })!;
    expect(none.recorder).toBeUndefined();
    const bad = mapAllergy(AL_ACTIVE, { ...MAP_CTX, practitionerIds: new Map([[DOCTOR_ACCOUNT, "not/an id"]]) })!;
    expect(bad.recorder).toBeUndefined();
    for (const a of [none, bad, mapAllergy(AL_ACTIVE, MAP_CTX)!]) {
      const text = JSON.stringify(a);
      expect(text).not.toContain(DOCTOR_ACCOUNT);
      expect(text).not.toContain(STAFF_NOTE);
      expect(text).not.toContain(PATIENT_A.id);
      expect(text).not.toMatch(/notes|created_by|_dirty|_synced_at/);
    }
  });

  it("does not read the notes or the sync columns at all", () => {
    expect(ALLERGY_COLUMNS).not.toContain("notes");
    expect(ALLERGY_COLUMNS).not.toContain("_dirty");
    expect(ALLERGY_COLUMNS).not.toContain("_synced_at");
  });

  it("versions from updated_at and never invents a time", () => {
    const a = mapAllergy({ ...AL_ACTIVE, updated_at: null, created_at: null }, MAP_CTX)!;
    expect(a.meta).toEqual({ versionId: "0", source: "https://mbhr.app" });
    expect(a.recordedDate).toBeUndefined();
  });

  it("keeps the onset a date, whether the column is a date or a timestamp", () => {
    expect(mapAllergy({ ...AL_ACTIVE, onset_date: "2026-04-01T00:00:00+00:00" }, MAP_CTX)!.onsetDateTime).toBe("2026-04-01");
    expect(mapAllergy({ ...AL_ACTIVE, onset_date: "not a date" }, MAP_CTX)!.onsetDateTime).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Value tables
// ---------------------------------------------------------------------------

describe("AllergyIntolerance status and value tables", () => {
  it("clinicalStatus: true is active, false is inactive, anything else is unknown (withheld)", () => {
    expect(mapAllergyClinicalStatus(true)).toBe("active");
    expect(mapAllergyClinicalStatus(false)).toBe("inactive");
    expect(mapAllergyClinicalStatus("true")).toBe("active");
    expect(mapAllergyClinicalStatus("FALSE")).toBe("inactive");
    for (const raw of [null, undefined, "", " true", "yes", "t", 1, 0, "1", "0", "active"]) {
      expect(mapAllergyClinicalStatus(raw), String(raw)).toBeNull();
    }
    expect(isActiveSource(true)).toBe("true");
    expect(isActiveSource(false)).toBe("false");
    expect(isActiveSource(null)).toBeNull();
    expect(explainStatus(ALLERGY_CLINICAL_STATUS, null).reason).toMatch(/never assumed active/);
    expect(explainStatus(ALLERGY_CLINICAL_STATUS, null).reason).toMatch(/ait-1/);
    expect(explainStatus(ALLERGY_CLINICAL_STATUS, "maybe").reason).toMatch(/withheld/);
  });

  it("inactive is never active, and a missing value is never active", () => {
    for (const raw of [false, "false", null, undefined, 0, "0", "inactive"]) {
      expect(mapAllergyClinicalStatus(raw), String(raw)).not.toBe("active");
    }
    // The only recorded value that means active is true.
    expect(ALLERGY_CLINICAL_STATUS.rules.filter((r) => r.fhir === "active").flatMap((r) => [...r.source])).toEqual(["true"]);
    // resolved and entered-in-error are never derived from "inactive".
    expect(knownSourceValues(ALLERGY_CLINICAL_STATUS).map((v) => applyStatusMap(ALLERGY_CLINICAL_STATUS, v))).toEqual(["active", "inactive"]);
  });

  it("verificationStatus is never filled: nothing is ever confirmed by default", () => {
    expect(ALLERGY_VERIFICATION_STATUS.rules).toEqual([]);
    for (const raw of ["confirmed", "true", null, "unconfirmed"]) {
      expect(applyStatusMap(ALLERGY_VERIFICATION_STATUS, raw), String(raw)).toBeNull();
    }
    for (const row of ALL_ROWS) {
      const a = mapAllergy(row, MAP_CTX);
      if (a) expect(a.verificationStatus, row.id).toBeUndefined();
      if (a) expect(a.type, row.id).toBeUndefined();
    }
  });

  it("category: only the types staff chose; the pre-selected medication is left out", () => {
    expect(applyStatusMap(ALLERGY_CATEGORY, "food")).toBe("food");
    expect(applyStatusMap(ALLERGY_CATEGORY, "environmental")).toBe("environment");
    for (const raw of ["medication", "Medication", "other", "biologic", "environment", "drug", "", null]) {
      expect(applyStatusMap(ALLERGY_CATEGORY, raw), String(raw)).toBeNull();
    }
    expect(explainStatus(ALLERGY_CATEGORY, "medication").reason).toMatch(/pre-selected/);
    expect(knownSourceValues(ALLERGY_CATEGORY)).toStrictEqual(["food", "environmental"]);
    // Nothing becomes medication (the form's default) or biologic.
    expect(ALLERGY_CATEGORY.rules.some((r) => r.fhir === "medication")).toBe(false);
    expect(ALLERGY_CATEGORY.rules.some((r) => r.fhir === "biologic")).toBe(false);
  });

  it("criticality: high only for life-threatening; never low, never unable-to-assess", () => {
    expect(applyStatusMap(ALLERGY_CRITICALITY, "life-threatening")).toBe("high");
    for (const raw of ["severe", "moderate", "mild", "", null, "high"]) {
      expect(applyStatusMap(ALLERGY_CRITICALITY, raw), String(raw)).toBeNull();
    }
    expect(ALLERGY_CRITICALITY.rules.map((r) => r.fhir)).toEqual(["high"]);
  });

  it("reaction severity: moderate and severe exactly, life-threatening as severe; the pre-selected mild is left out", () => {
    expect(applyStatusMap(ALLERGY_REACTION_SEVERITY, "moderate")).toBe("moderate");
    expect(applyStatusMap(ALLERGY_REACTION_SEVERITY, "severe")).toBe("severe");
    expect(applyStatusMap(ALLERGY_REACTION_SEVERITY, "life-threatening")).toBe("severe");
    expect(applyStatusMap(ALLERGY_REACTION_SEVERITY, "LIFE-THREATENING")).toBe("severe");
    for (const raw of ["mild", "", null, "Severe ", "critical", "high"]) {
      expect(applyStatusMap(ALLERGY_REACTION_SEVERITY, raw), String(raw)).toBeNull();
    }
    expect(explainStatus(ALLERGY_REACTION_SEVERITY, "mild").reason).toMatch(/pre-selected/);
    expect(explainStatus(ALLERGY_REACTION_SEVERITY, "life-threatening").reason).toMatch(/highest reaction-event-severity code/);
    // Nothing is ever published as mild.
    expect(ALLERGY_REACTION_SEVERITY.rules.some((r) => r.fhir === "mild")).toBe(false);
  });

  it("reaction severity never ranks a more serious rating below a less serious one", () => {
    const rank: Record<string, number> = { mild: 1, moderate: 2, severe: 3 };
    const ratings = ["moderate", "severe", "life-threatening"]; // in increasing seriousness
    const served = ratings.map((severity) => mapAllergy({ ...AL_ACTIVE, severity, reaction: "Anaphylaxis" }, MAP_CTX)!.reaction![0].severity);
    expect(served).toEqual(["moderate", "severe", "severe"]);
    for (let i = 1; i < served.length; i++) {
      expect(rank[served[i]!], ratings[i]).toBeGreaterThanOrEqual(rank[served[i - 1]!]);
    }
    // The most serious rating also carries criticality high; the others do not.
    expect(ratings.map((severity) => mapAllergy({ ...AL_ACTIVE, severity }, MAP_CTX)!.criticality)).toEqual([undefined, undefined, "high"]);
    // Without reaction text there is still no reaction element to carry it.
    expect(mapAllergy({ ...AL_ACTIVE, reaction: " " }, MAP_CTX)!.reaction).toBeUndefined();
  });

  it("every allergy table is listed with the other status maps", () => {
    for (const m of ALLERGY_STATUS_MAPS) expect(STATUS_MAPS).toContain(m);
    expect(ALLERGY_STATUS_MAPS.map((m) => m.element)).toEqual([
      "AllergyIntolerance.clinicalStatus",
      "AllergyIntolerance.verificationStatus",
      "AllergyIntolerance.category",
      "AllergyIntolerance.criticality",
      "AllergyIntolerance.reaction.severity",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The type's own validation rules
// ---------------------------------------------------------------------------

describe("AllergyIntolerance validation", () => {
  const good = () => JSON.parse(JSON.stringify(mapAllergy(AL_ACTIVE, MAP_CTX))) as Json;
  const check = (r: Json) => validateResource(r, validateAllergyIntolerance).map((i) => i.path);

  it("ait-1: a clinical status is required unless the record is entered-in-error", () => {
    const r = good();
    delete r.clinicalStatus;
    expect(check(r)).toEqual(["clinicalStatus"]);
    r.verificationStatus = { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code: "entered-in-error" }] };
    expect(check(r)).toEqual([]);
  });

  it("ait-2: no clinical status on an entered-in-error record", () => {
    const r = good();
    r.verificationStatus = { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code: "entered-in-error" }] };
    expect(check(r)).toEqual(["clinicalStatus"]);
  });

  it("refuses codes outside the R4 value sets, a missing patient, and any allergen coding", () => {
    const cases: [string, (r: Json) => void][] = [
      ["clinicalStatus", (r) => (r.clinicalStatus = { coding: [{ system: ALLERGY_CLINICAL_SYSTEM, code: "current" }] })],
      ["clinicalStatus", (r) => (r.clinicalStatus = { coding: [{ system: "https://mbhr.app/codes/x", code: "active" }] })],
      ["verificationStatus", (r) => (r.verificationStatus = { coding: [{ system: "https://example.org", code: "confirmed" }] })],
      ["patient", (r) => delete r.patient],
      ["patient", (r) => (r.patient = { reference: `Practitioner/${PRACTITIONER_ID}` })],
      ["category", (r) => (r.category = ["drug"])],
      ["criticality", (r) => (r.criticality = "medium")],
      ["type", (r) => (r.type = "sensitivity")],
      ["code.coding", (r) => (r.code = { text: "none", coding: [{ system: "http://snomed.info/sct", code: "716186003" }] })],
      ["code", (r) => (r.code = { coding: [{ system: "https://mbhr.app/codes/allergy", code: "x" }] })],
      ["recorder", (r) => (r.recorder = { display: "Dr Example" })],
      ["reaction[0].manifestation", (r) => (r.reaction = [{ severity: "mild" }])],
      ["reaction[0].severity", (r) => (r.reaction = [{ manifestation: [{ text: "rash" }], severity: "life-threatening" }])],
    ];
    for (const [path, change] of cases) {
      const r = good();
      change(r);
      expect(check(r), path).toContain(path);
    }
  });

  it("is what the gateway runs for this type", () => {
    expect(allergyIntoleranceModule.validate).toBe(validateAllergyIntolerance);
  });
});

// ---------------------------------------------------------------------------
// Definition and CapabilityStatement
// ---------------------------------------------------------------------------

describe("AllergyIntolerance definition", () => {
  it("states the source, permissions, parameters and limits", () => {
    expect(allergyIntoleranceModule.definition).toBe(definition);
    expect(definition.source).toBe("public.patient_allergies");
    expect(definition.readPermissions).toEqual(READ_PERMISSIONS.AllergyIntolerance);
    expect([...definition.readPermissions].sort()).toEqual(["consult", "dispense", "register", "vitals"]);
    expect(definition.patientAccess).toBe(false);
    expect(definition.interactions).toEqual(["read", "search-type"]);
    expect(definition.searchParams.map((p) => p.name)).toEqual(["_id", "patient", "clinical-status", "category", "criticality"]);
    expect(definition.requiredSearch).toEqual([["_id"], ["patient"]]);
    expect(definition.notes?.join(" ")).toMatch(/no known allergies/);
  });

  it("appears in the CapabilityStatement with exactly those parameters", () => {
    const cs = capabilityStatement("https://mbhr.app/fhir/R4") as Json;
    const r = cs.rest[0].resource.find((x: Json) => x.type === "AllergyIntolerance");
    expect(r.interaction).toEqual([{ code: "read" }, { code: "search-type" }]);
    expect(r.searchParam.map((p: Json) => p.name)).toEqual(["_id", "patient", "clinical-status", "category", "criticality"]);
    expect(r.documentation).toMatch(/no known allergies/);
    // No claim that a medication category is published or searchable: the
    // form's pre-selected type is left out (see the mapper and search tests).
    const category = r.searchParam.find((p: Json) => p.name === "category").documentation;
    expect(category).toMatch(/^food or environment\. medication and biologic match nothing/);
    expect(r.documentation).toMatch(/No category is sent for allergies saved with the form's pre-selected type \(medication\)/);
    expect(r.documentation).toMatch(/A missing category does not mean the allergy is not to a medicine\./);
    expect(r.documentation).not.toMatch(/category medication/);
  });
});

// ---------------------------------------------------------------------------
// Gateway: who may read
// ---------------------------------------------------------------------------

describe("AllergyIntolerance access", () => {
  it("staff who register, measure, consult or dispense may read", async () => {
    const { call } = setup();
    for (const token of [DOCTOR, NURSE, PHARMACIST, REGISTRAR]) {
      const res = await call(`/fhir/R4/AllergyIntolerance/${AL_ACTIVE.id}`, token);
      expect(res.status, token).toBe(200);
      expect((await json(res)).resourceType).toBe("AllergyIntolerance");
    }
  });

  it("other staff are refused before any allergy row is read, and the refusal is audited", async () => {
    const { call, allergyQueries, audits } = setup();
    for (const token of [AUDITOR, LAB_ONLY, STOCK_ONLY]) {
      expect((await call(`/fhir/R4/AllergyIntolerance/${AL_ACTIVE.id}`, token)).status, token).toBe(403);
      expect((await call(byPatient(PATIENT_A.fhir_id), token)).status, token).toBe(403);
    }
    expect(allergyQueries()).toEqual([]);
    expect(audits.every((a) => a.p_decision === "deny" && a.p_denial_reason === "missing_permission")).toBe(true);
  });

  it("patients are refused, for their own record and for anyone else's", async () => {
    const { call, allergyQueries, audits } = setup();
    const paths = [
      `/fhir/R4/AllergyIntolerance/${AL_ACTIVE.id}`, // own
      byPatient(PATIENT_A.fhir_id), // own
      `/fhir/R4/AllergyIntolerance/${AL_B.id}`, // someone else's
      byPatient(PATIENT_B.fhir_id), // someone else's
    ];
    for (const path of paths) {
      const res = await call(path, PAT_A);
      expect(res.status, path).toBe(403);
      expect(JSON.stringify(await json(res))).not.toMatch(/Penicillin|Peanuts/);
    }
    expect((await call(`/fhir/R4/AllergyIntolerance/${AL_B.id}`, PAT_B)).status).toBe(403);
    expect(allergyQueries()).toEqual([]);
    expect(audits.map((a) => a.p_denial_reason)).toEqual(Array(5).fill("not_available_to_patients"));
  });

  it("the module itself reads nothing for a patient scope (defence in depth)", async () => {
    const urls: string[] = [];
    const db = new Postgrest({
      supabaseUrl: "https://project.supabase.co",
      anonKey: "anon-key",
      accessToken: "token",
      fetchImpl: async (u) => {
        urls.push(u);
        return new Response("[]", { status: 200 });
      },
    });
    const ctx: QueryCtx = {
      db,
      scope: { kind: "patient", patientIds: new Set([PATIENT_A.id]) },
      permissions: new Set(),
      restrictions: new Set(["patient_scope"]),
      baseUrl: "https://mbhr.app/fhir/R4",
      cursorBinding: "",
      patients: { ids: [PATIENT_A.id], requested: [PATIENT_A.id] },
    };
    const read = await allergyIntoleranceModule.read(ctx, AL_ACTIVE.id);
    expect(read.page.resources).toEqual([]);
    const found = await allergyIntoleranceModule.search!(ctx, { values: new Map([["patient", [PATIENT_A.fhir_id]]]), count: 10, cursor: null });
    expect(found.page.resources).toEqual([]);
    expect(found.outcomes).toEqual([ALLERGY_NKA_CAVEAT]);
    expect(urls).toEqual([]);
  });
});

describe("AllergyIntolerance enumeration protection", () => {
  it("refuses staff searches that do not name an allergy or a patient", async () => {
    const { call, allergyQueries, audits } = setup();
    for (const q of ["", "?clinical-status=active", "?category=food", "?criticality=high", "?clinical-status=active&category=food&criticality=high"]) {
      const res = await call(`/fhir/R4/AllergyIntolerance${q}`, DOCTOR);
      expect(res.status, q).toBe(403);
    }
    expect(allergyQueries()).toEqual([]);
    expect(audits.every((a) => a.p_denial_reason === "search_not_narrowed")).toBe(true);
  });

  it("refuses parameters it does not implement instead of ignoring them", async () => {
    const { call, allergyQueries } = setup();
    // R4 AllergyIntolerance has no subject parameter; code, date and the rest are not implemented.
    for (const q of [
      `subject=Patient/${PATIENT_A.fhir_id}`,
      `patient=Patient/${PATIENT_A.fhir_id}&code=penicillin`,
      `patient=Patient/${PATIENT_A.fhir_id}&verification-status=confirmed`,
      `patient=Patient/${PATIENT_A.fhir_id}&date=2026`,
      `patient=Patient/${PATIENT_A.fhir_id}&clinical-status:not=active`,
    ]) {
      expect((await call(`/fhir/R4/AllergyIntolerance?${q}`, DOCTOR)).status, q).toBe(400);
    }
    expect(allergyQueries()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Gateway: searches
// ---------------------------------------------------------------------------

describe("AllergyIntolerance search", () => {
  it("lists a patient's allergies, including rows still on a merged-away record, all under the kept patient", async () => {
    const { call } = setup();
    const b = await json(await call(byPatient(PATIENT_A.fhir_id), DOCTOR));
    expect(b.resourceType).toBe("Bundle");
    expect(b.total).toBeUndefined();
    expect(ids(b)).toEqual([AL_DEVICE.id, AL_ACTIVE.id, AL_INACTIVE.id, AL_OTHER.id, AL_MERGED.id]);
    for (const r of matches(b)) expect(r.patient).toEqual({ reference: `Patient/${PATIENT_A.fhir_id}` });
    expect(JSON.stringify(b)).not.toContain(PATIENT_M.fhir_id);
    expect(matches(b).map(status)).toEqual(["active", "active", "inactive", "active", "active"]);
  });

  it("withholds a record with no clinical status and says a record was left out, never showing it as active", async () => {
    const { call } = setup();
    const b = await json(await call(byPatient(PATIENT_A.fhir_id), DOCTOR));
    expect(ids(b)).not.toContain(AL_UNKNOWN.id);
    expect(JSON.stringify(b)).not.toContain("House dust");
    expect(outcomes(b)).toEqual([
      ALLERGY_NKA_CAVEAT,
      expect.objectContaining({ severity: "warning", diagnostics: expect.stringMatching(/^1 matching record\(s\) were left out/) }),
    ]);
  });

  it("an empty search still carries the 'no known allergies' caveat and never an NKA record", async () => {
    const { call } = setup();
    const b = await json(await call(byPatient(PATIENT_C.fhir_id), DOCTOR));
    expect(b.entry).toHaveLength(1);
    expect(matches(b)).toEqual([]);
    expect(outcomes(b)).toEqual([ALLERGY_NKA_CAVEAT]);
    expect(outcomes(b)[0].diagnostics).toBe(
      "mBHR does not record 'no known allergies'; an empty result means no allergy has been recorded, not that the patient has none.",
    );
    expect(b.entry.some((e: Json) => e.resource.resourceType === "AllergyIntolerance")).toBe(false);
    expect(JSON.stringify(b)).not.toMatch(/"coding"|snomed|716186003|409137002/);
  });

  it("every searchset carries the caveat, whatever matched or was filtered", async () => {
    const { call } = setup();
    for (const q of [
      "",
      "&clinical-status=active",
      "&clinical-status=resolved",
      "&category=biologic",
      "&criticality=low",
      `&_id=${AL_ACTIVE.id}`,
    ]) {
      const b = await json(await call(byPatient(PATIENT_A.fhir_id, q), NURSE));
      expect(outcomes(b), q).toContainEqual(ALLERGY_NKA_CAVEAT);
    }
    const byId = await json(await call(`/fhir/R4/AllergyIntolerance?_id=${AL_B.id}`, PHARMACIST));
    expect(ids(byId)).toEqual([AL_B.id]);
    expect(outcomes(byId)).toEqual([ALLERGY_NKA_CAVEAT]);
  });

  it("a search by the merged-away record matches nothing and names the kept record", async () => {
    const { call } = setup();
    const b = await json(await call(byPatient(PATIENT_M.fhir_id), DOCTOR));
    expect(matches(b)).toEqual([]);
    const issues = outcomes(b);
    expect(issues[0].diagnostics).toContain(`Patient/${PATIENT_A.fhir_id}`);
    expect(issues).toContainEqual(ALLERGY_NKA_CAVEAT);
  });

  it("an unknown patient matches nothing, with the caveat", async () => {
    const { call } = setup();
    const b = await json(await call(byPatient("a1a1a1a1-0000-4000-8000-0000000000ff"), DOCTOR));
    expect(matches(b)).toEqual([]);
    expect(outcomes(b)).toEqual([ALLERGY_NKA_CAVEAT]);
  });

  it("clinical-status filters in the query exactly as the mapper maps", async () => {
    const { call, allergyQueries } = setup();
    const active = await json(await call(byPatient(PATIENT_A.fhir_id, "&clinical-status=active"), DOCTOR));
    expect(ids(active)).toEqual([AL_DEVICE.id, AL_ACTIVE.id, AL_OTHER.id, AL_MERGED.id]);
    expect(allergyQueries().at(-1)).toContain("or=(is_active.is.true)");
    // No record left out: a missing is_active never matches active.
    expect(outcomes(active)).toEqual([ALLERGY_NKA_CAVEAT]);

    const inactive = await json(
      await call(byPatient(PATIENT_A.fhir_id, `&clinical-status=${encodeURIComponent(`${ALLERGY_CLINICAL_SYSTEM}|inactive`)}`), DOCTOR),
    );
    expect(ids(inactive)).toEqual([AL_INACTIVE.id]);
    expect(matches(inactive).map(status)).toEqual(["inactive"]);
    expect(allergyQueries().at(-1)).toContain("or=(is_active.is.false)");

    const before = allergyQueries().length;
    for (const q of ["resolved", "unknown", "https://example.org/other|active"]) {
      const b = await json(await call(byPatient(PATIENT_A.fhir_id, `&clinical-status=${encodeURIComponent(q)}`), DOCTOR));
      expect(matches(b), q).toEqual([]);
    }
    // Codes mBHR never records match nothing without a query.
    expect(allergyQueries().length).toBe(before);
    expect((await call(byPatient(PATIENT_A.fhir_id, "&clinical-status=a%20b"), DOCTOR)).status).toBe(400);
  });

  it("category filters on the recorded type", async () => {
    const { call, allergyQueries } = setup();
    const q = async (v: string) => json(await call(byPatient(PATIENT_A.fhir_id, `&category=${encodeURIComponent(v)}`), DOCTOR));
    expect(ids(await q("food"))).toEqual([AL_INACTIVE.id]);
    expect(allergyQueries().at(-1)).toContain('or=(allergy_type.ilike."food")');
    expect(ids(await q("http://hl7.org/fhir/allergy-intolerance-category|food"))).toEqual([AL_INACTIVE.id]);
    // medication is the form's pre-selected type: the mapper publishes no
    // category for it, so a search for it matches nothing, without a query.
    const before = allergyQueries().length;
    for (const v of ["medication", "http://hl7.org/fhir/allergy-intolerance-category|medication"]) {
      const b = await q(v);
      expect(ids(b), v).toEqual([]);
      expect(outcomes(b), v).toEqual([ALLERGY_NKA_CAVEAT]);
    }
    expect(allergyQueries().length).toBe(before);
    // environmental: the only such row has no clinical status, so it is withheld (and said so).
    const env = await q("environment");
    expect(ids(env)).toEqual([]);
    expect(allergyQueries().at(-1)).toContain('or=(allergy_type.ilike."environmental")');
    expect(outcomes(env).some((i) => i.severity === "warning")).toBe(true);
    for (const v of ["biologic", "other", "https://example.org|food"]) expect(ids(await q(v)), v).toEqual([]);
  });

  it("criticality filters on the recorded rating", async () => {
    const { call, allergyQueries } = setup();
    const q = async (v: string) => json(await call(byPatient(PATIENT_A.fhir_id, `&criticality=${encodeURIComponent(v)}`), DOCTOR));
    const high = await q("high");
    expect(ids(high)).toEqual([AL_ACTIVE.id]);
    expect(matches(high)[0].criticality).toBe("high");
    expect(allergyQueries().at(-1)).toContain('or=(severity.ilike."life-threatening")');
    for (const v of ["low", "unable-to-assess", "severe", "http://hl7.org/fhir/allergy-intolerance-criticality|low"]) {
      expect(ids(await q(v)), v).toEqual([]);
    }
    expect(ids(await q("http://hl7.org/fhir/allergy-intolerance-criticality|high"))).toEqual([AL_ACTIVE.id]);
  });

  it("combines parameters, and _id alone is a narrowing search", async () => {
    const { call, allergyQueries } = setup();
    const both = await json(await call(byPatient(PATIENT_A.fhir_id, "&clinical-status=inactive&category=food"), DOCTOR));
    expect(ids(both)).toEqual([AL_INACTIVE.id]);
    // All three filters go into one query (no row here is both food and life-threatening).
    const none = await json(await call(byPatient(PATIENT_A.fhir_id, "&clinical-status=active&category=food&criticality=high"), DOCTOR));
    expect(ids(none)).toEqual([]);
    const last = allergyQueries().at(-1)!;
    for (const part of ["is_active.is.true", 'allergy_type.ilike."food"', "severity.ilike", `patient_id=in.("${PATIENT_A.id}","${PATIENT_M.id}")`]) {
      expect(last, part).toContain(part);
    }
    const byId = await json(await call(`/fhir/R4/AllergyIntolerance?_id=${AL_MERGED.id}`, DOCTOR));
    expect(ids(byId)).toEqual([AL_MERGED.id]);
    expect(matches(byId)[0].patient.reference).toBe(`Patient/${PATIENT_A.fhir_id}`);
    // _id of another patient's allergy with this patient: nothing.
    expect(ids(await json(await call(byPatient(PATIENT_A.fhir_id, `&_id=${AL_B.id}`), DOCTOR)))).toEqual([]);
  });

  it("pages with a stable cursor, no duplicates, and the caveat on every page", async () => {
    const { call } = setup();
    const seen: string[] = [];
    let url: string | null = byPatient(PATIENT_A.fhir_id, "&_count=2");
    let pages = 0;
    while (url && pages < 10) {
      const b = await json(await call(url, NURSE));
      expect(outcomes(b)).toContainEqual(ALLERGY_NKA_CAVEAT);
      seen.push(...ids(b));
      const next = b.link.find((l: Json) => l.relation === "next");
      url = next ? next.url.replace("https://mbhr.app", "") : null;
      pages++;
    }
    expect(pages).toBe(3);
    expect(seen).toEqual([AL_DEVICE.id, AL_ACTIVE.id, AL_INACTIVE.id, AL_OTHER.id, AL_MERGED.id]);
  });

  it("audits the patients the result belongs to, including the merged-away member", async () => {
    const { call, audits } = setup();
    await call(byPatient(PATIENT_A.fhir_id), DOCTOR);
    const a = audits.at(-1)!;
    expect(a).toMatchObject({ p_decision: "permit", p_interaction: "search", p_resource_type: "AllergyIntolerance", p_result_count: 5 });
    expect([...(a.p_patient_ids as string[])].sort()).toEqual([PATIENT_A.id, PATIENT_M.id].sort());
    expect(a.p_search_params).toEqual(["patient"]);
  });
});

// ---------------------------------------------------------------------------
// Gateway: reads and ids
// ---------------------------------------------------------------------------

describe("AllergyIntolerance read", () => {
  it("returns the mapped resource with ETag and no-store", async () => {
    const { call } = setup();
    const res = await call(`/fhir/R4/AllergyIntolerance/${AL_ACTIVE.id}`, DOCTOR);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const a = await json(res);
    expect(res.headers.get("etag")).toBe(`W/"${a.meta.versionId}"`);
    const withoutMeta = (r: object) => ({ ...r, meta: undefined });
    expect(withoutMeta(a)).toEqual(withoutMeta(mapAllergy(AL_ACTIVE, MAP_CTX)!));
    expect(a.meta.lastUpdated).toBe("2026-05-02T10:00:00.000Z");
  });

  it("keeps device-made (ULID) ids as they are when the column holds them", async () => {
    const { call } = setup();
    const res = await call(`/fhir/R4/AllergyIntolerance/${AL_DEVICE.id}`, NURSE);
    expect(res.status).toBe(200);
    expect((await json(res)).id).toBe(AL_DEVICE.id);
  });

  it("an id the uuid column cannot hold is simply not found, without database detail", async () => {
    const { call } = setup({}, uuidIdColumn);
    const res = await call(`/fhir/R4/AllergyIntolerance/${AL_DEVICE.id}`, DOCTOR);
    expect(res.status).toBe(404);
    const text = JSON.stringify(await json(res));
    expect(text).not.toMatch(/uuid|22P02|syntax|patient_allergies/);
    const b = await json(await call(`/fhir/R4/AllergyIntolerance?_id=${AL_DEVICE.id}`, DOCTOR));
    expect(matches(b)).toEqual([]);
    expect(outcomes(b)).toEqual([ALLERGY_NKA_CAVEAT]);
    // A real uuid still reads.
    expect((await call(`/fhir/R4/AllergyIntolerance/${AL_ACTIVE.id}`, DOCTOR)).status).toBe(200);
  });

  it("404s a missing allergy and 400s an id that is not a FHIR id, before any query", async () => {
    const { call, allergyQueries } = setup();
    expect((await call("/fhir/R4/AllergyIntolerance/a0000000-0000-4000-8000-0000000000ff", DOCTOR)).status).toBe(404);
    const before = allergyQueries().length;
    for (const bad of ["bad_id", "a%2Cb", "x".repeat(65), "a:b"]) {
      expect((await call(`/fhir/R4/AllergyIntolerance/${bad}`, DOCTOR)).status, bad).toBe(400);
    }
    expect(allergyQueries().length).toBe(before);
    expect((await call("/fhir/R4/AllergyIntolerance?_id=bad_id", DOCTOR)).status).toBe(400);
  });

  it("a record with no clinical status fails closed on read rather than being shown", async () => {
    const { call } = setup();
    const res = await call(`/fhir/R4/AllergyIntolerance/${AL_UNKNOWN.id}`, DOCTOR);
    expect(res.status).toBe(500);
    const text = JSON.stringify(await json(res));
    expect(text).not.toContain("House dust");
    expect(text).not.toContain('"active"');
  });

  it("reads an allergy still on a merged-away record as the kept patient's", async () => {
    const { call } = setup();
    const a = await json(await call(`/fhir/R4/AllergyIntolerance/${AL_MERGED.id}`, DOCTOR));
    expect(a.patient).toEqual({ reference: `Patient/${PATIENT_A.fhir_id}` });
  });

  it("row-level security still applies: an allergy the database hides is not found", async () => {
    const { call } = setup({ visible: (table, row) => !(table === "patient_allergies" && row.patient_id === PATIENT_B.id) });
    expect((await call(`/fhir/R4/AllergyIntolerance/${AL_B.id}`, DOCTOR)).status).toBe(404);
    const b = await json(await call(byPatient(PATIENT_B.fhir_id), DOCTOR));
    expect(matches(b)).toEqual([]);
    expect(outcomes(b)).toEqual([ALLERGY_NKA_CAVEAT]);
  });
});

// ---------------------------------------------------------------------------
// Allergies whose patient does not resolve: never dropped silently
// ---------------------------------------------------------------------------

/** The default fixtures plus the orphaned tombstone T and its allergy. */
const TOMB_TABLES = {
  patients: [PATIENT_A, PATIENT_M, PATIENT_B, PATIENT_C, PATIENT_T],
  patient_allergies: [...ALL_ROWS, AL_TOMB],
};

/**
 * A database on which the patient `id` no longer resolves when allergy rows
 * are mapped (its merge chain does not end, or a hop is hidden from the
 * caller), while the patient a search names still resolves.
 */
function unresolvable(id: string): (inner: FetchLike) => FetchLike {
  return (inner) => async (input, init) => {
    const res = await inner(input, init);
    if (!input.endsWith("/rpc/fhir_resolve_patients")) return res;
    const body = JSON.parse(String(init?.body ?? "{}")) as Json;
    if (!((body.p_ids as string[] | null) ?? []).includes(id)) return res;
    const rows = (await res.json()) as Json[];
    const broken = rows.map((r) => (r.input === id ? { ...r, canonical_id: null, canonical_fhir_id: null, chain_ok: false, member_ids: [] } : r));
    return new Response(JSON.stringify(broken), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

describe("AllergyIntolerance whose patient does not resolve", () => {
  it("an _id search says the allergy was left out, instead of implying that none is recorded", async () => {
    const { call } = setup({ tables: TOMB_TABLES });
    const b = await json(await call(`/fhir/R4/AllergyIntolerance?_id=${AL_TOMB.id}`, DOCTOR));
    expect(matches(b)).toEqual([]);
    // The caveat alone would say "no allergy has been recorded": the warning says otherwise.
    expect(outcomes(b)).toEqual([ALLERGY_NKA_CAVEAT, allergyLeftOutWarning(1)]);
    const warning = outcomes(b)[1];
    expect(warning.severity).toBe("warning");
    expect(warning.diagnostics).toMatch(/^1 matching allergy record\(s\) were left out because the patient record they are filed under could not be resolved/);
    expect(warning.diagnostics).toMatch(/not the complete list/);
    const text = JSON.stringify(b);
    for (const secret of ["Amoxicillin", "Anaphylaxis", PATIENT_T.id, PATIENT_T.fhir_id, "patient_allergies", "merged_into"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("a read fails closed (500, audited) rather than answering 'not found' for a recorded allergy", async () => {
    const { call, audits, logs } = setup({ tables: TOMB_TABLES });
    const res = await call(`/fhir/R4/AllergyIntolerance/${AL_TOMB.id}`, DOCTOR);
    expect(res.status).toBe(500);
    const text = JSON.stringify(await json(res));
    for (const secret of ["Amoxicillin", "Anaphylaxis", PATIENT_T.id, PATIENT_T.fhir_id]) expect(text, secret).not.toContain(secret);
    expect(audits.at(-1)).toMatchObject({ p_decision: "deny", p_http_status: 500, p_resource_type: "AllergyIntolerance" });
    expect(logs.join("\n")).not.toContain("Amoxicillin");
    // An allergy that does not exist is still simply not found.
    expect((await call("/fhir/R4/AllergyIntolerance/c0000000-0000-4000-8000-0000000000ff", DOCTOR)).status).toBe(404);
    // Allergies whose patient resolves are unaffected.
    expect((await call(`/fhir/R4/AllergyIntolerance/${AL_ACTIVE.id}`, DOCTOR)).status).toBe(200);
  });

  it("a search by the tombstone matches nothing and says its kept record is not available", async () => {
    const { call } = setup({ tables: TOMB_TABLES });
    const b = await json(await call(byPatient(PATIENT_T.fhir_id), DOCTOR));
    expect(matches(b)).toEqual([]);
    const issues = outcomes(b);
    expect(issues[0].diagnostics).toMatch(/merged into another record that is not available/);
    expect(issues).toContainEqual(ALLERGY_NKA_CAVEAT);
    expect(JSON.stringify(b)).not.toContain("Amoxicillin");
  });

  it("a patient search with nothing left out carries no warning", async () => {
    const { call } = setup({ tables: TOMB_TABLES });
    const b = await json(await call(byPatient(PATIENT_B.fhir_id), DOCTOR));
    expect(ids(b)).toEqual([AL_B.id]);
    expect(outcomes(b)).toEqual([ALLERGY_NKA_CAVEAT]);
  });

  it("reports each left-out allergy on exactly one page, and never shows it under another patient", async () => {
    // A's own rows interleaved with rows still filed under M, whose chain
    // stops resolving when the rows are mapped.
    const onA = (n: number) => ({ ...BASE, id: `b0000000-0000-4000-8000-00000000000${n}`, allergen: `Allergen ${n}` });
    const onM = (n: number) => ({ ...onA(n), patient_id: PATIENT_M.id });
    const rows = [onA(1), onM(2), onA(3), onM(4), onM(5), onA(6)];
    for (const count of [1, 2, 3, 10]) {
      const { call } = setup({ tables: { patients: [PATIENT_A, PATIENT_M], patient_allergies: rows } }, unresolvable(PATIENT_M.id));
      const seen: string[] = [];
      let leftOut = 0;
      let url: string | null = byPatient(PATIENT_A.fhir_id, `&_count=${count}`);
      let pages = 0;
      while (url && pages < 10) {
        const b = await json(await call(url, DOCTOR));
        expect(outcomes(b)[0], String(count)).toEqual(ALLERGY_NKA_CAVEAT);
        for (const i of outcomes(b).filter((o) => o.severity === "warning")) {
          const m = /^(\d+) matching allergy record\(s\) were left out/.exec(i.diagnostics);
          expect(m, i.diagnostics).not.toBeNull();
          leftOut += Number(m![1]);
        }
        for (const r of matches(b)) expect(r.patient).toEqual({ reference: `Patient/${PATIENT_A.fhir_id}` });
        seen.push(...ids(b));
        const next = b.link.find((l: Json) => l.relation === "next");
        url = next ? next.url.replace("https://mbhr.app", "") : null;
        pages++;
      }
      expect(seen, String(count)).toEqual([onA(1).id, onA(3).id, onA(6).id]);
      expect(leftOut, String(count)).toBe(3);
    }
  });

  it("counts only the rows a page covers", () => {
    const rows = (flags: boolean[]): ExaminedRow[] => flags.map((leftOut, i) => ({ key: `k${i}`, leftOut }));
    const examined = rows([false, true, false, true, true, false]);
    // No next link: every fetched row belongs to this page.
    expect(leftOutOnPage(examined, null)).toBe(3);
    // The next page resumes after k2: k3 and k4 are counted there, not here.
    expect(leftOutOnPage(examined, { k: "k2" })).toBe(1);
    expect(leftOutOnPage(examined, { k: "k0" })).toBe(0);
    expect(leftOutOnPage(examined, { k: "k5" })).toBe(3);
    // A resume key that was not fetched: count everything rather than nothing.
    expect(leftOutOnPage(examined, { k: "elsewhere" })).toBe(3);
    expect(leftOutOnPage([], null)).toBe(0);
    expect(allergyLeftOutWarning(2)).toEqual({ severity: "warning", code: "processing", diagnostics: expect.stringMatching(/^2 matching allergy record\(s\)/) });
  });
});

// ---------------------------------------------------------------------------
// Recorder through the staff directory
// ---------------------------------------------------------------------------

describe("AllergyIntolerance recorder", () => {
  it("names the recorder only through the staff directory, never by account id", async () => {
    const { call, directoryCalls } = setup();
    const b = await json(await call(byPatient(PATIENT_A.fhir_id), DOCTOR));
    const recorders = Object.fromEntries(matches(b).map((r) => [r.id, r.recorder?.reference]));
    expect(recorders).toEqual({
      [AL_DEVICE.id]: `Practitioner/${PRACTITIONER_ID}`,
      [AL_ACTIVE.id]: `Practitioner/${PRACTITIONER_ID}`,
      [AL_INACTIVE.id]: undefined, // device-made account: unknown to the directory
      [AL_OTHER.id]: undefined, // "patient-submitted"
      [AL_MERGED.id]: undefined, // not an account id the directory accepts: not sent
    });
    const calls = directoryCalls();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(Object.keys(c).sort()).toEqual(["p_limit", "p_source_ids"]);
      expect(c.p_limit).toBe(101);
      expect(c.p_source_ids).not.toContain("legacy:account 7");
    }
    expect([...new Set(calls.flatMap((c) => c.p_source_ids as string[]))].sort()).toEqual(
      [DEVICE_STAFF, DOCTOR_ACCOUNT, "patient-submitted"].sort(),
    );
  });

  it("still serves allergies, without a recorder, when the directory is missing or fails", async () => {
    const missing = setup({ rpcs: {} });
    const failing = setup({ rpcs: { fhir_staff_directory: () => new Response(JSON.stringify({ code: "XX000" }), { status: 500 }) } });
    for (const { call } of [missing, failing]) {
      const res = await call(`/fhir/R4/AllergyIntolerance/${AL_ACTIVE.id}`, DOCTOR);
      expect(res.status).toBe(200);
      const a = await json(res);
      expect(a.recorder).toBeUndefined();
      expect(status(a)).toBe("active");
      const b = await json(await call(byPatient(PATIENT_A.fhir_id), DOCTOR));
      expect(ids(b)).toHaveLength(5);
      expect(matches(b).every((r) => r.recorder === undefined)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Nothing private is served
// ---------------------------------------------------------------------------

describe("AllergyIntolerance never publishes", () => {
  it("account ids, notes, internal patient ids, contact details or database names", async () => {
    const { call, allergyQueries, logs } = setup();
    const served = [
      await json(await call(byPatient(PATIENT_A.fhir_id), DOCTOR)),
      await json(await call(`/fhir/R4/AllergyIntolerance/${AL_ACTIVE.id}`, NURSE)),
      await json(await call(`/fhir/R4/AllergyIntolerance/${AL_INACTIVE.id}`, PHARMACIST)),
      await json(await call(`/fhir/R4/AllergyIntolerance?_id=${AL_OTHER.id}`, REGISTRAR)),
    ];
    const text = JSON.stringify(served);
    for (const secret of [
      DOCTOR_ACCOUNT,
      DEVICE_STAFF,
      "patient-submitted",
      "legacy:account",
      STAFF_NOTE,
      PATIENT_A.id,
      PATIENT_M.id,
      PATIENT_M.fhir_id,
      PATIENT_A.email,
      PATIENT_A.auth_uid,
      "patient_allergies",
      "created_by",
      "is_active",
      "_dirty",
      "storage",
      "doctor-1",
      "nurse-1",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    // The notes and sync columns are never even requested.
    for (const q of allergyQueries()) expect(q).not.toMatch(/select=[^&]*(notes|_dirty|_synced_at)/);
    // Logs carry no patient data or allergen text.
    const log = logs.join("\n");
    for (const secret of [PATIENT_A.fhir_id, "Penicillin", STAFF_NOTE, DOCTOR_ACCOUNT]) expect(log).not.toContain(secret);
  });
});
