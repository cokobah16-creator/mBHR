// @vitest-environment node
//
// Staff directory and places: Practitioner, PractitionerRole, Organization
// and Location. Mapper rules (name as text only, active only when recorded,
// the role as a local access-role code, sites from the registry only),
// the Location status map, and the gateway end to end: staff only, every
// staff role may read, patients refused, searches narrowed, name searches
// literal, paging, and no account id, email, phone, credential or internal
// registry column in anything served.

import { describe, expect, it } from "vitest";
import { handleFhirRequest } from "../gateway/handler";
import {
  DIRECTORY_STATUS_MAPS,
  LOCATION_STATUS,
  STAFF_ROLES,
  STAFF_ROLE_SYSTEM,
  isNotAPlace,
  mapLocation,
  mapOrganization,
  mapPractitioner,
  mapPractitionerRole,
  nameMatches,
  normaliseNameSearch,
  recordedFlag,
  staffRoleConcept,
} from "../mappers/directory";
import { practitionerModule, practitionerReferences } from "../resources/practitioner";
import { practitionerRoleModule } from "../resources/practitionerRole";
import { organizationModule } from "../resources/organization";
import { locationModule } from "../resources/location";
import { MODULES } from "../resources/registry";
import type { QueryCtx } from "../resources/module";
import { Postgrest } from "../gateway/postgrest";
import { validateResource } from "../validation/validate";
import { applyStatusMap, explainStatus } from "../terminology/statusMaps";
import { fakeSupabase, makeToken, type FakeOptions, type FakeUser, type RpcHandler } from "./fakeSupabase";
import { PATIENT_A } from "./fixtures";

type Row = Record<string, unknown>;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------------------------------------------------------------------------
// Synthetic fixtures (no real people or organisations)
// ---------------------------------------------------------------------------

/** app_users rows, with the private columns production may have, present to prove none is published. */
const U_DOCTOR = {
  id: "a1b2c3d4-0000-4000-8000-0000000000d1", // an auth uid
  full_name: "Dr. Adaeze Obi",
  role: "doctor",
  email: "adaeze.obi@example.org",
  phone: "08011112222",
  admin_access: false,
  admin_permanent: false,
  otp_secret: "SECRET-OTP-SEED",
  wrapped_key: "WRAPPED-KEY-MATERIAL",
  created_at: "2026-01-05T09:00:00+00:00",
  updated_at: "2026-02-01T10:00:00+00:00",
};
const U_NURSE = {
  ...U_DOCTOR,
  id: "01HZZSTAFFNURSE00000000000", // a device ULID used as a staff id
  full_name: "Ngozi  Eze",
  role: "nurse",
  email: "ngozi@example.org",
  phone: "08033334444",
  is_active: true,
};
const U_PHARMACIST = {
  ...U_DOCTOR,
  id: "a1b2c3d4-0000-4000-8000-0000000000d3",
  full_name: "Musa Bello",
  role: "pharmacist",
  email: "musa@example.org",
  deactivated_at: "2026-06-01T00:00:00+00:00",
};
const U_VOL_1 = { ...U_DOCTOR, id: "a1b2c3d4-0000-4000-8000-0000000000d4", full_name: "Tunde Okoro", role: "volunteer" };
const U_VOL_2 = { ...U_DOCTOR, id: "a1b2c3d4-0000-4000-8000-0000000000d5", full_name: "Bisi Okoro", role: "volunteer" };
const U_VOL_LITERAL = { ...U_DOCTOR, id: "a1b2c3d4-0000-4000-8000-0000000000d6", full_name: "Kemi A_a", role: "volunteer" };
const U_GUEST = { ...U_DOCTOR, id: "a1b2c3d4-0000-4000-8000-0000000000d7", full_name: "Ada Guest", role: "guest" };
const U_CHW = { ...U_DOCTOR, id: "a1b2c3d4-0000-4000-8000-0000000000d8", full_name: "Ada Legacy", role: "chw" };
const APP_USERS: Row[] = [U_DOCTOR, U_NURSE, U_PHARMACIST, U_VOL_1, U_VOL_2, U_VOL_LITERAL, U_GUEST, U_CHW];

/** Published ids already minted (resource_links), including one for the guest (its role changed later). */
const PRE_MINTED: Record<string, string> = {
  [U_DOCTOR.id]: "9f000000-0000-4000-8000-000000000001",
  [U_NURSE.id]: "9f000000-0000-4000-8000-000000000002",
  [U_PHARMACIST.id]: "9f000000-0000-4000-8000-000000000003",
  [U_GUEST.id]: "9f000000-0000-4000-8000-000000000009",
};
const P_DOCTOR = PRE_MINTED[U_DOCTOR.id];
const P_NURSE = PRE_MINTED[U_NURSE.id];
const P_PHARMACIST = PRE_MINTED[U_PHARMACIST.id];
const P_GUEST = PRE_MINTED[U_GUEST.id];

const ORG_A = {
  id: "0a000000-0000-4000-8000-000000000001",
  name: "Example Health Outreach",
  slug: "example-health-slug",
  logo_url: "https://storage.example/logos/org-a.png",
  settings: { internal_flag: "SETTINGS-SECRET" },
  subscription_tier: "standard-tier-x",
  is_active: true,
  created_at: "2025-10-28T12:00:00+00:00",
  updated_at: "2026-03-01T12:00:00+00:00",
};
const ORG_B = { ...ORG_A, id: "0a000000-0000-4000-8000-000000000002", name: "Other Outreach Trust", slug: "other-trust", is_active: null };
const ORG_C = { ...ORG_A, id: "0a000000-0000-4000-8000-000000000003", name: "Riverside 100% Care_Group", slug: "riverside", is_active: false };

const SITE_A = {
  id: "5a000000-0000-4000-8000-000000000001",
  org_id: ORG_A.id,
  name: "Okpanam PHC",
  site_code: "SITECODE-OKP-01",
  address: "1 Clinic Road",
  state: "Delta",
  lga: "Oshimili North",
  typical_patient_volume: 213,
  capacity: 317,
  coordinates: { lat: 6.123456, lng: 6.654321 },
  is_active: true,
  created_at: "2025-10-28T12:00:00+00:00",
  updated_at: "2026-04-01T12:00:00+00:00",
};
const SITE_B = { ...SITE_A, id: "5a000000-0000-4000-8000-000000000002", name: "Ibusa School Ground", site_code: "SITECODE-IBU", is_active: false };
const SITE_C = { ...SITE_A, id: "5a000000-0000-4000-8000-000000000003", name: "Asaba Town Hall", site_code: "SITECODE-ASA", is_active: null };
const SITE_MOBILE = { ...SITE_A, id: "5a000000-0000-4000-8000-000000000004", name: "Mobile Clinic", site_code: "SITECODE-MOB" };
const SITE_PORTAL = { ...SITE_A, id: "5a000000-0000-4000-8000-000000000005", name: "Portal entry", site_code: "SITECODE-POR" };
const SITE_LITERAL = { ...SITE_A, id: "5a000000-0000-4000-8000-000000000006", name: "Clinic 50% Hall_B", site_code: "SITECODE-LIT" };

