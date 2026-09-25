// @vitest-environment node
//
// Provenance (server-attributed events) and AuditEvent (the gateway's own
// access trail): the mappers element by element, the activity and outcome
// maps, and the gateway end to end against an in-memory Supabase (who may
// read, restrictions, anti-enumeration, merged patients, paging, and that
// nothing that must stay internal is ever served).

import { describe, expect, it } from "vitest";
import { handleFhirRequest } from "../gateway/handler";
import { applyStatusMap, explainStatus, knownSourceValues, type StatusMap } from "../terminology/statusMaps";
import { validateResource } from "../validation/validate";
import {
  LAB_EVENT_ACTIVITY,
  MERGE_ACTIVITY,
  PROVENANCE_STATUS_MAPS,
  mapDocumentUploadEvent,
  mapLabReleaseEvent,
  mapMergeEvent,
  parseProvenanceId,
} from "../mappers/provenance";
import {
  AUDIT_EVENT_ACTION,
  AUDIT_EVENT_OUTCOME,
  AUDIT_EVENT_STATUS_MAPS,
  AUDIT_EVENT_SUBTYPE,
  auditOutcome,
  auditOwner,
  mapAuditEvent,
} from "../mappers/auditEvent";
import { canonicalMicros, inclusiveUpper, auditEventModule } from "../resources/auditEvent";
import { provenanceModule } from "../resources/provenance";
import { fakeSupabase, makeToken, type FakeOptions, type FakeUser, type RpcHandler } from "./fakeSupabase";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------------------------------------------------------------------------
// Fixtures (synthetic; no real people)
// ---------------------------------------------------------------------------

const DOCTOR_UID = "d0c70000-0000-4000-8000-000000000001";
const AUDITOR_UID = "a0d17000-0000-4000-8000-000000000002";
const NURSE_UID = "40a5e000-0000-4000-8000-000000000003";
const PORTAL_UID = "9047a100-0000-4000-8000-000000000004";
/** A staff account that no longer exists: the directory does not resolve it. */
const GONE_UID = "90e00000-0000-4000-8000-000000000005";

const DOCTOR_PRACTITIONER = "f1000000-0000-4000-8000-00000000000d";
const AUDITOR_PRACTITIONER = "f1000000-0000-4000-8000-0000000000a0";
const STAFF_DIRECTORY = [
  { fhir_id: DOCTOR_PRACTITIONER, source_id: DOCTOR_UID, full_name: "Dr Ngozi Example", role: "doctor", active: true, created_at: null, updated_at: null },
  { fhir_id: AUDITOR_PRACTITIONER, source_id: AUDITOR_UID, full_name: "Audu Example", role: "auditor", active: true, created_at: null, updated_at: null },
];

const P_KEPT = { id: "01HZZKEPT00000000000000000", fhir_id: "0b3c1d2e-2222-4aaa-8bbb-000000000001", merged_into: null, merged_at: null };
const P_MERGED = {
  id: "01HZZMERGED000000000000000",
  fhir_id: "0b3c1d2e-2222-4aaa-8bbb-000000000002",
  merged_into: P_KEPT.id,
  merged_at: "2026-09-10T09:00:00+00:00",
};
const P_OTHER = { id: "01HZZOTHER0000000000000000", fhir_id: "0b3c1d2e-2222-4aaa-8bbb-000000000003", merged_into: null, merged_at: null };
/** Merged into a record that was later deleted: its chain does not end. */
const P_ORPHAN = {
  id: "01HZZORPHAN000000000000000",
  fhir_id: "0b3c1d2e-2222-4aaa-8bbb-000000000004",
  merged_into: null,
  merged_at: "2026-08-01T09:00:00+00:00",
};

const ORDER_A = { id: "0a000000-0000-4000-8000-00000000000a", patient_id: P_KEPT.id };
const ORDER_M = { id: "0a000000-0000-4000-8000-00000000000b", patient_id: P_MERGED.id };
const ORDER_O = { id: "0a000000-0000-4000-8000-00000000000c", patient_id: P_OTHER.id };
const ORDER_X = { id: "0a000000-0000-4000-8000-00000000000d", patient_id: P_ORPHAN.id };

const RES_A1 = { id: "0e000000-0000-4000-8000-0000000000a1", order_id: ORDER_A.id, superseded_by: null };
const RES_A2 = { id: "0e000000-0000-4000-8000-0000000000a2", order_id: ORDER_A.id, superseded_by: RES_A1.id };
const RES_M = { id: "0e000000-0000-4000-8000-0000000000b1", order_id: ORDER_M.id, superseded_by: null };
const RES_O = { id: "0e000000-0000-4000-8000-0000000000c1", order_id: ORDER_O.id, superseded_by: null };
const RES_X = { id: "0e000000-0000-4000-8000-0000000000d1", order_id: ORDER_X.id, superseded_by: null };

const WITHHOLD_REASON = "WITHHOLD-REASON: discuss in person before release";
const logRow = (n: number, result: string, action: string | null, actor: string | null, at: string, reason: string | null = null) => ({
  id: `10000000-0000-4000-8000-00000000000${n}`,
  result_id: result,
  action,
  actor_id: actor,
  reason,
  created_at: at,
});
const LOG_REVIEW = logRow(1, RES_A1.id, "reviewed", DOCTOR_UID, "2026-09-12T08:00:00.123456+00:00");
const LOG_RELEASE = logRow(2, RES_A1.id, "released", GONE_UID, "2026-09-12T08:05:00+00:00");
const LOG_WITHHELD = logRow(3, RES_A1.id, "withheld", DOCTOR_UID, "2026-09-12T09:00:00+00:00", WITHHOLD_REASON);
const LOG_SUPERSEDED = logRow(4, RES_A2.id, "reviewed", DOCTOR_UID, "2026-09-12T07:00:00+00:00");
const LOG_M = logRow(5, RES_M.id, "reviewed", DOCTOR_UID, "2026-09-13T08:00:00+00:00");
const LOG_O = logRow(6, RES_O.id, "reviewed", DOCTOR_UID, "2026-09-14T08:00:00+00:00");
/** Not an action the log records (the CHECK would refuse it): never shown. */
const LOG_BAD = logRow(7, RES_A1.id, "approved", DOCTOR_UID, "2026-09-12T10:00:00+00:00");
const LOG_X = logRow(8, RES_X.id, "reviewed", DOCTOR_UID, "2026-09-12T11:00:00+00:00");

const DEVICE_USER = "01HZZDEVICEUSER00000000000";
const SNAPSHOT_PHONE = "0800-SNAPSHOT-PHONE";
const MERGE_OK = {
  id: "5e000000-0000-4000-8000-000000000001",
  winner_id: P_KEPT.id,
  loser_id: P_MERGED.id,
  kind: "merge",
  actor_id: DOCTOR_UID,
  merged_by: DEVICE_USER,
  requested_by: DEVICE_USER,
  requested_at: "2026-09-10T08:59:00+00:00",
  reason: "duplicate_resolution",
  field_choices: { phone: { source: "loser", value: SNAPSHOT_PHONE } },
  winner_before: { phone: SNAPSHOT_PHONE, given_name: "Snapshot" },
  loser_before: { phone: SNAPSHOT_PHONE },
  created_at: "2026-09-10T09:00:00.5+00:00",
};
/** Uploaded by a tablet before merge_patients(): no server-stamped actor. */
const MERGE_LEGACY = { ...MERGE_OK, id: "5e000000-0000-4000-8000-000000000002", loser_id: P_OTHER.id, actor_id: null, merged_by: "Dr Legacy Name" };
const MERGE_UNMERGE = { ...MERGE_OK, id: "5e000000-0000-4000-8000-000000000003", kind: "unmerge" };

