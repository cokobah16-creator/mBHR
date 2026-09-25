// @vitest-environment node
//
// Medicines: Medication, MedicationRequest and MedicationDispense. The pure
// mappers and status maps first (every element, every status row, the
// forbidden mappings), then the gateway end to end against the in-memory
// Supabase: permissions, patient self-access, enumeration, ids, merged
// patients, search parameters and paging, and that nothing that must never
// be published reaches a response.

import { describe, expect, it } from "vitest";
import { handleFhirRequest } from "../gateway/handler";
import { validateResource } from "../validation/validate";
import { explainStatus, sourceValuesFor } from "../terminology/statusMaps";
import { STATUS_MAPS } from "../terminology/status";
import {
  MEDICATION_DISPENSE_STATUS,
  MEDICATION_REQUEST_STATUS,
  MEDICATION_STATUS,
} from "../terminology/status/medication";
import {
  dispenseFhirId,
  dispenseSourceId,
  emptyMedicationContext,
  isAddMedicineRow,
  mapMedication,
  mapMedicationDispense,
  mapMedicationDispenseStatus,
  mapMedicationRequest,
  mapMedicationRequestStatus,
  mapMedicationStatus,
  medicationRequestId,
  parseMedicationRequestId,
  positiveInt,
  type MedicationMapContext,
} from "../mappers/medication";
import { medicationModule } from "../resources/medication";
import { medicationRequestModule } from "../resources/medicationRequest";
import { medicationDispenseModule } from "../resources/medicationDispense";
import { RESOURCE_DEFINITIONS } from "../resources/registry";
import { fakeSupabase, makeToken, type FakeOptions, type FakeUser, type RpcHandler } from "./fakeSupabase";
import { PATIENT_A, PATIENT_B, VISIT_A } from "./fixtures";

// ---------------------------------------------------------------------------
// Fixtures (synthetic; shaped like PostgREST rows, with every column the
// modules read plus columns that must never be published)
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
const VISIT_A_OPEN = { ...VISIT_A, id: "01HZZVISITA100000000000000", status: "open" };
const VISIT_B = { ...VISIT_A, id: "01HZZVISITB000000000000000", patient_id: PATIENT_B.id };

const DOCTOR_ACCOUNT = "11111111-aaaa-4bbb-8ccc-000000000001";
const PHARMACIST_ACCOUNT = "11111111-aaaa-4bbb-8ccc-000000000002";
const DEVICE_USER = "01HZZDEVICEUSER00000000000";
const VOIDED_BY = "99999999-dead-4bee-8fee-000000000009";
const STAFF_DIRECTORY = [
  { id: DOCTOR_ACCOUNT, full_name: "Dr Ngozi Example", role: "doctor", email: "ngozi@example.org", phone: "08000000077" },
  { id: PHARMACIST_ACCOUNT, full_name: "Tunde Example", role: "pharmacist", email: "tunde@example.org", phone: "08000000088" },
  { id: "22222222-aaaa-4bbb-8ccc-000000000003", full_name: "Guest Example", role: "guest", email: null, phone: null },
];

const ITEM_PARA = {
  id: "item-paracetamol-500mg-tablet",
  med_name: "Paracetamol",
  strength: "500mg",
  form: "tablet",
  unit: "tablets",
  on_hand_qty: 480,
  reorder_threshold: 50,
  is_controlled: false,
  site_key: "asaba-hq",
  is_active: true,
  row_version: 7,
  updated_at: "2026-04-01T10:00:00Z",
};
const ITEM_AMOX = {
  ...ITEM_PARA,
  id: "01HZZITEMAMOX0000000000000",
  med_name: "Amoxicillin",
  strength: "125mg/5ml",
  form: "powder for suspension",
  unit: "bottles",
  is_controlled: true,
  is_active: false,
};
// A seeded id longer than a FHIR id may be, and no unit recorded.
const ITEM_LONG = {
  ...ITEM_PARA,
  id: "item-artemether-lumefantrine-pediatric-20mg-120mg-dispersible-tablet",
  med_name: "Artemether-Lumefantrine (Pediatric)",
  strength: "20mg/120mg",
  form: "dispersible tablet",
  unit: "",
};

const LINE_PARA = { itemId: ITEM_PARA.id, dosage: "1 tablet", frequency: "three times daily", durationDays: 5, qty: 15, notes: "Take after food" };
const LINE_AMOX = { itemId: ITEM_AMOX.id, dosage: "5 ml", frequency: "twice daily", durationDays: 7, qty: 1 };

const RX_BASE = {
  visit_id: VISIT_A.id,
  patient_id: PATIENT_A.id,
  prescriber_id: DOCTOR_ACCOUNT,
  created_at: "2026-05-01T09:10:00Z",
  updated_at: "2026-05-01T09:10:05Z",
  dispensed_at: null,
  dispensed_by: null,
  voided_at: null,
  voided_by: null,
  void_reason: null,
  row_version: 1,
};
const RX_OPEN = { ...RX_BASE, id: "01HZZRXOPEN000000000000000", status: "open", lines: [LINE_PARA, LINE_AMOX] };
const RX_DONE = {
  ...RX_BASE,
  id: "01HZZRXDONE000000000000000",
  status: "dispensed",
  prescriber_id: DEVICE_USER,
  lines: [LINE_PARA],
  created_at: "2026-04-20T08:00:00Z",
  dispensed_at: "2026-04-20T09:00:00Z",
  dispensed_by: PHARMACIST_ACCOUNT,
};
const RX_VOID = {
  ...RX_BASE,
  id: "01HZZRXVOID000000000000000",
  status: "void",
  visit_id: "",
  lines: [LINE_PARA],
  voided_at: "2026-05-01T09:30:00Z",
  voided_by: VOIDED_BY,
  void_reason: "cancelled_by_prescriber",
  created_at: "2026-05-03T08:00:00Z",
};
const RX_PARTIAL = { ...RX_BASE, id: "01HZZRXPART000000000000000", status: "partial", lines: [LINE_PARA] };
// A status the app does not write, another patient's visit, a line naming a
// medicine not in the catalogue, a line that is not a line, and a medicine
// with a long id and no unit.
const RX_ODD = {
  ...RX_BASE,
  id: "01HZZRXODD0000000000000000",
  status: "archived",
  visit_id: VISIT_B.id,
  prescriber_id: "Dr Typed Name",
  lines: [{ itemId: "item-removed-from-catalogue", dosage: "1 tablet", qty: 2 }, "not a line", { itemId: ITEM_LONG.id, dosage: "1 tablet", frequency: "once daily", durationDays: "1", qty: 3 }],
};
const RX_M = { ...RX_BASE, id: "01HZZRXM000000000000000000", status: "open", patient_id: PATIENT_M.id, visit_id: "", lines: [LINE_PARA] };
const RX_B = { ...RX_BASE, id: "01HZZRXB000000000000000000", status: "open", patient_id: PATIENT_B.id, visit_id: VISIT_B.id, lines: [LINE_PARA] };
const RX_DUP = { ...RX_BASE, id: "01HZZRXDUP0000000000000000", status: "dispensed", lines: [LINE_PARA, { ...LINE_PARA, dosage: "2 tablets" }] };
const RX_OPEN_VISIT = { ...RX_BASE, id: "01HZZRXOPENVISIT0000000000", status: "open", visit_id: VISIT_A_OPEN.id, lines: [LINE_AMOX] };
const PRESCRIPTIONS = [RX_OPEN, RX_DONE, RX_VOID, RX_PARTIAL, RX_ODD, RX_M, RX_B, RX_DUP, RX_OPEN_VISIT];

const RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm";
const DISPENSE_BASE = {
  patient_id: PATIENT_A.id,
  visit_id: VISIT_A.id,
  item_name: "Paracetamol 500mg",
  qty: 10,
  dosage: "1 tablet",
  directions: "three times daily · 5 days · Take after food",
  dispensed_by: PHARMACIST_ACCOUNT,
  dispensed_at: "2026-05-01T10:00:00Z",
  updated_at: "2026-05-01T10:00:01Z",
  prescription_id: RX_DONE.id,
  item_id: ITEM_PARA.id,
  batch_id: "01HZZBATCH0000000000000000",
  dispense_status: null as string | null,
  when_handed_over: null as string | null,
  days_supply: null,
  authorizing_prescription_id: null,
  medication_code_system: RXNORM,
  medication_code: null,
  portal_visible: true,
  visibility_reason: null as string | null,
  hidden_by: null as string | null,
  hidden_at: null as string | null,
  _dirty: 0,
  _synced_at: null,
};
const D_RX = { ...DISPENSE_BASE, id: "01HZZDISPRX000000000000000" };
// The rx_dispense fallback id (<command uuid>:<line>:<k>) for units given offline beyond server stock.
const D_COLON = { ...DISPENSE_BASE, id: "7d9b6f2e-3c1a-4e8b-9f00-0000000000c1:1:1", qty: 5, batch_id: null };
const D_VISIT = {
  ...DISPENSE_BASE,
  id: "01HZZDISPVISIT000000000000",
  item_name: "Amoxicillin 250mg caps",
  dosage: "500 mg",
  directions: "twice daily for 5 days",
  dispensed_by: "Nurse Joy Example",
  dispensed_at: "2026-05-02T11:00:00Z",
  updated_at: "2026-05-02T11:00:00Z",
  prescription_id: null,
  item_id: null,
  batch_id: null,
};
// A row that existed when migration 20260503010200 was applied: it set
// dispense_status 'completed' and copied dispensed_at into when_handed_over
// for every such row, whatever happened to the medicine.
const D_LEGACY = {
  ...D_VISIT,
  id: "01HZZDISPLEGACY00000000000",
  item_name: "Ibuprofen 200mg",
  qty: null,
  dispense_status: "completed",
  when_handed_over: "2026-01-10T09:05:00Z",
  dispensed_at: "2026-01-10T09:05:00Z",
  updated_at: "2026-01-10T09:05:00Z",
};
// The staff dashboard's "Add medicine" form: invented quantity, never published.
const D_ADD = {
  ...D_VISIT,
  id: "b3f1c2d4-0000-4000-8000-0000000000ad",
  visit_id: null,
  item_name: "Vitamin C",
  qty: 1,
  dosage: null,
  directions: "daily",
  dispensed_by: "staff",
};
const D_HIDDEN = {
  ...D_VISIT,
  id: "01HZZDISPHIDDEN00000000000",
  item_name: "Metronidazole 400mg",
  portal_visible: false,
  visibility_reason: "private clinician reason",
  hidden_by: "hider@example.org",
  hidden_at: "2026-05-03T09:00:00Z",
};
const D_B = { ...D_VISIT, id: "01HZZDISPB0000000000000000", patient_id: PATIENT_B.id, visit_id: VISIT_B.id, item_name: "Zinc 20mg" };
const D_M = { ...DISPENSE_BASE, id: "01HZZDISPM0000000000000000", patient_id: PATIENT_M.id, visit_id: null, prescription_id: RX_M.id };
const D_DECLINED = { ...D_VISIT, id: "01HZZDISPDECLINED000000000", dispense_status: "declined" };
const D_CANCELLED = { ...D_VISIT, id: "01HZZDISPCANCELLED00000000", dispense_status: "cancelled" };
const D_AMBIG = { ...DISPENSE_BASE, id: "01HZZDISPAMBIG000000000000", prescription_id: RX_DUP.id };
const D_ZERO = { ...DISPENSE_BASE, id: "01HZZDISPZERO0000000000000", qty: 0, dispensed_by: DEVICE_USER };
const D_DOT = { ...D_VISIT, id: "01HZZ.DOT" };
const D_DRIFT = { ...D_VISIT, id: "01HZZDISPDRIFT000000000000", dispense_status: "handed_over" };
const DISPENSES = [D_RX, D_COLON, D_VISIT, D_LEGACY, D_ADD, D_HIDDEN, D_B, D_M, D_DECLINED, D_CANCELLED, D_AMBIG, D_ZERO, D_DOT, D_DRIFT];

// ---------------------------------------------------------------------------
// The database functions this package calls, with the migration's rules
// ---------------------------------------------------------------------------

const refused = (code: string, status: number) => new Response(JSON.stringify({ code }), { status });
const isStaff = (u: FakeUser) => (u.kind ?? (u.role ? "staff" : "none")) === "staff";

function linkRpcs(): Record<string, RpcHandler> {
  const minted = new Map<string, string>();
  const mint = (source: string) => {
    if (!minted.has(source)) minted.set(source, `5e0d0000-0000-4000-8000-${String(minted.size + 1).padStart(12, "0")}`);
    return minted.get(source) as string;
  };
  return {
    // SECURITY DEFINER: reads pharmacy_items without the caller's RLS; staff only.
    fhir_link_ids: (body, user, fake) => {
      if (!isStaff(user)) return refused("42501", 403);
      const ids = (body.p_source_ids as string[]) ?? [];
      if (body.p_resource_type !== "Medication" || ids.length > 200 || ids.some((i) => !/^[A-Za-z0-9._:-]{1,128}$/.test(i))) {
        return refused("22023", 400);
      }
      const existing = new Set((fake.opts.tables.pharmacy_items ?? []).map((r) => String(r.id)));
      return ids.filter((i) => existing.has(i)).sort().map((i) => ({ source_id: i, fhir_id: mint(i) }));
    },
    fhir_link_sources: (body, user, fake) => {
      if (!isStaff(user)) return refused("42501", 403);
      const ids = (body.p_fhir_ids as string[]) ?? [];
      if (body.p_resource_type !== "Medication" || ids.some((i) => !/^[A-Za-z0-9.-]{1,64}$/.test(i))) return refused("22023", 400);
      const existing = new Set((fake.opts.tables.pharmacy_items ?? []).map((r) => String(r.id)));
      return [...minted].filter(([s, f]) => ids.includes(f) && existing.has(s)).map(([s, f]) => ({ fhir_id: f, source_id: s }));
    },
    fhir_staff_directory: (body, user) => {
      if (!isStaff(user)) return refused("42501", 403);
      const ids = (body.p_source_ids as string[] | null) ?? null;
      if (!ids || ids.some((i) => !/^[A-Za-z0-9._-]{1,128}$/.test(i))) return refused("22023", 400);
      const roles = ["admin", "doctor", "nurse", "pharmacist", "volunteer", "auditor", "lead_clinician", "registration_lead"];
      return STAFF_DIRECTORY.filter((s) => roles.includes(s.role) && ids.includes(s.id)).map((s, i) => ({
        fhir_id: `7a000000-0000-4000-8000-00000000000${i + 1}`,
        source_id: s.id,
        full_name: s.full_name,
        role: s.role,
        active: null,
        created_at: null,
        updated_at: null,
      }));
    },
  };
}

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
const PHARMACIST = makeToken("pharm-1");
const STOREKEEPER = makeToken("store-1");
const NURSE = makeToken("nurse-1");
const PAT_A = makeToken("portal-a");
const PAT_B = makeToken("portal-b");

const USERS: Record<string, FakeUser> = {
  [DOCTOR]: { id: "doctor-1", role: "doctor", permissions: ["consult", "lab_review", "register", "vitals", "queue"] },
  [PHARMACIST]: { id: "pharm-1", role: "pharmacist", permissions: ["dispense", "inventory", "queue"] },
  [STOREKEEPER]: { id: "store-1", role: "pharmacist", permissions: ["inventory"] },
  [NURSE]: { id: "nurse-1", role: "nurse", permissions: ["register", "vitals", "queue"] },
  [PAT_A]: { id: "portal-a", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_A.id] },
  [PAT_B]: { id: "portal-b", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_B.id] },
};

/** Row-level security as the latest migrations have it. */
function visible(table: string, row: Record<string, unknown>, user: FakeUser): boolean {
  const staff = isStaff(user);
  const own = user.patientIds ?? [];
  switch (table) {
    case "pharmacy_items":
      return ["consult", "dispense", "inventory"].some((p) => user.permissions.includes(p));
    case "prescriptions":
      return staff;
    case "dispenses":
      return staff || (row.portal_visible !== false && own.includes(String(row.patient_id)));
    case "visits":
      return staff || (own.includes(String(row.patient_id)) && row.status === "closed");
    case "patients":
      return staff || own.includes(String(row.id));
    default:
      return staff;
  }
}

