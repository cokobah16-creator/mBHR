// @vitest-environment node
//
// Laboratory: ServiceRequest, DiagnosticReport and laboratory Observations.
// The pure mappers and status maps first (every field, every status row,
// the forbidden mappings, critical results keeping their meaning), then the
// gateway end to end against the in-memory Supabase: who may read, patient
// self-access through the release function only, anti-enumeration, invalid
// ids, merged patients, paging, and nothing forbidden in any served JSON.

import { describe, expect, it } from "vitest";
import { handleFhirRequest } from "../gateway/handler";
import { Postgrest } from "../gateway/postgrest";
import { FhirError } from "../errors/operationOutcome";
import { explainStatus, applyStatusMap } from "../terminology/statusMaps";
import { STATUS_MAPS } from "../terminology/status";
import {
  DIAGNOSTIC_REPORT_STATUS,
  LABORATORY_STATUS_MAPS,
  LAB_INTERPRETATION,
  LAB_OBSERVATION_STATUS,
  SERVICE_REQUEST_PRIORITY,
  SERVICE_REQUEST_STATUS,
} from "../terminology/status/laboratory";
import {
  LAB_TEST_SYSTEM,
  labInterpretation,
  labTestConcept,
  labValue,
  mapDiagnosticReport,
  mapLabObservation,
  mapServiceRequest,
  plainNumber,
  reportState,
  resultReviewState,
  splitPatientLabRow,
} from "../mappers/laboratory";
import { labObservationSource, validateLabObservation } from "../resources/labObservation";
import { LAB_RESULTS_WITHHELD } from "../resources/observation";
import type { QueryCtx } from "../resources/module";
import type { MapContext } from "../mappers/common";
import { fakeSupabase, makeToken, type FakeOptions, type FakeUser, type RpcHandler } from "./fakeSupabase";
import { PATIENT_A, PATIENT_B, VISIT_A, VITALS_A } from "./fixtures";

// ---------------------------------------------------------------------------
// Fixtures (synthetic; no real patient data)
// ---------------------------------------------------------------------------

const PATIENT_M = {
  ...PATIENT_A,
  id: "01HZZPATIENTM0000000000000",
  fhir_id: "0b3c1d2e-1111-4aaa-8bbb-00000000000d",
  given_name: "Ada",
  family_name: "Okafor-Dup",
  merged_into: PATIENT_A.id,
  merged_at: "2026-06-01T10:00:00+00:00",
};

const o = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const r = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Account ids (auth uids) that must never appear in served JSON. */
const ORDERER_UID = "auth-uid-doctor-0001";
const UNMAPPED_UID = "auth-uid-unmapped-0002";
const REVIEWER_UID = "auth-uid-reviewer-0003";
const ENTERER_UID = "auth-uid-nurse-0004";
const RELEASER_UID = "auth-uid-releaser-0005";
const WITHHOLDER_UID = "auth-uid-withholder-0006";
const PRACTITIONER_ID = "7a1e2b3c-0000-4000-8000-0000000000d1";

const ORDER_BASE = {
  patient_id: PATIENT_A.id,
  visit_id: null as string | null,
  ordered_by: ORDERER_UID,
  test_name: "Complete Blood Count (CBC)",
  test_code: "CBC" as string | null,
  priority: "routine",
  status: "completed",
  specimen_type: "SECRET specimen",
  clinical_notes: "SECRET clinical note",
  ordered_at: "2026-05-01T08:30:00+00:00",
  collected_at: null as string | null,
  completed_at: "2026-05-01T11:00:00+00:00",
  cancelled_at: null as string | null,
  created_at: "2026-05-01T08:30:00+00:00",
  updated_at: "2026-05-01T11:00:00+00:00",
};

const O1 = { ...ORDER_BASE, id: o(1), visit_id: VISIT_A.id, collected_at: "2026-05-01T09:00:00+00:00" };
const O2 = {
  ...ORDER_BASE,
  id: o(2),
  visit_id: VISIT_A.id,
  ordered_by: UNMAPPED_UID,
  test_name: "Blood Glucose",
  test_code: "GLUCOSE",
  priority: "stat",
  ordered_at: "2026-05-01T08:35:00+00:00",
  collected_at: "2026-05-01T09:05:00+00:00",
};
const O3 = { ...ORDER_BASE, id: o(3), test_name: "HIV Test", test_code: "HIV", priority: "urgent", status: "cancelled", ordered_at: "2026-05-02T08:00:00+00:00", completed_at: null };
// A quick pick whose name was edited afterwards keeps the old code: no local coding.
const O4 = { ...ORDER_BASE, id: o(4), test_name: "CBC with differential", status: "ordered", ordered_at: "2026-05-03T08:00:00+00:00", completed_at: null };
const O5 = { ...ORDER_BASE, id: o(5), patient_id: PATIENT_B.id, test_name: "Malaria Rapid Test", test_code: "MRDTrunc" };
const O6 = { ...ORDER_BASE, id: o(6), ordered_at: "2026-04-20T08:00:00+00:00", collected_at: "2026-04-20T09:00:00+00:00" };
const O7 = { ...ORDER_BASE, id: o(7), test_name: "Urinalysis", test_code: "UA", status: "cancelled", ordered_at: "2026-04-21T08:00:00+00:00" };
const O8 = { ...ORDER_BASE, id: o(8), test_name: "Lipid Panel", test_code: "LIPID", status: "processing", ordered_at: "2026-04-22T08:00:00+00:00", collected_at: "2026-04-22T09:00:00+00:00" };
const OM = { ...ORDER_BASE, id: o(9), patient_id: PATIENT_M.id, test_name: "Pregnancy Test", test_code: "PREG", ordered_at: "2026-03-01T08:00:00+00:00", collected_at: "2026-03-01T09:00:00+00:00" };
// Values the app does not write: status and priority fall back, never guessed.
const O10 = { ...ORDER_BASE, id: o(10), test_code: null, test_name: "Serum ferritin", status: "archived", priority: "asap", ordered_at: "2026-05-04T08:00:00+00:00" };

const RESULT_BASE = {
  result_value: "12.5",
  result_unit: "g/dL" as string | null,
  reference_range: "12–16 g/dL" as string | null,
  interpretation: "normal" as string | null,
  result_date: "2026-05-01T11:00:00+00:00",
  reviewed_by: REVIEWER_UID as string | null,
  reviewed_at: "2026-05-02T10:00:00+00:00" as string | null,
  notes: "SECRET staff note",
  entered_by: ENTERER_UID,
  released_to_patient_at: null as string | null,
  released_to_patient_by: null as string | null,
  patient_note: "SECRET patient note",
  withheld_at: null as string | null,
  withheld_by: null as string | null,
  withheld_reason: null as string | null,
  amended_at: null as string | null,
  superseded_by: null as string | null,
  created_at: "2026-05-01T11:00:00+00:00",
  updated_at: "2026-05-02T10:00:00+00:00",
};
const released = { released_to_patient_at: "2026-05-02T10:05:00+00:00", released_to_patient_by: RELEASER_UID };
const unreviewed = { reviewed_at: null, reviewed_by: null, updated_at: "2026-05-01T11:00:00+00:00" };

const R1a = { ...RESULT_BASE, ...released, id: r(11), order_id: O1.id };
const R1b = { ...RESULT_BASE, ...unreviewed, id: r(12), order_id: O1.id, result_value: "<0.5", result_unit: "mg/dL", reference_range: null, interpretation: "abnormal" };
const R2 = {
  ...RESULT_BASE,
  ...released,
  id: r(21),
  order_id: O2.id,
  result_value: "2.1",
  result_unit: "mmol/L",
  reference_range: "3.9–5.5 mmol/L",
  interpretation: "critical",
  reviewed_at: "2026-05-01T09:30:00+00:00",
  updated_at: "2026-05-01T09:30:00+00:00",
};
const R5 = { ...RESULT_BASE, ...released, id: r(51), order_id: O5.id, result_value: "Positive", result_unit: null, interpretation: "abnormal" };
const R6old = { ...RESULT_BASE, ...released, id: r(61), order_id: O6.id, result_value: "9.1", superseded_by: r(62) };
const R6new = { ...RESULT_BASE, ...released, id: r(62), order_id: O6.id, result_value: "11.9" };
const R7 = { ...RESULT_BASE, ...released, id: r(71), order_id: O7.id, result_value: "Negative", result_unit: null, interpretation: "normal" };
// Legacy: an unreviewed "normal" may be the form's old default.
const R8a = { ...RESULT_BASE, ...unreviewed, id: r(81), order_id: O8.id, result_value: "4.2", result_unit: "mmol/L" };
// Reviewed on an older database without the checks: no interpretation.
const R8b = { ...RESULT_BASE, id: r(82), order_id: O8.id, result_value: "1.1", result_unit: "mmol/L", interpretation: null };
// Reviewed, but no value recorded.
const R8c = { ...RESULT_BASE, id: r(83), order_id: O8.id, result_value: "", interpretation: "abnormal" };
// Kept off the portal with a reason: still a valid clinical result for staff.
const R8d = {
  ...RESULT_BASE,
  id: r(84),
  order_id: O8.id,
  result_value: "5.5",
  result_unit: "mmol/L",
  withheld_at: "2026-05-02T11:00:00+00:00",
  withheld_by: WITHHOLDER_UID,
  withheld_reason: "SECRET withheld reason",
};
const RM = { ...RESULT_BASE, ...released, id: r(91), order_id: OM.id, result_value: "Negative", result_unit: null };

const ORDERS = [O1, O2, O3, O4, O5, O6, O7, O8, OM, O10];
const RESULTS = [R1a, R1b, R2, R5, R6old, R6new, R7, R8a, R8b, R8c, R8d, RM];

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
const REVIEWER = makeToken("reviewer-1");
const NURSE = makeToken("nurse-1");
const VOLUNTEER = makeToken("volunteer-1");
const PHARMACIST = makeToken("pharm-1");
const PAT_A = makeToken("portal-a");
const PAT_B = makeToken("portal-b");