const STORAGE_PATH = "patient-documents/01HZZKEPT00000000000000000/secret-scan.pdf";
const docRow = (n: number, patient: string, source: string, uploader: string, deletedAt: string | null = null) => ({
  id: `d0000000-0000-4000-8000-00000000000${n}`,
  patient_id: patient,
  upload_source: source,
  uploaded_by_user_id: uploader,
  file_path: STORAGE_PATH,
  document_name: "secret-scan.pdf",
  deleted_at: deletedAt,
  deleted_by: deletedAt ? PORTAL_UID : null,
  created_at: `2026-09-11T1${n}:00:00+00:00`,
});
const DOC_PATIENT = docRow(1, P_KEPT.id, "patient", PORTAL_UID);
const DOC_STAFF = docRow(2, P_OTHER.id, "staff", DOCTOR_UID);
const DOC_REMOVED = docRow(3, P_KEPT.id, "patient", PORTAL_UID, "2026-09-12T10:00:00+00:00");
const DOC_MERGED = docRow(4, P_MERGED.id, "staff", "legacy-client-value");

const SECRET_UA = "Mozilla/5.0 (SECRET-USER-AGENT)";
const IP_HASH = "ab".repeat(32);
const REQUEST_ID = "7e000000-0000-4000-8000-000000000001";
const audRow = (n: number, over: Json) => ({
  id: `a0000000-0000-4000-8000-00000000000${n}`,
  request_id: REQUEST_ID,
  action: "read",
  resource_type: "Patient",
  resource_id: null,
  patient_ids: [],
  actor_user_id: DOCTOR_UID,
  actor_role: "doctor",
  actor_kind: "staff",
  purpose: "TREAT",
  decision: "permit",
  denial_reason: null,
  http_status: 200,
  result_count: 1,
  consent_decision: "not-applicable",
  // Stored, never published:
  user_agent: SECRET_UA,
  ip_hash: IP_HASH,
  metadata: { search_params: ["birthdate", "name"] },
  ...over,
});
const AUD_READ = audRow(1, {
  occurred_at: "2026-09-20T10:00:00.123456+00:00",
  resource_id: P_KEPT.fhir_id,
  patient_ids: [P_KEPT.id],
});
/** Same millisecond as AUD_READ, 56 microseconds earlier: a millisecond cursor would skip it. */
const AUD_DENY = audRow(2, {
  occurred_at: "2026-09-20T10:00:00.1234+00:00",
  action: "search",
  resource_type: "Observation",
  patient_ids: [P_MERGED.id],
  actor_user_id: NURSE_UID,
  actor_role: "nurse",
  decision: "deny",
  denial_reason: "missing_permission",
  http_status: 403,
  result_count: 0,
});
const AUD_ERROR = audRow(3, {
  occurred_at: "2026-09-19T08:00:00+00:00",
  resource_type: "Observation",
  resource_id: `lab-${RES_A1.id}`,
  patient_ids: [P_KEPT.id],
  decision: "deny",
  denial_reason: "unavailable",
  http_status: 503,
  result_count: 0,
});
const AUD_PATIENT = audRow(4, {
  occurred_at: "2026-09-18T12:00:00+00:00",
  action: "search",
  resource_type: "Observation",
  patient_ids: [P_KEPT.id],
  actor_user_id: PORTAL_UID,
  actor_role: null,
  actor_kind: "patient",
  purpose: "PATRQT",
  result_count: 3,
});
/** A Phase 1 "permit" from an account with no staff role: only a direct function call could write it. */
const AUD_FORGED = audRow(5, {
  occurred_at: "2026-09-17T12:00:00+00:00",
  resource_id: P_KEPT.fhir_id,
  patient_ids: [P_KEPT.id],
  actor_user_id: PORTAL_UID,
  actor_role: null,
  actor_kind: null,
  http_status: null,
});
const AUD_V1_STAFF = audRow(6, {
  occurred_at: "2026-09-16T12:00:00+00:00",
  action: "search",
  resource_type: "Encounter",
  patient_ids: [P_OTHER.id],
  actor_user_id: GONE_UID,
  actor_role: "admin",
  actor_kind: null,
  purpose: "invalid",
  http_status: null,
  result_count: 2,
});
const AUD_NONE = audRow(7, {
  occurred_at: "2026-09-15T12:00:00+00:00",
  resource_id: P_OTHER.fhir_id,
  actor_user_id: PORTAL_UID,
  actor_role: null,
  actor_kind: "none",
  decision: "deny",
  denial_reason: "no_active_account",
  http_status: 403,
  result_count: 0,
});
const AUD_DELETED = audRow(8, {
  occurred_at: "2026-09-14T12:00:00+00:00",
  resource_type: "Condition",
  resource_id: "c0000000-0000-4000-8000-00000000000a",
  patient_ids: ["01HZZDELETED00000000000000"],
  http_status: 404,
  result_count: 0,
});
const AUD_OLD = audRow(9, { occurred_at: "2026-07-01T12:00:00+00:00", patient_ids: [P_OTHER.id] });

// ---------------------------------------------------------------------------
// Database functions (same rules as supabase/migrations/20260926130000_interop_phase2.sql)
// ---------------------------------------------------------------------------

const refuse = (code: string, status: number) => new Response(JSON.stringify({ code }), { status });

const staffDirectory: RpcHandler = (body, user) => {
  if (!user.role) return refuse("42501", 403);
  const ids = body.p_source_ids as string[] | null;
  if (!ids) return [];
  return STAFF_DIRECTORY.filter((s) => ids.includes(s.source_id));
};

const micro = (v: unknown) => canonicalMicros(v) as string;

const accessAuditEvents: RpcHandler = (body, user, fake) => {
  if (!user.permissions.includes("audit_access")) return refuse("42501", 403);
  const b = body as Json;
  const patients: string[] | null = b.p_patient_ids;
  const from = b.p_from ? micro(b.p_from) : null;
  const to = b.p_to ? micro(b.p_to) : null;
  const narrowed =
    b.p_id ||
    (patients && patients.length) ||
    (b.p_actor_source_ids && b.p_actor_source_ids.length) ||
    (from && to && Date.parse(b.p_to) - Date.parse(b.p_from) <= 31 * 86400000);
  if (!narrowed || (b.p_after_occurred === null) !== (b.p_after_id === null)) return refuse("22023", 400);
  const after = b.p_after_occurred ? micro(b.p_after_occurred) : null;
  const rows = (fake.opts.tables.access_audit ?? [])
    .filter((a) => a.action === "read" || a.action === "search")
    .filter((a) => !b.p_id || a.id === b.p_id)
    .filter((a) => !patients || (a.patient_ids as string[]).some((p) => patients.includes(p)))
    .filter((a) => !from || micro(a.occurred_at) >= from)
    .filter((a) => !to || micro(a.occurred_at) <= to)
    .filter((a) => !b.p_decision || a.decision === b.p_decision)
    .filter((a) => !after || micro(a.occurred_at) < after || (micro(a.occurred_at) === after && String(a.id) < b.p_after_id))
    .sort((x, y) => (micro(x.occurred_at) === micro(y.occurred_at) ? (String(x.id) < String(y.id) ? 1 : -1) : micro(x.occurred_at) < micro(y.occurred_at) ? 1 : -1));
  // Returned as stored, extra columns included, to prove the mapper only reads what it publishes.
  return rows.slice(0, Math.min(Math.max(Number(b.p_limit) || 20, 1), 101));
};

// ---------------------------------------------------------------------------
// Gateway harness
// ---------------------------------------------------------------------------

const ENV = {
  FHIR_ENABLED: "true",
  FHIR_BASE_URL: "https://mbhr.app/fhir/R4",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  FHIR_PATIENT_ACCESS_ENABLED: "true",
};

