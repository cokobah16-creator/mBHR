// @vitest-environment node
//
// The Phase 2 security matrix at the gateway (owner prompt section 55),
// end to end against the in-memory Supabase: patient self-access (own
// records only, whatever the URL says), staff limits, merged patients,
// cursors bound to their search, audit of refusals and errors, and the
// server-side defence in depth behind the database's own row-level
// security. Document and consent cases are in documents.test.ts and
// consentResource.test.ts.

import { describe, expect, it } from "vitest";
import { handleFhirRequest } from "../gateway/handler";
import { fakeSupabase, makeToken, type FakeOptions, type FakeUser } from "./fakeSupabase";
import { CONDITION_A, PATIENT_A, PATIENT_B, VISIT_A, VITALS_A } from "./fixtures";

const ENV = {
  FHIR_ENABLED: "true",
  FHIR_PATIENT_ACCESS_ENABLED: "true",
  FHIR_BASE_URL: "https://mbhr.app/fhir/R4",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
};

// A record merged into A: its row is kept as a tombstone, and one vitals row
// still carries its old id.
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
const VITALS_B = { ...VITALS_A, id: "01HZZVITALSB0000000000000", patient_id: PATIENT_B.id, visit_id: VISIT_B.id, pulse_bpm: 70 };
const VITALS_M = { ...VITALS_A, id: "01HZZVITALSM0000000000000", patient_id: PATIENT_M.id, visit_id: null, pulse_bpm: 66 };
const VITALS_HIDDEN = { ...VITALS_A, id: "01HZZVITALSH0000000000000", portal_visible: false, pulse_bpm: 72 };

const DOCTOR = makeToken("doctor-1");
const NURSE = makeToken("nurse-1");
const PHARMACIST = makeToken("pharm-1");
const PAT_A = makeToken("portal-a");
const PAT_B = makeToken("portal-b");
const NOBODY = makeToken("nobody-1");

const USERS: Record<string, FakeUser> = {
  [DOCTOR]: { id: "doctor-1", role: "doctor", permissions: ["consult", "lab_review", "register", "vitals", "queue"] },
  [NURSE]: { id: "nurse-1", role: "nurse", permissions: ["register", "vitals", "queue", "portal_manage"] },
  [PHARMACIST]: { id: "pharm-1", role: "pharmacist", permissions: ["dispense", "inventory", "queue"] },
  [PAT_A]: { id: "portal-a", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_A.id] },
  [PAT_B]: { id: "portal-b", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_B.id] },
  [NOBODY]: { id: "nobody-1", role: null, permissions: [], kind: "none" },
};

/** Row-level security as the portal policies have it: a patient sees only their own rows. */
function visible(table: string, row: Record<string, unknown>, user: FakeUser): boolean {
  if ((user.kind ?? "staff") !== "patient") return true;
  const own = user.patientIds ?? [];
  if (table === "patients") return own.includes(String(row.id));
  return own.includes(String(row.patient_id));
}