const USERS: Record<string, FakeUser> = {
  [DOCTOR]: { id: "doctor-1", role: "doctor", permissions: ["consult", "lab_review", "lab_release", "register", "vitals", "queue"] },
  // lab_review alone is enough (a lead clinician who reviews but does not consult).
  [REVIEWER]: { id: "reviewer-1", role: "lead_clinician", permissions: ["lab_review"] },
  // Owner decision 3: nurses are excluded from laboratory data, like volunteers.
  [NURSE]: { id: "nurse-1", role: "nurse", permissions: ["register", "vitals", "queue", "portal_manage"] },
  [VOLUNTEER]: { id: "volunteer-1", role: "volunteer", permissions: ["register", "vitals", "queue"] },
  [PHARMACIST]: { id: "pharm-1", role: "pharmacist", permissions: ["dispense", "inventory", "queue"] },
  [PAT_A]: { id: "portal-a", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_A.id] },
  [PAT_B]: { id: "portal-b", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_B.id] },
};

/** Row-level security as the latest migrations have it: patients cannot read the lab tables at all. */
function visible(table: string, row: Record<string, unknown>, user: FakeUser): boolean {
  if ((user.kind ?? "staff") !== "patient") return true;
  if (table === "lab_orders" || table === "lab_results") return false;
  const own = user.patientIds ?? [];
  if (table === "patients") return own.includes(String(row.id));
  return own.includes(String(row.patient_id));
}

const refuse = (code: string, status: number) => new Response(JSON.stringify({ code }), { status });

/** public.fhir_patient_lab_results as the Phase 2 migration defines it. */
const patientLabResults: RpcHandler = (body, user, state) => {
  if (user.kind !== "patient") return refuse("42501", 403);
  const own = user.patientIds ?? [];
  const orders = new Map((state.opts.tables.lab_orders ?? []).map((row) => [String(row.id), row]));
  const resultIds = (body.p_result_ids as string[] | null) ?? null;
  const orderIds = (body.p_order_ids as string[] | null) ?? null;
  const after = (body.p_after as string | null) ?? null;
  const limit = Math.min(Math.max(typeof body.p_limit === "number" ? body.p_limit : 100, 1), 101);
  return (state.opts.tables.lab_results ?? [])
    .filter((res) => {
      const ord = orders.get(String(res.order_id));
      return (
        ord !== undefined &&
        own.includes(String(ord.patient_id)) &&
        res.reviewed_at != null &&
        res.released_to_patient_at != null &&
        res.withheld_at == null &&
        res.superseded_by == null &&
        (resultIds === null || resultIds.includes(String(res.id))) &&
        (orderIds === null || orderIds.includes(String(res.order_id))) &&
        (after === null || String(res.id) > after)
      );
    })
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
    .slice(0, limit)
    .map((res) => {
      const ord = orders.get(String(res.order_id)) as Record<string, unknown>;
      return {
        id: res.id,
        order_id: res.order_id,
        result_value: res.result_value,
        result_unit: res.result_unit ?? null,
        reference_range: res.reference_range ?? null,
        interpretation: res.interpretation ?? null,
        result_date: res.result_date ?? null,
        reviewed_at: res.reviewed_at,
        released_to_patient_at: res.released_to_patient_at,
        amended_at: res.amended_at ?? null,
        created_at: res.created_at ?? null,
        updated_at: res.updated_at ?? null,
        patient_id: ord.patient_id,
        visit_id: ord.visit_id ?? null,
        test_name: ord.test_name,
        test_code: ord.test_code ?? null,
        priority: ord.priority ?? null,
        order_status: ord.status ?? null,
        ordered_at: ord.ordered_at ?? null,
        collected_at: ord.collected_at ?? null,
        order_created_at: ord.created_at ?? null,
        order_updated_at: ord.updated_at ?? null,
      };
    });
};

/** public.fhir_staff_directory, p_source_ids mode only (staff callers only). */
const staffDirectory: RpcHandler = (body, user) => {
  if ((user.kind ?? (user.role ? "staff" : "none")) !== "staff") return refuse("42501", 403);
  const ids = (body.p_source_ids as string[] | null) ?? [];
  const directory: Record<string, string> = { [ORDERER_UID]: PRACTITIONER_ID };
  return ids
    .filter((id) => directory[id])
    .map((id) => ({ fhir_id: directory[id], source_id: id, full_name: "Dr Example", role: "doctor", active: true, created_at: null, updated_at: null }));
};