function setup(overrides: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({
    users: USERS,
    tables: {
      patients: [PATIENT_A, PATIENT_B, PATIENT_M],
      visits: [VISIT_A, VISIT_A_OPEN, VISIT_B],
      pharmacy_items: [ITEM_PARA, ITEM_AMOX, ITEM_LONG],
      prescriptions: PRESCRIPTIONS,
      dispenses: DISPENSES,
    },
    visible,
    rpcs: linkRpcs(),
    ...overrides,
  });
  const logs: string[] = [];
  const call = (path: string, token?: string) => {
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return handleFhirRequest(new Request(`https://mbhr.app${path}`, { headers }), {
      env: ENV,
      fetchImpl: fake.fetchImpl,
      randomId: () => "11111111-2222-4333-8444-555555555555",
      log: (l) => logs.push(l),
      now: () => new Date("2026-09-25T12:00:00Z"),
    });
  };
  return { ...fake, call, logs };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const body = async (res: Response) => (await res.json()) as Json;
const matches = (b: Json): Json[] => (b.entry ?? []).filter((e: Json) => e.search.mode === "match").map((e: Json) => e.resource);
const ids = (b: Json): string[] => matches(b).map((r) => r.id);
const outcome = (b: Json): Json | undefined => (b.entry ?? []).find((e: Json) => e.search.mode === "outcome")?.resource;

/** Values that must never appear in a served response. */
const NEVER_PUBLISHED = [
  PATIENT_A.id,
  PATIENT_B.id,
  PATIENT_M.id,
  DOCTOR_ACCOUNT,
  PHARMACIST_ACCOUNT,
  DEVICE_USER,
  VOIDED_BY,
  "Dr Typed Name",
  "Nurse Joy Example",
  "ngozi@example.org",
  "tunde@example.org",
  "Dr Ngozi Example",
  "Tunde Example",
  "cancelled_by_prescriber",
  "private clinician reason",
  "hider@example.org",
  ITEM_PARA.id,
  ITEM_AMOX.id,
  ITEM_LONG.id,
  "item-removed-from-catalogue",
  "asaba-hq",
  "01HZZBATCH",
  "rxnorm",
  "on_hand",
  "reorder",
  "is_controlled",
  "pharmacy_items",
  "prescriptions",
  "dispenses",
  "resource_links",
  "Vitamin C",
];

function expectNothingForbidden(json: unknown) {
  const text = JSON.stringify(json);
  for (const secret of NEVER_PUBLISHED) expect(text, secret).not.toContain(secret);
}

// ---------------------------------------------------------------------------
// Status maps
// ---------------------------------------------------------------------------

describe("medicine status maps", () => {
  it("are listed with every other map", () => {
    for (const m of [MEDICATION_STATUS, MEDICATION_REQUEST_STATUS, MEDICATION_DISPENSE_STATUS]) expect(STATUS_MAPS).toContain(m);
  });

  it("Medication.status follows is_active and leaves a missing flag out", () => {
    expect(mapMedicationStatus(true)).toBe("active");
    expect(mapMedicationStatus(false)).toBe("inactive");
    expect(mapMedicationStatus(null)).toBeNull();
    expect(mapMedicationStatus(undefined)).toBeNull();
    // Never active from anything but a recorded true.
    expect(mapMedicationStatus("yes")).toBeNull();
    expect(mapMedicationStatus(1)).toBeNull();
  });

  it("MedicationRequest.status maps each prescription status", () => {
    expect(mapMedicationRequestStatus("open")).toBe("active");
    expect(mapMedicationRequestStatus("dispensed")).toBe("completed");
    expect(mapMedicationRequestStatus("void")).toBe("cancelled");
    expect(mapMedicationRequestStatus("partial")).toBe("unknown");
    expect(mapMedicationRequestStatus(null)).toBe("unknown");
    expect(mapMedicationRequestStatus("")).toBe("unknown");
    expect(mapMedicationRequestStatus("archived")).toBe("unknown");
    expect(mapMedicationRequestStatus("OPEN")).toBe("active");
    expect(mapMedicationRequestStatus(" open")).toBe("unknown");
    expect(explainStatus(MEDICATION_REQUEST_STATUS, "dispensed").reason).toMatch(/not that the course of treatment has ended/);
  });

  it("MedicationRequest.status never promotes: open is never completed, void never completed or active, partial never active or completed", () => {
    expect(mapMedicationRequestStatus("open")).not.toBe("completed");
    for (const v of ["void", "partial"]) {
      expect(["completed", "active"]).not.toContain(mapMedicationRequestStatus(v));
    }
    expect(["stopped", "entered-in-error"]).not.toContain(mapMedicationRequestStatus("void"));
    expect(sourceValuesFor(MEDICATION_REQUEST_STATUS, "completed")).toEqual(["dispensed"]);
    expect(sourceValuesFor(MEDICATION_REQUEST_STATUS, "active")).toEqual(["open"]);
  });

  it("MedicationDispense.status maps codes set on purpose and keeps a missing status unknown", () => {
    for (const code of ["preparation", "in-progress", "cancelled", "on-hold", "entered-in-error", "stopped", "declined", "unknown"]) {
      expect(mapMedicationDispenseStatus(code)).toBe(code);
    }
    expect(mapMedicationDispenseStatus(null)).toBe("unknown");
    expect(mapMedicationDispenseStatus("")).toBe("unknown");
    expect(mapMedicationDispenseStatus("handed_over")).toBe("unknown");
    expect(explainStatus(MEDICATION_DISPENSE_STATUS, null).reason).toMatch(/never assumed completed/);
  });

  it("MedicationDispense.status: the 'completed' a migration stamped on every row is a default, not a handover: unknown", () => {
    // 20260503010200 sets dispense_status = 'completed' WHERE it IS NULL,
    // whenever it is applied; nothing else writes the column.
    expect(mapMedicationDispenseStatus("completed")).toBe("unknown");
    expect(mapMedicationDispenseStatus("COMPLETED")).toBe("unknown");
    expect(explainStatus(MEDICATION_DISPENSE_STATUS, "completed").reason).toMatch(/Migration default, not a recorded handover/);
    expect(MEDICATION_DISPENSE_STATUS.rules.flatMap((r) => r.source).includes("completed")).toBe(true);
  });

  it("MedicationDispense.status: nothing mBHR stores is ever published as completed", () => {
    expect(mapMedicationDispenseStatus(null)).not.toBe("completed");
    for (const v of ["completed", "declined", "cancelled", "stopped", "in-progress", "preparation", "on-hold", "unknown", "handed_over"]) {
      expect(mapMedicationDispenseStatus(v), v).not.toBe("completed");
    }
    expect(MEDICATION_DISPENSE_STATUS.rules.some((r) => r.fhir === "completed")).toBe(false);
    expect(sourceValuesFor(MEDICATION_DISPENSE_STATUS, "completed")).toEqual([]);
    expect(sourceValuesFor(MEDICATION_DISPENSE_STATUS, "unknown").sort()).toEqual(["completed", "unknown"]);
  });
});

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

const MED_ID = "5e0d0000-0000-4000-8000-0000000000aa";
const PRACTITIONER_ID = "7a000000-0000-4000-8000-0000000000bb";

function mapCtx(extra: Partial<MedicationMapContext> = {}): MedicationMapContext {
  return {
    ...emptyMedicationContext({
      patientFhirIds: new Map([
        [PATIENT_A.id, PATIENT_A.fhir_id],
        [PATIENT_M.id, PATIENT_A.fhir_id],
        [PATIENT_B.id, PATIENT_B.fhir_id],
      ]),
    }),
    items: new Map([
      [ITEM_PARA.id, { fhirId: MED_ID, description: "Paracetamol 500mg", unit: "tablets" }],
      [ITEM_AMOX.id, { fhirId: null, description: "Amoxicillin 125mg/5ml", unit: "bottles" }],
      [ITEM_LONG.id, { fhirId: "5e0d0000-0000-4000-8000-0000000000cc", description: "Artemether-Lumefantrine (Pediatric) 20mg/120mg" }],
    ]),
    visitPatients: new Map([
      [VISIT_A.id, PATIENT_A.fhir_id],
      [VISIT_B.id, PATIENT_B.fhir_id],
    ]),
    practitioners: new Map([
      [DOCTOR_ACCOUNT, PRACTITIONER_ID],
      [PHARMACIST_ACCOUNT, "7a000000-0000-4000-8000-0000000000dd"],
    ]),
    prescriptions: new Map([
      [RX_DONE.id, { patientFhirId: PATIENT_A.fhir_id, itemIds: [ITEM_PARA.id] }],
      [RX_DUP.id, { patientFhirId: PATIENT_A.fhir_id, itemIds: [ITEM_PARA.id, ITEM_PARA.id] }],
      [RX_B.id, { patientFhirId: PATIENT_B.fhir_id, itemIds: [ITEM_PARA.id] }],
    ]),
    ...extra,
  };
}

describe("Medication mapper", () => {
  it("publishes name and strength as text, the form as text and the status, under the random id", () => {
    const m = mapMedication(ITEM_PARA, MED_ID)!;
    expect(m).toEqual({
      resourceType: "Medication",
      id: MED_ID,
      meta: { versionId: String(Date.parse(ITEM_PARA.updated_at)), lastUpdated: "2026-04-01T10:00:00.000Z", source: "https://mbhr.app" },
      code: { text: "Paracetamol 500mg" },
      status: "active",
      form: { text: "tablet" },
    });
    expect(validateResource(m, medicationModule.validate)).toEqual([]);
  });

  it("never publishes the catalogue id, stock or a code, and never parses the strength", () => {
    const m = mapMedication(ITEM_AMOX, MED_ID)!;
    expect(m.status).toBe("inactive");
    const text = JSON.stringify(m);
    for (const s of [ITEM_AMOX.id, "480", "on_hand", "controlled", "asaba", "coding", "ingredient", "amount"]) expect(text).not.toContain(s);
  });

  it("publishes nothing without a published id or a name", () => {
    expect(mapMedication(ITEM_PARA, null)).toBeNull();
    expect(mapMedication(ITEM_PARA, ITEM_LONG.id)).toBeNull(); // 68 characters: not a FHIR id
    expect(mapMedication({ ...ITEM_PARA, med_name: "  " }, MED_ID)).toBeNull();
    const noStatus = mapMedication({ ...ITEM_PARA, is_active: null, form: "", strength: "" }, MED_ID)!;
    expect(noStatus).toMatchObject({ code: { text: "Paracetamol" } });
    expect(noStatus.status).toBeUndefined();
    expect(noStatus.form).toBeUndefined();
  });

  it("the validator refuses invented codes and parsed strengths", () => {
    const bad = { ...mapMedication(ITEM_PARA, MED_ID)!, code: { text: "x", coding: [{ system: RXNORM, code: "161" }] }, amount: {} };
    const issues = validateResource(bad, medicationModule.validate).map((i) => i.path);
    expect(issues).toEqual(expect.arrayContaining(["code.coding", "amount"]));
  });
});

describe("MedicationRequest mapper", () => {
  it("maps every element of a prescription line", () => {
    const r = mapMedicationRequest(RX_OPEN, 0, mapCtx())!;
    expect(r).toEqual({
      resourceType: "MedicationRequest",
      id: `${RX_OPEN.id}-1`,
      meta: { versionId: String(Date.parse(RX_OPEN.updated_at)), lastUpdated: "2026-05-01T09:10:05.000Z", source: "https://mbhr.app" },
      status: "active",
      intent: "order",
      subject: { reference: `Patient/${PATIENT_A.fhir_id}` },
      groupIdentifier: { system: "https://mbhr.app/identifiers/prescription", value: RX_OPEN.id },
      medicationReference: { reference: `Medication/${MED_ID}`, display: "Paracetamol 500mg" },
      encounter: { reference: `Encounter/${VISIT_A.id}` },
      authoredOn: "2026-05-01T09:10:00.000Z",
      requester: { reference: `Practitioner/${PRACTITIONER_ID}` },
      dosageInstruction: [{ text: "1 tablet · three times daily · 5 days", patientInstruction: "Take after food" }],
      dispenseRequest: { quantity: { value: 15, unit: "tablets" } },
    });
    expect(validateResource(r, medicationRequestModule.validate)).toEqual([]);
  });

  it("keeps dosing as free text: no dose quantity, timing, route or bounds", () => {
    const r = mapMedicationRequest(RX_OPEN, 1, mapCtx())!;
    expect(r.dosageInstruction).toEqual([{ text: "5 ml · twice daily · 7 days" }]);
    expect(JSON.stringify(r)).not.toMatch(/doseAndRate|timing|route|boundsDuration|"code"|unitsofmeasure/);
    // One day, in words; a duration that is not a whole number of days is left out, never guessed.
    expect(mapMedicationRequest({ ...RX_OPEN, lines: [{ ...LINE_PARA, durationDays: 1, notes: "" }] }, 0, mapCtx())!.dosageInstruction).toEqual([
      { text: "1 tablet · three times daily · 1 day" },
    ]);
    expect(mapMedicationRequest({ ...RX_OPEN, lines: [{ ...LINE_PARA, durationDays: "5-7", notes: null }] }, 0, mapCtx())!.dosageInstruction).toEqual([
      { text: "1 tablet · three times daily" },
    ]);
    expect(mapMedicationRequest({ ...RX_OPEN, lines: [{ itemId: ITEM_PARA.id }] }, 0, mapCtx())!.dosageInstruction).toBeUndefined();
  });

  it("names the medicine as text when its published id could not be obtained", () => {
    const r = mapMedicationRequest(RX_OPEN, 1, mapCtx())!;
    expect(r.medicationReference).toBeUndefined();
    expect(r.medicationCodeableConcept).toEqual({ text: "Amoxicillin 125mg/5ml" });
    expect(r.dispenseRequest).toEqual({ quantity: { value: 1, unit: "bottles" } });
    expect(validateResource(r, medicationRequestModule.validate)).toEqual([]);
  });

  it("publishes a quantity only with its unit and a positive whole number", () => {
    const long = mapMedicationRequest(RX_ODD, 2, mapCtx())!;
    expect(long.id).toBe(`${RX_ODD.id}-3`);
    expect(long.dispenseRequest).toBeUndefined(); // no unit recorded
    for (const qty of [0, -2, 1.5, "3 packs", null]) {
      expect(mapMedicationRequest({ ...RX_OPEN, lines: [{ ...LINE_PARA, qty }] }, 0, mapCtx())!.dispenseRequest).toBeUndefined();
    }
  });

  it("maps each prescription status, and a cancelled or open prescription is never completed", () => {
    const status = (row: Record<string, unknown>) => mapMedicationRequest(row, 0, mapCtx())!.status;
    expect(status(RX_OPEN)).toBe("active");
    expect(status(RX_DONE)).toBe("completed");
    expect(status(RX_VOID)).toBe("cancelled");
    expect(status(RX_PARTIAL)).toBe("unknown");
    expect(status({ ...RX_OPEN, status: null })).toBe("unknown");
    expect(status({ ...RX_OPEN, status: "archived" })).toBe("unknown");
    // The void reason (free text a caller may send) is not published.
    expect(JSON.stringify(mapMedicationRequest(RX_VOID, 0, mapCtx()))).not.toMatch(/statusReason|cancelled_by/);
  });

  it("references only what resolves: encounter of the same patient, prescriber in the staff directory", () => {
    const odd = mapMedicationRequest(RX_ODD, 2, mapCtx())!;
    expect(odd.encounter).toBeUndefined(); // another patient's visit
    expect(odd.requester).toBeUndefined(); // a typed name, not an account
    expect(mapMedicationRequest(RX_VOID, 0, mapCtx())!.encounter).toBeUndefined(); // visit_id ''
    expect(mapMedicationRequest(RX_DONE, 0, mapCtx())!.requester).toBeUndefined(); // a device id, not in the directory
    const unreadVisit = mapMedicationRequest(RX_OPEN, 0, mapCtx({ visitPatients: new Map() }))!;
    expect(unreadVisit.encounter).toBeUndefined();
    // Merged-away patient: the kept record is the subject.
    expect(mapMedicationRequest(RX_M, 0, mapCtx())!.subject).toEqual({ reference: `Patient/${PATIENT_A.fhir_id}` });
  });

  it("withholds a line whose medicine, patient, shape or id cannot be shown", () => {
    expect(mapMedicationRequest(RX_ODD, 0, mapCtx())).toBeNull(); // medicine not in the catalogue
    expect(mapMedicationRequest(RX_ODD, 1, mapCtx())).toBeNull(); // not a line
    expect(mapMedicationRequest(RX_ODD, 3, mapCtx())).toBeNull(); // no such line
    expect(mapMedicationRequest(RX_OPEN, 0, mapCtx({ patientFhirIds: new Map() }))).toBeNull(); // patient does not resolve
    expect(mapMedicationRequest({ ...RX_OPEN, id: "x".repeat(63) }, 0, mapCtx())).toBeNull(); // id would pass 64 characters
    expect(mapMedicationRequest({ ...RX_OPEN, lines: null }, 0, mapCtx())).toBeNull();
  });

  it("forms and parses line ids", () => {
    expect(medicationRequestId("abc", 0)).toBe("abc-1");
    expect(medicationRequestId("abc", 64)).toBeNull();
    expect(parseMedicationRequestId("0b3c1d2e-1111-4aaa-8bbb-000000000001-2")).toEqual({
      prescriptionId: "0b3c1d2e-1111-4aaa-8bbb-000000000001",
      lineIndex: 1,
    });
    for (const bad of ["abc", "abc-0", "abc-65", "-1", "abc-01", "abc-1x", "a/b-1"]) expect(parseMedicationRequestId(bad), bad).toBeNull();
  });

  it("the validator refuses structured dosing and unit-less quantities", () => {
    const r = mapMedicationRequest(RX_OPEN, 0, mapCtx())!;
    const bad = {
      ...r,
      dosageInstruction: [{ text: "x", timing: { repeat: { frequency: 3 } } }],
      dispenseRequest: { quantity: { value: 15, unit: "", system: "http://unitsofmeasure.org" } },
    };
    const paths = validateResource(bad, medicationRequestModule.validate).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["dosageInstruction[0].timing", "dispenseRequest.quantity"]));
    const noMedication = { ...r, medicationReference: undefined };
    expect(validateResource(noMedication, medicationRequestModule.validate).map((i) => i.path)).toContain("medication[x]");
  });
});