/** Anything that must never appear in a served resource. */
const FORBIDDEN = [
  ...APP_USERS.map((u) => String(u.id)),
  ...APP_USERS.map((u) => String(u.email)),
  "08011112222",
  "08033334444",
  "SECRET-OTP-SEED",
  "WRAPPED-KEY-MATERIAL",
  "Ada Guest",
  "Ada Legacy",
  "guest",
  "example-health-slug",
  "logos/org-a.png",
  "SETTINGS-SECRET",
  "standard-tier-x",
  "SITECODE",
  "6.123456",
  "6.654321",
  '"capacity"',
  '"typical_patient_volume"',
  '"coordinates"',
  '"site_code"',
  '"slug"',
  '"source_id"',
  '"email"',
  "app_users",
  "resource_links",
  "user_org_sites",
  PATIENT_A.id,
];

// ---------------------------------------------------------------------------
// A stand-in for public.fhir_staff_directory with the migration's rules
// ---------------------------------------------------------------------------

const STAFF_ROLE_LIST = ["admin", "doctor", "nurse", "pharmacist", "volunteer", "auditor", "lead_clinician", "registration_lead"];

function pgError(status: number, code: string): Response {
  return new Response(JSON.stringify({ code, message: "detail that must not leak: app_users" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Active as the function derives it from to_jsonb(u): an off-flag wins, an on-flag says true, else NULL. */
function activeOf(u: Row): boolean | null {
  const s = (k: string) => (u[k] === undefined || u[k] === null ? "" : String(u[k]));
  if (["false", "0"].includes(s("is_active")) || s("active") === "false" || s("disabled") === "true" || s("deactivated") === "true") return false;
  if (u.deactivated_at != null || u.disabled_at != null) return false;
  if (["true", "1"].includes(s("is_active")) || s("active") === "true") return true;
  return null;
}

function staffDirectory(users: Row[], links: Map<string, string>, calls: Record<string, unknown>[]): RpcHandler {
  let minted = 100;
  return (body, user) => {
    calls.push(body);
    if ((user.kind ?? (user.role ? "staff" : "none")) !== "staff") return pgError(403, "42501");
    const fhirIds = body.p_fhir_ids as string[] | null;
    const sourceIds = body.p_source_ids as string[] | null;
    const name = body.p_name as string | null;
    const role = body.p_role as string | null;
    const after = body.p_after as string | null;
    const selectors = [fhirIds, sourceIds, name, role].filter((v) => v !== null && v !== undefined).length;
    const idsOk = (a: string[] | null, re: RegExp) => a === null || a === undefined || (a.length <= 200 && a.every((v) => re.test(v)));
    if (
      selectors > 1 ||
      !idsOk(fhirIds, /^[A-Za-z0-9.-]{1,64}$/) ||
      !idsOk(sourceIds, /^[A-Za-z0-9._-]{1,128}$/) ||
      (after != null && !/^[A-Za-z0-9.-]{1,64}$/.test(after)) ||
      (role != null && !/^[a-z_]{1,40}$/.test(role))
    ) {
      return pgError(400, "22023");
    }
    // LIKE '<value>%' with %, _ and \ escaped: the value matches literally.
    let needle: string | null = null;
    if (name != null) {
      needle = name.trim().replace(/\s+/g, " ").toLowerCase();
      if (needle.length < 2 || needle.length > 64) return pgError(400, "22023");
    }
    const limit = Math.min(Math.max(Number(body.p_limit ?? 20), 1), 101);
    const matchName = (u: Row) => {
      if (needle === null) return true;
      const hay = String(u.full_name).replace(/\s+/g, " ").toLowerCase();
      return hay.startsWith(needle) || hay.includes(` ${needle}`);
    };
    const candidates = users.filter(
      (u) =>
        STAFF_ROLE_LIST.includes(String(u.role)) &&
        (role == null || u.role === role) &&
        (sourceIds == null || sourceIds.includes(String(u.id))) &&
        matchName(u),
    );
    if (fhirIds == null) {
      for (const u of candidates) {
        if (!links.has(String(u.id))) links.set(String(u.id), `9f000000-0000-4000-8000-${String(minted++).padStart(12, "0")}`);
      }
    }
    return candidates
      .filter((u) => links.has(String(u.id)))
      .map((u) => ({ u, fhir_id: links.get(String(u.id)) as string }))
      .filter(({ fhir_id }) => fhirIds == null || fhirIds.includes(fhir_id))
      .filter(({ fhir_id }) => after == null || fhir_id > after)
      .sort((a, b) => (a.fhir_id < b.fhir_id ? -1 : 1))
      .slice(0, limit)
      .map(({ u, fhir_id }) => ({
        fhir_id,
        source_id: sourceIds != null ? String(u.id) : null,
        full_name: u.full_name,
        role: u.role,
        active: activeOf(u),
        created_at: u.created_at ?? null,
        updated_at: u.updated_at ?? null,
      }));
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
const VOLUNTEER = makeToken("vol-1");
const AUDITOR = makeToken("audit-1");
const REG_LEAD = makeToken("reg-1");
const OUTSIDER = makeToken("outsider-1");
const GUEST = makeToken("guest-1");
const NO_PERMS = makeToken("noperm-1");
const PAT_A = makeToken("portal-a");

const USERS: Record<string, FakeUser> = {
  [DOCTOR]: { id: "doctor-1", role: "doctor", permissions: ["consult", "lab_review", "register", "vitals", "queue"] },
  [PHARMACIST]: { id: "pharm-1", role: "pharmacist", permissions: ["dispense", "inventory", "queue"] },
  [VOLUNTEER]: { id: "vol-1", role: "volunteer", permissions: ["register", "vitals", "queue", "portal_manage"] },
  [AUDITOR]: { id: "audit-1", role: "auditor", permissions: ["export", "approve_phi_conflicts", "audit_access", "resolve_conflicts", "merge_patients"] },
  [REG_LEAD]: { id: "reg-1", role: "registration_lead", permissions: ["register", "queue", "portal_manage", "portal_invite"] },
  [OUTSIDER]: { id: "outsider-1", role: "nurse", permissions: ["register", "vitals", "queue"] },
  [GUEST]: { id: "guest-1", role: null, permissions: [], kind: "none" },
  [NO_PERMS]: { id: "noperm-1", role: "guest", permissions: [], kind: "staff" },
  [PAT_A]: { id: "portal-a", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_A.id] },
};

/** Organisation membership (user_org_sites), as the organisation RLS policy reads it. */
const MEMBERS: Record<string, string[]> = {
  "doctor-1": [ORG_A.id, ORG_B.id, ORG_C.id],
  "pharm-1": [ORG_A.id],
  "vol-1": [ORG_A.id],
  "audit-1": [ORG_A.id],
  "reg-1": [ORG_A.id],
};

/** RLS: organisations to members; sites active to everyone, inactive to members of the owning org. */
function visible(table: string, row: Row, user: FakeUser): boolean {
  const orgs = MEMBERS[user.id] ?? [];
  if (table === "organizations") return orgs.includes(String(row.id));
  if (table === "sites") return row.is_active === true || orgs.includes(String(row.org_id));
  return true;
}

function setup(overrides: Partial<FakeOptions> = {}) {
  const directoryCalls: Record<string, unknown>[] = [];
  const links = new Map(Object.entries(PRE_MINTED));
  const fake = fakeSupabase({
    users: USERS,
    tables: {
      patients: [PATIENT_A],
      organizations: [ORG_A, ORG_B, ORG_C],
      sites: [SITE_A, SITE_B, SITE_C, SITE_MOBILE, SITE_PORTAL, SITE_LITERAL],
    },
    visible,
    rpcs: { fhir_staff_directory: staffDirectory(APP_USERS, links, directoryCalls) },
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
  return { ...fake, call, logs, directoryCalls, links };
}

async function json(res: Response): Promise<Json> {
  return (await res.json()) as Json;
}

function matches(bundle: Json): Json[] {
  return (bundle.entry ?? []).filter((e: Json) => e.search?.mode === "match").map((e: Json) => e.resource);
}

function expectClean(served: unknown): void {
  const text = JSON.stringify(served);
  for (const secret of FORBIDDEN) expect(text, secret).not.toContain(secret);
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

const DIR_ROW = {
  fhir_id: P_DOCTOR,
  full_name: "Dr. Adaeze Obi",
  role: "doctor",
  active: null,
  created_at: "2026-01-05T09:00:00+00:00",
  updated_at: "2026-02-01T10:00:00+00:00",
};

describe("Practitioner mapper", () => {
  it("publishes the minted id and the name as text only", () => {
    expect(mapPractitioner(DIR_ROW)).toEqual({
      resourceType: "Practitioner",
      id: P_DOCTOR,
      meta: {
        versionId: String(Date.parse("2026-02-01T10:00:00Z")),
        lastUpdated: "2026-02-01T10:00:00.000Z",
        source: "https://mbhr.app",
      },
      name: [{ text: "Dr. Adaeze Obi" }],
    });
  });

  it("publishes active only when the account records it (unknown stays unknown)", () => {
    expect(mapPractitioner(DIR_ROW)?.active).toBeUndefined();
    expect(mapPractitioner({ ...DIR_ROW, active: true })?.active).toBe(true);
    expect(mapPractitioner({ ...DIR_ROW, active: false })?.active).toBe(false);
    // Anything that is not a recorded boolean is unknown, never true or false.
    for (const v of [undefined, null, "true", "false", 1, 0, ""]) {
      expect(mapPractitioner({ ...DIR_ROW, active: v })?.active, String(v)).toBeUndefined();
    }
    expect(recordedFlag(null)).toBeUndefined();
    expect(recordedFlag(false)).toBe(false);
  });

  it("never publishes the account id, even when the row carries it", () => {
    const p = mapPractitioner({ ...DIR_ROW, source_id: U_DOCTOR.id, email: U_DOCTOR.email, phone: U_DOCTOR.phone });
    expect(JSON.stringify(p)).not.toContain(U_DOCTOR.id);
    expect(JSON.stringify(p)).not.toContain("example.org");
    expect(JSON.stringify(p)).not.toContain("0801");
    expect(p).not.toHaveProperty("identifier");
    expect(p).not.toHaveProperty("telecom");
    expect(p).not.toHaveProperty("qualification");
  });

  it("withholds guest, legacy and unknown roles, rows without a valid id, and rows without a name", () => {
    for (const role of ["guest", "chw", "Doctor", "superuser", "", null, undefined]) {
      expect(mapPractitioner({ ...DIR_ROW, role }), String(role)).toBeNull();
    }
    expect(mapPractitioner({ ...DIR_ROW, fhir_id: "not/valid" })).toBeNull();
    expect(mapPractitioner({ ...DIR_ROW, fhir_id: null })).toBeNull();
    expect(mapPractitioner({ ...DIR_ROW, full_name: "  " })).toBeNull();
    expect(mapPractitioner({ ...DIR_ROW, full_name: null })).toBeNull();
  });

  it("never invents a time", () => {
    expect(mapPractitioner({ ...DIR_ROW, created_at: null, updated_at: null })?.meta).toEqual({ versionId: "0", source: "https://mbhr.app" });
  });
});

describe("PractitionerRole mapper", () => {
  it("publishes the access role as a local code, the Practitioner, and nothing else", () => {
    expect(mapPractitionerRole(DIR_ROW)).toEqual({
      resourceType: "PractitionerRole",
      id: P_DOCTOR,
      meta: expect.objectContaining({ lastUpdated: "2026-02-01T10:00:00.000Z" }),
      practitioner: { reference: `Practitioner/${P_DOCTOR}`, display: "Dr. Adaeze Obi" },
      code: [
        {
          coding: [{ system: "https://mbhr.app/codes/staff-role", code: "doctor", display: "Doctor" }],
          text: "mBHR access role: Doctor",
        },
      ],
    });
    const r = mapPractitionerRole(DIR_ROW);
    for (const k of ["organization", "location", "specialty", "period", "active"]) expect(r).not.toHaveProperty(k);
  });

  it("covers the 8 staff roles, in plain words", () => {
    expect(Object.keys(STAFF_ROLES).sort()).toEqual([...STAFF_ROLE_LIST].sort());
    expect(STAFF_ROLES.lead_clinician).toBe("Lead clinician");
    expect(STAFF_ROLES.registration_lead).toBe("Registration lead");
    for (const role of STAFF_ROLE_LIST) {
      const c = staffRoleConcept(role);
      expect(c?.coding?.[0]).toEqual({ system: STAFF_ROLE_SYSTEM, code: role, display: STAFF_ROLES[role] });
      // Never a standard practitioner code (the role is not a qualification).
      expect(JSON.stringify(c)).not.toMatch(/snomed|terminology\.hl7\.org|v2-/i);
    }
  });

  it("never maps guest, legacy or unknown roles to a staff role", () => {
    for (const role of ["guest", "chw", "lab_tech", "ADMIN", " doctor", "", null, 7]) {
      expect(staffRoleConcept(role), String(role)).toBeNull();
      expect(mapPractitionerRole({ ...DIR_ROW, role }), String(role)).toBeNull();
    }
  });

  it("carries active only when recorded", () => {
    expect(mapPractitionerRole({ ...DIR_ROW, active: false })?.active).toBe(false);
    expect(mapPractitionerRole({ ...DIR_ROW, active: true })?.active).toBe(true);
    expect(mapPractitionerRole({ ...DIR_ROW, active: null })?.active).toBeUndefined();
    expect(mapPractitionerRole({ ...DIR_ROW, active: "false" })?.active).toBeUndefined();
  });

  it("is withheld whenever its Practitioner is (no dangling reference)", () => {
    for (const row of [
      { ...DIR_ROW, full_name: null },
      { ...DIR_ROW, full_name: " " },
      { ...DIR_ROW, fhir_id: "a/b" },
      { ...DIR_ROW, role: "guest" },
    ]) {
      expect(mapPractitioner(row)).toBeNull();
      expect(mapPractitionerRole(row)).toBeNull();
    }
  });
});

describe("Organization mapper", () => {
  it("publishes id, name and the recorded active flag only", () => {
    expect(mapOrganization(ORG_A)).toEqual({
      resourceType: "Organization",
      id: ORG_A.id,
      meta: {
        versionId: String(Date.parse("2026-03-01T12:00:00Z")),
        lastUpdated: "2026-03-01T12:00:00.000Z",
        source: "https://mbhr.app",
      },
      name: "Example Health Outreach",
      active: true,
    });
    expect(mapOrganization(ORG_C)?.active).toBe(false);
    // Not recorded: left out, never assumed true.
    expect(mapOrganization(ORG_B)?.active).toBeUndefined();
    expectClean(mapOrganization(ORG_A));
  });

  it("withholds a row with no name (org-1) or no valid id", () => {
    expect(mapOrganization({ ...ORG_A, name: " " })).toBeNull();
    expect(mapOrganization({ ...ORG_A, id: "DIOF" })).toBeNull();
  });
});

describe("Location mapper", () => {
  it("maps name, status, address and the owning organisation; nothing else", () => {
    expect(mapLocation(SITE_A)).toEqual({
      resourceType: "Location",
      id: SITE_A.id,
      meta: {
        versionId: String(Date.parse("2026-04-01T12:00:00Z")),
        lastUpdated: "2026-04-01T12:00:00.000Z",
        source: "https://mbhr.app",
      },
      name: "Okpanam PHC",
      mode: "instance",
      status: "active",
      address: { text: "1 Clinic Road", district: "Oshimili North", state: "Delta" },
      managingOrganization: { reference: `Organization/${ORG_A.id}` },
    });
    expectClean(mapLocation(SITE_A));
    const l = mapLocation(SITE_A);
    for (const k of ["type", "physicalType", "position", "identifier", "telecom", "hoursOfOperation"]) expect(l).not.toHaveProperty(k);
  });

  it("status: active, inactive, or left out when not recorded (never assumed active)", () => {
    expect(mapLocation(SITE_B)?.status).toBe("inactive");
    expect(mapLocation(SITE_C)?.status).toBeUndefined();
    for (const v of [undefined, "yes", 1, "TRUE"]) expect(mapLocation({ ...SITE_A, is_active: v })?.status, String(v)).toBeUndefined();
  });

  it("never publishes the tablet placeholders as places", () => {
    expect(mapLocation(SITE_MOBILE)).toBeNull();
    expect(mapLocation(SITE_PORTAL)).toBeNull();
    expect(mapLocation({ ...SITE_A, name: "  mobile CLINIC " })).toBeNull();
    expect(isNotAPlace("Portal Entry")).toBe(true);
    expect(isNotAPlace("Okpanam PHC")).toBe(false);
  });

  it("leaves out what is not recorded and withholds a row with no name or id", () => {
    expect(mapLocation({ ...SITE_A, address: "", lga: null, state: " " })?.address).toBeUndefined();
    expect(mapLocation({ ...SITE_A, address: null })?.address).toEqual({ district: "Oshimili North", state: "Delta" });
    expect(mapLocation({ ...SITE_A, org_id: null })?.managingOrganization).toBeUndefined();
    expect(mapLocation({ ...SITE_A, name: null })).toBeNull();
    expect(mapLocation({ ...SITE_A, id: "01HZZDEVICESITE" })).toBeNull();
  });
});

describe("Location.status map", () => {
  it("maps each recorded value and falls back to nothing", () => {
    expect(applyStatusMap(LOCATION_STATUS, "true")).toBe("active");
    expect(applyStatusMap(LOCATION_STATUS, "false")).toBe("inactive");
    expect(explainStatus(LOCATION_STATUS, "false").reason).toMatch(/Not suspended/);
    expect(applyStatusMap(LOCATION_STATUS, null)).toBeNull();
    expect(applyStatusMap(LOCATION_STATUS, "")).toBeNull();
    expect(applyStatusMap(LOCATION_STATUS, "planned")).toBeNull();
    expect(LOCATION_STATUS.missing.fhir).toBeNull();
    expect(LOCATION_STATUS.unrecognised.fhir).toBeNull();
  });

  it("follows the rules every status map keeps (as __tests__/statusMaps.test.ts checks)", () => {
    for (const m of DIRECTORY_STATUS_MAPS) {
      expect(m.valueSet).toMatch(/^http:\/\/hl7\.org\/fhir\/ValueSet\//);
      for (const r of m.rules) {
        expect(m.allowed).toContain(r.fhir);
        expect(r.reason.length).toBeGreaterThan(10);
        for (const s of r.source) expect(s).toBe(s.toLowerCase());
      }
      const all = m.rules.flatMap((r) => [...r.source]);
      expect(new Set(all).size).toBe(all.length);
      for (const fb of [m.missing, m.unrecognised]) expect(fb.fhir === null || fb.fhir === "unknown").toBe(true);
      for (const raw of [null, undefined, "", "somethingnew", 0, false]) expect(applyStatusMap(m, raw)).toBeNull();
    }
    // A switched-off site is never shown as active.
    expect(applyStatusMap(LOCATION_STATUS, "false")).not.toBe("active");
  });
});

describe("name search values", () => {
  it("normalises and bounds the value", () => {
    expect(normaliseNameSearch("  Ada   Obi ")).toBe("Ada Obi");
    expect(normaliseNameSearch("Dr.")).toBe("Dr.");
    expect(normaliseNameSearch("O'Neil")).toBe("O'Neil");
    expect(normaliseNameSearch("50%")).toBe("50%");
    expect(normaliseNameSearch("A_a")).toBe("A_a");
    for (const bad of ["a", " a ", "x".repeat(65), "ad*", "ad\\", 'a"b', "a;b", "a\u0000b"]) {
      expect(normaliseNameSearch(bad), bad).toBeNull();
    }
  });

  it("matches the start of the name or of any word, case-insensitively", () => {
    expect(nameMatches("Dr. Adaeze Obi", "ada")).toBe(true);
    expect(nameMatches("Dr. Adaeze Obi", "OBI")).toBe(true);
    expect(nameMatches("Ngozi  Eze", "ngozi eze")).toBe(true);
    expect(nameMatches("Dr. Adaeze Obi", "daeze")).toBe(false);
    expect(nameMatches("Kemi A_a", "a_a")).toBe(true);
    expect(nameMatches("Kemi Aba", "a_a")).toBe(false);
    expect(nameMatches(null, "ad")).toBe(false);
  });
});

describe("module validation", () => {
  const check = (resource: unknown, module: typeof practitionerModule) => validateResource(resource, module.validate?.bind(module));

  it("accepts what the mappers produce", () => {
    expect(check(mapPractitioner(DIR_ROW), practitionerModule)).toEqual([]);
    expect(check(mapPractitionerRole({ ...DIR_ROW, active: false }), practitionerRoleModule)).toEqual([]);
    expect(check(mapOrganization(ORG_A), organizationModule)).toEqual([]);
    expect(check(mapLocation(SITE_A), locationModule)).toEqual([]);
    expect(check(mapLocation(SITE_C), locationModule)).toEqual([]);
  });

  it("refuses resources that break the directory's rules", () => {
    const p = mapPractitioner(DIR_ROW) as Json;
    expect(check({ ...p, telecom: [{ system: "email", value: "x@example.org" }] }, practitionerModule).map((i) => i.path)).toContain("telecom");
    expect(check({ ...p, identifier: [{ value: U_DOCTOR.id }] }, practitionerModule).map((i) => i.path)).toContain("identifier");
    expect(check({ ...p, name: [{ family: "Obi", given: ["Adaeze"], text: "Adaeze Obi" }] }, practitionerModule).map((i) => i.path)).toContain("name");
    expect(check({ ...p, active: "yes" }, practitionerModule).map((i) => i.path)).toContain("active");
    const r = mapPractitionerRole(DIR_ROW) as Json;
    expect(check({ ...r, practitioner: { reference: `Practitioner/${P_NURSE}` } }, practitionerRoleModule).map((i) => i.path)).toContain("practitioner");
    expect(check({ ...r, code: [{ coding: [{ system: STAFF_ROLE_SYSTEM, code: "guest" }] }] }, practitionerRoleModule).map((i) => i.path)).toContain("code");
    expect(check({ ...r, organization: { reference: `Organization/${ORG_A.id}` } }, practitionerRoleModule).map((i) => i.path)).toContain("organization");
    const o = mapOrganization(ORG_A) as Json;
    expect(check({ ...o, name: undefined }, organizationModule).map((i) => i.path)).toContain("name");
    const l = mapLocation(SITE_A) as Json;
    expect(check({ ...l, status: "suspended-ish" }, locationModule).map((i) => i.path)).toContain("status");
    expect(check({ ...l, managingOrganization: { reference: `Patient/${PATIENT_A.fhir_id}` } }, locationModule).map((i) => i.path)).toContain("managingOrganization");
    expect(check({ ...l, position: { latitude: 6.1, longitude: 6.6 } }, locationModule).map((i) => i.path)).toContain("position");
  });
});

// ---------------------------------------------------------------------------
// Gateway: Practitioner
// ---------------------------------------------------------------------------

describe("Practitioner at the gateway", () => {
  it("reads a staff member by the minted id: name only", async () => {
    const { call, audits } = setup();
    const res = await call(`/fhir/R4/Practitioner/${P_DOCTOR}`, DOCTOR);
    expect(res.status).toBe(200);
    const p = await json(res);
    expect(p).toMatchObject({ resourceType: "Practitioner", id: P_DOCTOR, name: [{ text: "Dr. Adaeze Obi" }] });
    expect(p.active).toBeUndefined();
    expectClean(p);
    // Not patient data: the audit names no patient.
    expect(audits.at(-1)).toMatchObject({ p_decision: "permit", p_resource_type: "Practitioner", p_patient_ids: [] });
  });

  it("publishes active only when recorded: true, or false when switched off", async () => {
    const { call } = setup();
    expect((await json(await call(`/fhir/R4/Practitioner/${P_NURSE}`, DOCTOR))).active).toBe(true);
    expect((await json(await call(`/fhir/R4/Practitioner/${P_PHARMACIST}`, DOCTOR))).active).toBe(false);
  });

  it("every staff role may read the directory", async () => {
    const { call } = setup();
    for (const token of [DOCTOR, PHARMACIST, VOLUNTEER, AUDITOR, REG_LEAD, OUTSIDER]) {
      expect((await call(`/fhir/R4/Practitioner/${P_DOCTOR}`, token)).status).toBe(200);
      expect((await call(`/fhir/R4/Practitioner?name=okoro`, token)).status).toBe(200);
    }
  });

  it("a guest or an account with no permission is refused before the directory is asked", async () => {
    const { call, directoryCalls, audits } = setup();
    expect((await call(`/fhir/R4/Practitioner/${P_DOCTOR}`, GUEST)).status).toBe(403);
    expect((await call(`/fhir/R4/Practitioner?name=ada`, NO_PERMS)).status).toBe(403);
    expect(directoryCalls).toHaveLength(0);
    expect(audits.map((a) => a.p_decision)).toEqual(["deny", "deny"]);
  });

  it("a guest's id (its role changed after the id was minted) is not found", async () => {
    const { call } = setup();
    const res = await call(`/fhir/R4/Practitioner/${P_GUEST}`, DOCTOR);
    expect(res.status).toBe(404);
    expectClean(await json(res));
  });

  it("unknown and malformed ids: 404 or 400, saying nothing about the directory", async () => {
    const { call } = setup();
    const unknown = await call("/fhir/R4/Practitioner/9f000000-0000-4000-8000-0000000000ff", DOCTOR);
    expect(unknown.status).toBe(404);
    // An account id is not a published id.
    expect((await call(`/fhir/R4/Practitioner/${U_DOCTOR.id}`, DOCTOR)).status).toBe(404);
    const bad = await call("/fhir/R4/Practitioner/bad_id!", DOCTOR);
    expect(bad.status).toBe(400);
    for (const r of [await json(unknown), await json(bad)]) expectClean(r);
  });

  it("searches by name: start of any word, staff roles only", async () => {
    const { call, directoryCalls } = setup();
    const b = await json(await call("/fhir/R4/Practitioner?name=ada", DOCTOR));
    // "Ada Guest" (guest) and "Ada Legacy" (legacy role) never appear.
    expect(matches(b).map((p) => p.name[0].text)).toEqual(["Dr. Adaeze Obi"]);
    expectClean(b);
    expect(directoryCalls.at(-1)).toMatchObject({ p_name: "ada", p_fhir_ids: null, p_source_ids: null, p_role: null });
    const obi = await json(await call("/fhir/R4/Practitioner?name=OBI", DOCTOR));
    expect(matches(obi).map((p) => p.id)).toEqual([P_DOCTOR]);
    const spaced = await json(await call("/fhir/R4/Practitioner?name=ngozi%20%20eze", DOCTOR));
    expect(matches(spaced).map((p) => p.id)).toEqual([P_NURSE]);
    // Never looks anyone up by account id from a search.
    expect(directoryCalls.every((c) => c.p_source_ids === null)).toBe(true);
  });

  it("a name with % or _ is matched literally, not as a wildcard", async () => {
    const { call } = setup();
    expect(matches(await json(await call("/fhir/R4/Practitioner?name=A%25", DOCTOR)))).toEqual([]);
    const underscore = await json(await call("/fhir/R4/Practitioner?name=A_a", DOCTOR));
    // "Adaeze" would match A_a as a wildcard; only "Kemi A_a" matches literally.
    expect(matches(underscore).map((p) => p.name[0].text)).toEqual(["Kemi A_a"]);
  });

  it("refuses a name that is too short, too long or carries * or \\", async () => {
    const { call, directoryCalls } = setup();
    for (const v of ["a", "x".repeat(65), "ad*", "ad%5C"]) {
      const res = await call(`/fhir/R4/Practitioner?name=${v}`, DOCTOR);
      expect(res.status, v).toBe(400);
    }
    expect(directoryCalls).toHaveLength(0);
  });

  it("filters active only where the flag is recorded", async () => {
    const { call } = setup();
    const off = await json(await call(`/fhir/R4/Practitioner?_id=${P_PHARMACIST}&active=false`, DOCTOR));
    expect(matches(off).map((p) => p.id)).toEqual([P_PHARMACIST]);
    expect(matches(await json(await call(`/fhir/R4/Practitioner?_id=${P_PHARMACIST}&active=true`, DOCTOR)))).toEqual([]);
    // No flag recorded: matches neither true nor false.
    expect(matches(await json(await call(`/fhir/R4/Practitioner?_id=${P_DOCTOR}&active=true`, DOCTOR)))).toEqual([]);
    expect(matches(await json(await call(`/fhir/R4/Practitioner?_id=${P_DOCTOR}&active=false`, DOCTOR)))).toEqual([]);
    expect((await call(`/fhir/R4/Practitioner?name=musa&active=maybe`, DOCTOR)).status).toBe(400);
  });

  it("applies _id and name together", async () => {
    const { call } = setup();
    expect(matches(await json(await call(`/fhir/R4/Practitioner?_id=${P_DOCTOR}&name=adaeze`, DOCTOR))).map((p) => p.id)).toEqual([P_DOCTOR]);
    expect(matches(await json(await call(`/fhir/R4/Practitioner?_id=${P_DOCTOR}&name=musa`, DOCTOR)))).toEqual([]);
  });

  it("refuses a search that names no record, and parameters it does not support", async () => {
    const { call, directoryCalls } = setup();
    for (const path of ["/fhir/R4/Practitioner", "/fhir/R4/Practitioner?active=true", "/fhir/R4/Practitioner?_count=5"]) {
      expect((await call(path, DOCTOR)).status, path).toBe(403);
    }
    for (const path of [
      "/fhir/R4/Practitioner?identifier=x",
      `/fhir/R4/Practitioner?email=${encodeURIComponent(U_DOCTOR.email)}`,
      "/fhir/R4/Practitioner?role=doctor",
      `/fhir/R4/Practitioner?patient=Patient/${PATIENT_A.fhir_id}`,
    ]) {
      expect((await call(path, DOCTOR)).status, path).toBe(400);
    }
    expect(directoryCalls).toHaveLength(0);
  });

  it("pages through a name search with bound cursors", async () => {
    const { call } = setup();
    const first = await json(await call("/fhir/R4/Practitioner?name=okoro&_count=1", DOCTOR));
    expect(matches(first)).toHaveLength(1);
    const next = first.link.find((l: Json) => l.relation === "next")?.url as string;
    expect(next).toBeTruthy();
    const second = await json(await call(new URL(next).pathname + new URL(next).search, DOCTOR));
    expect(matches(second)).toHaveLength(1);
    expect(second.link.some((l: Json) => l.relation === "next")).toBe(false);
    expect(new Set([...matches(first), ...matches(second)].map((p) => p.name[0].text))).toEqual(new Set(["Tunde Okoro", "Bisi Okoro"]));
    // The cursor only continues its own search.
    const cursor = new URL(next).searchParams.get("_cursor") as string;
    expect((await call(`/fhir/R4/Practitioner?name=adaeze&_cursor=${cursor}`, DOCTOR)).status).toBe(400);
    expectClean([first, second]);
  });

  it("a patient is refused, whatever the flag says, and the directory is never asked", async () => {
    const { call, directoryCalls } = setup();
    for (const path of [`/fhir/R4/Practitioner/${P_DOCTOR}`, "/fhir/R4/Practitioner?name=ada", `/fhir/R4/PractitionerRole/${P_DOCTOR}`, "/fhir/R4/PractitionerRole?role=doctor"]) {
      const res = await call(path, PAT_A);
      expect(res.status, path).toBe(403);
      expectClean(await json(res));
    }
    expect(directoryCalls).toHaveLength(0);
  });

  it("a database refusal or failure says nothing about the database", async () => {
    const refused = setup({ rpcs: { fhir_staff_directory: () => pgError(403, "42501") } });
    const r1 = await refused.call(`/fhir/R4/Practitioner/${P_DOCTOR}`, DOCTOR);
    expect(r1.status).toBe(403);
    expectClean(await json(r1));
    const broken = setup({ rpcs: { fhir_staff_directory: () => pgError(404, "PGRST202") } });
    const r2 = await broken.call("/fhir/R4/Practitioner?name=ada", DOCTOR);
    expect(r2.status).toBe(503);
    expectClean(await json(r2));
    // A row without a valid published id is a broken contract, not a page.
    const odd = setup({ rpcs: { fhir_staff_directory: () => [{ ...DIR_ROW, fhir_id: U_DOCTOR.id + "/x" }] } });
    expect((await odd.call("/fhir/R4/Practitioner?name=ada", DOCTOR)).status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Gateway: PractitionerRole
// ---------------------------------------------------------------------------

describe("PractitionerRole at the gateway", () => {
  it("reads the role under the Practitioner's id", async () => {
    const { call } = setup();
    const r = await json(await call(`/fhir/R4/PractitionerRole/${P_NURSE}`, PHARMACIST));
    expect(r).toMatchObject({
      resourceType: "PractitionerRole",
      id: P_NURSE,
      active: true,
      practitioner: { reference: `Practitioner/${P_NURSE}`, display: "Ngozi  Eze" },
      code: [{ coding: [{ system: STAFF_ROLE_SYSTEM, code: "nurse", display: "Nurse" }] }],
    });
    expectClean(r);
    expect((await call(`/fhir/R4/PractitionerRole/${P_GUEST}`, DOCTOR)).status).toBe(404);
  });

  it("searches by role (local system or none); guest and foreign systems match nothing", async () => {
    const { call, directoryCalls } = setup();
    const vols = await json(await call("/fhir/R4/PractitionerRole?role=volunteer", DOCTOR));
    expect(matches(vols).map((r) => r.practitioner.display).sort()).toEqual(["Bisi Okoro", "Kemi A_a", "Tunde Okoro"]);
    expectClean(vols);
    const sys = await json(await call(`/fhir/R4/PractitionerRole?role=${encodeURIComponent(`${STAFF_ROLE_SYSTEM}|doctor`)}`, DOCTOR));
    expect(matches(sys).map((r) => r.id)).toEqual([P_DOCTOR]);
    const before = directoryCalls.length;
    for (const role of ["guest", "chw", "surgeon", encodeURIComponent("http://snomed.info/sct|doctor"), encodeURIComponent("|doctor")]) {
      const b = await json(await call(`/fhir/R4/PractitionerRole?role=${role}`, DOCTOR));
      expect(matches(b), role).toEqual([]);
    }
    // Nothing that is not a staff role is ever sent to the database.
    expect(directoryCalls.length).toBe(before);
  });

  it("searches by practitioner, and combines _id, practitioner and role", async () => {
    const { call } = setup();
    const byRef = await json(await call(`/fhir/R4/PractitionerRole?practitioner=Practitioner/${P_PHARMACIST}`, DOCTOR));
    expect(matches(byRef).map((r) => [r.id, r.active])).toEqual([[P_PHARMACIST, false]]);
    expect(matches(await json(await call(`/fhir/R4/PractitionerRole?practitioner=${P_PHARMACIST}&role=pharmacist`, DOCTOR)))).toHaveLength(1);
    expect(matches(await json(await call(`/fhir/R4/PractitionerRole?practitioner=${P_PHARMACIST}&role=doctor`, DOCTOR)))).toEqual([]);
    expect(matches(await json(await call(`/fhir/R4/PractitionerRole?_id=${P_DOCTOR}&practitioner=${P_NURSE}`, DOCTOR)))).toEqual([]);
    expect((await call(`/fhir/R4/PractitionerRole?practitioner=Patient/${PATIENT_A.fhir_id}`, DOCTOR)).status).toBe(400);
  });

  it("refuses a search that names no record", async () => {
    const { call } = setup();
    expect((await call("/fhir/R4/PractitionerRole", DOCTOR)).status).toBe(403);
    expect((await call("/fhir/R4/PractitionerRole?_count=10", DOCTOR)).status).toBe(403);
    expect((await call("/fhir/R4/PractitionerRole?name=ada", DOCTOR)).status).toBe(400);
  });

  it("pages through a role search", async () => {
    const { call } = setup();
    const seen: string[] = [];
    let path: string | null = "/fhir/R4/PractitionerRole?role=volunteer&_count=2";
    for (let i = 0; path && i < 5; i++) {
      const b = await json(await call(path, DOCTOR));
      seen.push(...matches(b).map((r) => r.id as string));
      const next = b.link.find((l: Json) => l.relation === "next")?.url as string | undefined;
      path = next ? new URL(next).pathname + new URL(next).search : null;
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Gateway: Organization and Location
// ---------------------------------------------------------------------------

describe("Organization at the gateway", () => {
  it("reads a member's organisation: id, name, active", async () => {
    const { call } = setup();
    const res = await call(`/fhir/R4/Organization/${ORG_A.id}`, VOLUNTEER);
    expect(res.status).toBe(200);
    const o = await json(res);
    expect(o).toMatchObject({ resourceType: "Organization", id: ORG_A.id, name: ORG_A.name, active: true });
    expectClean(o);
  });

  it("row-level security decides: a non-member finds nothing", async () => {
    const { call } = setup();
    expect((await call(`/fhir/R4/Organization/${ORG_A.id}`, OUTSIDER)).status).toBe(404);
    expect(matches(await json(await call("/fhir/R4/Organization?name=example", OUTSIDER)))).toEqual([]);
  });

  it("searches by name (start of any word; % and _ literal)", async () => {
    const { call } = setup();
    const all = await json(await call("/fhir/R4/Organization?name=outreach", DOCTOR));
    expect(matches(all).map((o) => o.id)).toEqual([ORG_A.id, ORG_B.id]);
    expect(matches(all)[1].active).toBeUndefined();
    expect(matches(await json(await call("/fhir/R4/Organization?name=100%25", DOCTOR))).map((o) => o.id)).toEqual([ORG_C.id]);
    expect(matches(await json(await call("/fhir/R4/Organization?name=1%25", DOCTOR)))).toEqual([]);
    expect(matches(await json(await call("/fhir/R4/Organization?name=Ri_er", DOCTOR)))).toEqual([]);
    expect(matches(await json(await call("/fhir/R4/Organization?name=care_group", DOCTOR))).map((o) => o.id)).toEqual([ORG_C.id]);
    expectClean(all);
  });

  it("refuses unnarrowed searches, bad names and a patient; bad ids find nothing", async () => {
    const { call } = setup();
    expect((await call("/fhir/R4/Organization", DOCTOR)).status).toBe(403);
    expect((await call("/fhir/R4/Organization?name=e", DOCTOR)).status).toBe(400);
    expect((await call("/fhir/R4/Organization?identifier=example-health-slug", DOCTOR)).status).toBe(400);
    expect((await call(`/fhir/R4/Organization/${ORG_A.id}`, PAT_A)).status).toBe(403);
    expect((await call("/fhir/R4/Organization?name=example", PAT_A)).status).toBe(403);
    expect((await call("/fhir/R4/Organization/DIOF", DOCTOR)).status).toBe(404);
    expect(matches(await json(await call("/fhir/R4/Organization?_id=DIOF", DOCTOR)))).toEqual([]);
  });
});

describe("Location at the gateway", () => {
  it("reads a registered site with its address and owning organisation", async () => {
    const { call } = setup();
    const l = await json(await call(`/fhir/R4/Location/${SITE_A.id}`, PHARMACIST));
    expect(l).toMatchObject({
      resourceType: "Location",
      id: SITE_A.id,
      name: "Okpanam PHC",
      status: "active",
      mode: "instance",
      address: { text: "1 Clinic Road", district: "Oshimili North", state: "Delta" },
      managingOrganization: { reference: `Organization/${ORG_A.id}` },
    });
    expectClean(l);
  });

  it("status follows the recorded flag only; an unrecorded one is left out", async () => {
    const { call } = setup();
    expect((await json(await call(`/fhir/R4/Location/${SITE_B.id}`, DOCTOR))).status).toBe("inactive");
    expect((await json(await call(`/fhir/R4/Location/${SITE_C.id}`, DOCTOR))).status).toBeUndefined();
    // Another spelling of the id is not this resource (the served id must equal the asked id).
    expect((await call(`/fhir/R4/Location/${SITE_A.id.toUpperCase()}`, DOCTOR)).status).toBe(404);
    const upper = await json(await call(`/fhir/R4/Location?_id=${SITE_A.id.toUpperCase()}`, DOCTOR));
    expect(upper.entry ?? []).toEqual([]);
    // Inactive sites are visible to members only (row-level security).
    expect((await call(`/fhir/R4/Location/${SITE_B.id}`, OUTSIDER)).status).toBe(404);
  });

  it("'Mobile Clinic' and 'Portal entry' are never Locations", async () => {
    const { call } = setup();
    expect((await call(`/fhir/R4/Location/${SITE_MOBILE.id}`, DOCTOR)).status).toBe(404);
    expect((await call(`/fhir/R4/Location/${SITE_PORTAL.id}`, DOCTOR)).status).toBe(404);
    const clinic = await json(await call("/fhir/R4/Location?name=clinic", DOCTOR));
    expect(matches(clinic).map((l) => l.name)).toEqual(["Clinic 50% Hall_B"]);
    expect(matches(await json(await call("/fhir/R4/Location?name=portal", DOCTOR)))).toEqual([]);
    expect(matches(await json(await call(`/fhir/R4/Location?_id=${SITE_MOBILE.id}`, DOCTOR)))).toEqual([]);
  });

  it("searches by name with % and _ literal", async () => {
    const { call } = setup();
    expect(matches(await json(await call("/fhir/R4/Location?name=50%25", DOCTOR))).map((l) => l.id)).toEqual([SITE_LITERAL.id]);
    expect(matches(await json(await call("/fhir/R4/Location?name=5%25", DOCTOR)))).toEqual([]);
    expect(matches(await json(await call("/fhir/R4/Location?name=Hall_B", DOCTOR))).map((l) => l.id)).toEqual([SITE_LITERAL.id]);
    expect(matches(await json(await call("/fhir/R4/Location?name=Okp_nam", DOCTOR)))).toEqual([]);
  });

  it("refuses unnarrowed searches, unsupported parameters and a patient", async () => {
    const { call } = setup();
    expect((await call("/fhir/R4/Location", DOCTOR)).status).toBe(403);
    for (const p of ["status=active", "address-state=Delta", "organization=Organization/x", "near=6.2|6.7|10|km"]) {
      expect((await call(`/fhir/R4/Location?${p}`, DOCTOR)).status, p).toBe(400);
    }
    expect((await call(`/fhir/R4/Location/${SITE_A.id}`, PAT_A)).status).toBe(403);
    expect((await call("/fhir/R4/Location/not-a-uuid", DOCTOR)).status).toBe(404);
  });

  it("pages over sites by id", async () => {
    const { call } = setup();
    const seen: string[] = [];
    let path: string | null = "/fhir/R4/Location?name=clinic&_count=1";
    // Only one real match; the placeholder rows are skipped without losing it.
    for (let i = 0; path && i < 5; i++) {
      const b = await json(await call(path, DOCTOR));
      seen.push(...matches(b).map((r) => r.id as string));
      const next = b.link.find((l: Json) => l.relation === "next")?.url as string | undefined;
      path = next ? new URL(next).pathname + new URL(next).search : null;
    }
    expect(seen).toEqual([SITE_LITERAL.id]);
  });
});

// ---------------------------------------------------------------------------
// Registry, capability statement, and the reference helper
// ---------------------------------------------------------------------------

describe("definitions", () => {
  it("are staff-only reference data with narrowing searches", () => {
    for (const type of ["Practitioner", "PractitionerRole", "Organization", "Location"] as const) {
      const def = MODULES[type].definition;
      expect(def.patientAccess, type).toBe(false);
      expect(def.consentClass, type).toBe("directory");
      expect(def.interactions, type).toEqual(["read", "search-type"]);
      expect(def.requiredSearch.length, type).toBeGreaterThan(0);
      // Every parameter a search may be narrowed by is declared.
      for (const group of def.requiredSearch) for (const p of group) expect(def.searchParams.map((s) => s.name), type).toContain(p);
      expect(MODULES[type].validate, type).toBeTypeOf("function");
      expect(def.source, type).not.toMatch(/^\(not implemented/);
    }
  });

  it("are listed in the capability statement with their parameters", async () => {
    const { call } = setup();
    const cs = await json(await call("/fhir/R4/metadata"));
    const byType = Object.fromEntries(cs.rest[0].resource.map((r: Json) => [r.type, r]));
    expect(byType.Practitioner.searchParam.map((p: Json) => p.name)).toEqual(["_id", "name", "active"]);
    expect(byType.PractitionerRole.searchParam.map((p: Json) => p.name)).toEqual(["_id", "practitioner", "role"]);
    expect(byType.Organization.searchParam.map((p: Json) => p.name)).toEqual(["_id", "name"]);
    expect(byType.Location.searchParam.map((p: Json) => p.name)).toEqual(["_id", "name"]);
    expect(byType.Location.interaction).toEqual([{ code: "read" }, { code: "search-type" }]);
  });
});

describe("practitionerReferences (for other resource types)", () => {
  function ctxFor(token: string, fake: ReturnType<typeof setup>, kind: "staff" | "patient" = "staff"): QueryCtx {
    return {
      db: new Postgrest({ supabaseUrl: ENV.SUPABASE_URL, anonKey: "anon-key", accessToken: token, fetchImpl: fake.fetchImpl }),
      scope: kind === "staff" ? { kind: "staff", patientIds: null } : { kind: "patient", patientIds: new Set([PATIENT_A.id]) },
      permissions: new Set(),
      restrictions: new Set(),
      baseUrl: ENV.FHIR_BASE_URL,
      cursorBinding: "",
    };
  }

  it("resolves account ids to Practitioner references and never publishes the account id", async () => {
    const fake = setup();
    const refs = await practitionerReferences(ctxFor(DOCTOR, fake), [U_DOCTOR.id, U_NURSE.id, U_GUEST.id, "unknown-id", "Dr Example", "", null, U_DOCTOR.id]);
    expect([...refs.keys()].sort()).toEqual([U_NURSE.id, U_DOCTOR.id].sort());
    expect(refs.get(U_DOCTOR.id)).toEqual({ reference: `Practitioner/${P_DOCTOR}` });
    expect(JSON.stringify([...refs.values()])).not.toMatch(/a1b2c3d4|01HZZSTAFF/);
    // A typed name or "" is never sent to the database.
    const sent = fake.directoryCalls.flatMap((c) => (c.p_source_ids as string[]) ?? []);
    expect(sent).not.toContain("Dr Example");
    expect(sent).not.toContain("");
    const withName = await practitionerReferences(ctxFor(DOCTOR, fake), [U_NURSE.id], { withDisplay: true });
    expect(withName.get(U_NURSE.id)).toEqual({ reference: `Practitioner/${P_NURSE}`, display: "Ngozi  Eze" });
  });

  it("mints a published id for an account seen for the first time", async () => {
    const fake = setup();
    const refs = await practitionerReferences(ctxFor(DOCTOR, fake), [U_VOL_1.id]);
    expect(refs.get(U_VOL_1.id)?.reference).toMatch(/^Practitioner\/9f000000-0000-4000-8000-0000000001\d\d$/);
    expect(fake.links.has(U_VOL_1.id)).toBe(true);
  });

  it("gives a patient caller nothing, without asking the database", async () => {
    const fake = setup();
    const refs = await practitionerReferences(ctxFor(PAT_A, fake, "patient"), [U_DOCTOR.id]);
    expect(refs.size).toBe(0);
    expect(fake.directoryCalls).toHaveLength(0);
  });

  it("sends at most 100 ids per call", async () => {
    const fake = setup();
    const ids = Array.from({ length: 230 }, (_, i) => `device-${i}`);
    await practitionerReferences(ctxFor(DOCTOR, fake), [...ids, U_DOCTOR.id]);
    expect(fake.directoryCalls.map((c) => (c.p_source_ids as string[]).length)).toEqual([100, 100, 31]);
    expect(fake.directoryCalls.every((c) => c.p_name === null && c.p_fhir_ids === null && c.p_role === null)).toBe(true);
  });
});

describe("status maps registry", () => {
  it("lists the Location map with every other status map", async () => {
    const { STATUS_MAPS } = await import("../terminology/status");
    expect(STATUS_MAPS).toContain(LOCATION_STATUS);
  });
});