function setup(overrides: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({
    users: USERS,
    tables: {
      patients: [PATIENT_A, PATIENT_B, PATIENT_M],
      visits: [VISIT_A],
      vitals: [VITALS_A],
      lab_orders: ORDERS,
      lab_results: RESULTS,
    },
    visible,
    rpcs: { fhir_patient_lab_results: patientLabResults, fhir_staff_directory: staffDirectory },
    ...overrides,
  });
  const served: string[] = [];
  const call = async (path: string, token?: string) => {
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await handleFhirRequest(new Request(`https://mbhr.app${path}`, { headers }), {
      env: ENV,
      fetchImpl: fake.fetchImpl,
      randomId: () => "11111111-2222-4333-8444-555555555555",
      log: () => undefined,
      now: () => new Date("2026-09-25T12:00:00Z"),
    });
    const text = await res.text();
    served.push(text);
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
  };
  return { ...fake, call, served };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const matches = (b: Json): Json[] => (b.entry ?? []).filter((e: Json) => e.search.mode === "match").map((e: Json) => e.resource);
const idsOf = (b: Json): string[] => matches(b).map((x) => x.id);
const outcomes = (b: Json): Json[] => (b.entry ?? []).filter((e: Json) => e.search.mode === "outcome").flatMap((e: Json) => e.resource.issue);
const lab = (id: string) => `lab-${id}`;

/** Follow next links to the end; the ids of every page, in order. */
async function allPages(call: ReturnType<typeof setup>["call"], path: string, token: string): Promise<string[]> {
  const seen: string[] = [];
  let url: string | null = path;
  for (let i = 0; url && i < 50; i++) {
    const { status, body } = await call(url, token);
    expect(status, url).toBe(200);
    seen.push(...idsOf(body));
    const next = (body.link as Json[]).find((l) => l.relation === "next");
    url = next ? String(next.url).replace("https://mbhr.app", "") : null;
  }
  return seen;
}

const REFS: MapContext = {
  patientFhirIds: new Map([
    [PATIENT_A.id, PATIENT_A.fhir_id],
    [PATIENT_M.id, PATIENT_A.fhir_id],
    [PATIENT_B.id, PATIENT_B.fhir_id],
  ]),
};

// ---------------------------------------------------------------------------
// Status maps
// ---------------------------------------------------------------------------

describe("laboratory status maps", () => {
  it("are all listed for the shared status-map checks", () => {
    for (const m of LABORATORY_STATUS_MAPS) expect(STATUS_MAPS).toContain(m);
  });

  it("ServiceRequest.status: every row, and missing or unrecognised stays unknown", () => {
    const cases: [unknown, string][] = [
      ["ordered", "active"],
      ["collected", "active"],
      ["processing", "active"],
      ["completed", "completed"],
      ["cancelled", "revoked"],
      ["Cancelled", "revoked"],
      [null, "unknown"],
      ["", "unknown"],
      ["archived", "unknown"],
      [" cancelled", "unknown"],
    ];
    for (const [raw, fhir] of cases) expect(applyStatusMap(SERVICE_REQUEST_STATUS, raw), String(raw)).toBe(fhir);
    expect(explainStatus(SERVICE_REQUEST_STATUS, "completed").reason).toMatch(/says nothing about review/);
  });

  it("a cancelled order is never completed, active or entered-in-error", () => {
    expect(applyStatusMap(SERVICE_REQUEST_STATUS, "cancelled")).toBe("revoked");
    for (const m of [SERVICE_REQUEST_STATUS, DIAGNOSTIC_REPORT_STATUS]) {
      for (const rule of m.rules) {
        if (rule.source.some((s) => s.includes("cancel"))) expect(["completed", "final", "active", "entered-in-error"]).not.toContain(rule.fhir);
      }
    }
  });

  it("ServiceRequest.priority: only the three recorded values, nothing guessed", () => {
    expect(applyStatusMap(SERVICE_REQUEST_PRIORITY, "routine")).toBe("routine");
    expect(applyStatusMap(SERVICE_REQUEST_PRIORITY, "urgent")).toBe("urgent");
    expect(applyStatusMap(SERVICE_REQUEST_PRIORITY, "stat")).toBe("stat");
    for (const raw of [null, "", "asap", "high"]) expect(applyStatusMap(SERVICE_REQUEST_PRIORITY, raw), String(raw)).toBeNull();
  });

  it("DiagnosticReport.status: every report state", () => {
    const cases: [unknown, string][] = [
      ["awaiting_result", "registered"],
      ["cancelled", "cancelled"],
      ["unreviewed", "partial"],
      ["reviewed", "final"],
      ["released_results_reviewed", "partial"],
      ["results_on_cancelled_order", "unknown"],
      ["completed_without_result", "unknown"],
      ["unrecognised_order_status", "unknown"],
      [null, "unknown"],
    ];
    for (const [raw, fhir] of cases) expect(applyStatusMap(DIAGNOSTIC_REPORT_STATUS, raw), String(raw)).toBe(fhir);
    // Critic C3: unreviewed results make a partial report, never preliminary or final.
    expect(applyStatusMap(DIAGNOSTIC_REPORT_STATUS, "unreviewed")).toBe("partial");
    // A patient's view (released results only) is never final.
    expect(explainStatus(DIAGNOSTIC_REPORT_STATUS, "released_results_reviewed").reason).toMatch(/Never final/);
  });

  it("Observation.status (laboratory): preliminary until reviewed, final after", () => {
    expect(applyStatusMap(LAB_OBSERVATION_STATUS, "reviewed")).toBe("final");
    expect(applyStatusMap(LAB_OBSERVATION_STATUS, "unreviewed")).toBe("preliminary");
    expect(applyStatusMap(LAB_OBSERVATION_STATUS, "review_incomplete")).toBe("preliminary");
    expect(applyStatusMap(LAB_OBSERVATION_STATUS, null)).toBe("unknown");
    expect(applyStatusMap(LAB_OBSERVATION_STATUS, "something")).toBe("unknown");
  });

  it("interpretation: N, A, AA only; missing or unknown values are left out", () => {
    expect(applyStatusMap(LAB_INTERPRETATION, "normal")).toBe("N");
    expect(applyStatusMap(LAB_INTERPRETATION, "abnormal")).toBe("A");
    expect(applyStatusMap(LAB_INTERPRETATION, "critical")).toBe("AA");
    for (const raw of [null, "", "high", "low", "critical-high", "unknown"]) expect(applyStatusMap(LAB_INTERPRETATION, raw), String(raw)).toBeNull();
    const codes = LAB_INTERPRETATION.rules.map((x) => x.fhir);
    for (const never of ["H", "L", "HH", "LL"]) expect(codes).not.toContain(never);
  });
});

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

describe("lab test code", () => {
  it("is the name as text, with a local code only for an unchanged quick pick", () => {
    expect(labTestConcept(O1)).toEqual({
      coding: [{ system: LAB_TEST_SYSTEM, code: "CBC", display: "Complete Blood Count (CBC)" }],
      text: "Complete Blood Count (CBC)",
    });
    expect(labTestConcept(O4)).toEqual({ text: "CBC with differential" });
    expect(labTestConcept(O10)).toEqual({ text: "Serum ferritin" });
    expect(labTestConcept({ ...O1, test_code: "cbc" })).toEqual({ text: "Complete Blood Count (CBC)" });
    // The stored quick-pick code is published as stored (not corrected).
    expect(labTestConcept(O5)?.coding?.[0].code).toBe("MRDTrunc");
    expect(labTestConcept({ ...O1, test_name: "  " })).toBeNull();
    // No LOINC or any other international code is ever published for a test.
    expect(JSON.stringify(ORDERS.map(labTestConcept))).not.toMatch(/loinc|snomed/i);
  });
});

describe("lab values", () => {
  it("valueQuantity only for a plain number with a unit; UCUM only from the exact table", () => {
    expect(labValue({ result_value: "12.5", result_unit: "g/dL" })).toEqual({
      valueQuantity: { value: 12.5, unit: "g/dL", system: "http://unitsofmeasure.org", code: "g/dL" },
    });
    expect(labValue({ result_value: "-3", result_unit: "mmol/L" }).valueQuantity?.value).toBe(-3);
    // A unit that is not an exact UCUM-safe string keeps its text, with no system or code.
    expect(labValue({ result_value: "7.2", result_unit: "x10^9/L" })).toEqual({ valueQuantity: { value: 7.2, unit: "x10^9/L" } });
    expect(labValue({ result_value: "140", result_unit: "mEq/L" })).toEqual({ valueQuantity: { value: 140, unit: "mEq/L" } });
    expect(labValue({ result_value: "5", result_unit: "g/dl" })).toEqual({ valueQuantity: { value: 5, unit: "g/dl" } });
  });

  it("anything else is text exactly as recorded (value, then the unit as the portal shows it)", () => {
    const text = (value: unknown, unit: unknown) => labValue({ result_value: value, result_unit: unit });
    expect(text("<0.5", "mg/dL")).toEqual({ valueString: "<0.5 mg/dL" });
    expect(text(">200", "mg/dL")).toEqual({ valueString: ">200 mg/dL" });
    expect(text("12,5", "g/dL")).toEqual({ valueString: "12,5 g/dL" });
    expect(text("1:80", null)).toEqual({ valueString: "1:80" });
    expect(text("5-10", "/hpf")).toEqual({ valueString: "5-10 /hpf" });
    expect(text("++", null)).toEqual({ valueString: "++" });
    expect(text("Positive", null)).toEqual({ valueString: "Positive" });
    // A number without a unit is not a Quantity: it stays text.
    expect(text("12.5", null)).toEqual({ valueString: "12.5" });
    expect(text("12.5", "  ")).toEqual({ valueString: "12.5" });
    // Numbers JSON cannot carry unchanged stay text.
    expect(text("007", "mg/dL")).toEqual({ valueString: "007 mg/dL" });
    expect(text("1e3", "mg/dL")).toEqual({ valueString: "1e3 mg/dL" });
    expect(text("12345678901234567890", "U/L")).toEqual({ valueString: "12345678901234567890 U/L" });
    expect(text("4.0", "mmol/L")).toEqual({ valueString: "4.0 mmol/L" });
    expect(text("12.50", "g/dL")).toEqual({ valueString: "12.50 g/dL" });
  });

  it("a missing value is a dataAbsentReason, never 0 or an empty string", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(labValue({ result_value: v, result_unit: "g/dL" }), String(v)).toEqual({
        dataAbsentReason: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/data-absent-reason", code: "unknown", display: "Unknown" }] },
      });
    }
  });

  it("plainNumber keeps every digit: a number whose text JSON would change stays text", () => {
    expect(plainNumber("12.5")).toBe(12.5);
    expect(plainNumber("100")).toBe(100);
    expect(plainNumber("0")).toBe(0);
    expect(plainNumber("-3.25")).toBe(-3.25);
    // Trailing zeros are precision (FHIR decimals keep it; a JSON number from JavaScript cannot).
    for (const bad of ["12.50", "4.0", "0.010", "007", "-0", "1e3", "12,5", " 12", "12.", ".5", "+3", "Infinity", "12345678901234567890"]) {
      expect(plainNumber(bad), bad).toBeUndefined();
    }
  });
});

describe("lab interpretation", () => {
  const concept = (interpretation: unknown, reviewed: boolean) =>
    labInterpretation({ interpretation }, reviewed ? "reviewed" : "unreviewed");

  it("critical keeps its meaning: critical abnormal (AA), never just abnormal, high or low", () => {
    const c = concept("critical", false);
    expect(c).toEqual([
      {
        coding: [
          { system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "AA", display: "Critical abnormal" },
          { system: "https://mbhr.app/codes/lab-interpretation", code: "critical", display: "Critical" },
        ],
        text: "Critical",
      },
    ]);
    expect(concept("critical", true)).toEqual(c);
  });

  it("abnormal is A (no direction is stored); normal only once reviewed; missing or unknown is left out", () => {
    expect(concept("abnormal", false)?.[0].coding?.[0].code).toBe("A");
    expect(concept("normal", true)?.[0].coding?.[0].code).toBe("N");
    expect(concept("normal", false)).toBeUndefined();
    expect(labInterpretation({ interpretation: "normal" }, "review_incomplete")).toBeUndefined();
    for (const v of [null, "", "high", "HIGH", "unknown"]) expect(concept(v, true), String(v)).toBeUndefined();
  });
});

describe("result review state", () => {
  it("is reviewed only with a review time, a known interpretation and a value", () => {
    expect(resultReviewState(R1a)).toBe("reviewed");
    expect(resultReviewState(R1b)).toBe("unreviewed");
    expect(resultReviewState(R8b)).toBe("review_incomplete");
    expect(resultReviewState(R8c)).toBe("review_incomplete");
    expect(resultReviewState({ ...R1a, reviewed_at: "not a time" })).toBe("unreviewed");
  });
});