describe("MedicationDispense mapper", () => {
  it("maps every element of a prescription dispense", () => {
    const d = mapMedicationDispense(D_RX, mapCtx())!;
    expect(d).toEqual({
      resourceType: "MedicationDispense",
      id: D_RX.id,
      meta: { versionId: String(Date.parse(D_RX.updated_at)), lastUpdated: "2026-05-01T10:00:01.000Z", source: "https://mbhr.app" },
      status: "unknown",
      medicationCodeableConcept: { text: "Paracetamol 500mg" },
      subject: { reference: `Patient/${PATIENT_A.fhir_id}` },
      context: { reference: `Encounter/${VISIT_A.id}` },
      performer: [{ actor: { reference: "Practitioner/7a000000-0000-4000-8000-0000000000dd" } }],
      authorizingPrescription: [{ reference: `MedicationRequest/${RX_DONE.id}-1` }],
      quantity: { value: 10, unit: "tablets" },
      dosageInstruction: [{ text: "1 tablet · three times daily · 5 days · Take after food" }],
    });
    expect(validateResource(d, medicationDispenseModule.validate)).toEqual([]);
  });

  it("never takes a dispense row as proof of a handover: no recorded status is unknown, even with a prescription", () => {
    expect(mapMedicationDispense(D_RX, mapCtx())!.status).toBe("unknown");
    expect(mapMedicationDispense(D_VISIT, mapCtx())!.status).toBe("unknown");
    // The backfilled legacy row: the migration's 'completed' is not a handover either.
    expect(mapMedicationDispense(D_LEGACY, mapCtx())!.status).toBe("unknown");
    expect(mapMedicationDispense(D_DECLINED, mapCtx())!.status).toBe("declined");
    expect(mapMedicationDispense(D_CANCELLED, mapCtx())!.status).toBe("cancelled");
    expect(mapMedicationDispense(D_DRIFT, mapCtx())!.status).toBe("unknown");
  });

  it("never publishes a handover time: not dispensed_at, not the migration's copy in when_handed_over, whatever the status", () => {
    const rows = [
      D_RX,
      D_VISIT,
      D_LEGACY,
      D_DECLINED,
      { ...D_VISIT, dispense_status: "in-progress", when_handed_over: "2026-05-02T11:30:00Z" },
      { ...D_VISIT, when_handed_over: "2026-05-02T11:30:00Z" },
    ];
    for (const row of rows) {
      const d = mapMedicationDispense(row, mapCtx())!;
      const text = JSON.stringify(d);
      expect(text, row.id).not.toMatch(/whenHandedOver|whenPrepared/);
      // Neither recorded time appears anywhere (meta.lastUpdated is updated_at).
      for (const t of [row.dispensed_at, row.when_handed_over]) {
        if (t && t !== row.updated_at) expect(text).not.toContain(new Date(t).toISOString());
      }
    }
    // A status unknown beside a handover time would say a handover happened: the validator refuses it.
    const d = mapMedicationDispense(D_RX, mapCtx())!;
    const paths = validateResource({ ...d, whenHandedOver: "2026-05-01T10:00:00Z" }, medicationDispenseModule.validate).map((i) => i.path);
    expect(paths).toContain("whenHandedOver");
  });

  it("writes ':' in ids as '.', reversibly, and withholds ids that cannot round-trip", () => {
    expect(dispenseFhirId(D_COLON.id)).toBe("7d9b6f2e-3c1a-4e8b-9f00-0000000000c1.1.1");
    expect(dispenseSourceId("7d9b6f2e-3c1a-4e8b-9f00-0000000000c1.1.1")).toBe(D_COLON.id);
    expect(mapMedicationDispense(D_COLON, mapCtx())!.id).toBe("7d9b6f2e-3c1a-4e8b-9f00-0000000000c1.1.1");
    expect(mapMedicationDispense(D_DOT, mapCtx())).toBeNull();
    expect(dispenseFhirId("a_b")).toBeNull();
    expect(dispenseFhirId("x".repeat(65))).toBeNull();
    expect(dispenseSourceId("a/b")).toBeNull();
  });

  it("never publishes the 'Add medicine' rows", () => {
    expect(isAddMedicineRow(D_ADD)).toBe(true);
    expect(isAddMedicineRow(D_VISIT)).toBe(false);
    expect(mapMedicationDispense(D_ADD, mapCtx())).toBeNull();
  });

  it("names the prescription line only when exactly one line gave this medicine", () => {
    expect(mapMedicationDispense(D_AMBIG, mapCtx())!.authorizingPrescription).toBeUndefined();
    expect(mapMedicationDispense({ ...D_RX, item_id: ITEM_AMOX.id }, mapCtx())!.authorizingPrescription).toBeUndefined();
    expect(mapMedicationDispense({ ...D_RX, prescription_id: RX_B.id }, mapCtx())!.authorizingPrescription).toBeUndefined(); // another patient's
    expect(mapMedicationDispense({ ...D_RX, prescription_id: "01HZZUNKNOWN" }, mapCtx())!.authorizingPrescription).toBeUndefined();
    expect(mapMedicationDispense(D_VISIT, mapCtx())!.authorizingPrescription).toBeUndefined();
    // Merged-away patient on the dispense and its prescription: both show the kept record.
    const merged = mapMedicationDispense(D_M, mapCtx({ prescriptions: new Map([[RX_M.id, { patientFhirId: PATIENT_A.fhir_id, itemIds: [ITEM_PARA.id] }]]) }))!;
    expect(merged.subject).toEqual({ reference: `Patient/${PATIENT_A.fhir_id}` });
    expect(merged.authorizingPrescription).toEqual([{ reference: `MedicationRequest/${RX_M.id}-1` }]);
  });

  it("publishes a quantity only with a unit and more than zero; staff only for staff lookups", () => {
    expect(mapMedicationDispense(D_VISIT, mapCtx())!.quantity).toBeUndefined(); // no catalogue link, no unit
    expect(mapMedicationDispense(D_ZERO, mapCtx())!.quantity).toBeUndefined(); // 0 from a history import
    expect(mapMedicationDispense(D_ZERO, mapCtx())!.performer).toBeUndefined(); // a device id
    expect(mapMedicationDispense(D_VISIT, mapCtx())!.performer).toBeUndefined(); // a typed name
  });

  it("gives a patient the portal's view: no quantity, prescription link or staff", () => {
    const d = mapMedicationDispense(D_RX, mapCtx({ patientView: true }))!;
    expect(d.quantity).toBeUndefined();
    expect(d.authorizingPrescription).toBeUndefined();
    expect(d.performer).toBeUndefined();
    expect(d).toMatchObject({ status: "unknown", medicationCodeableConcept: { text: "Paracetamol 500mg" } });
    expect("whenHandedOver" in d).toBe(false);
  });

  it("withholds a row without a medicine name or a resolvable patient", () => {
    expect(mapMedicationDispense({ ...D_RX, item_name: " " }, mapCtx())).toBeNull();
    expect(mapMedicationDispense(D_RX, mapCtx({ patientFhirIds: new Map() }))).toBeNull();
  });

  it("never uses the RxNorm default or any code", () => {
    const text = JSON.stringify(DISPENSES.map((r) => mapMedicationDispense(r, mapCtx())));
    expect(text).not.toMatch(/rxnorm|coding|"code"/i);
  });

  it("small helpers never turn a missing value into a number", () => {
    expect(positiveInt(3)).toBe(3);
    expect(positiveInt("12")).toBe(12);
    for (const v of [0, "0", -1, 2.5, "2.5", "", null, undefined, "abc", true]) expect(positiveInt(v), String(v)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Gateway: permissions and patient self-access
// ---------------------------------------------------------------------------

describe("who may read medicines", () => {
  it("a nurse without consult or dispense reads none of them, and nothing is queried", async () => {
    const { call, calls } = setup();
    expect((await call(`/fhir/R4/MedicationRequest/${RX_OPEN.id}-1`, NURSE)).status).toBe(403);
    expect((await call(`/fhir/R4/MedicationDispense/${D_RX.id}`, NURSE)).status).toBe(403);
    expect((await call("/fhir/R4/Medication/5e0d0000-0000-4000-8000-000000000001", NURSE)).status).toBe(403);
    expect(calls.some((c) => /\/rest\/v1\/(prescriptions|dispenses|pharmacy_items)|fhir_link|fhir_staff/.test(c.url))).toBe(false);
  });

  it("a stock keeper (inventory) reads the catalogue but not prescriptions or dispenses", async () => {
    const { call } = setup();
    expect((await call(`/fhir/R4/MedicationRequest/${RX_OPEN.id}-1`, STOREKEEPER)).status).toBe(403);
    expect((await call(`/fhir/R4/MedicationDispense/${D_RX.id}`, STOREKEEPER)).status).toBe(403);
  });

  it("prescribers and the pharmacy read prescriptions and dispenses", async () => {
    const { call } = setup();
    for (const token of [DOCTOR, PHARMACIST]) {
      expect((await call(`/fhir/R4/MedicationRequest/${RX_OPEN.id}-1`, token)).status).toBe(200);
      expect((await call(`/fhir/R4/MedicationDispense/${D_RX.id}`, token)).status).toBe(200);
    }
  });

  it("patients are refused prescriptions and the catalogue", async () => {
    const { call, audits } = setup();
    expect((await call(`/fhir/R4/MedicationRequest/${RX_OPEN.id}-1`, PAT_A)).status).toBe(403);
    expect((await call(`/fhir/R4/MedicationRequest?patient=Patient/${PATIENT_A.fhir_id}`, PAT_A)).status).toBe(403);
    expect((await call("/fhir/R4/Medication/5e0d0000-0000-4000-8000-000000000001", PAT_A)).status).toBe(403);
    expect(audits.map((a) => a.p_denial_reason)).toEqual(["not_available_to_patients", "not_available_to_patients", "not_available_to_patients"]);
  });

  it("a patient reads their own portal-visible dispenses, and nothing else", async () => {
    const { call } = setup();
    const own = await call(`/fhir/R4/MedicationDispense/${D_RX.id}`, PAT_A);
    expect(own.status).toBe(200);
    const d = await body(own);
    expect(d.subject).toEqual({ reference: `Patient/${PATIENT_A.fhir_id}` });
    expect(d.context).toEqual({ reference: `Encounter/${VISIT_A.id}` }); // a closed visit
    for (const k of ["quantity", "authorizingPrescription", "performer"]) expect(d[k], k).toBeUndefined();
    expectNothingForbidden(d);
    // Hidden from the portal, another patient's, and an "Add medicine" row: not found.
    expect((await call(`/fhir/R4/MedicationDispense/${D_HIDDEN.id}`, PAT_A)).status).toBe(404);
    expect((await call(`/fhir/R4/MedicationDispense/${D_B.id}`, PAT_A)).status).toBe(404);
    expect((await call(`/fhir/R4/MedicationDispense/${D_ADD.id}`, PAT_A)).status).toBe(404);
    expect((await call(`/fhir/R4/MedicationDispense/${D_B.id}`, PAT_B)).status).toBe(200);
  });

  it("refuses prescription= to a patient, whose view carries no authorizingPrescription", async () => {
    const { call } = setup();
    const res = await call(`/fhir/R4/MedicationDispense?prescription=MedicationRequest/${RX_OPEN.id}-1`, PAT_A);
    expect(res.status).toBe(400);
  });

  it("a patient's search is confined to their own visible rows, and naming another patient is refused", async () => {
    const { call, calls } = setup();
    const b = await body(await call("/fhir/R4/MedicationDispense", PAT_A));
    expect(ids(b).sort()).toEqual(
      [D_RX, D_COLON, D_VISIT, D_LEGACY, D_DECLINED, D_CANCELLED, D_AMBIG, D_ZERO, D_DRIFT].map((r) => dispenseFhirId(r.id)).sort(),
    );
    expectNothingForbidden(b);
    for (const r of matches(b)) {
      expect(r.quantity).toBeUndefined();
      expect(r.authorizingPrescription).toBeUndefined();
    }
    // No staff or catalogue lookups are made for a patient.
    expect(calls.some((c) => /fhir_staff_directory|fhir_link_ids|\/rest\/v1\/(pharmacy_items|prescriptions)/.test(c.url))).toBe(false);
    // The filter is in the query itself, not only in row-level security.
    const q = calls.find((c) => c.url.includes("/rest/v1/dispenses"))!.url;
    expect(decodeURIComponent(q)).toContain(`patient_id=in.("${PATIENT_A.id}")`);
    expect(decodeURIComponent(q)).toContain("portal_visible=is.true");
    expect((await call(`/fhir/R4/MedicationDispense?patient=Patient/${PATIENT_B.fhir_id}`, PAT_A)).status).toBe(403);
    // The backfilled legacy row is not shown to the patient as completed, and a completed search finds nothing.
    const done = await body(await call(`/fhir/R4/MedicationDispense?patient=Patient/${PATIENT_A.fhir_id}&status=completed`, PAT_A));
    expect(ids(done)).toEqual([]);
    const legacy = await body(await call(`/fhir/R4/MedicationDispense/${D_LEGACY.id}`, PAT_A));
    expect(legacy.status).toBe("unknown");
    expect(legacy.whenHandedOver).toBeUndefined();
    const unknown = await body(await call(`/fhir/R4/MedicationDispense?patient=Patient/${PATIENT_A.fhir_id}&status=unknown`, PAT_A));
    expect(ids(unknown)).toContain(D_LEGACY.id);
    for (const r of matches(b)) expect(r.status, r.id).not.toBe("completed");
  });

  it("a patient's visit lookup is confined to their own records in the query, not only by row-level security", async () => {
    // A's own dispense naming B's visit, with row-level security on visits drifted open.
    const D_CROSS = { ...D_VISIT, id: "01HZZDISPCROSS000000000000", visit_id: VISIT_B.id };
    const { call, calls } = setup({
      tables: {
        patients: [PATIENT_A, PATIENT_B, PATIENT_M],
        visits: [VISIT_A, VISIT_A_OPEN, VISIT_B],
        pharmacy_items: [ITEM_PARA, ITEM_AMOX, ITEM_LONG],
        prescriptions: PRESCRIPTIONS,
        dispenses: [...DISPENSES, D_CROSS],
      },
      visible: (t, r, u) => (t === "visits" ? true : visible(t, r, u)),
    });
    const b = await body(await call("/fhir/R4/MedicationDispense", PAT_A));
    const cross = matches(b).find((r) => r.id === D_CROSS.id)!;
    expect(cross.context).toBeUndefined();
    const visitQueries = calls.filter((c) => c.url.includes("/rest/v1/visits")).map((c) => decodeURIComponent(c.url));
    expect(visitQueries.length).toBeGreaterThan(0);
    for (const q of visitQueries) expect(q).toContain(`patient_id=in.("${PATIENT_A.id}")`);
    // Another patient's internal id is never sent to the resolver on a patient's request.
    const resolverBodies = calls.filter((c) => c.url.includes("fhir_resolve_patients")).map((c) => JSON.stringify(c.body));
    for (const rb of resolverBodies) expect(rb).not.toContain(PATIENT_B.id);
    expectNothingForbidden(b);
  });

  it("the portal restriction holds even where row-level security would show a hidden row", async () => {
    const { call } = setup({ visible: (t, r, u) => (t === "dispenses" ? isStaff(u) || (u.patientIds ?? []).includes(String(r.patient_id)) : visible(t, r, u)) });
    expect((await call(`/fhir/R4/MedicationDispense/${D_HIDDEN.id}`, PAT_A)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Gateway: enumeration, ids, errors
// ---------------------------------------------------------------------------

describe("enumeration and ids", () => {
  it("refuses staff searches that name no record", async () => {
    const { call } = setup();
    for (const path of [
      "/fhir/R4/Medication",
      "/fhir/R4/MedicationRequest",
      "/fhir/R4/MedicationRequest?status=active",
      "/fhir/R4/MedicationRequest?authoredon=2026-05-01",
      "/fhir/R4/MedicationDispense",
      "/fhir/R4/MedicationDispense?status=unknown",
    ]) {
      expect((await call(path, DOCTOR)).status, path).toBe(403);
    }
  });

  it("answers unknown and malformed ids with 404 or 400, without leaking anything", async () => {
    const { call, calls } = setup();
    for (const path of [
      `/fhir/R4/MedicationRequest/${RX_OPEN.id}`, // no line number
      `/fhir/R4/MedicationRequest/${RX_OPEN.id}-0`,
      `/fhir/R4/MedicationRequest/${RX_OPEN.id}-3`, // no third line
      `/fhir/R4/MedicationRequest/${RX_ODD.id}-1`, // medicine not in the catalogue
      `/fhir/R4/MedicationRequest/${RX_B.id}-1x`,
      "/fhir/R4/MedicationDispense/01HZZ.DOT", // a row whose id cannot round-trip
      `/fhir/R4/MedicationDispense/${D_ADD.id}`,
      "/fhir/R4/MedicationDispense/nothing-here",
      "/fhir/R4/Medication/5e0d0000-0000-4000-8000-0000000000ff",
      "/fhir/R4/Medication/not-a-uuid",
    ]) {
      const res = await call(path, DOCTOR);
      expect(res.status, path).toBe(404);
      expectNothingForbidden(await body(res));
    }
    expect((await call(`/fhir/R4/MedicationRequest/${"a".repeat(65)}`, DOCTOR)).status).toBe(400);
    expect((await call("/fhir/R4/MedicationDispense/a:b", DOCTOR)).status).toBe(400);
    // A Medication id that is not a minted uuid never reaches the database.
    expect(calls.some((c) => c.url.includes("fhir_link_sources") && JSON.stringify(c.body).includes("not-a-uuid"))).toBe(false);
    const bad = await call(`/fhir/R4/MedicationRequest?_id=${RX_OPEN.id}-1&status=a|b|c`, DOCTOR);
    expect(bad.status).toBe(400);
  });

  it("reads a dispense by its published id, ':' written as '.'", async () => {
    const { call } = setup();
    const res = await call("/fhir/R4/MedicationDispense/7d9b6f2e-3c1a-4e8b-9f00-0000000000c1.1.1", PHARMACIST);
    expect(res.status).toBe(200);
    const d = await body(res);
    expect(d.id).toBe("7d9b6f2e-3c1a-4e8b-9f00-0000000000c1.1.1");
    expect(d.quantity).toEqual({ value: 5, unit: "tablets" });
    expect(d.authorizingPrescription).toEqual([{ reference: `MedicationRequest/${RX_DONE.id}-1` }]);
  });
});

// ---------------------------------------------------------------------------
// Gateway: Medication
// ---------------------------------------------------------------------------

describe("Medication at the gateway", () => {
  it("is reached through the reference on a prescription, and read by that id", async () => {
    const { call } = setup();
    const r = await body(await call(`/fhir/R4/MedicationRequest/${RX_OPEN.id}-1`, DOCTOR));
    const ref: string = r.medicationReference.reference;
    expect(ref).toMatch(/^Medication\/5e0d0000-/);
    const medId = ref.split("/")[1];
    for (const token of [DOCTOR, PHARMACIST, STOREKEEPER]) {
      const res = await call(`/fhir/R4/Medication/${medId}`, token);
      expect(res.status).toBe(200);
      const m = await body(res);
      expect(m).toMatchObject({ resourceType: "Medication", id: medId, code: { text: "Paracetamol 500mg" }, status: "active", form: { text: "tablet" } });
      expectNothingForbidden(m);
    }
    const byId = await body(await call(`/fhir/R4/Medication?_id=${medId}`, DOCTOR));
    expect(ids(byId)).toEqual([medId]);
    expect(ids(await body(await call("/fhir/R4/Medication?_id=not-a-uuid", DOCTOR)))).toEqual([]);
  });

  it("gives a medicine with an over-long catalogue id a stable published id", async () => {
    const { call } = setup();
    const r = await body(await call(`/fhir/R4/MedicationRequest/${RX_ODD.id}-3`, DOCTOR));
    const first = r.medicationReference.reference;
    const again = await body(await call(`/fhir/R4/MedicationRequest/${RX_ODD.id}-3`, PHARMACIST));
    expect(again.medicationReference.reference).toBe(first);
    const m = await body(await call(`/fhir/R4/${first}`, DOCTOR));
    expect(m.code.text).toBe("Artemether-Lumefantrine (Pediatric) 20mg/120mg");
    expectNothingForbidden(m);
  });

  it("row-level security still decides: a catalogue row the caller cannot read is not served", async () => {
    const { call } = setup();
    const r = await body(await call(`/fhir/R4/MedicationRequest/${RX_OPEN.id}-1`, DOCTOR));
    const medId = r.medicationReference.reference.split("/")[1];
    const { call: hidden } = setup({ visible: (t, row, u) => t !== "pharmacy_items" && visible(t, row, u) });
    // (a fresh fake has no link yet, so the id does not exist there either)
    expect((await hidden(`/fhir/R4/Medication/${medId}`, DOCTOR)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Gateway: MedicationRequest search
// ---------------------------------------------------------------------------

describe("MedicationRequest at the gateway", () => {
  it("reads a line with every reference resolved as staff, and nothing forbidden", async () => {
    const { call, audits } = setup();
    const res = await call(`/fhir/R4/MedicationRequest/${RX_OPEN.id}-1`, DOCTOR);
    const r = await body(res);
    expect(r).toMatchObject({
      id: `${RX_OPEN.id}-1`,
      status: "active",
      intent: "order",
      subject: { reference: `Patient/${PATIENT_A.fhir_id}` },
      encounter: { reference: `Encounter/${VISIT_A.id}` },
      requester: { reference: "Practitioner/7a000000-0000-4000-8000-000000000001" },
      dispenseRequest: { quantity: { value: 15, unit: "tablets" } },
    });
    expectNothingForbidden(r);
    expect(audits.at(-1)).toMatchObject({ p_decision: "permit", p_patient_ids: [PATIENT_A.id], p_resource_type: "MedicationRequest" });
  });

  it("finds a patient's prescription lines, including those still on a merged-away record, shown under the kept record", async () => {
    const { call } = setup();
    const b = await body(await call(`/fhir/R4/MedicationRequest?patient=Patient/${PATIENT_A.fhir_id}`, DOCTOR));
    expect(ids(b).sort()).toEqual(
      [
        `${RX_OPEN.id}-1`,
        `${RX_OPEN.id}-2`,
        `${RX_DONE.id}-1`,
        `${RX_VOID.id}-1`,
        `${RX_PARTIAL.id}-1`,
        `${RX_ODD.id}-3`,
        `${RX_M.id}-1`,
        `${RX_DUP.id}-1`,
        `${RX_DUP.id}-2`,
        `${RX_OPEN_VISIT.id}-1`,
      ].sort(),
    );
    const merged = matches(b).find((r) => r.id === `${RX_M.id}-1`)!;
    expect(merged.subject).toEqual({ reference: `Patient/${PATIENT_A.fhir_id}` });
    // A line left out because its medicine is missing is announced, not silent.
    expect(outcome(b)?.issue[0].diagnostics).toMatch(/left out because the medicine/);
    expectNothingForbidden(b);
    for (const r of matches(b)) expect(validateResource(r, medicationRequestModule.validate)).toEqual([]);
  });

  it("searching by a merged-away record matches nothing and names the kept record", async () => {
    const { call } = setup();
    const b = await body(await call(`/fhir/R4/MedicationRequest?patient=Patient/${PATIENT_M.fhir_id}`, DOCTOR));
    expect(ids(b)).toEqual([]);
    expect(outcome(b)?.issue[0].diagnostics).toContain(`Patient/${PATIENT_A.fhir_id}`);
  });

  it("filters by status with the same map the resources use", async () => {
    const { call } = setup();
    const q = async (s: string) => ids(await body(await call(`/fhir/R4/MedicationRequest?subject=Patient/${PATIENT_A.fhir_id}&status=${s}`, PHARMACIST))).sort();
    expect(await q("active")).toEqual([`${RX_M.id}-1`, `${RX_OPEN.id}-1`, `${RX_OPEN.id}-2`, `${RX_OPEN_VISIT.id}-1`].sort());
    expect(await q("completed")).toEqual([`${RX_DONE.id}-1`, `${RX_DUP.id}-1`, `${RX_DUP.id}-2`].sort());
    expect(await q("cancelled")).toEqual([`${RX_VOID.id}-1`]);
    expect(await q("unknown")).toEqual([`${RX_ODD.id}-3`, `${RX_PARTIAL.id}-1`].sort());
    expect(await q("stopped")).toEqual([]);
    expect(await q("http://hl7.org/fhir/CodeSystem/medicationrequest-status|active")).toHaveLength(4);
    expect(await q("urn:other|active")).toEqual([]);
    // Every returned resource carries the status searched for.
    const b = await body(await call(`/fhir/R4/MedicationRequest?patient=Patient/${PATIENT_A.fhir_id}&status=unknown`, DOCTOR));
    for (const r of matches(b)) expect(r.status).toBe("unknown");
  });

  it("filters by encounter (only lines whose encounter is published) and by authoredon", async () => {
    const { call } = setup();
    const enc = await body(await call(`/fhir/R4/MedicationRequest?encounter=Encounter/${VISIT_A.id}`, DOCTOR));
    expect(ids(enc).sort()).toEqual(
      [`${RX_OPEN.id}-1`, `${RX_OPEN.id}-2`, `${RX_DONE.id}-1`, `${RX_PARTIAL.id}-1`, `${RX_DUP.id}-1`, `${RX_DUP.id}-2`].sort(),
    );
    // RX_ODD names VISIT_B, another patient's visit: it never shows that encounter.
    const other = await body(await call(`/fhir/R4/MedicationRequest?encounter=Encounter/${VISIT_B.id}`, DOCTOR));
    expect(ids(other)).toEqual([`${RX_B.id}-1`]);
    const dated = await body(await call(`/fhir/R4/MedicationRequest?patient=Patient/${PATIENT_A.fhir_id}&authoredon=2026-04-20`, DOCTOR));
    expect(ids(dated)).toEqual([`${RX_DONE.id}-1`]);
    const range = await body(
      await call(`/fhir/R4/MedicationRequest?patient=Patient/${PATIENT_A.fhir_id}&authoredon=ge2026-05-02&authoredon=lt2026-06-01`, DOCTOR),
    );
    expect(ids(range)).toEqual([`${RX_VOID.id}-1`]);
  });

  it("finds one line by _id", async () => {
    const { call } = setup();
    expect(ids(await body(await call(`/fhir/R4/MedicationRequest?_id=${RX_OPEN.id}-2`, DOCTOR)))).toEqual([`${RX_OPEN.id}-2`]);
    expect(ids(await body(await call(`/fhir/R4/MedicationRequest?_id=${RX_OPEN.id}-9`, DOCTOR)))).toEqual([]);
    expect(ids(await body(await call(`/fhir/R4/MedicationRequest?_id=${RX_OPEN.id}`, DOCTOR)))).toEqual([]);
  });

  it("pages line by line with a stable cursor and no duplicates", async () => {
    const { call } = setup();
    const seen: string[] = [];
    let url: string | null = `/fhir/R4/MedicationRequest?patient=Patient/${PATIENT_A.fhir_id}&_count=3`;
    let pages = 0;
    while (url && pages < 10) {
      const b = await body(await call(url, DOCTOR));
      seen.push(...ids(b));
      const next = b.link.find((l: Json) => l.relation === "next");
      url = next ? next.url.replace("https://mbhr.app", "") : null;
      pages++;
    }
    expect(pages).toBe(4);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(10);
    expect(seen.indexOf(`${RX_OPEN.id}-2`)).toBe(seen.indexOf(`${RX_OPEN.id}-1`) + 1);
  });

  it("refuses a cursor from another search", async () => {
    const { call } = setup();
    const b = await body(await call(`/fhir/R4/MedicationRequest?patient=Patient/${PATIENT_A.fhir_id}&_count=1`, DOCTOR));
    const cursor = new URL(b.link.find((l: Json) => l.relation === "next").url).searchParams.get("_cursor");
    expect((await call(`/fhir/R4/MedicationRequest?patient=Patient/${PATIENT_A.fhir_id}&status=active&_cursor=${cursor}`, DOCTOR)).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Gateway: MedicationDispense search
// ---------------------------------------------------------------------------

describe("MedicationDispense at the gateway", () => {
  it("finds a patient's dispenses (merged-away rows under the kept record), never the 'Add medicine' rows", async () => {
    const { call } = setup();
    const b = await body(await call(`/fhir/R4/MedicationDispense?patient=Patient/${PATIENT_A.fhir_id}`, PHARMACIST));
    expect(ids(b).sort()).toEqual(
      [D_RX, D_COLON, D_VISIT, D_LEGACY, D_HIDDEN, D_M, D_DECLINED, D_CANCELLED, D_AMBIG, D_ZERO, D_DRIFT].map((r) => dispenseFhirId(r.id)).sort(),
    );
    const m = matches(b).find((r) => r.id === D_M.id)!;
    expect(m.subject).toEqual({ reference: `Patient/${PATIENT_A.fhir_id}` });
    expect(m.authorizingPrescription).toEqual([{ reference: `MedicationRequest/${RX_M.id}-1` }]);
    expectNothingForbidden(b);
    for (const r of matches(b)) expect(validateResource(r, medicationDispenseModule.validate)).toEqual([]);
  });

  it("filters by status with the same map the resources use: completed matches nothing, the backfilled rows are unknown", async () => {
    const { call } = setup();
    const q = async (s: string) =>
      ids(await body(await call(`/fhir/R4/MedicationDispense?patient=Patient/${PATIENT_A.fhir_id}&status=${s}`, DOCTOR))).sort();
    expect(await q("completed")).toEqual([]);
    expect(await q("declined")).toEqual([D_DECLINED.id]);
    expect(await q("cancelled")).toEqual([D_CANCELLED.id]);
    expect(await q("unknown")).toEqual(
      [D_RX, D_COLON, D_VISIT, D_LEGACY, D_HIDDEN, D_M, D_AMBIG, D_ZERO, D_DRIFT].map((r) => dispenseFhirId(r.id)).sort(),
    );
    expect(await q("http://terminology.hl7.org/CodeSystem/medicationdispense-status|completed")).toEqual([]);
    expect(await q("http://terminology.hl7.org/CodeSystem/medicationdispense-status|unknown")).toContain(D_LEGACY.id);
    expect(await q("http://hl7.org/fhir/CodeSystem/medicationrequest-status|completed")).toEqual([]);
    // Every returned resource carries the status searched for; none is completed.
    const all = await body(await call(`/fhir/R4/MedicationDispense?patient=Patient/${PATIENT_A.fhir_id}`, DOCTOR));
    for (const r of matches(all)) expect(r.status, r.id).not.toBe("completed");
    const unknown = await body(await call(`/fhir/R4/MedicationDispense?patient=Patient/${PATIENT_A.fhir_id}&status=unknown`, DOCTOR));
    for (const r of matches(unknown)) expect(r.status).toBe("unknown");
  });

  it("finds the dispenses of one prescription line, only where the line is exactly identified", async () => {
    const { call } = setup();
    const b = await body(await call(`/fhir/R4/MedicationDispense?prescription=MedicationRequest/${RX_DONE.id}-1`, PHARMACIST));
    expect(ids(b).sort()).toEqual([D_RX, D_COLON, D_ZERO].map((r) => dispenseFhirId(r.id)).sort());
    // Two lines name the same medicine: which one was given is not known, so neither matches.
    for (const n of [1, 2]) {
      expect(ids(await body(await call(`/fhir/R4/MedicationDispense?prescription=MedicationRequest/${RX_DUP.id}-${n}`, PHARMACIST)))).toEqual([]);
    }
    expect((await call(`/fhir/R4/MedicationDispense?prescription=Patient/${PATIENT_A.fhir_id}`, PHARMACIST)).status).toBe(400);
  });

  it("offers no whenhandedover search (no handover time is published) and reads neither time column", async () => {
    const { call, calls } = setup();
    for (const token of [DOCTOR, PAT_A]) {
      const res = await call(`/fhir/R4/MedicationDispense?patient=Patient/${PATIENT_A.fhir_id}&whenhandedover=2026-05-01`, token);
      expect(res.status).toBe(400);
      expectNothingForbidden(await body(res));
    }
    const b = await body(await call(`/fhir/R4/MedicationDispense?patient=Patient/${PATIENT_A.fhir_id}`, DOCTOR));
    for (const r of matches(b)) expect(r.whenHandedOver, r.id).toBeUndefined();
    const selects = calls.filter((c) => c.url.includes("/rest/v1/dispenses")).map((c) => decodeURIComponent(c.url));
    expect(selects.length).toBeGreaterThan(0);
    for (const q of selects) expect(q).not.toMatch(/when_handed_over|dispensed_at/);
  });

  it("finds one dispense by _id", async () => {
    const { call } = setup();
    expect(ids(await body(await call(`/fhir/R4/MedicationDispense?_id=${dispenseFhirId(D_COLON.id)}`, DOCTOR)))).toEqual([dispenseFhirId(D_COLON.id)]);
    expect(ids(await body(await call(`/fhir/R4/MedicationDispense?_id=${D_ADD.id}`, DOCTOR)))).toEqual([]);
  });

  it("pages with a stable cursor and no duplicates", async () => {
    const { call } = setup();
    const seen: string[] = [];
    let url: string | null = `/fhir/R4/MedicationDispense?patient=Patient/${PATIENT_A.fhir_id}&_count=4`;
    let pages = 0;
    while (url && pages < 10) {
      const b = await body(await call(url, DOCTOR));
      seen.push(...ids(b));
      const next = b.link.find((l: Json) => l.relation === "next");
      url = next ? next.url.replace("https://mbhr.app", "") : null;
      pages++;
    }
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(11);
  });

  it("omits the staff reference when the directory is unavailable, never falling back to the raw id", async () => {
    const rpcs = linkRpcs();
    const { call } = setup({ rpcs: { ...rpcs, fhir_staff_directory: () => refused("42501", 403) } });
    const d = await body(await call(`/fhir/R4/MedicationDispense/${D_RX.id}`, PHARMACIST));
    expect(d.performer).toBeUndefined();
    expectNothingForbidden(d);
  });
});

// ---------------------------------------------------------------------------
// Definitions (the CapabilityStatement is generated from these)
// ---------------------------------------------------------------------------

describe("medicine definitions", () => {
  it("declare what is implemented, who may read, and what is never published", () => {
    const m = RESOURCE_DEFINITIONS.Medication;
    const r = RESOURCE_DEFINITIONS.MedicationRequest;
    const d = RESOURCE_DEFINITIONS.MedicationDispense;
    expect(m.searchParams.map((p) => p.name)).toEqual(["_id"]);
    expect(r.searchParams.map((p) => p.name)).toEqual(["_id", "patient", "subject", "encounter", "status", "authoredon"]);
    expect(d.searchParams.map((p) => p.name)).toEqual(["_id", "patient", "subject", "status", "prescription"]);
    expect(d.fields.join(" ")).not.toMatch(/whenHandedOver/);
    expect(d.notes?.join(" ")).toMatch(/No handover time \(whenHandedOver\) is published/);
    expect([m.patientAccess, r.patientAccess, d.patientAccess]).toEqual([false, false, true]);
    expect(m.readPermissions).toEqual(["consult", "dispense", "inventory"]);
    expect(r.readPermissions).toEqual(["consult", "dispense"]);
    expect(d.readPermissions).toEqual(["consult", "dispense"]);
    for (const def of [m, r, d]) {
      expect(def.interactions).toEqual(["read", "search-type"]);
      expect(def.notes?.length).toBeGreaterThan(0);
      for (const p of def.searchParams) expect(p.documentation.length).toBeGreaterThan(10);
      expect(def.requiredSearch.flat().every((p) => def.searchParams.some((s) => s.name === p))).toBe(true);
    }
  });
});