const AUDITOR = makeToken(AUDITOR_UID);
const DOCTOR = makeToken(DOCTOR_UID);
const NURSE = makeToken(NURSE_UID);
const PORTAL = makeToken(PORTAL_UID);
const USERS: Record<string, FakeUser> = {
  [AUDITOR]: { id: AUDITOR_UID, role: "auditor", permissions: ["audit_access", "export", "merge_patients", "resolve_conflicts"] },
  [DOCTOR]: {
    id: DOCTOR_UID,
    role: "doctor",
    permissions: ["consult", "lab_release", "lab_review", "merge_patients", "portal_manage", "queue", "register", "resolve_conflicts", "vitals"],
  },
  [NURSE]: { id: NURSE_UID, role: "nurse", permissions: ["merge_patients", "portal_manage", "queue", "register", "resolve_conflicts", "vitals"] },
  [PORTAL]: { id: PORTAL_UID, role: null, permissions: [], kind: "patient", patientIds: [P_KEPT.id] },
};

/** Row-level security as the migrations define it for these tables. */
function visible(table: string, _row: Json, user: FakeUser): boolean {
  const has = (...p: string[]) => p.some((x) => user.permissions.includes(x));
  if (table === "lab_result_release_log") return has("lab_review", "audit_access");
  if (table === "patient_merges") return has("merge_patients", "audit_access");
  return user.role !== null;
}