describe("laboratory Observation mapper", () => {
  it("maps every field of a reviewed numeric result", () => {
    expect(mapLabObservation(R1a, O1, REFS)).toEqual({
      resourceType: "Observation",
      id: `lab-${R1a.id}`,
      meta: { versionId: String(Date.parse("2026-05-02T10:00:00Z")), lastUpdated: "2026-05-02T10:00:00.000Z", source: "https://mbhr.app" },
      status: "final",
      basedOn: [{ reference: `ServiceRequest/${O1.id}` }],
      category: [
        { coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory", display: "Laboratory" }], text: "Laboratory" },
      ],
      code: { coding: [{ system: LAB_TEST_SYSTEM, code: "CBC", display: "Complete Blood Count (CBC)" }], text: "Complete Blood Count (CBC)" },
      subject: { reference: `Patient/${PATIENT_A.fhir_id}` },
      encounter: { reference: `Encounter/${VISIT_A.id}` },
      effectiveDateTime: "2026-05-01T09:00:00.000Z",
      issued: "2026-05-02T10:00:00.000Z",
      valueQuantity: { value: 12.5, unit: "g/dL", system: "http://unitsofmeasure.org", code: "g/dL" },
      interpretation: [
        {
          coding: [
            { system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "N", display: "Normal" },
            { system: "https://mbhr.app/codes/lab-interpretation", code: "normal", display: "Normal" },
          ],
          text: "Normal",
        },
      ],
      referenceRange: [{ text: "12–16 g/dL" }],
    });
  });

  it("an unreviewed result is preliminary, issued at entry, and its text value is kept whole", () => {
    const obs = mapLabObservation(R1b, O1, REFS)!;
    expect(obs.status).toBe("preliminary");
    expect(obs.issued).toBe("2026-05-01T11:00:00.000Z");
    expect(obs.valueString).toBe("<0.5 mg/dL");
    expect(obs.valueQuantity).toBeUndefined();
    expect(obs.interpretation?.[0].coding?.[0].code).toBe("A");
    expect(obs.referenceRange).toBeUndefined();
  });

  it("is never final because the order is completed", () => {
    expect(O1.status).toBe("completed");
    expect(mapLabObservation(R1b, O1, REFS)!.status).toBe("preliminary");
  });

  it("a result without a value carries a dataAbsentReason and is never final", () => {
    const obs = mapLabObservation(R8c, O8, REFS)!;
    expect(obs.status).toBe("preliminary");
    expect(obs.dataAbsentReason?.coding?.[0].code).toBe("unknown");
    expect(obs.valueString).toBeUndefined();
    expect(obs.valueQuantity).toBeUndefined();
  });

  it("a reviewed result without an interpretation stays preliminary and has none", () => {
    const obs = mapLabObservation(R8b, O8, REFS)!;
    expect(obs.status).toBe("preliminary");
    expect(obs.interpretation).toBeUndefined();
  });

  it("an unreviewed 'normal' (possibly the old default) is published without an interpretation", () => {
    const obs = mapLabObservation(R8a, O8, REFS)!;
    expect(obs.status).toBe("preliminary");
    expect(obs.interpretation).toBeUndefined();
    expect(obs.valueQuantity).toEqual({ value: 4.2, unit: "mmol/L", system: "http://unitsofmeasure.org", code: "mmol/L" });
  });

  it("leaves out effective time and encounter when not recorded, and never uses the order time instead", () => {
    const obs = mapLabObservation(R7, O7, REFS)!;
    expect(obs.effectiveDateTime).toBeUndefined();
    expect(obs.encounter).toBeUndefined();
  });

  it("withholds rows it cannot publish", () => {
    expect(mapLabObservation(R1a, O1, { patientFhirIds: new Map() })).toBeNull();
    expect(mapLabObservation(R1a, O2, REFS)).toBeNull(); // another order's result
    expect(mapLabObservation({ ...R1a, id: "NOT-A-UUID" }, O1, REFS)).toBeNull();
    expect(mapLabObservation(R1a, { ...O1, test_name: "" }, REFS)).toBeNull();
  });

  it("publishes no staff id, note, withheld reason or patient note", () => {
    const text = JSON.stringify(RESULTS.map((x) => mapLabObservation(x, ORDERS.find((y) => y.id === x.order_id)!, REFS)));
    for (const secret of ["SECRET", "auth-uid", PATIENT_A.id, PATIENT_M.id, "reviewed_by", "superseded"]) expect(text).not.toContain(secret);
  });

  it("validateLabObservation: every mapped result passes; each broken rule is caught", () => {
    const issues = (resource: unknown) => {
      const out: string[] = [];
      validateLabObservation(resource as Record<string, unknown>, (path, message) => out.push(`${path}: ${message}`));
      return out;
    };
    for (const x of RESULTS) {
      const obs = mapLabObservation(x, ORDERS.find((y) => y.id === x.order_id)!, REFS);
      if (obs) expect(issues(obs), String(x.id)).toEqual([]);
    }
    const good = mapLabObservation(R1a, O1, REFS)! as unknown as Record<string, unknown>;
    const absent = mapLabObservation(R8c, O8, REFS)! as unknown as Record<string, unknown>;
    expect(issues({ ...absent, status: "final" })).toContain("Observation.status: a result without a value is never final");
    expect(issues({ ...good, valueString: "12" }).join()).toContain("exactly one of a value");
    const high = { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "H" }] };
    expect(issues({ ...good, interpretation: [high] }).join()).toContain("only an interpretation mBHR records");
    const normal = { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "N" }] };
    expect(issues({ ...good, status: "preliminary", interpretation: [normal] }).join()).toContain("normal is published only");
    expect(issues({ ...good, status: "amended" }).join()).toContain("Observation.status");
    expect(issues({ ...good, valueQuantity: { value: 1, unit: "cells", system: "http://unitsofmeasure.org", code: "cells" } }).join()).toContain(
      "verified UCUM list",
    );
    expect(issues({ ...good, basedOn: undefined }).join()).toContain("names its order");
    expect(issues({ ...good, category: [] }).join()).toContain("laboratory category");
    expect(issues({ ...good, note: [{ text: "x" }] }).join()).toContain("Observation.note");
    // Vital signs are not this validator's to judge.
    expect(issues({ ...good, id: VITALS_A.id + "-bp", note: [{ text: "x" }] })).toEqual([]);
  });
});

describe("critical results keep their meaning end to end (owner prompt section 53)", () => {
  it("mapper: interpretation, status and value survive unchanged in meaning", () => {
    const unreviewedCritical = { ...R2, ...unreviewed };
    const pre = mapLabObservation(unreviewedCritical, O2, REFS)!;
    const fin = mapLabObservation(R2, O2, REFS)!;
    for (const obs of [pre, fin]) {
      expect(obs.interpretation?.[0].coding?.map((c) => c.code)).toEqual(["AA", "critical"]);
      expect(obs.valueQuantity).toEqual({ value: 2.1, unit: "mmol/L", system: "http://unitsofmeasure.org", code: "mmol/L" });
      expect(obs.referenceRange).toEqual([{ text: "3.9–5.5 mmol/L" }]);
    }
    expect(pre.status).toBe("preliminary");
    expect(fin.status).toBe("final");
    expect(JSON.stringify([pre, fin])).not.toMatch(/"code":"(A|H|L|HH|LL)"/);
  });

  it("gateway: staff and the patient see the same critical meaning", async () => {
    const { call } = setup();
    const staff = await call(`/fhir/R4/Observation/${lab(R2.id)}`, DOCTOR);
    const patient = await call(`/fhir/R4/Observation/${lab(R2.id)}`, PAT_A);
    for (const { status, body } of [staff, patient]) {
      expect(status).toBe(200);
      expect(body.status).toBe("final");
      expect(body.interpretation[0].coding[0]).toEqual({
        system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
        code: "AA",
        display: "Critical abnormal",
      });
      expect(body.interpretation[0].text).toBe("Critical");
      expect(body.valueQuantity).toEqual({ value: 2.1, unit: "mmol/L", system: "http://unitsofmeasure.org", code: "mmol/L" });
    }
    const report = await call(`/fhir/R4/DiagnosticReport/${O2.id}`, DOCTOR);
    expect(report.body.status).toBe("final");
    expect(report.body.result).toEqual([{ reference: `Observation/${lab(R2.id)}` }]);
  });
});

describe("DiagnosticReport mapper", () => {
  const report = (order: Record<string, unknown>) =>
    mapDiagnosticReport(
      order,
      RESULTS.filter((x) => x.order_id === order.id && x.superseded_by === null),
      REFS,
      "all_current_results",
    )!;

  it("maps every field; values stay in the Observations", () => {
    expect(report(O2)).toEqual({
      resourceType: "DiagnosticReport",
      id: O2.id,
      meta: { versionId: String(Date.parse("2026-05-01T11:00:00Z")), lastUpdated: "2026-05-01T11:00:00.000Z", source: "https://mbhr.app" },
      basedOn: [{ reference: `ServiceRequest/${O2.id}` }],
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "LAB", display: "Laboratory" }], text: "Laboratory" }],
      code: { coding: [{ system: LAB_TEST_SYSTEM, code: "GLUCOSE", display: "Blood Glucose" }], text: "Blood Glucose" },
      subject: { reference: `Patient/${PATIENT_A.fhir_id}` },
      encounter: { reference: `Encounter/${VISIT_A.id}` },
      effectiveDateTime: "2026-05-01T09:05:00.000Z",
      issued: "2026-05-01T09:30:00.000Z",
      result: [{ reference: `Observation/${lab(R2.id)}` }],
    });
    expect(JSON.stringify(ORDERS.map(report))).not.toMatch(/valueQuantity|valueString|interpretation|referenceRange|conclusion|SECRET|auth-uid/);
  });

  it("status follows the review of every current result, never the order status alone", () => {
    expect(report(O1).status).toBe("partial"); // one reviewed, one not; order completed
    expect(report(O1).issued).toBeUndefined();
    expect(report(O2).status).toBe("final");
    expect(report(O3).status).toBe("cancelled");
    expect(report(O3).result).toBeUndefined();
    expect(report(O4).status).toBe("registered");
    expect(report(O6).status).toBe("final");
    expect(report(O6).result).toEqual([{ reference: `Observation/${lab(R6new.id)}` }]); // superseded result not listed
    expect(report(O7).status).toBe("unknown"); // results on a cancelled order
    expect(report(O8).status).toBe("partial");
    expect(report(O10).status).toBe("unknown"); // order status the app does not write
    expect(mapDiagnosticReport({ ...O1, status: null }, [R1a], REFS, "all_current_results")!.status).toBe("unknown");
    expect(mapDiagnosticReport({ ...O1, status: "completed" }, [], REFS, "all_current_results")!.status).toBe("unknown");
  });

  it("forbidden: a completed order with unreviewed results is never final; a cancelled order never final", () => {
    expect(reportState({ status: "completed" }, [R1b], "all_current_results")).toBe("unreviewed");
    expect(mapDiagnosticReport(O1, [R1b], REFS, "all_current_results")!.status).toBe("partial");
    expect(mapDiagnosticReport({ ...O2, status: "cancelled" }, [R2], REFS, "all_current_results")!.status).not.toBe("final");
    expect(mapDiagnosticReport({ ...O3 }, [], REFS, "all_current_results")!.status).not.toMatch(/final|completed/);
  });

  it("forbidden: a report built from the results released to a patient is never final or issued", () => {
    // O1 has a reviewed, released result (R1a) and an unreviewed one (R1b)
    // the patient's rows do not include: the patient's report must not
    // claim to be complete.
    expect(reportState(O1, [R1a], "released_to_patient")).toBe("released_results_reviewed");
    const partial = mapDiagnosticReport(O1, [R1a], REFS, "released_to_patient")!;
    expect(partial.status).toBe("partial");
    expect(partial.issued).toBeUndefined();
    expect(partial.result).toEqual([{ reference: `Observation/${lab(R1a.id)}` }]);
    // Even when every result of the order happens to be released: the
    // patient's rows cannot prove it, and the status must not hint either way.
    const all = mapDiagnosticReport(O2, [R2], REFS, "released_to_patient")!;
    expect(all.status).toBe("partial");
    expect(all.issued).toBeUndefined();
    expect(mapDiagnosticReport(O2, [R2], REFS, "all_current_results")!.status).toBe("final");
    // No combination of order status and result states is final in this view.
    const states = [R1a, R1b, R2, R7, R8b, R8c, R8d];
    for (const status of ["ordered", "collected", "processing", "completed", "cancelled", "archived", null]) {
      for (let mask = 1; mask < 1 << states.length; mask++) {
        const rows = states.filter((_, i) => mask & (1 << i)).map((x) => ({ ...x, order_id: O1.id }));
        const rep = mapDiagnosticReport({ ...O1, status }, rows, REFS, "released_to_patient")!;
        expect(rep.status, `${status} ${mask}`).not.toBe("final");
        expect(rep.issued, `${status} ${mask}`).toBeUndefined();
      }
    }
  });
});