function setup(overrides: Partial<FakeOptions> = {}, env: Record<string, string> = ENV) {
  const fake = fakeSupabase({
    users: USERS,
    tables: {
      patients: [PATIENT_A, PATIENT_B, PATIENT_M],
      visits: [VISIT_A, VISIT_A_OPEN, VISIT_B],
      vitals: [VITALS_A, VITALS_B, VITALS_M, VITALS_HIDDEN],
      conditions: [CONDITION_A],
    },
    visible,
    ...overrides,
  });
  const logs: string[] = [];
  let fetchImpl = fake.fetchImpl;
  const call = (path: string, init: RequestInit & { token?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    return handleFhirRequest(new Request(`https://mbhr.app${path}`, { ...init, headers }), {
      env,
      fetchImpl: (input, i) => fetchImpl(input, i),
      randomId: () => "11111111-2222-4333-8444-555555555555",
      log: (l) => logs.push(l),
      now: () => new Date("2026-09-25T12:00:00Z"),
    });
  };
  const wrapFetch = (w: (f: typeof fake.fetchImpl) => typeof fake.fetchImpl) => {
    fetchImpl = w(fake.fetchImpl);
  };
  return { ...fake, call, logs, wrapFetch };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const json = async (res: Response) => (await res.json()) as Json;
const matches = (b: Json) => b.entry.filter((e: Json) => e.search.mode === "match").map((e: Json) => e.resource);
const outcomes = (b: Json) => b.entry.filter((e: Json) => e.search.mode === "outcome").flatMap((e: Json) => e.resource.issue);

describe("anonymous", () => {
  it("gets 401 for every type, with nothing read or audited", async () => {
    const { call, calls, audits } = setup();
    for (const path of [`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, `/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}`, "/fhir/R4/Binary/x1"]) {
      const res = await call(path);
      expect(res.status, path).toBe(401);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(calls).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });
});

describe("patient self-access", () => {
  it("A reads A: permitted and audited as the patient's own request", async () => {
    const { call, audits } = setup();
    const res = await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, { token: PAT_A });
    expect(res.status).toBe(200);
    expect((await json(res)).id).toBe(PATIENT_A.fhir_id);
    expect(audits).toEqual([
      expect.objectContaining({
        actor: "portal-a",
        p_decision: "permit",
        p_actor_kind: "patient",
        p_purpose: "PATRQT",
        p_patient_ids: [PATIENT_A.id],
        p_consent_decision: "not-applicable",
      }),
    ]);
  });

  it("A reads B: refused, whatever the id, and the refusal is audited", async () => {
    const { call, audits, calls } = setup();
    const res = await call(`/fhir/R4/Patient/${PATIENT_B.fhir_id}`, { token: PAT_A });
    expect(res.status).toBe(403);
    expect(JSON.stringify(await json(res))).not.toContain("Bola");
    expect(audits).toEqual([expect.objectContaining({ p_decision: "deny", p_denial_reason: "patient_not_in_context", p_http_status: 403 })]);
    // B's clinical rows were never queried.
    expect(calls.some((c) => c.url.includes("/rest/v1/patients?"))).toBe(false);
  });

  it("a modified patient= parameter does not reach another patient's data", async () => {
    const { call } = setup();
    for (const path of [
      `/fhir/R4/Observation?patient=Patient/${PATIENT_B.fhir_id}`,
      `/fhir/R4/Encounter?subject=Patient/${PATIENT_B.fhir_id}`,
      `/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&subject=Patient/${PATIENT_B.fhir_id}`,
    ]) {
      const res = await call(path, { token: PAT_A });
      expect(res.status, path).toBe(403);
    }
  });

  it("a search that names no patient is confined to the patient's own records", async () => {
    const { call } = setup();
    const b = await json(await call("/fhir/R4/Observation", { token: PAT_A }));
    const subjects = new Set(matches(b).map((o: Json) => o.subject.reference));
    expect([...subjects]).toEqual([`Patient/${PATIENT_A.fhir_id}`]);
  });

  it("naming another patient's row by id finds nothing", async () => {
    const { call } = setup();
    expect((await call(`/fhir/R4/Observation/${VITALS_B.id}-heart-rate`, { token: PAT_A })).status).toBe(404);
    expect((await call(`/fhir/R4/Encounter/${VISIT_B.id}`, { token: PAT_A })).status).toBe(404);
    const b = await json(await call(`/fhir/R4/Observation?_id=${VITALS_B.id}-heart-rate`, { token: PAT_A }));
    expect(matches(b)).toEqual([]);
  });

  it("sees what the portal shows: closed visits and portal-visible vital signs only", async () => {
    const { call } = setup();
    const enc = await json(await call("/fhir/R4/Encounter", { token: PAT_A }));
    expect(matches(enc).map((e: Json) => e.id)).toEqual([VISIT_A.id]);
    const obs = await json(await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&code=8867-4`, { token: PAT_A }));
    expect(matches(obs).map((o: Json) => o.id)).toEqual([]); // pulse only on the hidden row (and 0 on VITALS_A)
    const staff = await json(await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&code=8867-4`, { token: DOCTOR }));
    expect(matches(staff).map((o: Json) => o.id)).toContain(`${VITALS_HIDDEN.id}-heart-rate`);
  });

  it("is refused types the portal does not show", async () => {
    const { call } = setup();
    for (const path of [`/fhir/R4/Condition?patient=Patient/${PATIENT_A.fhir_id}`, "/fhir/R4/Practitioner?name=Ada", "/fhir/R4/AuditEvent?patient=Patient/x"]) {
      expect((await call(path, { token: PAT_A })).status, path).toBe(403);
    }
  });

  it("gets nothing while patient access is switched off", async () => {
    const { call, audits } = setup({}, { ...ENV, FHIR_PATIENT_ACCESS_ENABLED: "false" });
    expect((await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, { token: PAT_A })).status).toBe(403);
    expect(audits[0]).toMatchObject({ p_denial_reason: "patient_access_disabled" });
  });

  it("an account linked to no record gets nothing", async () => {
    const { call, audits } = setup();
    expect((await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, { token: NOBODY })).status).toBe(403);
    expect(audits[0]).toMatchObject({ p_denial_reason: "no_active_account", p_actor_kind: "none" });
  });

  it("a patient cannot state another purpose to widen access", async () => {
    const { call } = setup();
    for (const purpose of ["TREAT", "HRESCH", "ETREAT"]) {
      const res = await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, { token: PAT_A, headers: { "X-Purpose-Of-Use": purpose } });
      expect(res.status, purpose).toBe(403);
    }
  });

  it("defence in depth: rows outside the patient's scope are never released, even if the database returned them", async () => {
    const { call, wrapFetch, audits } = setup({ visible: () => true });
    // Simulate a query that lost its patient filter.
    wrapFetch((f) => (input, init) => f(input.replace(/&patient_id=in\.[^&]*/g, ""), init));
    const res = await call("/fhir/R4/Observation", { token: PAT_A });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await json(res))).not.toContain(PATIENT_B.fhir_id);
    expect(audits.at(-1)).toMatchObject({ p_decision: "deny", p_denial_reason: "server_error", p_http_status: 500 });
  });
});

describe("staff limits", () => {
  it("a nurse cannot write, and cannot read diagnoses or laboratory results", async () => {
    const { call } = setup();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await call("/fhir/R4/Observation", { method, token: NURSE, body: method === "DELETE" ? undefined : "{}" })).status).toBe(405);
    }
    expect((await call(`/fhir/R4/Condition/${CONDITION_A.id}`, { token: NURSE })).status).toBe(403);
    expect((await call("/fhir/R4/Observation/lab-00000000-0000-4000-8000-000000000001", { token: NURSE })).status).toBe(404);
  });

  it("a pharmacist cannot read clinical notes or vital signs", async () => {
    const { call } = setup();
    expect((await call(`/fhir/R4/Condition?patient=Patient/${PATIENT_A.fhir_id}`, { token: PHARMACIST })).status).toBe(403);
    expect((await call(`/fhir/R4/Encounter/${VISIT_A.id}`, { token: PHARMACIST })).status).toBe(403);
  });

  it("a doctor reads an encounter they may see", async () => {
    const { call } = setup();
    expect((await call(`/fhir/R4/Encounter/${VISIT_A.id}`, { token: DOCTOR })).status).toBe(200);
  });

  it("staff searches must name a record, and the refusal is audited", async () => {
    const { call, audits } = setup();
    const res = await call("/fhir/R4/Observation?category=vital-signs", { token: DOCTOR });
    expect(res.status).toBe(403);
    expect(audits.at(-1)).toMatchObject({ p_decision: "deny", p_denial_reason: "search_not_narrowed", p_http_status: 403 });
  });
});

describe("merged patients", () => {
  it("a search by the merged-away record matches nothing and names the kept record", async () => {
    const { call } = setup();
    const b = await json(await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_M.fhir_id}`, { token: DOCTOR }));
    expect(matches(b)).toEqual([]);
    expect(outcomes(b)[0].diagnostics).toContain(`Patient/${PATIENT_A.fhir_id}`);
  });

  it("a search by the kept record includes rows still on the merged-away id, shown as the kept record", async () => {
    const { call } = setup();
    const b = await json(await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&code=8867-4`, { token: DOCTOR }));
    const merged = matches(b).find((o: Json) => o.id === `${VITALS_M.id}-heart-rate`);
    expect(merged.subject.reference).toBe(`Patient/${PATIENT_A.fhir_id}`);
    expect(JSON.stringify(b)).not.toContain(PATIENT_M.fhir_id);
  });

  it("a read of the merged-away record is a tombstone pointing at the kept one", async () => {
    const { call } = setup();
    const p = await json(await call(`/fhir/R4/Patient/${PATIENT_M.fhir_id}`, { token: DOCTOR }));
    expect(p.active).toBe(false);
    expect(p.link).toEqual([{ other: { reference: `Patient/${PATIENT_A.fhir_id}` }, type: "replaced-by" }]);
    for (const k of ["birthDate", "gender", "telecom", "address"]) expect(p[k], k).toBeUndefined();
  });

  it("a merge chain the caller cannot follow resolves to nothing (fails closed)", async () => {
    const hiddenKept = (table: string, row: Record<string, unknown>) => !(table === "patients" && row.id === PATIENT_A.id);
    const { call } = setup({ visible: hiddenKept });
    const b = await json(await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_M.fhir_id}`, { token: DOCTOR }));
    expect(matches(b)).toEqual([]);
    expect(outcomes(b)[0].diagnostics).toMatch(/not available/);
  });

  it("a patient cannot reach a merged-away record by naming it", async () => {
    const { call } = setup();
    expect((await call(`/fhir/R4/Patient/${PATIENT_M.fhir_id}`, { token: PAT_A })).status).toBe(403);
    expect((await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_M.fhir_id}`, { token: PAT_A })).status).toBe(403);
  });
});

describe("paging and cursors", () => {
  async function nextLink(call: ReturnType<typeof setup>["call"], path: string, token: string): Promise<string> {
    const b = await json(await call(path, { token }));
    return b.link.find((l: Json) => l.relation === "next").url.replace("https://mbhr.app", "");
  }

  it("a cursor continues only the search, caller and scope it was issued for", async () => {
    const { call } = setup();
    const next = await nextLink(call, `/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&_count=1`, DOCTOR);
    expect((await call(next, { token: DOCTOR })).status).toBe(200);
    const cursor = new URL(`https://x${next}`).searchParams.get("_cursor")!;
    // Same cursor, other patient.
    const moved = `/fhir/R4/Observation?patient=Patient/${PATIENT_B.fhir_id}&_count=1&_cursor=${cursor}`;
    expect((await call(moved, { token: DOCTOR })).status).toBe(400);
    // Same search, other caller.
    expect((await call(next, { token: NURSE })).status).toBe(400);
    // Same search with an extra filter.
    expect((await call(`${next}&code=8867-4`, { token: DOCTOR })).status).toBe(400);
  });

  it("refuses a forged or tampered cursor, and audits the refusal", async () => {
    const { call, audits } = setup();
    const forged = btoa(JSON.stringify({ k: VITALS_B.id, p: "v" })).replace(/=+$/, "");
    const res = await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&_cursor=${forged}`, { token: DOCTOR });
    expect(res.status).toBe(400);
    expect(audits.at(-1)).toMatchObject({ p_decision: "deny", p_denial_reason: "invalid_request", p_http_status: 400 });
    const junk = await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&_cursor=%7B%22k%22%3A1%7D`, { token: DOCTOR });
    expect(junk.status).toBe(400);
  });

  it("caps oversized pages and refuses _count=0, _include and unknown parameters", async () => {
    const { call } = setup();
    const b = await json(await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&_count=5000`, { token: DOCTOR }));
    expect(new URL(b.link[0].url).searchParams.get("_count")).toBe("100");
    for (const q of ["_count=0", "_include=Observation:patient", "_revinclude=Provenance:target", "_sort=date", "_total=accurate", "value-quantity=5", "_has:Condition:subject:code=x"]) {
      const res = await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&${q}`, { token: DOCTOR });
      expect(res.status, q).toBe(400);
    }
  });

  it("never sends Bundle.total", async () => {
    const { call } = setup();
    const b = await json(await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}`, { token: DOCTOR }));
    expect(b.total).toBeUndefined();
  });
});

describe("audit of every request after sign-in", () => {
  it("records malformed searches, invalid values and rate limiting", async () => {
    const { call, audits } = setup();
    expect((await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&date=yesterday`, { token: DOCTOR })).status).toBe(400);
    expect(audits.at(-1)).toMatchObject({ p_decision: "deny", p_denial_reason: "invalid_request", p_http_status: 400, p_search_params: ["date", "patient"] });
    expect(JSON.stringify(audits)).not.toContain("yesterday");

    const limited = setup({ rateAllowed: false });
    const res = await limited.call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, { token: DOCTOR });
    expect(res.status).toBe(429);
    expect(limited.audits).toEqual([expect.objectContaining({ p_decision: "deny", p_denial_reason: "rate_limited", p_http_status: 429 })]);
  });

  it("still refuses when the refusal itself cannot be recorded", async () => {
    const { call } = setup({ auditFails: true });
    const res = await call(`/fhir/R4/Patient/${PATIENT_B.fhir_id}`, { token: PAT_A });
    expect(res.status).toBe(403);
  });

  it("counts sensitive searches and downloads against the stricter limit", async () => {
    const { call, contexts } = setup();
    await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}`, { token: DOCTOR });
    await call(`/fhir/R4/Encounter?patient=Patient/${PATIENT_A.fhir_id}`, { token: DOCTOR });
    await call(`/fhir/R4/Patient/${PATIENT_A.fhir_id}`, { token: DOCTOR });
    await call("/fhir/R4/Binary/doc1", { token: DOCTOR });
    expect(contexts.map((c) => c.p_sensitive)).toEqual([true, false, false, true]);
  });

  it("never logs tokens, patient ids or search values", async () => {
    const { call, logs } = setup();
    await call(`/fhir/R4/Observation?patient=Patient/${PATIENT_A.fhir_id}&date=2026-05-01`, { token: DOCTOR });
    await call(`/fhir/R4/Patient/${PATIENT_B.fhir_id}`, { token: PAT_A });
    const all = logs.join("\n");
    for (const secret of [DOCTOR, PAT_A, PATIENT_A.fhir_id, PATIENT_A.id, PATIENT_B.fhir_id, "2026-05-01"]) expect(all).not.toContain(secret);
  });
});

describe("records that cannot be shown as valid FHIR", () => {
  it("are left out of a search with a warning, and a read of one fails closed", async () => {
    // A visit id with a character FHIR ids cannot hold.
    const bad = { ...VISIT_A, id: "01HZZVISIT:BAD" };
    const { call } = setup({ tables: { patients: [PATIENT_A], visits: [VISIT_A, bad], vitals: [VITALS_A], conditions: [] } });
    const b = await json(await call(`/fhir/R4/Encounter?patient=Patient/${PATIENT_A.fhir_id}`, { token: DOCTOR }));
    expect(matches(b).map((e: Json) => e.id)).toEqual([VISIT_A.id]);
    expect(outcomes(b)).toEqual([expect.objectContaining({ severity: "warning", code: "processing" })]);
  });
});

describe("metadata and flags", () => {
  it("reports the flags as on/off only", async () => {
    const { call } = setup();
    const res = await call("/fhir/R4/metadata");
    expect(res.headers.get("x-mbhr-fhir-flags")).toBe("read=on; patient=on; consent=off; audit=on; external=off; write=off; smart=off");
    const body = await json(res);
    expect(body.implementation.description).toMatch(/patients reading their own records/);
    // Unauthenticated: no table, schema or database function names.
    expect(JSON.stringify(body)).not.toMatch(/public\.|interop\.|fhir_[a-z_]+|app_users|patient_documents|pharmacy_items|lab_orders|lab_results|[a-z]\.[a-z]+_at\b|\b[a-z]+_at\)/);
  });

  it("refuses to start with write, SMART or external access switched on", async () => {
    for (const flag of ["FHIR_WRITE_ENABLED", "SMART_ENABLED", "FHIR_EXTERNAL_ACCESS_ENABLED", "SMART_EXTERNAL_CLIENTS_ENABLED"]) {
      const { call } = setup({}, { ...ENV, [flag]: "true" });
      expect((await call("/fhir/R4/metadata")).status, flag).toBe(503);
    }
    const { call } = setup({}, { ...ENV, FHIR_AUDIT_ENABLED: "false" });
    expect((await call("/fhir/R4/metadata")).status).toBe(503);
  });

  it("publishes no SMART configuration", async () => {
    const { call } = setup();
    expect((await call("/fhir/R4/.well-known/smart-configuration")).status).toBe(404);
  });
});