function setup(overrides: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({
    users: USERS,
    tables: {
      patients: [P_KEPT, P_MERGED, P_OTHER, P_ORPHAN],
      lab_orders: [ORDER_A, ORDER_M, ORDER_O, ORDER_X],
      lab_results: [RES_A1, RES_A2, RES_M, RES_O, RES_X],
      lab_result_release_log: [LOG_REVIEW, LOG_RELEASE, LOG_WITHHELD, LOG_SUPERSEDED, LOG_M, LOG_O, LOG_BAD, LOG_X],
      patient_merges: [MERGE_OK, MERGE_LEGACY, MERGE_UNMERGE],
      patient_documents: [DOC_PATIENT, DOC_STAFF, DOC_REMOVED, DOC_MERGED],
      access_audit: [AUD_READ, AUD_DENY, AUD_ERROR, AUD_PATIENT, AUD_FORGED, AUD_V1_STAFF, AUD_NONE, AUD_DELETED, AUD_OLD],
    },
    visible,
    rpcs: { fhir_staff_directory: staffDirectory, fhir_access_audit_events: accessAuditEvents },
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

async function json(res: Response): Promise<Json> {
  return (await res.json()) as Json;
}

const matches = (b: Json): Json[] => (b.entry ?? []).filter((e: Json) => e.search.mode === "match").map((e: Json) => e.resource);
const ids = (b: Json): string[] => matches(b).map((r) => r.id);

/** Every page of a search, following next links. */
async function allPages(call: (p: string, t?: string) => Promise<Response>, path: string, token: string): Promise<{ ids: string[]; pages: number; bodies: Json[] }> {
  const out: string[] = [];
  const bodies: Json[] = [];
  let url: string | null = path;
  let pages = 0;
  while (url && pages < 20) {
    const res = await call(url, token);
    expect(res.status, url).toBe(200);
    const b = await json(res);
    bodies.push(b);
    out.push(...ids(b));
    const next = b.link.find((l: Json) => l.relation === "next");
    url = next ? String(next.url).replace("https://mbhr.app", "") : null;
    pages++;
  }
  return { ids: out, pages, bodies };
}

/** Values that must never appear in any served resource. */
const NEVER_SERVED = [
  DOCTOR_UID,
  AUDITOR_UID,
  NURSE_UID,
  PORTAL_UID,
  GONE_UID,
  P_KEPT.id,
  P_MERGED.id,
  P_OTHER.id,
  "01HZZDELETED00000000000000",
  WITHHOLD_REASON,
  "discuss in person",
  DEVICE_USER,
  "Dr Legacy Name",
  SNAPSHOT_PHONE,
  "Snapshot",
  "duplicate_resolution",
  STORAGE_PATH,
  "secret-scan",
  "legacy-client-value",
  SECRET_UA,
  IP_HASH,
  REQUEST_ID,
  "birthdate",
  "search_params",
  "lab_result_release_log",
  "patient_merges",
  "patient_documents",
  "access_audit",
];

function expectNothingInternal(resources: unknown) {
  const text = JSON.stringify(resources);
  for (const secret of NEVER_SERVED) expect(text, secret).not.toContain(secret);
}

const labRef = (id: string) => `Observation/lab-${id}`;

// ---------------------------------------------------------------------------
// Status maps
// ---------------------------------------------------------------------------

function checkMap(m: StatusMap) {
  expect(m.valueSet).toMatch(/^http:\/\/hl7\.org\/fhir\/ValueSet\//);
  for (const r of m.rules) {
    expect(m.allowed).toContain(r.fhir);
    expect(r.reason.length).toBeGreaterThan(10);
    for (const s of r.source) expect(s).toBe(s.toLowerCase());
  }
  const all = m.rules.flatMap((r) => [...r.source]);
  expect(new Set(all).size).toBe(all.length);
  expect(m.missing.fhir).toBeNull();
  expect(m.unrecognised.fhir).toBeNull();
  for (const raw of [null, undefined, "", "somethingnew", 0, false]) expect(applyStatusMap(m, raw)).toBeNull();
}

describe("activity and outcome maps", () => {
  it("are well formed, and a missing or unknown value is never guessed", () => {
    for (const m of [...PROVENANCE_STATUS_MAPS, ...AUDIT_EVENT_STATUS_MAPS]) checkMap(m);
  });

  it("maps every release-log action, and nothing else", () => {
    expect(applyStatusMap(LAB_EVENT_ACTIVITY, "reviewed")).toBe("lab-review");
    expect(applyStatusMap(LAB_EVENT_ACTIVITY, "released")).toBe("lab-release");
    expect(applyStatusMap(LAB_EVENT_ACTIVITY, "withheld")).toBe("lab-withhold");
    expect(applyStatusMap(LAB_EVENT_ACTIVITY, "Reviewed")).toBe("lab-review");
    expect(applyStatusMap(LAB_EVENT_ACTIVITY, "approved")).toBeNull();
    expect(applyStatusMap(LAB_EVENT_ACTIVITY, null)).toBeNull();
    expect(explainStatus(LAB_EVENT_ACTIVITY, "released").reason).toMatch(/not a review/);
    expect(explainStatus(LAB_EVENT_ACTIVITY, "x").reason).toMatch(/withheld, not guessed/);
    expect(knownSourceValues(LAB_EVENT_ACTIVITY)).toEqual(["reviewed", "released", "withheld"]);
  });

  it("maps merges only; unmerge (no writer) and a missing kind are withheld", () => {
    expect(applyStatusMap(MERGE_ACTIVITY, "merge")).toBe("patient-merge");
    expect(applyStatusMap(MERGE_ACTIVITY, "unmerge")).toBeNull();
    expect(applyStatusMap(MERGE_ACTIVITY, null)).toBeNull();
  });

  it("maps the audit action, subtype and decision", () => {
    expect(applyStatusMap(AUDIT_EVENT_ACTION, "read")).toBe("R");
    expect(applyStatusMap(AUDIT_EVENT_ACTION, "search")).toBe("E");
    expect(applyStatusMap(AUDIT_EVENT_ACTION, "export")).toBeNull();
    expect(applyStatusMap(AUDIT_EVENT_SUBTYPE, "read")).toBe("read");
    expect(applyStatusMap(AUDIT_EVENT_SUBTYPE, "search")).toBe("search-type");
    expect(applyStatusMap(AUDIT_EVENT_OUTCOME, "permit")).toBe("0");
    expect(applyStatusMap(AUDIT_EVENT_OUTCOME, "deny")).toBe("4");
    expect(applyStatusMap(AUDIT_EVENT_OUTCOME, "maybe")).toBeNull();
    expect(applyStatusMap(AUDIT_EVENT_OUTCOME, null)).toBeNull();
  });

  it("uses 8 only when the stored HTTP status is a server error, never 12", () => {
    expect(auditOutcome({ decision: "permit", http_status: 200 })).toBe("0");
    expect(auditOutcome({ decision: "permit", http_status: 404 })).toBe("0");
    expect(auditOutcome({ decision: "permit", http_status: null })).toBe("0");
    expect(auditOutcome({ decision: "deny", http_status: 403 })).toBe("4");
    expect(auditOutcome({ decision: "deny", http_status: 429 })).toBe("4");
    expect(auditOutcome({ decision: "deny", http_status: null })).toBe("4");
    expect(auditOutcome({ decision: "deny", http_status: 500 })).toBe("8");
    expect(auditOutcome({ decision: "deny", http_status: 503 })).toBe("8");
    expect(auditOutcome({ decision: "deny", http_status: 999 })).toBe("4");
    expect(auditOutcome({ decision: null, http_status: 500 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Provenance mapper
// ---------------------------------------------------------------------------

const REFS = {
  patientFhirIds: new Map([
    [P_KEPT.id, P_KEPT.fhir_id],
    [P_MERGED.id, P_KEPT.fhir_id],
    [P_OTHER.id, P_OTHER.fhir_id],
  ]),
};
const STAFF = new Map([[DOCTOR_UID, { reference: `Practitioner/${DOCTOR_PRACTITIONER}` }]]);
const LINK_A1 = { orderId: ORDER_A.id, current: true, patientId: P_KEPT.id };

describe("Provenance ids", () => {
  it("are derived, stable, valid FHIR ids, and parse back", () => {
    expect(parseProvenanceId(`labrel-${LOG_REVIEW.id}`)).toEqual({ kind: "lab", sourceId: LOG_REVIEW.id });
    expect(parseProvenanceId(`merge-${MERGE_OK.id}`)).toEqual({ kind: "merge", sourceId: MERGE_OK.id });
    expect(parseProvenanceId(`merge-01HZZMERGEULID000000000000`)).toEqual({ kind: "merge", sourceId: "01HZZMERGEULID000000000000" });
    expect(parseProvenanceId(`docup-${DOC_PATIENT.id}`)).toEqual({ kind: "upload", sourceId: DOC_PATIENT.id });
    for (const bad of ["labrel-nope", "docup-", `labrel${LOG_REVIEW.id}`, `rv-${LOG_REVIEW.id}`, "merge-", `merge-${"x".repeat(59)}`, LOG_REVIEW.id]) {
      expect(parseProvenanceId(bad), bad).toBeNull();
    }
    expect(`labrel-${LOG_REVIEW.id}`.length).toBeLessThanOrEqual(64);
  });
});

describe("Provenance mapping", () => {
  it("maps a review: targets, server time, local activity, verifier Practitioner", () => {
    const p = mapLabReleaseEvent(LOG_REVIEW, LINK_A1, REFS, STAFF);
    expect(p).toEqual({
      resourceType: "Provenance",
      id: `labrel-${LOG_REVIEW.id}`,
      meta: { versionId: String(Date.parse("2026-09-12T08:00:00.123Z")), lastUpdated: "2026-09-12T08:00:00.123Z", source: "https://mbhr.app" },
      target: [{ reference: labRef(RES_A1.id) }, { reference: `DiagnosticReport/${ORDER_A.id}` }],
      recorded: "2026-09-12T08:00:00.123Z",
      activity: {
        coding: [{ system: "https://mbhr.app/codes/provenance-activity", code: "lab-review", display: "Laboratory result reviewed by a clinician" }],
      },
      agent: [
        {
          type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "verifier", display: "Verifier" }] },
          who: { reference: `Practitioner/${DOCTOR_PRACTITIONER}` },
        },
      ],
    });
    expect(validateResource(p, provenanceModule.validate)).toEqual([]);
  });

  it("a release names no agent type, and an unresolved account is display-only", () => {
    const p = mapLabReleaseEvent(LOG_RELEASE, LINK_A1, REFS, STAFF) as Json;
    expect(p.activity.coding[0].code).toBe("lab-release");
    expect(p.agent).toEqual([{ who: { display: "mBHR staff member" } }]);
    expect(p).not.toHaveProperty("occurredDateTime");
  });

  it("a withhold never carries its reason", () => {
    const p = mapLabReleaseEvent(LOG_WITHHELD, LINK_A1, REFS, STAFF) as Json;
    expect(p.activity.coding[0].code).toBe("lab-withhold");
    expect(p.agent[0].type).toBeUndefined();
    expect(p).not.toHaveProperty("reason");
    expectNothingInternal(p);
  });

  it("withholds what it cannot state: unknown action, no time, replaced result, unresolved patient, unknown result", () => {
    expect(mapLabReleaseEvent(LOG_BAD, LINK_A1, REFS, STAFF)).toBeNull();
    expect(mapLabReleaseEvent({ ...LOG_REVIEW, action: null }, LINK_A1, REFS, STAFF)).toBeNull();
    expect(mapLabReleaseEvent({ ...LOG_REVIEW, created_at: null }, LINK_A1, REFS, STAFF)).toBeNull();
    expect(mapLabReleaseEvent(LOG_SUPERSEDED, { ...LINK_A1, current: false }, REFS, STAFF)).toBeNull();
    expect(mapLabReleaseEvent(LOG_X, { orderId: ORDER_X.id, current: true, patientId: P_ORPHAN.id }, REFS, STAFF)).toBeNull();
    expect(mapLabReleaseEvent(LOG_REVIEW, undefined, REFS, STAFF)).toBeNull();
  });

  it("maps a merge: kept and merged-away records by their own ids, the merged-away one as source", () => {
    const own = new Map([
      [P_KEPT.id, P_KEPT.fhir_id],
      [P_MERGED.id, P_MERGED.fhir_id],
    ]);
    const p = mapMergeEvent(MERGE_OK, own, STAFF);
    expect(p).toEqual({
      resourceType: "Provenance",
      id: `merge-${MERGE_OK.id}`,
      meta: { versionId: String(Date.parse("2026-09-10T09:00:00.500Z")), lastUpdated: "2026-09-10T09:00:00.500Z", source: "https://mbhr.app" },
      target: [{ reference: `Patient/${P_KEPT.fhir_id}` }, { reference: `Patient/${P_MERGED.fhir_id}` }],
      recorded: "2026-09-10T09:00:00.500Z",
      activity: {
        coding: [{ system: "https://mbhr.app/codes/provenance-activity", code: "patient-merge", display: "Duplicate patient record merged into the kept record" }],
      },
      agent: [{ who: { reference: `Practitioner/${DOCTOR_PRACTITIONER}` } }],
      entity: [{ role: "source", what: { reference: `Patient/${P_MERGED.fhir_id}` } }],
    });
    // The tablet's request time is a device clock: not published as occurred.
    expect(p).not.toHaveProperty("occurredDateTime");
    expectNothingInternal(p);
    expect(validateResource(p, provenanceModule.validate)).toEqual([]);
  });

  it("never publishes a merge without a server-stamped actor, an unmerge, or one whose kept record does not resolve", () => {
    const own = new Map([
      [P_KEPT.id, P_KEPT.fhir_id],
      [P_MERGED.id, P_MERGED.fhir_id],
      [P_OTHER.id, P_OTHER.fhir_id],
    ]);
    expect(mapMergeEvent(MERGE_LEGACY, own, STAFF)).toBeNull();
    expect(mapMergeEvent(MERGE_UNMERGE, own, STAFF)).toBeNull();
    expect(mapMergeEvent({ ...MERGE_OK, kind: null }, own, STAFF)).toBeNull();
    expect(mapMergeEvent(MERGE_OK, new Map([[P_MERGED.id, P_MERGED.fhir_id]]), STAFF)).toBeNull();
    expect(mapMergeEvent({ ...MERGE_OK, id: "has space" }, own, STAFF)).toBeNull();
    // A merged-away record that no longer resolves is left out, not named by its internal id.
    const p = mapMergeEvent(MERGE_OK, new Map([[P_KEPT.id, P_KEPT.fhir_id]]), new Map()) as Json;
    expect(p.target).toEqual([{ reference: `Patient/${P_KEPT.fhir_id}` }]);
    expect(p.entity).toBeUndefined();
    expect(p.agent).toEqual([{ who: { display: "mBHR staff member" } }]);
  });

  it("maps an upload: DocumentReference target, CREATE, and no person named", () => {
    const p = mapDocumentUploadEvent(DOC_PATIENT, REFS);
    expect(p).toEqual({
      resourceType: "Provenance",
      id: `docup-${DOC_PATIENT.id}`,
      meta: { versionId: String(Date.parse("2026-09-11T11:00:00.000Z")), lastUpdated: "2026-09-11T11:00:00.000Z", source: "https://mbhr.app" },
      target: [{ reference: `DocumentReference/${DOC_PATIENT.id}` }],
      recorded: "2026-09-11T11:00:00.000Z",
      activity: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-DataOperation", code: "CREATE", display: "create" }] },
      agent: [{ who: { display: "Patient portal account" } }],
    });
    // "staff" includes every document stored before the ownership change: it names no one.
    expect((mapDocumentUploadEvent(DOC_STAFF, REFS) as Json).agent).toEqual([{ who: { display: "mBHR account" } }]);
    expect((mapDocumentUploadEvent({ ...DOC_STAFF, upload_source: null }, REFS) as Json).agent).toEqual([{ who: { display: "mBHR account" } }]);
    expect((mapDocumentUploadEvent({ ...DOC_STAFF, upload_source: "robot" }, REFS) as Json).agent).toEqual([{ who: { display: "mBHR account" } }]);
    expect(mapDocumentUploadEvent(DOC_REMOVED, REFS)).toBeNull();
    expect(mapDocumentUploadEvent({ ...DOC_PATIENT, patient_id: P_ORPHAN.id }, REFS)).toBeNull();
    expect(mapDocumentUploadEvent({ ...DOC_PATIENT, created_at: null }, REFS)).toBeNull();
    expectNothingInternal(p);
  });

  it("validation refuses ids, agents and elements this server never publishes", () => {
    const p = mapLabReleaseEvent(LOG_REVIEW, LINK_A1, REFS, STAFF) as Json;
    const issues = (r: Json) => validateResource(r, provenanceModule.validate).map((i) => i.path);
    expect(issues({ ...p, id: "other-1" })).toContain("id");
    expect(issues({ ...p, agent: [{ who: { reference: "Patient/abc" } }] })).toContain("agent[0].who");
    expect(issues({ ...p, agent: [{ who: { identifier: { value: DOCTOR_UID }, display: "x" } }] })).toContain("agent[0].who.identifier");
    expect(issues({ ...p, reason: [{ text: "why" }] })).toContain("reason");
    expect(issues({ ...p, occurredDateTime: "2026-09-12T08:00:00Z" })).toContain("occurredDateTime");
    expect(issues({ ...p, target: [] })).toEqual(expect.arrayContaining(["target"]));
  });
});

// ---------------------------------------------------------------------------
// AuditEvent mapper
// ---------------------------------------------------------------------------

const AUDIT_REFS = {
  patientFhirIds: new Map([
    [P_KEPT.id, P_KEPT.fhir_id],
    [P_MERGED.id, P_KEPT.fhir_id],
    [P_OTHER.id, P_OTHER.fhir_id],
  ]),
};

describe("AuditEvent mapping", () => {
  it("maps a permitted staff read element by element", () => {
    const a = mapAuditEvent(AUD_READ, AUDIT_REFS, STAFF);
    expect(a).toEqual({
      resourceType: "AuditEvent",
      id: AUD_READ.id,
      meta: { versionId: String(Date.parse("2026-09-20T10:00:00.123Z")), lastUpdated: "2026-09-20T10:00:00.123Z", source: "https://mbhr.app" },
      type: { system: "http://terminology.hl7.org/CodeSystem/audit-event-type", code: "rest", display: "RESTful Operation" },
      subtype: [{ system: "http://hl7.org/fhir/restful-interaction", code: "read", display: "read" }],
      action: "R",
      recorded: "2026-09-20T10:00:00.123Z",
      outcome: "0",
      purposeOfEvent: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ActReason", code: "TREAT" }] }],
      agent: [
        {
          who: { reference: `Practitioner/${DOCTOR_PRACTITIONER}` },
          requestor: true,
          role: [{ coding: [{ system: "https://mbhr.app/codes/staff-role", code: "doctor", display: "Doctor" }] }],
        },
      ],
      source: {
        observer: { display: "mBHR FHIR gateway" },
        type: [{ system: "http://terminology.hl7.org/CodeSystem/security-source-type", code: "4", display: "Application Server" }],
      },
      entity: [
        {
          what: { reference: `Patient/${P_KEPT.fhir_id}` },
          type: { system: "http://hl7.org/fhir/resource-types", code: "Patient" },
          role: { system: "http://terminology.hl7.org/CodeSystem/object-role", code: "1", display: "Patient" },
        },
        {
          what: { reference: `Patient/${P_KEPT.fhir_id}` },
          type: { system: "http://hl7.org/fhir/resource-types", code: "Patient" },
          role: { system: "http://terminology.hl7.org/CodeSystem/object-role", code: "4", display: "Domain Resource" },
          detail: [{ type: "result-count", valueString: "1" }],
        },
      ],
    });
    expect(validateResource(a, auditEventModule.validate)).toEqual([]);
    expectNothingInternal(a);
  });

  it("maps a refused search: E, search-type, outcome 4 with the reason code, the query without values", () => {
    const a = mapAuditEvent(AUD_DENY, AUDIT_REFS, new Map()) as Json;
    expect(a.action).toBe("E");
    expect(a.subtype[0].code).toBe("search-type");
    expect(a.outcome).toBe("4");
    expect(a.outcomeDesc).toBe("missing_permission");
    // The nurse account is not in the directory: display-only, never the account id.
    expect(a.agent[0].who).toEqual({ display: "mBHR staff member" });
    // The merged-away record shows as the kept (canonical) record.
    expect(a.entity[0].what).toEqual({ reference: `Patient/${P_KEPT.fhir_id}` });
    expect(a.entity[1]).toEqual({
      type: { system: "http://hl7.org/fhir/resource-types", code: "Observation" },
      role: { system: "http://terminology.hl7.org/CodeSystem/object-role", code: "24", display: "Query" },
    });
    expect(a.entity[1]).not.toHaveProperty("query");
    expectNothingInternal(a);
    expect(validateResource(a, auditEventModule.validate)).toEqual([]);
  });

  it("uses 8 for a recorded server error, and never publishes network, user agent or account ids", () => {
    const a = mapAuditEvent(AUD_ERROR, AUDIT_REFS, STAFF) as Json;
    expect(a.outcome).toBe("8");
    expect(a.outcomeDesc).toBe("unavailable");
    expect(a.entity[1].what).toEqual({ reference: labRef(RES_A1.id) });
    expect(a.agent[0]).not.toHaveProperty("network");
    expectNothingInternal(a);
  });

  it("shows a portal requester and an unknown account as display-only", () => {
    const p = mapAuditEvent(AUD_PATIENT, AUDIT_REFS, STAFF) as Json;
    expect(p.agent).toEqual([{ who: { display: "Patient portal account" }, requestor: true }]);
    expect(p.purposeOfEvent[0].coding[0].code).toBe("PATRQT");
    const n = mapAuditEvent(AUD_NONE, AUDIT_REFS, STAFF) as Json;
    expect(n.agent).toEqual([{ who: { display: "mBHR account" }, requestor: true }]);
    expect(n.outcome).toBe("4");
    expect(n.outcomeDesc).toBe("no_active_account");
  });

  it("never shows a Phase 1 permit that no staff or patient account could have written", () => {
    expect(mapAuditEvent(AUD_FORGED, AUDIT_REFS, STAFF)).toBeNull();
    expect(mapAuditEvent({ ...AUD_READ, actor_kind: "none" }, AUDIT_REFS, STAFF)).toBeNull();
    expect(mapAuditEvent({ ...AUD_READ, actor_kind: "robot" }, AUDIT_REFS, STAFF)).toBeNull();
    // A Phase 1 row with a staff role was a staff account: kept, role shown.
    const v1 = mapAuditEvent(AUD_V1_STAFF, AUDIT_REFS, STAFF) as Json;
    expect(v1.agent[0]).toEqual({
      who: { display: "mBHR staff member" },
      requestor: true,
      role: [{ coding: [{ system: "https://mbhr.app/codes/staff-role", code: "admin", display: "Administrator" }] }],
    });
    // "invalid" is not a purpose code: left out.
    expect(v1).not.toHaveProperty("purposeOfEvent");
  });

  it("withholds rows that are not gateway reads or searches, or lack an id, time or decision", () => {
    for (const over of [{ action: "export" }, { action: "consent_change" }, { action: null }, { decision: null }, { decision: "maybe" }, { occurred_at: null }, { id: "not-a-uuid" }]) {
      expect(mapAuditEvent({ ...AUD_READ, ...over }, AUDIT_REFS, STAFF), JSON.stringify(over)).toBeNull();
    }
  });

  it("names a deleted patient by nothing rather than by an internal id", () => {
    const a = mapAuditEvent(AUD_DELETED, AUDIT_REFS, STAFF) as Json;
    expect(a.entity).toEqual([
      {
        what: { reference: "Condition/c0000000-0000-4000-8000-00000000000a" },
        type: { system: "http://hl7.org/fhir/resource-types", code: "Condition" },
        role: { system: "http://terminology.hl7.org/CodeSystem/object-role", code: "4", display: "Domain Resource" },
        detail: [{ type: "result-count", valueString: "0" }],
      },
    ]);
    expectNothingInternal(a);
  });

  it("gives each row the patient the search named, else its first patient", () => {
    expect(auditOwner(AUD_DENY, [P_KEPT.id, P_MERGED.id])).toBe(P_MERGED.id);
    expect(auditOwner(AUD_DENY, [P_OTHER.id])).toBeNull();
    expect(auditOwner(AUD_READ, null)).toBe(P_KEPT.id);
    expect(auditOwner(AUD_NONE, null)).toBeNull();
  });

  it("validation refuses queries, free-text outcomes and identifiers", () => {
    const a = mapAuditEvent(AUD_DENY, AUDIT_REFS, STAFF) as Json;
    const issues = (r: Json) => validateResource(r, auditEventModule.validate).map((i) => i.path);
    expect(issues({ ...a, entity: [{ query: "cGF0aWVudD14" }] })).toContain("entity[0]");
    expect(issues({ ...a, outcomeDesc: "Access denied to Ada" })).toContain("outcomeDesc");
    expect(issues({ ...a, agent: [{ who: { display: "x" }, requestor: true, network: { address: "1.2.3.4" } }] })).toContain("agent[0].network");
    expect(issues({ ...a, agent: [{ who: { reference: `Patient/${P_KEPT.fhir_id}` }, requestor: true }] })).toContain("agent[0].who");
  });

  it("keeps microseconds in the keyset and turns an exclusive bound into an inclusive one", () => {
    expect(canonicalMicros("2026-09-20T10:00:00.123456+00:00")).toBe("2026-09-20T10:00:00.123456Z");
    expect(canonicalMicros("2026-09-20T10:00:00.1234+00:00")).toBe("2026-09-20T10:00:00.123400Z");
    expect(canonicalMicros("2026-09-20 11:00:00+01")).toBe("2026-09-20T10:00:00.000000Z");
    expect(canonicalMicros("2026-09-20")).toBeNull();
    expect(canonicalMicros(null)).toBeNull();
    expect(inclusiveUpper("2026-09-30T23:00:00.000Z")).toBe("2026-09-30T22:59:59.999999Z");
  });
});

// ---------------------------------------------------------------------------
// Gateway: Provenance
// ---------------------------------------------------------------------------

const KEPT_EVENTS = [
  `labrel-${LOG_REVIEW.id}`,
  `labrel-${LOG_RELEASE.id}`,
  `labrel-${LOG_WITHHELD.id}`,
  `labrel-${LOG_M.id}`,
  `merge-${MERGE_OK.id}`,
  `docup-${DOC_PATIENT.id}`,
  `docup-${DOC_MERGED.id}`,
];

describe("Provenance through the gateway", () => {
  it("lists every server-attributed event about a patient, including records merged into it", async () => {
    const { call, audits } = setup();
    const res = await call(`/fhir/R4/Provenance?patient=Patient/${P_KEPT.fhir_id}`, AUDITOR);
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(ids(b)).toEqual(KEPT_EVENTS);
    expectNothingInternal(matches(b));
    // The access audit names the patient and the records returned (internal ids, server side only).
    const permit = audits.find((a) => a.p_decision === "permit") as Json;
    expect(permit.p_resource_type).toBe("Provenance");
    expect(new Set(permit.p_patient_ids)).toEqual(new Set([P_KEPT.id, P_MERGED.id]));
  });

  it("never shows forged or out-of-scope rows", async () => {
    const { call } = setup();
    const b = await json(await call(`/fhir/R4/Provenance?patient=Patient/${P_KEPT.fhir_id}`, AUDITOR));
    const served = ids(b);
    for (const hidden of [
      `labrel-${LOG_BAD.id}`, // action the log does not record
      `labrel-${LOG_SUPERSEDED.id}`, // result replaced by a newer one
      `labrel-${LOG_O.id}`, // another patient
      `merge-${MERGE_LEGACY.id}`, // device-claimed actor, device time
      `merge-${MERGE_UNMERGE.id}`, // no writer
      `docup-${DOC_REMOVED.id}`, // removed document
      `docup-${DOC_STAFF.id}`, // another patient
    ]) {
      expect(served).not.toContain(hidden);
    }
    // By id too.
    for (const id of [`labrel-${LOG_BAD.id}`, `merge-${MERGE_LEGACY.id}`, `docup-${DOC_REMOVED.id}`, `labrel-${LOG_X.id}`]) {
      expect((await call(`/fhir/R4/Provenance/${id}`, AUDITOR)).status, id).toBe(404);
    }
  });

  it("reads each kind of event by id", async () => {
    const { call } = setup();
    for (const id of [`labrel-${LOG_REVIEW.id}`, `merge-${MERGE_OK.id}`, `docup-${DOC_PATIENT.id}`]) {
      const res = await call(`/fhir/R4/Provenance/${id}`, AUDITOR);
      expect(res.status, id).toBe(200);
      const p = await json(res);
      expect(p.id).toBe(id);
      expect(res.headers.get("etag")).toMatch(/^W\//);
      expectNothingInternal(p);
    }
  });

  it("gives lab_review holders without audit_access laboratory events only", async () => {
    const { call } = setup();
    const b = await json(await call(`/fhir/R4/Provenance?patient=Patient/${P_KEPT.fhir_id}`, DOCTOR));
    expect(ids(b)).toEqual(KEPT_EVENTS.filter((i) => i.startsWith("labrel-")));
    expect((await call(`/fhir/R4/Provenance/merge-${MERGE_OK.id}`, DOCTOR)).status).toBe(404);
    expect((await call(`/fhir/R4/Provenance/docup-${DOC_PATIENT.id}`, DOCTOR)).status).toBe(404);
    expect((await call(`/fhir/R4/Provenance/labrel-${LOG_REVIEW.id}`, DOCTOR)).status).toBe(200);
    expect(ids(await json(await call(`/fhir/R4/Provenance?target=Patient/${P_KEPT.fhir_id}`, DOCTOR)))).toEqual([]);
  });

  it("refuses staff without audit_access or lab_review, and patients", async () => {
    const { call, audits } = setup();
    for (const path of [`/fhir/R4/Provenance?patient=Patient/${P_KEPT.fhir_id}`, `/fhir/R4/Provenance/labrel-${LOG_REVIEW.id}`]) {
      expect((await call(path, NURSE)).status, path).toBe(403);
      expect((await call(path, PORTAL)).status, path).toBe(403);
    }
    expect(audits.filter((a) => a.p_resource_type === "Provenance").every((a) => a.p_decision === "deny")).toBe(true);
    expect(audits.map((a) => a.p_denial_reason)).toEqual(expect.arrayContaining(["missing_permission", "not_available_to_patients"]));
  });

  it("refuses a search that names no record (anti-enumeration)", async () => {
    const { call, audits } = setup();
    expect((await call("/fhir/R4/Provenance", AUDITOR)).status).toBe(403);
    expect(audits[audits.length - 1]).toMatchObject({ p_decision: "deny", p_denial_reason: "search_not_narrowed" });
    for (const q of ["recorded=ge2026-09-01", "recorded=ge2026-07-01&recorded=lt2026-10-01", "recorded=2026"]) {
      const res = await call(`/fhir/R4/Provenance?${q}`, AUDITOR);
      expect(res.status, q).toBe(403);
      expect(JSON.stringify(await json(res))).not.toMatch(/labrel|merge-|docup/);
    }
  });

  it("searches a closed recorded range of at most 31 days across every source", async () => {
    const { call } = setup();
    const b = await json(await call("/fhir/R4/Provenance?recorded=ge2026-09-01&recorded=lt2026-10-01", AUDITOR));
    expect(new Set(ids(b))).toEqual(
      new Set([...KEPT_EVENTS, `labrel-${LOG_O.id}`, `docup-${DOC_STAFF.id}`]),
    );
    const day = await json(await call("/fhir/R4/Provenance?recorded=2026-09-12&patient=Patient/" + P_KEPT.fhir_id, AUDITOR));
    expect(ids(day)).toEqual([`labrel-${LOG_REVIEW.id}`, `labrel-${LOG_RELEASE.id}`, `labrel-${LOG_WITHHELD.id}`]);
  });

  it("finds events by target", async () => {
    const { call, audits } = setup();
    const q = async (t: string) => ids(await json(await call(`/fhir/R4/Provenance?target=${t}`, AUDITOR)));
    const a1 = [`labrel-${LOG_REVIEW.id}`, `labrel-${LOG_RELEASE.id}`, `labrel-${LOG_WITHHELD.id}`];
    expect(await q(labRef(RES_A1.id))).toEqual(a1);
    expect(await q(`DiagnosticReport/${ORDER_A.id}`)).toEqual(a1);
    expect(await q(labRef(RES_A2.id))).toEqual([]);
    expect(await q(`Patient/${P_KEPT.fhir_id}`)).toEqual([`merge-${MERGE_OK.id}`]);
    // The merged-away record is a target of its merge too.
    expect(await q(`Patient/${P_MERGED.fhir_id}`)).toEqual([`merge-${MERGE_OK.id}`]);
    expect(audits[audits.length - 1].p_patient_ids).toContain(P_MERGED.id);
    expect(await q(`DocumentReference/${DOC_PATIENT.id}`)).toEqual([`docup-${DOC_PATIENT.id}`]);
    expect(await q(`Encounter/01HZZVISITA000000000000000`)).toEqual([]);
    expect(await q(`Observation/01HZZVITALSA0000000000000-bp`)).toEqual([]);
    expect(await q(`Patient/0b3c1d2e-2222-4aaa-8bbb-00000000ffff`)).toEqual([]);
    // _id and target together must agree.
    expect(ids(await json(await call(`/fhir/R4/Provenance?_id=docup-${DOC_PATIENT.id}&target=DocumentReference/${DOC_MERGED.id}`, AUDITOR)))).toEqual([]);
    expect(ids(await json(await call(`/fhir/R4/Provenance?_id=labrel-${LOG_REVIEW.id}&target=${labRef(RES_A1.id)}`, AUDITOR)))).toEqual([
      `labrel-${LOG_REVIEW.id}`,
    ]);
  });

  it("answers malformed targets and ids with 400 or 404, without detail", async () => {
    const { call } = setup();
    for (const t of ["just-an-id", "https://other.example/fhir/Patient/1", "Patient/a/b"]) {
      const res = await call(`/fhir/R4/Provenance?target=${encodeURIComponent(t)}`, AUDITOR);
      expect(res.status, t).toBe(400);
      expect(JSON.stringify(await json(res))).not.toMatch(/lab_result|patient_merges|select|postgres/i);
    }
    for (const id of ["unknown-prefix", "labrel-not-a-uuid", `merge-5e000000-0000-4000-8000-00000000ffff`, `docup-${DOC_STAFF.id.slice(0, -1)}0`]) {
      const res = await call(`/fhir/R4/Provenance/${id}`, AUDITOR);
      expect(res.status, id).toBe(404);
      expect(JSON.stringify(await json(res))).not.toContain(id);
    }
  });

  it("matches nothing for a merged-away patient and says where the records are", async () => {
    const { call } = setup();
    const b = await json(await call(`/fhir/R4/Provenance?patient=Patient/${P_MERGED.fhir_id}`, AUDITOR));
    expect(ids(b)).toEqual([]);
    const outcome = (b.entry as Json[]).find((e) => e.search.mode === "outcome");
    expect(outcome?.resource.issue[0].diagnostics).toContain(`Patient/${P_KEPT.fhir_id}`);
  });

  it("pages across the three sources with no gaps or repeats", async () => {
    const { call } = setup();
    const r = await allPages(call, `/fhir/R4/Provenance?patient=Patient/${P_KEPT.fhir_id}&_count=2`, AUDITOR);
    expect(r.ids).toEqual(KEPT_EVENTS);
    expect(r.pages).toBe(4);
    const one = await allPages(call, `/fhir/R4/Provenance?patient=Patient/${P_KEPT.fhir_id}&_count=1`, AUDITOR);
    expect(one.ids).toEqual(KEPT_EVENTS);
    // A cursor from another search is refused.
    const first = one.bodies[0].link.find((l: Json) => l.relation === "next").url as string;
    const cursor = new URL(first).searchParams.get("_cursor");
    expect((await call(`/fhir/R4/Provenance?patient=Patient/${P_OTHER.fhir_id}&_count=1&_cursor=${cursor}`, AUDITOR)).status).toBe(400);
  });

  it("publishes its search parameters in the CapabilityStatement", async () => {
    const { call } = setup();
    const cs = await json(await call("/fhir/R4/metadata"));
    const byType = (t: string) => cs.rest[0].resource.find((r: Json) => r.type === t);
    expect(byType("Provenance").searchParam.map((p: Json) => p.name)).toEqual(["_id", "target", "patient", "recorded"]);
    expect(byType("Provenance").interaction.map((i: Json) => i.code)).toEqual(["read", "search-type"]);
    expect(byType("AuditEvent").searchParam.map((p: Json) => p.name)).toEqual(["_id", "patient", "date", "outcome", "action", "subtype"]);
  });
});

// ---------------------------------------------------------------------------
// Gateway: AuditEvent
// ---------------------------------------------------------------------------

describe("AuditEvent through the gateway", () => {
  it("lists the requests that touched a patient's records, merged records included, newest first", async () => {
    const { call, audits } = setup();
    const res = await call(`/fhir/R4/AuditEvent?patient=Patient/${P_KEPT.fhir_id}`, AUDITOR);
    expect(res.status).toBe(200);
    const b = await json(res);
    // AUD_FORGED is on this patient too, and is never shown.
    expect(ids(b)).toEqual([AUD_READ.id, AUD_DENY.id, AUD_ERROR.id, AUD_PATIENT.id]);
    const deny = matches(b).find((r) => r.id === AUD_DENY.id) as Json;
    expect(deny.outcome).toBe("4");
    expect(deny.outcomeDesc).toBe("missing_permission");
    expect(deny.entity[0].what.reference).toBe(`Patient/${P_KEPT.fhir_id}`);
    expectNothingInternal(matches(b));
    const permit = audits.find((a) => a.p_resource_type === "AuditEvent" && a.p_decision === "permit") as Json;
    expect(new Set(permit.p_patient_ids)).toEqual(new Set([P_KEPT.id, P_MERGED.id]));
  });

  it("reads one event by id; a withheld, unknown or malformed id is a plain 404", async () => {
    const { call } = setup();
    const res = await call(`/fhir/R4/AuditEvent/${AUD_READ.id}`, AUDITOR);
    expect(res.status).toBe(200);
    const a = await json(res);
    expect(a.agent[0].who.reference).toBe(`Practitioner/${DOCTOR_PRACTITIONER}`);
    expectNothingInternal(a);
    for (const id of [AUD_FORGED.id, "a0000000-0000-4000-8000-00000000ffff", "not-a-uuid"]) {
      const r = await call(`/fhir/R4/AuditEvent/${id}`, AUDITOR);
      expect(r.status, id).toBe(404);
      expect(JSON.stringify(await json(r))).not.toContain(id);
    }
  });

  it("is refused to everyone without audit_access, patients included", async () => {
    const { call } = setup();
    for (const token of [DOCTOR, NURSE, PORTAL]) {
      expect((await call(`/fhir/R4/AuditEvent?patient=Patient/${P_KEPT.fhir_id}`, token)).status).toBe(403);
      expect((await call(`/fhir/R4/AuditEvent/${AUD_READ.id}`, token)).status).toBe(403);
    }
  });

  it("refuses a search that names no record, an open date range, or a range over 31 days", async () => {
    const { call } = setup();
    for (const q of ["", "?outcome=4", "?date=ge2026-09-01", "?date=ge2026-08-01&date=lt2026-10-01", "?date=2026"]) {
      const res = await call(`/fhir/R4/AuditEvent${q}`, AUDITOR);
      expect(res.status, q).toBe(403);
      expect(JSON.stringify(await json(res))).not.toContain("a0000000");
    }
    const month = await json(await call("/fhir/R4/AuditEvent?date=ge2026-09-01&date=lt2026-10-01", AUDITOR));
    expect(ids(month)).toEqual([AUD_READ.id, AUD_DENY.id, AUD_ERROR.id, AUD_PATIENT.id, AUD_V1_STAFF.id, AUD_NONE.id, AUD_DELETED.id]);
    expectNothingInternal(matches(month));
    expect(ids(await json(await call("/fhir/R4/AuditEvent?date=2026-09-20", AUDITOR)))).toEqual([AUD_READ.id, AUD_DENY.id]);
  });

  it("filters by outcome, action and subtype", async () => {
    const { call } = setup();
    const q = async (s: string) => ids(await json(await call(`/fhir/R4/AuditEvent?patient=Patient/${P_KEPT.fhir_id}&${s}`, AUDITOR)));
    expect(await q("outcome=0")).toEqual([AUD_READ.id, AUD_PATIENT.id]);
    expect(await q("outcome=4")).toEqual([AUD_DENY.id]);
    expect(await q("outcome=8")).toEqual([AUD_ERROR.id]);
    expect(await q("outcome=http://hl7.org/fhir/audit-event-outcome|8")).toEqual([AUD_ERROR.id]);
    expect(await q("outcome=12")).toEqual([]);
    expect(await q("action=R")).toEqual([AUD_READ.id, AUD_ERROR.id]);
    expect(await q("action=E")).toEqual([AUD_DENY.id, AUD_PATIENT.id]);
    expect(await q("action=C")).toEqual([]);
    expect(await q("subtype=search-type")).toEqual([AUD_DENY.id, AUD_PATIENT.id]);
    expect(await q("subtype=read&action=E")).toEqual([]);
    expect(await q(`_id=${AUD_ERROR.id}`)).toEqual([AUD_ERROR.id]);
    expect(await q("date=lt2026-09-19")).toEqual([AUD_PATIENT.id]);
    expect((await call(`/fhir/R4/AuditEvent?patient=Patient/${P_KEPT.fhir_id}&outcome=5`, AUDITOR)).status).toBe(400);
    expect((await call(`/fhir/R4/AuditEvent?patient=Patient/${P_KEPT.fhir_id}&agent=Practitioner/x`, AUDITOR)).status).toBe(400);
  });

  it("pages newest first without losing a row in the same millisecond", async () => {
    const { call } = setup();
    const r = await allPages(call, `/fhir/R4/AuditEvent?patient=Patient/${P_KEPT.fhir_id}&_count=1`, AUDITOR);
    expect(r.ids).toEqual([AUD_READ.id, AUD_DENY.id, AUD_ERROR.id, AUD_PATIENT.id]);
    const two = await allPages(call, "/fhir/R4/AuditEvent?date=ge2026-09-01&date=lt2026-10-01&_count=2", AUDITOR);
    expect(two.ids).toEqual([AUD_READ.id, AUD_DENY.id, AUD_ERROR.id, AUD_PATIENT.id, AUD_V1_STAFF.id, AUD_NONE.id, AUD_DELETED.id]);
  });

  it("matches nothing for a merged-away patient", async () => {
    const { call } = setup();
    const b = await json(await call(`/fhir/R4/AuditEvent?patient=Patient/${P_MERGED.fhir_id}`, AUDITOR));
    expect(ids(b)).toEqual([]);
  });

  it("fails closed when the database refuses the caller", async () => {
    const { call } = setup({
      rpcs: { fhir_staff_directory: staffDirectory, fhir_access_audit_events: () => refuse("42501", 403) },
    });
    expect((await call(`/fhir/R4/AuditEvent?patient=Patient/${P_KEPT.fhir_id}`, AUDITOR)).status).toBe(403);
  });

  it("still serves events, display-only, when the staff directory cannot be read", async () => {
    const { call } = setup({
      rpcs: { fhir_staff_directory: () => refuse("PGRST202", 404), fhir_access_audit_events: accessAuditEvents },
    });
    const a = await json(await call(`/fhir/R4/AuditEvent/${AUD_READ.id}`, AUDITOR));
    expect(a.agent[0].who).toEqual({ display: "mBHR staff member" });
    expectNothingInternal(a);
  });
});