describe("ServiceRequest mapper", () => {
  it("maps every field; the requester only through the staff directory", () => {
    expect(mapServiceRequest(O1, REFS, new Map([[ORDERER_UID, PRACTITIONER_ID]]))).toEqual({
      resourceType: "ServiceRequest",
      id: O1.id,
      meta: { versionId: String(Date.parse("2026-05-01T11:00:00Z")), lastUpdated: "2026-05-01T11:00:00.000Z", source: "https://mbhr.app" },
      status: "completed",
      intent: "order",
      subject: { reference: `Patient/${PATIENT_A.fhir_id}` },
      priority: "routine",
      code: { coding: [{ system: LAB_TEST_SYSTEM, code: "CBC", display: "Complete Blood Count (CBC)" }], text: "Complete Blood Count (CBC)" },
      encounter: { reference: `Encounter/${VISIT_A.id}` },
      authoredOn: "2026-05-01T08:30:00.000Z",
      requester: { reference: `Practitioner/${PRACTITIONER_ID}` },
    });
    const noDirectory = mapServiceRequest(O1, REFS)!;
    expect(noDirectory.requester).toBeUndefined();
    expect(JSON.stringify(noDirectory)).not.toContain(ORDERER_UID);
  });

  it("falls back without guessing, and a cancelled order is revoked", () => {
    const sr = mapServiceRequest(O10, REFS)!;
    expect(sr.status).toBe("unknown");
    expect(sr.priority).toBeUndefined();
    expect(mapServiceRequest(O3, REFS)!.status).toBe("revoked");
    expect(mapServiceRequest(O4, REFS)!.status).toBe("active");
    expect(mapServiceRequest(O1, { patientFhirIds: new Map() })).toBeNull();
    expect(JSON.stringify(ORDERS.map((x) => mapServiceRequest(x, REFS)))).not.toMatch(/SECRET|auth-uid|note|specimen/);
  });
});

describe("patient-path rows", () => {
  it("split into the same order and result shapes the tables have", () => {
    const { order, result } = splitPatientLabRow({
      id: R1a.id,
      order_id: O1.id,
      result_value: "12.5",
      result_unit: "g/dL",
      reference_range: null,
      interpretation: "normal",
      result_date: R1a.result_date,
      reviewed_at: R1a.reviewed_at,
      released_to_patient_at: R1a.released_to_patient_at,
      amended_at: null,
      created_at: R1a.created_at,
      updated_at: R1a.updated_at,
      patient_id: PATIENT_A.id,
      visit_id: VISIT_A.id,
      test_name: O1.test_name,
      test_code: O1.test_code,
      priority: "routine",
      order_status: "completed",
      ordered_at: O1.ordered_at,
      collected_at: O1.collected_at,
      order_created_at: O1.created_at,
      order_updated_at: O1.updated_at,
    });
    expect(order).toMatchObject({ id: O1.id, status: "completed", updated_at: O1.updated_at, patient_id: PATIENT_A.id });
    expect(result).toMatchObject({ id: R1a.id, order_id: O1.id, reviewed_at: R1a.reviewed_at });
    expect(mapLabObservation(result, order, REFS)!.status).toBe("final");
  });
});

// ---------------------------------------------------------------------------
// Gateway: ServiceRequest
// ---------------------------------------------------------------------------

describe("ServiceRequest at the gateway", () => {
  it("a doctor reads an order; the requester comes from the staff directory", async () => {
    const { call } = setup();
    const { status, body } = await call(`/fhir/R4/ServiceRequest/${O1.id}`, DOCTOR);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      resourceType: "ServiceRequest",
      id: O1.id,
      status: "completed",
      intent: "order",
      priority: "routine",
      subject: { reference: `Patient/${PATIENT_A.fhir_id}` },
      encounter: { reference: `Encounter/${VISIT_A.id}` },
      authoredOn: "2026-05-01T08:30:00.000Z",
      requester: { reference: `Practitioner/${PRACTITIONER_ID}` },
    });
    expect(body.note).toBeUndefined();
    // An ordering account the directory does not know: no requester at all.
    expect((await call(`/fhir/R4/ServiceRequest/${O2.id}`, DOCTOR)).body.requester).toBeUndefined();
  });

  it("leaves the requester out when the staff directory cannot be read", async () => {
    const { call } = setup({
      rpcs: { fhir_patient_lab_results: patientLabResults, fhir_staff_directory: () => refuse("XX000", 500) },
    });
    const { status, body } = await call(`/fhir/R4/ServiceRequest/${O1.id}`, DOCTOR);
    expect(status).toBe(200);
    expect(body.requester).toBeUndefined();
  });

  it("searches by patient, status, code, authored date and encounter", async () => {
    const { call } = setup();
    const q = async (params: string) => idsOf((await call(`/fhir/R4/ServiceRequest?patient=Patient/${PATIENT_A.fhir_id}&${params}`, DOCTOR)).body);
    expect(await q("_count=50")).toEqual([O1, O2, O3, O4, O6, O7, O8, OM, O10].map((x) => x.id));
    expect(await q("status=revoked")).toEqual([O3.id, O7.id]);
    expect(await q("status=active")).toEqual([O4.id, O8.id]);
    expect(await q("status=completed")).toEqual([O1, O2, O6, OM].map((x) => x.id));
    expect(await q("status=unknown")).toEqual([O10.id]);
    expect(await q("status=draft")).toEqual([]);
    // A status token matches only in ServiceRequest.status's own code system.
    expect(await q("status=http://hl7.org/fhir/request-status|revoked")).toEqual([O3.id, O7.id]);
    expect(await q("status=http://example.org/other|revoked")).toEqual([]);
    expect(await q("status=http://hl7.org/fhir/diagnostic-report-status|unknown")).toEqual([]);
    // Only the unchanged quick pick matches: O4 kept the code after its name was edited.
    expect(await q("code=CBC")).toEqual([O1.id, O6.id]);
    expect(await q("code=https://mbhr.app/codes/lab-test|HIV")).toEqual([O3.id]);
    expect(await q("code=http://loinc.org|58410-2")).toEqual([]);
    expect(await q("code=NOTATEST")).toEqual([]);
    expect(await q("authored=2026-05-01")).toEqual([O1.id, O2.id]);
    expect(await q("authored=ge2026-05-02&authored=lt2026-05-04")).toEqual([O3.id, O4.id]);
    expect(await q(`encounter=Encounter/${VISIT_A.id}`)).toEqual([O1.id, O2.id]);
    expect(idsOf((await call(`/fhir/R4/ServiceRequest?_id=${O3.id}`, DOCTOR)).body)).toEqual([O3.id]);
    expect(idsOf((await call(`/fhir/R4/ServiceRequest?encounter=Encounter/${VISIT_A.id}`, DOCTOR)).body)).toEqual([O1.id, O2.id]);
  });

  it("pages with a stable cursor and no duplicates", async () => {
    const { call } = setup();
    const all = await allPages(call, `/fhir/R4/ServiceRequest?patient=Patient/${PATIENT_A.fhir_id}&_count=2`, DOCTOR);
    expect(all).toEqual([O1, O2, O3, O4, O6, O7, O8, OM, O10].map((x) => x.id));
  });

  it("is refused to staff without consult or lab_review, and to patients", async () => {
    const { call, calls } = setup();
    for (const token of [NURSE, VOLUNTEER, PHARMACIST, PAT_A]) {
      expect((await call(`/fhir/R4/ServiceRequest/${O1.id}`, token)).status).toBe(403);
      expect((await call(`/fhir/R4/ServiceRequest?patient=Patient/${PATIENT_A.fhir_id}`, token)).status).toBe(403);
    }
    expect(calls.some((c) => c.url.includes("/rest/v1/lab_"))).toBe(false);
    expect((await call(`/fhir/R4/ServiceRequest/${O1.id}`, REVIEWER)).status).toBe(200);
  });

  it("refuses searches that name no record", async () => {
    const { call, audits } = setup();
    for (const path of ["/fhir/R4/ServiceRequest", "/fhir/R4/ServiceRequest?status=active", "/fhir/R4/ServiceRequest?code=CBC", "/fhir/R4/ServiceRequest?authored=2026-05-01"]) {
      expect((await call(path, DOCTOR)).status, path).toBe(403);
    }
    expect(audits.at(-1)).toMatchObject({ p_decision: "deny", p_denial_reason: "search_not_narrowed" });
  });

  it("answers invalid ids with 404 or 400 and says nothing about the database", async () => {
    const { call, served } = setup();
    expect((await call("/fhir/R4/ServiceRequest/not-a-uuid", DOCTOR)).status).toBe(404);
    expect((await call(`/fhir/R4/ServiceRequest/${O1.id.toUpperCase()}`, DOCTOR)).status).toBe(404);
    expect((await call(`/fhir/R4/ServiceRequest/${o(999)}`, DOCTOR)).status).toBe(404);
    expect((await call("/fhir/R4/ServiceRequest?_id=bad!id", DOCTOR)).status).toBe(400);
    expect((await call("/fhir/R4/ServiceRequest?encounter=Patient/x", DOCTOR)).status).toBe(400);
    expect(idsOf((await call("/fhir/R4/ServiceRequest?_id=not-a-uuid", DOCTOR)).body)).toEqual([]);
    expect(served.join("\n")).not.toMatch(/lab_orders|lab_results|PGRST|42703|select=/);
  });
});

// ---------------------------------------------------------------------------
// Gateway: DiagnosticReport
// ---------------------------------------------------------------------------

describe("DiagnosticReport at the gateway (staff)", () => {
  it("reads each report state", async () => {
    const { call } = setup();
    const get = async (id: string) => (await call(`/fhir/R4/DiagnosticReport/${id}`, DOCTOR)).body;
    const partial = await get(O1.id);
    expect(partial.status).toBe("partial");
    expect(partial.issued).toBeUndefined();
    expect(partial.result).toEqual([{ reference: `Observation/${lab(R1a.id)}` }, { reference: `Observation/${lab(R1b.id)}` }]);
    expect((await get(O2.id)).issued).toBe("2026-05-01T09:30:00.000Z");
    expect((await get(O3.id)).status).toBe("cancelled");
    expect((await get(O4.id)).status).toBe("registered");
    expect((await get(O6.id)).result).toEqual([{ reference: `Observation/${lab(R6new.id)}` }]);
    expect((await get(O7.id)).status).toBe("unknown");
    expect((await get(O10.id)).status).toBe("unknown");
  });

  it("searches by patient, status, category, based-on, code, date and encounter", async () => {
    const { call } = setup();
    const q = async (params: string) => idsOf((await call(`/fhir/R4/DiagnosticReport?patient=Patient/${PATIENT_A.fhir_id}&${params}`, DOCTOR)).body);
    expect(await q("_count=50")).toEqual([O1, O2, O3, O4, O6, O7, O8, OM, O10].map((x) => x.id));
    expect(await q("status=final")).toEqual([O2.id, O6.id, OM.id]);
    expect(await q("status=partial")).toEqual([O1.id, O8.id]);
    expect(await q("status=registered")).toEqual([O4.id]);
    expect(await q("status=cancelled")).toEqual([O3.id]);
    expect(await q("status=unknown")).toEqual([O7.id, O10.id]);
    expect(await q("status=preliminary")).toEqual([]);
    // A status token matches only in DiagnosticReport.status's own code system.
    expect(await q("status=http://hl7.org/fhir/diagnostic-report-status|final")).toEqual([O2.id, O6.id, OM.id]);
    expect(await q("status=http://example.org/other|final")).toEqual([]);
    expect(await q("status=http://hl7.org/fhir/observation-status|final")).toEqual([]);
    expect(await q("category=LAB&_count=50")).toHaveLength(9);
    expect(await q("category=http://terminology.hl7.org/CodeSystem/v2-0074|LAB&status=final")).toEqual([O2.id, O6.id, OM.id]);
    expect(await q("category=laboratory")).toEqual([]);
    expect(await q(`based-on=ServiceRequest/${O1.id}`)).toEqual([O1.id]);
    expect(await q("code=GLUCOSE")).toEqual([O2.id]);
    expect(await q("date=2026-05-01")).toEqual([O1.id, O2.id]);
    expect(await q("date=lt2026-04-01")).toEqual([OM.id]);
    expect(await q(`encounter=Encounter/${VISIT_A.id}`)).toEqual([O1.id, O2.id]);
    expect(idsOf((await call(`/fhir/R4/DiagnosticReport?based-on=ServiceRequest/${O2.id}`, DOCTOR)).body)).toEqual([O2.id]);
    expect(idsOf((await call(`/fhir/R4/DiagnosticReport?_id=${O2.id}&based-on=ServiceRequest/${O1.id}`, DOCTOR)).body)).toEqual([]);
  });

  it("pages a status search (worked out after reading) without losing or repeating a report", async () => {
    const { call } = setup();
    expect(await allPages(call, `/fhir/R4/DiagnosticReport?patient=Patient/${PATIENT_A.fhir_id}&status=final&_count=1`, DOCTOR)).toEqual([O2.id, O6.id, OM.id]);
    expect(await allPages(call, `/fhir/R4/DiagnosticReport?patient=Patient/${PATIENT_A.fhir_id}&_count=4`, DOCTOR)).toHaveLength(9);
  });

  it("is refused to staff without consult or lab_review, and searches must name a record", async () => {
    const { call } = setup();
    for (const token of [NURSE, VOLUNTEER, PHARMACIST]) expect((await call(`/fhir/R4/DiagnosticReport/${O1.id}`, token)).status).toBe(403);
    expect((await call(`/fhir/R4/DiagnosticReport/${O1.id}`, REVIEWER)).status).toBe(200);
    for (const path of ["/fhir/R4/DiagnosticReport", "/fhir/R4/DiagnosticReport?status=final", "/fhir/R4/DiagnosticReport?category=LAB", "/fhir/R4/DiagnosticReport?date=2026-05-01"]) {
      expect((await call(path, DOCTOR)).status, path).toBe(403);
    }
  });

  it("answers invalid ids with 404 or 400", async () => {
    const { call } = setup();
    expect((await call("/fhir/R4/DiagnosticReport/xyz", DOCTOR)).status).toBe(404);
    expect((await call(`/fhir/R4/DiagnosticReport/${o(999)}`, DOCTOR)).status).toBe(404);
    expect((await call("/fhir/R4/DiagnosticReport?based-on=Observation/x", DOCTOR)).status).toBe(400);
    expect((await call("/fhir/R4/DiagnosticReport?patient=Patient/x&date=someday", DOCTOR)).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Gateway: laboratory Observations (staff)
// ---------------------------------------------------------------------------

describe("laboratory Observations at the gateway (staff)", () => {
  const A_LABS = [R1a, R1b, R2, R6new, R7, R8a, R8b, R8c, R8d, RM].map((x) => lab(x.id));

  it("reads a current result; a superseded one is not found", async () => {
    const { call } = setup();
    const { status, body } = await call(`/fhir/R4/Observation/${lab(R1a.id)}`, DOCTOR);
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: lab(R1a.id), status: "final", subject: { reference: `Patient/${PATIENT_A.fhir_id}` } });
    expect((await call(`/fhir/R4/Observation/${lab(R6old.id)}`, DOCTOR)).status).toBe(404);
    // Withheld from the portal is not a clinical status: staff still see it, as final.
    expect((await call(`/fhir/R4/Observation/${lab(R8d.id)}`, DOCTOR)).body.status).toBe("final");
    for (const bad of ["lab-xyz", `lab-${R1a.id.toUpperCase()}`, `lab-${r(999)}`, "lab-"]) {
      expect((await call(`/fhir/R4/Observation/${bad}`, DOCTOR)).status, bad).toBe(404);
    }
  });

  it("searches every declared parameter for laboratory rows", async () => {
    const { call } = setup();
    const q = async (params: string) =>
      idsOf((await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&_count=50&${params}`, DOCTOR)).body);
    expect(await q("category=laboratory")).toEqual(A_LABS);
    expect(await q("category=http://terminology.hl7.org/CodeSystem/observation-category|laboratory&code=CBC")).toEqual(
      [R1a, R1b, R6new].map((x) => lab(x.id)),
    );
    expect(await q("code=https://mbhr.app/codes/lab-test|GLUCOSE")).toEqual([lab(R2.id)]);
    expect(await q("category=laboratory&status=final")).toEqual([R1a, R2, R6new, R7, R8d, RM].map((x) => lab(x.id)));
    // A status token matches only in Observation.status's own code system.
    expect(await q("category=laboratory&status=http://hl7.org/fhir/observation-status|final")).toEqual(
      [R1a, R2, R6new, R7, R8d, RM].map((x) => lab(x.id)),
    );
    expect(await q("category=laboratory&status=http://example.org/other|final")).toEqual([]);
    expect(await q("status=http://example.org/other|preliminary")).toEqual([]);
    expect(await q("category=laboratory&status=preliminary")).toEqual([R1b, R8a, R8b, R8c].map((x) => lab(x.id)));
    expect(await q(`based-on=ServiceRequest/${O1.id}`)).toEqual([lab(R1a.id), lab(R1b.id)]);
    expect(await q(`category=laboratory&encounter=Encounter/${VISIT_A.id}`)).toEqual([R1a, R1b, R2].map((x) => lab(x.id)));
    expect(await q("category=laboratory&date=2026-05-01")).toEqual([R1a, R1b, R2].map((x) => lab(x.id)));
    expect(await q(`_id=${lab(R2.id)}`)).toEqual([lab(R2.id)]);
    expect(await q(`_id=${lab(R6old.id)}`)).toEqual([]);
    // Parameters that cannot match a laboratory row select none (never ignored).
    expect(await q("category=vital-signs&code=CBC")).toEqual([]);
    expect(await q("code=8867-4")).toEqual([]);
    expect(await q("category=laboratory&status=amended")).toEqual([]);
    expect(idsOf((await call(`/fhir/R4/Observation?based-on=ServiceRequest/${O2.id}`, DOCTOR)).body)).toEqual([lab(R2.id)]);
    expect(idsOf((await call(`/fhir/R4/Observation?_id=${lab(R1b.id)}`, DOCTOR)).body)).toEqual([lab(R1b.id)]);
    expect(idsOf((await call(`/fhir/R4/Observation?based-on=ServiceRequest/not-a-uuid`, DOCTOR)).body)).toEqual([]);
    expect((await call("/fhir/R4/Observation?based-on=Patient/x", DOCTOR)).status).toBe(400);
  });

  it("pages across vital signs and laboratory results without losing or repeating one", async () => {
    const { call } = setup();
    const unpaged = idsOf((await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&_count=100`, DOCTOR)).body);
    expect(unpaged.slice(-A_LABS.length)).toEqual(A_LABS);
    expect(unpaged.length).toBe(5 + A_LABS.length);
    for (const size of [1, 3, 5]) {
      expect(await allPages(call, `/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&_count=${size}`, DOCTOR)).toEqual(unpaged);
    }
    expect(await allPages(call, `/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&category=laboratory&status=preliminary&_count=1`, DOCTOR)).toEqual(
      [R1b, R8a, R8b, R8c].map((x) => lab(x.id)),
    );
  });

  it("nurses and volunteers get vital signs only, and are told so; lab_review alone is enough for labs", async () => {
    const { call, calls, audits } = setup();
    const labNote = (b: Json) => outcomes(b).filter((i) => i.code === "suppressed");
    for (const token of [NURSE, VOLUNTEER]) {
      const before = calls.length;
      const b = (await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&_count=100`, token)).body;
      expect(idsOf(b).some((id) => id.startsWith("lab-"))).toBe(false);
      expect(idsOf(b).length).toBeGreaterThan(0);
      // The searchset says laboratory results were left out, so it never reads as "no results".
      expect(labNote(b)).toStrictEqual([LAB_RESULTS_WITHHELD]);
      // Decided from the permissions and the query alone: the same note whether or not a
      // laboratory row exists (a patient with results, one without, an unknown patient, an unknown id).
      for (const q of [
        `based-on=ServiceRequest/${O1.id}`,
        `patient=Patient/${PATIENT_A.fhir_id}&category=laboratory`,
        `patient=Patient/${PATIENT_B.fhir_id}&category=laboratory&status=final`,
        "patient=Patient/0b3c1d2e-1111-4aaa-8bbb-0000000000ff&category=laboratory",
        `_id=${lab(R1a.id)}`,
        "_id=lab-00000000-0000-4000-8000-0000000000ff",
      ]) {
        const r = await call(`/fhir/R4/Observation?${q}`, token);
        expect(r.status, q).toBe(200);
        expect(idsOf(r.body), q).toStrictEqual([]);
        expect(labNote(r.body), q).toStrictEqual([LAB_RESULTS_WITHHELD]);
      }
      // A search that cannot select a laboratory row carries no such note.
      for (const q of ["category=vital-signs", "code=http://loinc.org|29463-7", "status=http://hl7.org/fhir/observation-status|final&code=8302-2"]) {
        const r = await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&${q}`, token);
        expect(idsOf(r.body).length, q).toBeGreaterThan(0);
        expect(labNote(r.body), q).toStrictEqual([]);
      }
      // A read is refused (403, as DiagnosticReport is) from the id alone, before any lookup:
      // an existing result and an unknown id answer the same.
      for (const id of [lab(R1a.id), "lab-00000000-0000-4000-8000-0000000000ff"]) {
        const r = await call(`/fhir/R4/Observation/${id}`, token);
        expect(r.status, id).toBe(403);
        expect(r.body).toMatchObject({ resourceType: "OperationOutcome", issue: [{ severity: "error", code: "forbidden" }] });
        expect(audits.at(-1)).toMatchObject({ p_decision: "deny", p_denial_reason: "forbidden", p_http_status: 403, p_result_count: 0 });
      }
      expect(calls.slice(before).some((c) => c.url.includes("/rest/v1/lab_"))).toBe(false);
    }
    // Staff who may read laboratory results get no note.
    const doctor = (await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&category=laboratory`, DOCTOR)).body;
    expect(idsOf(doctor).length).toBeGreaterThan(0);
    expect(labNote(doctor)).toStrictEqual([]);
    expect((await call(`/fhir/R4/Observation/${lab(R1a.id)}`, REVIEWER)).status).toBe(200);
    expect((await call(`/fhir/R4/Observation/${lab(R1a.id)}`, PHARMACIST)).status).toBe(403);
  });

  it("direct calls: a key that is not this source's is refused, and selects() says when labs cannot match", async () => {
    const fake = fakeSupabase({ users: USERS, tables: { patients: [PATIENT_A, PATIENT_B, PATIENT_M], lab_orders: ORDERS, lab_results: RESULTS } });
    const ctx: QueryCtx = {
      db: new Postgrest({ supabaseUrl: "https://project.supabase.co", anonKey: "anon-key", accessToken: DOCTOR, fetchImpl: fake.fetchImpl }),
      scope: { kind: "staff", patientIds: null },
      permissions: new Set(["consult"]),
      restrictions: new Set(),
      baseUrl: "https://mbhr.app/fhir/R4",
      cursorBinding: "",
    };
    const search = (q: string) => ({ values: new Map([...new URLSearchParams(q)].map(([k, v]) => [k, [v]])), count: 5, cursor: null });
    await expect(labObservationSource.search({ ctx, search: search("based-on=ServiceRequest/" + O1.id), after: "garbage", count: 5 })).rejects.toBeInstanceOf(FhirError);
    const ok = await labObservationSource.search({ ctx, search: search("based-on=ServiceRequest/" + O1.id), after: `${O1.id}.${R1a.id}`, count: 5 });
    expect(ok.resources.map((x) => x.id)).toEqual([lab(R1b.id)]);
    expect(labObservationSource.selects(search("category=laboratory"))).toBe(true);
    expect(labObservationSource.selects(search("category=vital-signs"))).toBe(false);
    expect(labObservationSource.selects(search("code=8867-4"))).toBe(false);
    expect(labObservationSource.selects(search("status=amended"))).toBe(false);
    expect(labObservationSource.selects(search(`_id=${VITALS_A.id}-bp`))).toBe(false);
    expect(labObservationSource.selects(search("_id=lab-notauuid"))).toBe(false);
    // Without lab permissions the source reads nothing, even when called directly.
    const vitalsOnly = { ...ctx, permissions: new Set(["vitals"]) };
    expect((await labObservationSource.search({ ctx: vitalsOnly, search: search("category=laboratory"), after: null, count: 5 })).resources).toEqual([]);
    expect((await labObservationSource.read(vitalsOnly, lab(R1a.id))).page.resources).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Gateway: patient self-access
// ---------------------------------------------------------------------------

describe("laboratory self-access for patients", () => {
  const RELEASED_A = [R1a, R2, R6new, R7].map((x) => lab(x.id));

  it("sees only own results that were reviewed, released, not withheld and not superseded", async () => {
    const { call, calls } = setup();
    const all = (await call("/fhir/R4/Observation?category=laboratory", PAT_A)).body;
    expect(idsOf(all)).toEqual(RELEASED_A);
    expect(new Set(matches(all).map((x) => x.subject.reference))).toEqual(new Set([`Patient/${PATIENT_A.fhir_id}`]));
    expect(matches(all).every((x) => x.status === "final")).toBe(true);
    const mixed = await allPages(call, `/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&_count=2`, PAT_A);
    expect(mixed.filter((id) => id.startsWith("lab-"))).toEqual(RELEASED_A);
    for (const id of [R1b, R6old, R8d, R5, RM].map((x) => lab(x.id))) {
      expect((await call(`/fhir/R4/Observation/${id}`, PAT_A)).status, id).toBe(404);
    }
    expect((await call(`/fhir/R4/Observation/${lab(R1a.id)}`, PAT_A)).status).toBe(200);
    // Never from the tables: only through the release function.
    expect(calls.some((c) => c.url.includes("/rest/v1/lab_"))).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/rpc/fhir_patient_lab_results"))).toBe(true);
  });

  it("applies every declared parameter on the patient path too", async () => {
    const { call } = setup();
    const q = async (params: string) => idsOf((await call(`/fhir/R4/Observation?${params}`, PAT_A)).body);
    expect(await q("category=laboratory&code=CBC")).toEqual([lab(R1a.id), lab(R6new.id)]);
    expect(await q(`based-on=ServiceRequest/${O1.id}`)).toEqual([lab(R1a.id)]);
    expect(await q(`_id=${lab(R2.id)}`)).toEqual([lab(R2.id)]);
    expect(await q(`_id=${lab(R5.id)}`)).toEqual([]);
    expect(await q(`category=laboratory&encounter=Encounter/${VISIT_A.id}`)).toEqual([lab(R1a.id), lab(R2.id)]);
    expect(await q("category=laboratory&date=2026-05-01")).toEqual([lab(R1a.id), lab(R2.id)]);
    expect(await q("category=laboratory&status=preliminary")).toEqual([]);
    expect(await q(`category=laboratory&patient=Patient/${PATIENT_A.fhir_id}&status=final`)).toEqual(RELEASED_A);
    expect(await allPages(call, "/fhir/R4/Observation?category=laboratory&_count=1", PAT_A)).toEqual(RELEASED_A);
  });

  it("reads reports built from released results only", async () => {
    const { call, calls } = setup();
    const own = await call(`/fhir/R4/DiagnosticReport/${O1.id}`, PAT_A);
    expect(own.status).toBe(200);
    // Only the released result is listed. R1b is not reviewed yet, so the
    // report is incomplete: partial, never final, and not issued.
    expect(own.body.result).toEqual([{ reference: `Observation/${lab(R1a.id)}` }]);
    expect(own.body.status).toBe("partial");
    expect(own.body.issued).toBeUndefined();
    // O2's only result is released: final for staff (see the critical test
    // above), still partial for the patient.
    const o2 = await call(`/fhir/R4/DiagnosticReport/${O2.id}`, PAT_A);
    expect(o2.body.status).toBe("partial");
    expect(o2.body.issued).toBeUndefined();
    expect((await call(`/fhir/R4/DiagnosticReport/${O7.id}`, PAT_A)).body.status).toBe("unknown");
    for (const id of [O3.id, O4.id, O5.id, O8.id, OM.id]) expect((await call(`/fhir/R4/DiagnosticReport/${id}`, PAT_A)).status, id).toBe(404);
    const search = (await call("/fhir/R4/DiagnosticReport", PAT_A)).body;
    expect(idsOf(search)).toEqual([O1.id, O2.id, O6.id, O7.id]);
    expect(idsOf((await call("/fhir/R4/DiagnosticReport?status=partial&code=CBC", PAT_A)).body)).toEqual([O1.id, O6.id]);
    expect(idsOf((await call("/fhir/R4/DiagnosticReport?status=final", PAT_A)).body)).toEqual([]);
    expect(idsOf((await call(`/fhir/R4/DiagnosticReport?based-on=ServiceRequest/${O2.id}`, PAT_A)).body)).toEqual([O2.id]);
    expect(idsOf((await call(`/fhir/R4/DiagnosticReport?encounter=Encounter/${VISIT_A.id}&date=2026-05-01`, PAT_A)).body)).toEqual([O1.id, O2.id]);
    expect(await allPages(call, "/fhir/R4/DiagnosticReport?_count=1", PAT_A)).toEqual([O1.id, O2.id, O6.id, O7.id]);
    expect(calls.some((c) => c.url.includes("/rest/v1/lab_"))).toBe(false);
  });

  it("a released result never makes the patient's report final while a sibling result is pending (critical)", async () => {
    // One order, two current results: one reviewed and released, one not
    // reviewed yet and critical. Staff see partial with both; the patient
    // must see partial too (never final, never issued), with only theirs.
    const OX = { ...ORDER_BASE, id: o(20), test_name: "Blood Glucose", test_code: "GLUCOSE", collected_at: "2026-05-05T09:00:00+00:00" };
    const RX1 = { ...RESULT_BASE, ...released, id: r(201), order_id: OX.id };
    const RX2 = { ...RESULT_BASE, ...unreviewed, id: r(202), order_id: OX.id, result_value: "1.9", result_unit: "mmol/L", interpretation: "critical" };
    // Same shape, but the second result is reviewed and withheld from the portal.
    const OY = { ...OX, id: o(21) };
    const RY1 = { ...RX1, id: r(211), order_id: OY.id };
    const RY2 = { ...RESULT_BASE, id: r(212), order_id: OY.id, withheld_at: "2026-05-06T10:00:00+00:00", withheld_by: WITHHOLDER_UID, withheld_reason: "SECRET withheld reason" };
    // Every result released: the patient's view looks exactly the same.
    const OZ = { ...OX, id: o(22) };
    const RZ1 = { ...RX1, id: r(221), order_id: OZ.id };
    const { call } = setup({
      tables: {
        patients: [PATIENT_A, PATIENT_B, PATIENT_M],
        visits: [VISIT_A],
        vitals: [VITALS_A],
        lab_orders: [OX, OY, OZ],
        lab_results: [RX1, RX2, RY1, RY2, RZ1],
      },
    });
    const staff = await call(`/fhir/R4/DiagnosticReport/${OX.id}`, DOCTOR);
    expect(staff.body.status).toBe("partial");
    expect(staff.body.result).toEqual([{ reference: `Observation/${lab(RX1.id)}` }, { reference: `Observation/${lab(RX2.id)}` }]);
    expect((await call(`/fhir/R4/DiagnosticReport/${OZ.id}`, DOCTOR)).body.status).toBe("final");

    const seen: Json[] = [];
    for (const order of [OX, OY, OZ]) {
      const { status, body } = await call(`/fhir/R4/DiagnosticReport/${order.id}`, PAT_A);
      expect(status, order.id).toBe(200);
      expect(body.status, order.id).toBe("partial");
      expect(body.issued, order.id).toBeUndefined();
      expect(body.result, order.id).toHaveLength(1);
      seen.push(body);
    }
    // The pending critical and the withheld result are neither listed nor hinted at.
    const text = JSON.stringify(seen);
    for (const hidden of [RX2.id, RY2.id, "critical", "SECRET"]) expect(text, hidden).not.toContain(hidden);
    const shape = (b: Json) => ({ status: b.status, issued: b.issued, results: b.result.length });
    expect(new Set(seen.map((b) => JSON.stringify(shape(b)))).size).toBe(1);
    // Searches agree with reads.
    expect(idsOf((await call("/fhir/R4/DiagnosticReport?status=final", PAT_A)).body)).toEqual([]);
    expect(idsOf((await call("/fhir/R4/DiagnosticReport?status=partial", PAT_A)).body)).toEqual([OX.id, OY.id, OZ.id]);
    // The released result itself is final: it was reviewed.
    expect((await call(`/fhir/R4/Observation/${lab(RX1.id)}`, PAT_A)).body.status).toBe("final");
    expect((await call(`/fhir/R4/Observation/${lab(RX2.id)}`, PAT_A)).status).toBe(404);
  });

  it("cannot reach another patient's laboratory data by changing the URL", async () => {
    const { call } = setup();
    for (const path of [
      `/fhir/R4/Observation?patient=Patient/${PATIENT_B.fhir_id}&category=laboratory`,
      `/fhir/R4/DiagnosticReport?patient=Patient/${PATIENT_B.fhir_id}`,
      `/fhir/R4/DiagnosticReport?subject=Patient/${PATIENT_A.fhir_id}&patient=Patient/${PATIENT_B.fhir_id}`,
    ]) {
      expect((await call(path, PAT_A)).status, path).toBe(403);
    }
    expect((await call(`/fhir/R4/DiagnosticReport/${O1.id}`, PAT_B)).status).toBe(404);
    expect(idsOf((await call("/fhir/R4/DiagnosticReport", PAT_B)).body)).toEqual([O5.id]);
    expect(idsOf((await call("/fhir/R4/Observation?category=laboratory", PAT_B)).body)).toEqual([lab(R5.id)]);
  });

  it("the audit names the patient's own record", async () => {
    const { call, audits } = setup();
    await call(`/fhir/R4/DiagnosticReport/${O2.id}`, PAT_A);
    expect(audits.at(-1)).toMatchObject({ p_decision: "permit", p_patient_ids: [PATIENT_A.id], p_actor_kind: "patient" });
  });
});

// ---------------------------------------------------------------------------
// Merged patients
// ---------------------------------------------------------------------------

describe("merged patients", () => {
  it("a search by the kept record includes rows still on the merged-away id, shown as the kept record", async () => {
    const { call } = setup();
    const kept = `patient=Patient/${PATIENT_A.fhir_id}`;
    for (const path of [
      `/fhir/R4/ServiceRequest?${kept}&code=PREG`,
      `/fhir/R4/DiagnosticReport?${kept}&code=PREG`,
      `/fhir/R4/Observation?${kept}&code=PREG`,
    ]) {
      const { status, body } = await call(path, DOCTOR);
      expect(status, path).toBe(200);
      const found = matches(body);
      expect(found.map((x) => x.id), path).toEqual([path.includes("Observation") ? lab(RM.id) : OM.id]);
      expect(found[0].subject.reference).toBe(`Patient/${PATIENT_A.fhir_id}`);
      expect(JSON.stringify(body)).not.toContain(PATIENT_M.fhir_id);
    }
  });

  it("a search by the merged-away record matches nothing and names the kept record", async () => {
    const { call } = setup();
    for (const type of ["ServiceRequest", "DiagnosticReport", "Observation"]) {
      const { body } = await call(`/fhir/R4/${type}?patient=Patient/${PATIENT_M.fhir_id}`, DOCTOR);
      expect(matches(body), type).toEqual([]);
      expect(outcomes(body)[0].diagnostics, type).toContain(`Patient/${PATIENT_A.fhir_id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Nothing forbidden in any served JSON
// ---------------------------------------------------------------------------

describe("never published", () => {
  it("no account id, note, withheld reason, patient note, specimen, table name or internal patient id", async () => {
    const { call, served } = setup();
    const paths = [
      `/fhir/R4/ServiceRequest?patient=Patient/${PATIENT_A.fhir_id}&_count=50`,
      `/fhir/R4/DiagnosticReport?patient=Patient/${PATIENT_A.fhir_id}&_count=50`,
      `/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&_count=100`,
      ...ORDERS.map((x) => `/fhir/R4/ServiceRequest/${x.id}`),
      ...ORDERS.map((x) => `/fhir/R4/DiagnosticReport/${x.id}`),
      ...RESULTS.map((x) => `/fhir/R4/Observation/${lab(x.id)}`),
    ];
    for (const p of paths) await call(p, DOCTOR);
    for (const p of [
      "/fhir/R4/Observation?_count=100",
      "/fhir/R4/DiagnosticReport",
      ...ORDERS.map((x) => `/fhir/R4/DiagnosticReport/${x.id}`),
      ...RESULTS.map((x) => `/fhir/R4/Observation/${lab(x.id)}`),
    ]) {
      await call(p, PAT_A);
    }
    const text = served.join("\n");
    expect(text).toContain(PRACTITIONER_ID); // the published staff id is there...
    for (const secret of [
      // ...but never an account id
      ORDERER_UID,
      UNMAPPED_UID,
      REVIEWER_UID,
      ENTERER_UID,
      RELEASER_UID,
      WITHHOLDER_UID,
      "doctor-1",
      "SECRET",
      "lab_orders",
      "lab_results",
      "superseded",
      "withheld",
      "clinical_notes",
      "specimen",
      PATIENT_A.id,
      PATIENT_M.id,
      PATIENT_B.id,
      "storage",
      "http://loinc.org|",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});
