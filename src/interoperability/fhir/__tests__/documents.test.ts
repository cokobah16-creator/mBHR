// @vitest-environment node
//
// DocumentReference and Binary (patient documents): the mapper, the status
// maps, the stored-path and download-name rules, and the owner prompt's
// section 55 document cases end to end at the gateway against the
// in-memory Supabase (fakeSupabase.ts, with its Storage stand-in).
//
// The document rows below have the columns of the older 20251030000000
// table layout plus the 20260925100700 ownership columns, and no
// updated_at: the fake answers 400 (and the gateway 503) for any column no
// fixture row has, so every passing request also shows the module reads
// only columns that exist on both layouts.

import { describe, expect, it } from "vitest";
import { handleFhirRequest } from "../gateway/handler";
import { fakeSupabase, makeToken, type FakeOptions, type FakeUser } from "./fakeSupabase";
import { PATIENT_A, PATIENT_B } from "./fixtures";
import {
  BINARY_COLUMNS,
  DOCUMENT_COLUMNS,
  documentContentType,
  documentTitle,
  documentTypeConcept,
  downloadFilename,
  mapBinary,
  mapDocumentReference,
} from "../mappers/document";
import { definition as documentDefinition, documentReferenceModule } from "../resources/documentReference";
import { binaryModule, definition as binaryDefinition, documentObjectPath } from "../resources/binary";
import { validateResource } from "../validation/validate";
import { STATUS_MAPS } from "../terminology/status";
import {
  DOCUMENT_REFERENCE_DOC_STATUS,
  DOCUMENT_REFERENCE_STATUS,
  DOCUMENT_STATUS_MAPS,
} from "../terminology/status/document";
import { applyStatusMap, explainStatus, sourceValuesFor } from "../terminology/statusMaps";

// ---------------------------------------------------------------------------
// Fixtures (synthetic; no real patient data)
// ---------------------------------------------------------------------------

/** A record merged into A. */
const PATIENT_M = {
  ...PATIENT_A,
  id: "01HZZPATIENTM0000000000000",
  fhir_id: "0b3c1d2e-1111-4aaa-8bbb-00000000000d",
  given_name: "Ada",
  family_name: "Okafor-Dup",
  merged_into: PATIENT_A.id,
  merged_at: "2026-06-01T10:00:00+00:00",
};

// Account ids (auth uids): read by nobody, published nowhere.
const UPLOADER_UID = "5e0c1a2b-0000-4000-8000-0000000a0a0a";
const STAFF_UID = "5e0c1a2b-0000-4000-8000-0000000c0c0c";
const STAFF_NOTE = "STAFF NOTE discuss shadow on left lung";

const DOC_BASE = {
  document_type: "lab_result",
  document_name: "blood test.pdf",
  file_size: 20480,
  mime_type: "application/pdf",
  description: null as string | null,
  upload_source: "patient",
  uploaded_by_user_id: UPLOADER_UID,
  uploaded_by_patient: true,
  metadata: { internal: "internal-metadata-value" },
  created_at: "2026-09-01T09:30:00+00:00",
  deleted_at: null as string | null,
  deleted_by: null as string | null,
};
const docId = (n: string) => `d0c00000-0000-4000-8000-0000000000${n}`;

/** A's own upload. */
const DOC_A = {
  ...DOC_BASE,
  id: docId("0a"),
  patient_id: PATIENT_A.id,
  file_path: `${PATIENT_A.id}/1756719000000.pdf`,
  description: "Results from the Asaba lab",
};
/** A clinic record for A (bucket-prefixed path, as a row written outside the portal may have). */
const DOC_A_CLINIC = {
  ...DOC_BASE,
  id: docId("0b"),
  patient_id: PATIENT_A.id,
  document_type: "imaging",
  document_name: "chest x-ray.png",
  mime_type: "image/png",
  file_size: 1000,
  upload_source: "staff",
  uploaded_by_user_id: STAFF_UID,
  uploaded_by_patient: false,
  description: STAFF_NOTE,
  file_path: `patient-documents/${PATIENT_A.id}/1756719100000.png`,
  created_at: "2026-09-02T10:00:00+00:00",
};
/** Removed by the patient: never published. */
const DOC_A_REMOVED = {
  ...DOC_A,
  id: docId("0c"),
  file_path: `${PATIENT_A.id}/1756719200000.pdf`,
  deleted_at: "2026-09-03T08:00:00+00:00",
  deleted_by: UPLOADER_UID,
};
/** Declared as HTML: served as octet-stream. */
const DOC_A_HTML = {
  ...DOC_A,
  id: docId("0d"),
  document_type: "Referral letter",
  document_name: "page.html",
  mime_type: "text/html",
  file_path: `${PATIENT_A.id}/1756719300000.html`,
  created_at: "2026-09-04T09:00:00+00:00",
};
/** A's own upload whose path climbs into B's folder (it passes the portal's first-folder check). */
const DOC_A_DOTS = { ...DOC_A, id: docId("0e"), file_path: `${PATIENT_A.id}/../${PATIENT_B.id}/1756719400000.pdf` };
/** A clinic row holding a signed URL instead of a path. */
const SIGNED_URL = `https://project.supabase.co/storage/v1/object/sign/patient-documents/${PATIENT_A.id}/x.pdf?token=abc`;
const DOC_A_URL = { ...DOC_A_CLINIC, id: docId("0f"), file_path: SIGNED_URL };
/** A clinic row for A whose file is in B's folder (staff inserts have no folder check). */
const DOC_A_WRONG_FOLDER = { ...DOC_A_CLINIC, id: docId("10"), file_path: `${PATIENT_B.id}/1756719500000.pdf` };
/** A's upload whose file is not in Storage (files are not backed up). */
const DOC_A_MISSING = { ...DOC_A, id: docId("11"), file_path: `${PATIENT_A.id}/1756719600000.pdf` };
/** A's upload whose stored file is empty. */
const DOC_A_EMPTY = { ...DOC_A, id: docId("12"), file_path: `${PATIENT_A.id}/1756719650000.pdf` };
/** A row moved to A by the merge; its file stayed in M's folder. */
const DOC_A_MOVED = { ...DOC_A, id: docId("13"), file_path: `${PATIENT_M.id}/1756719800000.pdf` };
/** B's own upload. */
const DOC_B = {
  ...DOC_BASE,
  id: docId("1b"),
  patient_id: PATIENT_B.id,
  file_path: `${PATIENT_B.id}/1756719500000.pdf`,
  description: "Bola private upload",
};
/** A row still on the merged-away record M. */
const DOC_M = { ...DOC_BASE, id: docId("1d"), patient_id: PATIENT_M.id, file_path: `${PATIENT_M.id}/1756719700000.pdf` };

const DOCS = [
  DOC_A,
  DOC_A_CLINIC,
  DOC_A_REMOVED,
  DOC_A_HTML,
  DOC_A_DOTS,
  DOC_A_URL,
  DOC_A_WRONG_FOLDER,
  DOC_A_MISSING,
  DOC_A_EMPTY,
  DOC_A_MOVED,
  DOC_B,
  DOC_M,
];

const object = (path: string) => `patient-documents/${path}`;
const STORAGE: NonNullable<FakeOptions["storage"]> = {
  [object(DOC_A.file_path)]: { body: "%PDF-1.4 A upload", contentType: "application/pdf" },
  [object(`${PATIENT_A.id}/1756719100000.png`)]: { body: "PNG clinic image", contentType: "image/png" },
  [object(DOC_A_REMOVED.file_path)]: { body: "%PDF removed", contentType: "application/pdf" },
  [object(DOC_A_HTML.file_path)]: { body: "<script>alert(1)</script>", contentType: "text/html" },
  [object(`${PATIENT_B.id}/1756719400000.pdf`)]: { body: "%PDF B secret", contentType: "application/pdf" },
  [object(DOC_B.file_path)]: { body: "%PDF B upload", contentType: "application/pdf" },
  [object(DOC_A_EMPTY.file_path)]: { body: "", contentType: "application/pdf" },
  [object(DOC_A_MOVED.file_path)]: { body: "%PDF moved", contentType: "application/pdf" },
  [object(DOC_M.file_path)]: { body: "%PDF M upload", contentType: "application/pdf" },
};

const DOCTOR = makeToken("doctor-1");
const NURSE = makeToken("nurse-1");
const PHARMACIST = makeToken("pharm-1");
const AUDITOR = makeToken("auditor-1");
const PAT_A = makeToken("portal-a");
const PAT_B = makeToken("portal-b");

const USERS: Record<string, FakeUser> = {
  [DOCTOR]: { id: "doctor-1", role: "doctor", permissions: ["consult", "lab_review", "register", "vitals", "queue"] },
  [NURSE]: { id: "nurse-1", role: "nurse", permissions: ["register", "vitals", "queue", "portal_manage"] },
  [PHARMACIST]: { id: "pharm-1", role: "pharmacist", permissions: ["dispense", "inventory", "queue"] },
  [AUDITOR]: { id: "auditor-1", role: "auditor", permissions: ["audit_access"] },
  [PAT_A]: { id: "portal-a", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_A.id] },
  [PAT_B]: { id: "portal-b", role: null, permissions: [], kind: "patient", patientIds: [PATIENT_B.id] },
};

const isPatient = (user: FakeUser) => (user.kind ?? "staff") === "patient";

/** Row-level security as 20260925100700 has it: staff see every row, removed ones too; a patient their own live rows. */
function visible(table: string, row: Record<string, unknown>, user: FakeUser): boolean {
  if (!isPatient(user)) return true;
  const own = user.patientIds ?? [];
  if (table === "patients") return own.includes(String(row.id));
  if (table === "patient_documents") return own.includes(String(row.patient_id)) && row.deleted_at === null;
  return own.includes(String(row.patient_id));
}

/** The bucket's policy: staff any object; a patient objects in their own folders. */
function storageVisible(key: string, user: FakeUser): boolean {
  if (!isPatient(user)) return true;
  const folder = key.split("/")[1];
  return (user.patientIds ?? []).includes(folder);
}

const ENV = {
  FHIR_ENABLED: "true",
  FHIR_PATIENT_ACCESS_ENABLED: "true",
  FHIR_BASE_URL: "https://mbhr.app/fhir/R4",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
};

function setup(overrides: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({
    users: USERS,
    tables: { patients: [PATIENT_A, PATIENT_B, PATIENT_M], patient_documents: DOCS },
    visible,
    storage: STORAGE,
    storageVisible,
    ...overrides,
  });
  const logs: string[] = [];
  const served: string[] = [];
  const call = async (path: string, init: RequestInit & { token?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    const res = await handleFhirRequest(new Request(`https://mbhr.app${path}`, { ...init, headers }), {
      env: ENV,
      fetchImpl: fake.fetchImpl,
      randomId: () => "11111111-2222-4333-8444-555555555555",
      log: (l) => logs.push(l),
      now: () => new Date("2026-09-25T12:00:00Z"),
    });
    // Everything served, headers included, for the "never published" checks.
    served.push(JSON.stringify([...res.headers.entries()]), await res.clone().text());
    return res;
  };
  const storageCalls = () => fake.calls.filter((c) => c.url.includes("/storage/v1/"));
  const documentQueries = () => fake.calls.filter((c) => c.url.includes("/rest/v1/patient_documents"));
  return { ...fake, call, logs, served, storageCalls, documentQueries };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const json = async (res: Response) => (await res.json()) as Json;
const matches = (b: Json) => b.entry.filter((e: Json) => e.search.mode === "match").map((e: Json) => e.resource);
const ids = (b: Json) => matches(b).map((r: Json) => r.id).sort();
const outcomes = (b: Json) => b.entry.filter((e: Json) => e.search.mode === "outcome").flatMap((e: Json) => e.resource.issue);
const refs = { patientFhirIds: new Map([[PATIENT_A.id, PATIENT_A.fhir_id]]) };

/** Every live document of A whose patient resolves (what staff see for A). */
const A_LIVE = [DOC_A, DOC_A_CLINIC, DOC_A_HTML, DOC_A_DOTS, DOC_A_URL, DOC_A_WRONG_FOLDER, DOC_A_MISSING, DOC_A_EMPTY, DOC_A_MOVED];

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

describe("DocumentReference mapper", () => {
  it("maps every field of a patient upload", () => {
    expect(mapDocumentReference(DOC_A, refs, { contentAvailable: true })).toEqual({
      resourceType: "DocumentReference",
      id: DOC_A.id,
      meta: { source: "https://mbhr.app" },
      status: "current",
      type: {
        coding: [{ system: "https://mbhr.app/codes/document-type", code: "lab_result", display: "Test result" }],
        text: "Test result",
      },
      category: [
        {
          coding: [{ system: "https://mbhr.app/codes/document-source", code: "patient", display: "Uploaded through the patient portal" }],
          text: "Uploaded through the patient portal",
        },
      ],
      subject: { reference: `Patient/${PATIENT_A.fhir_id}` },
      date: "2026-09-01T09:30:00.000Z",
      description: "Results from the Asaba lab",
      content: [
        {
          attachment: {
            contentType: "application/pdf",
            url: `Binary/${DOC_A.id}`,
            size: 20480,
            title: "blood test.pdf",
          },
        },
      ],
    });
  });

  it("publishes no author, docStatus, creation, hash, context or lastUpdated (none is recorded)", () => {
    const d = mapDocumentReference(DOC_A_CLINIC, refs, { contentAvailable: true }) as unknown as Json;
    for (const k of ["author", "docStatus", "context", "custodian", "securityLabel", "authenticator", "masterIdentifier"]) {
      expect(d[k], k).toBeUndefined();
    }
    expect(d.content[0].attachment.creation).toBeUndefined();
    expect(d.content[0].attachment.hash).toBeUndefined();
    expect(d.meta.lastUpdated).toBeUndefined();
  });

  it("never publishes a clinic record's description (a staff free-text note)", () => {
    const d = mapDocumentReference(DOC_A_CLINIC, refs, { contentAvailable: true })!;
    expect(d.description).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain(STAFF_NOTE);
    expect(d.category?.[0].coding?.[0].code).toBe("staff");
    // The staff display does not claim that staff provided legacy documents.
    expect(d.category?.[0].coding?.[0].display).toMatch(/before mBHR recorded/);
  });

  it("gives the attachment no url when the caller may not download the file", () => {
    const d = mapDocumentReference(DOC_A_CLINIC, refs, { contentAvailable: false })!;
    expect(d.content[0].attachment).toEqual({ contentType: "image/png", size: 1000, title: "chest x-ray.png" });
  });

  it("withholds a removed document, one whose state is unknown, and one whose patient does not resolve", () => {
    expect(mapDocumentReference(DOC_A_REMOVED, refs, { contentAvailable: true })).toBeNull();
    const { deleted_at: _gone, ...unread } = DOC_A;
    expect(mapDocumentReference(unread, refs, { contentAvailable: true })).toBeNull();
    expect(mapDocumentReference(DOC_A, { patientFhirIds: new Map() }, { contentAvailable: true })).toBeNull();
    expect(mapDocumentReference({ ...DOC_A, id: null }, refs, { contentAvailable: true })).toBeNull();
  });

  it("publishes a document type the portal does not offer as text only, never as 'other'", () => {
    expect(documentTypeConcept("Referral letter")).toEqual({ text: "Referral letter" });
    // Matched exactly, like the search filter: a padded or re-cased value is not the code.
    expect(documentTypeConcept(" lab_result")).toEqual({ text: "lab_result" });
    expect(documentTypeConcept("LAB_RESULT")).toEqual({ text: "LAB_RESULT" });
    expect(documentTypeConcept("   ")).toBeUndefined();
    expect(documentTypeConcept(null)).toBeUndefined();
    for (const [code, label] of [
      ["medical_record", "Medical record"],
      ["imaging", "Scan or X-ray"],
      ["prescription", "Prescription"],
      ["insurance", "Insurance document"],
      ["other", "Other"],
    ]) {
      expect(documentTypeConcept(code)?.coding?.[0]).toEqual({ system: "https://mbhr.app/codes/document-type", code, display: label });
    }
    const d = mapDocumentReference({ ...DOC_A, document_type: null }, refs, { contentAvailable: true })!;
    expect(d.type).toBeUndefined();
  });

  it("leaves out free text that names a storage path rather than withholding the document", () => {
    const link = "copy of https://abc.supabase.co/storage/v1/object/public/foo/bar";
    expect(documentTypeConcept("see /storage/v1/object")).toBeUndefined();
    const d = mapDocumentReference({ ...DOC_A, description: link, document_type: "see /storage/v1/x" }, refs, { contentAvailable: true })!;
    expect(d).not.toBeNull();
    expect(d.description).toBeUndefined();
    expect(d.type).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain("/storage/v1/");
  });

  it("leaves out a category that is not one of the two recorded sources", () => {
    for (const source of ["PATIENT", "caregiver", null]) {
      const d = mapDocumentReference({ ...DOC_A, upload_source: source }, refs, { contentAvailable: true })!;
      expect(d.category, String(source)).toBeUndefined();
      // Not a patient upload as far as the record says: its description is not published either.
      expect(d.description).toBeUndefined();
    }
  });

  it("labels content only with allowlisted types, else application/octet-stream", () => {
    expect(documentContentType("application/pdf")).toBe("application/pdf");
    expect(documentContentType("Application/PDF; charset=binary")).toBe("application/pdf");
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/msword"]) {
      expect(documentContentType(t)).toBe(t);
    }
    for (const t of ["text/html", "image/svg+xml", "application/javascript", "application/x-msdownload", "application/zip", "", "pdf", null, 5]) {
      expect(documentContentType(t), String(t)).toBe("application/octet-stream");
    }
    const d = mapDocumentReference({ ...DOC_A, mime_type: "" }, refs, { contentAvailable: true })!;
    expect(d.content[0].attachment.contentType).toBe("application/octet-stream");
  });

  it("publishes the size only when it is a whole number of bytes, never zero for missing", () => {
    const size = (v: unknown) => mapDocumentReference({ ...DOC_A, file_size: v }, refs, { contentAvailable: true })!.content[0].attachment.size;
    expect(size("20480")).toBe(20480);
    expect(size(0)).toBe(0);
    for (const v of [null, -1, 1.5, "abc", "", 3e10]) expect(size(v), String(v)).toBeUndefined();
  });

  it("shows only the file name, never a path or URL, without invisible characters", () => {
    expect(documentTitle("C:\\fakepath\\scan.pdf")).toBe("scan.pdf");
    expect(documentTitle(`${PATIENT_A.id}/1756719000000.pdf`)).toBe("1756719000000.pdf");
    expect(documentTitle(SIGNED_URL)).toBeUndefined();
    expect(documentTitle("report\u202Efdp.exe")).toBe("reportfdp.exe");
    expect(documentTitle("a\u0000b\tc.pdf")).toBe("ab c.pdf");
    expect(documentTitle("Résumé médical.pdf")).toBe("Résumé médical.pdf");
    for (const v of ["", "   ", "..", "a/", "x".repeat(256), null]) expect(documentTitle(v), String(v)).toBeUndefined();
  });

  it("is valid FHIR by the generic and the DocumentReference rules", () => {
    for (const row of [DOC_A, DOC_A_CLINIC, DOC_A_HTML]) {
      for (const contentAvailable of [true, false]) {
        const d = mapDocumentReference(row, refs, { contentAvailable })!;
        expect(validateResource(d, documentReferenceModule.validate), row.id).toEqual([]);
      }
    }
  });
});

describe("DocumentReference validation", () => {
  const good = mapDocumentReference(DOC_A, refs, { contentAvailable: true }) as unknown as Json;
  const problems = (change: (d: Json) => void) => {
    const d = JSON.parse(JSON.stringify(good));
    change(d);
    return validateResource(d, documentReferenceModule.validate).map((i) => i.path);
  };

  it("requires status, subject and content", () => {
    expect(problems((d) => delete d.status)).toContain("status");
    expect(problems((d) => (d.status = "final"))).toContain("status");
    expect(problems((d) => delete d.subject)).toContain("subject");
    expect(problems((d) => (d.content = []))).toContain("content");
    expect(problems((d) => (d.content = [{}]))).toContain("content[0].attachment");
    expect(problems((d) => (d.docStatus = "done"))).toContain("docStatus");
  });

  it("refuses an attachment that points anywhere but this document's Binary, or embeds the file", () => {
    expect(problems((d) => (d.content[0].attachment.url = SIGNED_URL))).toContain("content[0].attachment.url");
    expect(problems((d) => (d.content[0].attachment.url = `https://mbhr.app/fhir/R4/Binary/${DOC_A.id}`))).toContain(
      "content[0].attachment.url",
    );
    expect(problems((d) => (d.content[0].attachment.url = `Binary/${DOC_B.id}`))).toContain("content[0].attachment.url");
    expect(problems((d) => (d.content[0].attachment.data = "JVBERi0="))).toContain("content[0].attachment.data");
    expect(problems((d) => (d.content[0].attachment.contentType = "text/html"))).toContain("content[0].attachment.contentType");
    expect(problems((d) => (d.content[0].attachment.size = -3))).toContain("content[0].attachment.size");
    expect(problems((d) => (d.description = `see ${SIGNED_URL}`))).toContain("");
  });
});

// ---------------------------------------------------------------------------
// Status maps
// ---------------------------------------------------------------------------

describe("document status maps", () => {
  it("are listed with every other status map", () => {
    for (const m of DOCUMENT_STATUS_MAPS) expect(STATUS_MAPS).toContain(m);
  });

  it("DocumentReference.status: a live document is current; everything else is withheld", () => {
    expect(explainStatus(DOCUMENT_REFERENCE_STATUS, "live")).toMatchObject({ fhir: "current" });
    const removed = explainStatus(DOCUMENT_REFERENCE_STATUS, "removed");
    expect(removed.fhir).toBeNull();
    expect(removed.reason).toMatch(/neither an error nor a replacement/);
    for (const raw of [null, undefined, "", "entered-in-error", "superseded", "deleted", "current"]) {
      expect(applyStatusMap(DOCUMENT_REFERENCE_STATUS, raw), String(raw)).toBeNull();
    }
    expect(DOCUMENT_REFERENCE_STATUS.missing.reason).toMatch(/withheld/);
  });

  it("never produces entered-in-error or superseded: mBHR records neither", () => {
    expect(sourceValuesFor(DOCUMENT_REFERENCE_STATUS, "entered-in-error")).toEqual([]);
    expect(sourceValuesFor(DOCUMENT_REFERENCE_STATUS, "superseded")).toEqual([]);
    // A removal is not an error: the removed row is not published at all.
    expect(mapDocumentReference(DOC_A_REMOVED, refs, { contentAvailable: true })).toBeNull();
  });

  it("DocumentReference.docStatus: nothing records it, so it is never final", () => {
    expect(DOCUMENT_REFERENCE_DOC_STATUS.rules).toEqual([]);
    for (const raw of ["final", "preliminary", "amended", "entered-in-error", null, ""]) {
      expect(applyStatusMap(DOCUMENT_REFERENCE_DOC_STATUS, raw), String(raw)).toBeNull();
    }
    expect(sourceValuesFor(DOCUMENT_REFERENCE_DOC_STATUS, "final")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Binary helpers
// ---------------------------------------------------------------------------

describe("stored paths", () => {
  const A = PATIENT_A.id;
  const B = PATIENT_B.id;

  it("accepts a plain path in the patient's own folder, with or without the bucket prefix", () => {
    expect(documentObjectPath(`${A}/1756719000000.pdf`, [A])).toBe(`${A}/1756719000000.pdf`);
    expect(documentObjectPath(`patient-documents/${A}/1756719000000.pdf`, [A])).toBe(`${A}/1756719000000.pdf`);
    expect(documentObjectPath(`${PATIENT_M.id}/x.pdf`, [A, PATIENT_M.id])).toBe(`${PATIENT_M.id}/x.pdf`);
  });

  it("refuses ../, absolute paths, URLs, other folders and anything unusual", () => {
    for (const p of [
      `${A}/../${B}/x.pdf`,
      `../${A}/x.pdf`,
      `/${A}/x.pdf`,
      `${A}//x.pdf`,
      `${A}/./x.pdf`,
      `${A}/%2e%2e/x.pdf`,
      `${A}\\..\\${B}\\x.pdf`,
      `${A}/x.pdf\n`,
      ` ${A}/x.pdf`,
      SIGNED_URL,
      `https://evil.example/${A}/x.pdf`,
      `${B}/x.pdf`,
      `patient-documents/patient-documents/${A}/x.pdf`,
      A,
      "",
      null,
      42,
    ]) {
      expect(documentObjectPath(p, [A]), String(p)).toBeNull();
    }
  });
});

describe("Binary mapper and download name", () => {
  it("maps the file's resource with an allowlisted type and its DocumentReference as security context", () => {
    expect(mapBinary(DOC_A, refs)).toEqual({
      resourceType: "Binary",
      id: DOC_A.id,
      meta: { source: "https://mbhr.app" },
      contentType: "application/pdf",
      securityContext: { reference: `DocumentReference/${DOC_A.id}` },
    });
    expect(mapBinary(DOC_A_HTML, refs)?.contentType).toBe("application/octet-stream");
    expect(mapBinary(DOC_A_REMOVED, refs)).toBeNull();
    expect(mapBinary(DOC_A, { patientFhirIds: new Map() })).toBeNull();
    expect(validateResource(mapBinary(DOC_A, refs), binaryModule.validate)).toEqual([]);
  });

  it("validates a Binary: a served type, no embedded data, its own DocumentReference", () => {
    const b = mapBinary(DOC_A, refs) as unknown as Json;
    const problems = (change: (d: Json) => void) => {
      const d = JSON.parse(JSON.stringify(b));
      change(d);
      return validateResource(d, binaryModule.validate).map((i) => i.path);
    };
    expect(problems((d) => delete d.contentType)).toContain("contentType");
    expect(problems((d) => (d.contentType = "text/html"))).toContain("contentType");
    expect(problems((d) => (d.data = "JVBERi0="))).toContain("data");
    expect(problems((d) => (d.securityContext = { reference: `DocumentReference/${DOC_B.id}` }))).toContain("securityContext");
  });

  it("names downloads in plain ASCII with the extension of the served type", () => {
    expect(downloadFilename("blood test.pdf", "application/pdf")).toBe("blood_test.pdf");
    expect(downloadFilename("Résumé médical.pdf", "application/pdf")).toBe("Resume_medical.pdf");
    expect(downloadFilename("page.html", "application/octet-stream")).toBe("page.bin");
    expect(downloadFilename("invoice\u202Efdp.exe", "application/octet-stream")).toBe("invoicefdp.bin");
    expect(downloadFilename("../../etc/passwd", "application/octet-stream")).toBe("passwd.bin");
    expect(downloadFilename(SIGNED_URL, "application/pdf")).toBe("document.pdf");
    expect(downloadFilename(null, "image/png")).toBe("document.png");
    expect(downloadFilename("光.pdf", "application/pdf")).toBe("document.pdf");
    expect(downloadFilename(`${"a".repeat(200)}.jpg`, "image/jpeg")).toBe(`${"a".repeat(80)}.jpg`);
  });
});

describe("definitions", () => {
  it("declare what is implemented, and only that", () => {
    expect(documentDefinition.readPermissions).toEqual(["consult"]);
    expect(documentDefinition.requiredSearch).toEqual([["_id"], ["patient"], ["subject"]]);
    expect(documentDefinition.searchParams.map((p) => p.name)).toEqual(["_id", "patient", "subject", "date", "type", "category", "status"]);
    expect(documentDefinition.interactions).toEqual(["read", "search-type"]);
    expect(documentDefinition.patientAccess).toBe(true);
    expect(documentDefinition.sensitiveSearch).toBe(true);
    expect(binaryDefinition.readPermissions).toEqual(["consult"]);
    expect(binaryDefinition.interactions).toEqual(["read"]);
    expect(binaryDefinition.searchParams).toEqual([]);
    expect(binaryModule.search).toBeUndefined();
  });

  it("read no path, account id or updated_at for the metadata, and the path only for the file", () => {
    for (const c of ["file_path", "uploaded_by_user_id", "deleted_by", "uploaded_by_patient", "metadata", "updated_at"]) {
      expect(DOCUMENT_COLUMNS as readonly string[], c).not.toContain(c);
    }
    expect(BINARY_COLUMNS as readonly string[]).toContain("file_path");
    for (const c of ["uploaded_by_user_id", "deleted_by", "description", "updated_at"]) {
      expect(BINARY_COLUMNS as readonly string[], c).not.toContain(c);
    }
  });
});

// ---------------------------------------------------------------------------
// Gateway: staff
// ---------------------------------------------------------------------------

describe("staff access to documents", () => {
  it("a doctor (consult) reads a document's metadata, with the file at Binary/[id]", async () => {
    const { call, audits } = setup();
    const res = await call(`/fhir/R4/DocumentReference/${DOC_A.id}`, { token: DOCTOR });
    expect(res.status).toBe(200);
    const d = await json(res);
    expect(d.resourceType).toBe("DocumentReference");
    expect(d.subject.reference).toBe(`Patient/${PATIENT_A.fhir_id}`);
    expect(d.content[0].attachment.url).toBe(`Binary/${DOC_A.id}`);
    expect(d.meta.versionId).toMatch(/^[0-9a-f]{24}$/);
    expect(res.headers.get("last-modified")).toBeNull();
    expect(audits).toEqual([
      expect.objectContaining({ p_resource_type: "DocumentReference", p_decision: "permit", p_patient_ids: [PATIENT_A.id], p_http_status: 200 }),
    ]);
  });

  it("staff without consult are refused documents and files before anything is read", async () => {
    for (const token of [NURSE, PHARMACIST, AUDITOR]) {
      const { call, audits, documentQueries, storageCalls } = setup();
      for (const path of [
        `/fhir/R4/DocumentReference/${DOC_A.id}`,
        `/fhir/R4/DocumentReference?patient=Patient/${PATIENT_A.fhir_id}`,
        `/fhir/R4/Binary/${DOC_A.id}`,
      ]) {
        const res = await call(path, { token });
        expect(res.status, path).toBe(403);
        expect(JSON.stringify(await json(res))).not.toContain("blood");
      }
      expect(documentQueries()).toHaveLength(0);
      expect(storageCalls()).toHaveLength(0);
      expect(audits.map((a) => a.p_denial_reason)).toEqual(["missing_permission", "missing_permission", "missing_permission"]);
    }
  });

  it("a removed document is not found, not listed, and its file is not served", async () => {
    const { call, storageCalls } = setup();
    expect((await call(`/fhir/R4/DocumentReference/${DOC_A_REMOVED.id}`, { token: DOCTOR })).status).toBe(404);
    expect((await call(`/fhir/R4/Binary/${DOC_A_REMOVED.id}`, { token: DOCTOR })).status).toBe(404);
    expect(storageCalls()).toHaveLength(0);
    const b = await json(await call(`/fhir/R4/DocumentReference?patient=Patient/${PATIENT_A.fhir_id}`, { token: DOCTOR }));
    expect(ids(b)).not.toContain(DOC_A_REMOVED.id);
    const byId = await json(await call(`/fhir/R4/DocumentReference?_id=${DOC_A_REMOVED.id}`, { token: DOCTOR }));
    expect(matches(byId)).toEqual([]);
  });

  it("refuses searches that do not name a record (anti-enumeration)", async () => {
    const { call, documentQueries, audits } = setup();
    for (const q of ["", "?type=lab_result", "?category=patient", "?date=2026", "?status=current"]) {
      const res = await call(`/fhir/R4/DocumentReference${q}`, { token: DOCTOR });
      expect(res.status, q).toBe(403);
    }
    expect(documentQueries()).toHaveLength(0);
    expect(new Set(audits.map((a) => a.p_denial_reason))).toEqual(new Set(["search_not_narrowed"]));
  });

  it("answers invalid ids with 404 or 400 without querying or leaking", async () => {
    const { call, documentQueries, storageCalls } = setup();
    for (const path of ["/fhir/R4/DocumentReference/not-a-uuid", "/fhir/R4/Binary/not-a-uuid", `/fhir/R4/Binary/${docId("99")}`]) {
      const res = await call(path, { token: DOCTOR });
      expect(res.status, path).toBe(404);
      expect(JSON.stringify(await json(res))).not.toMatch(/not-a-uuid|patient_documents|storage/);
    }
    expect((await call("/fhir/R4/Binary/a%2Cb", { token: DOCTOR })).status).toBe(400);
    expect((await call(`/fhir/R4/Binary?patient=Patient/${PATIENT_A.fhir_id}`, { token: DOCTOR })).status).toBe(400);
    // Only the unknown uuid reached the database; no file was fetched.
    expect(documentQueries()).toHaveLength(1);
    expect(storageCalls()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Gateway: patient self-access
// ---------------------------------------------------------------------------

describe("patient access to documents", () => {
  it("a patient reads their own document's metadata", async () => {
    const { call, audits } = setup();
    const res = await call(`/fhir/R4/DocumentReference/${DOC_A.id}`, { token: PAT_A });
    expect(res.status).toBe(200);
    const d = await json(res);
    expect(d.subject.reference).toBe(`Patient/${PATIENT_A.fhir_id}`);
    expect(d.description).toBe(DOC_A.description);
    expect(d.content[0].attachment.url).toBe(`Binary/${DOC_A.id}`);
    expect(audits[0]).toMatchObject({ p_decision: "permit", p_actor_kind: "patient", p_purpose: "PATRQT", p_patient_ids: [PATIENT_A.id] });
  });

  it("sees a clinic record's metadata with no file url and no staff note", async () => {
    const { call } = setup();
    const d = await json(await call(`/fhir/R4/DocumentReference/${DOC_A_CLINIC.id}`, { token: PAT_A }));
    expect(d.content[0].attachment.url).toBeUndefined();
    expect(d.description).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain(STAFF_NOTE);
  });

  it("a search is confined to their own documents that were not removed", async () => {
    const { call } = setup();
    const b = await json(await call("/fhir/R4/DocumentReference", { token: PAT_A }));
    expect(ids(b)).toEqual(A_LIVE.map((d) => d.id).sort());
    expect(new Set(matches(b).map((d: Json) => d.subject.reference))).toEqual(new Set([`Patient/${PATIENT_A.fhir_id}`]));
    // A url only on the documents they uploaded.
    for (const d of matches(b)) {
      const own = A_LIVE.find((x) => x.id === d.id)!.upload_source === "patient";
      expect(d.content[0].attachment.url !== undefined, d.id).toBe(own);
    }
  });

  it("cannot read another patient's DocumentReference, by id or by patient=", async () => {
    const { call, audits } = setup();
    expect((await call(`/fhir/R4/DocumentReference/${DOC_B.id}`, { token: PAT_A })).status).toBe(404);
    const byPatient = await call(`/fhir/R4/DocumentReference?patient=Patient/${PATIENT_B.fhir_id}`, { token: PAT_A });
    expect(byPatient.status).toBe(403);
    expect(audits[audits.length - 1]).toMatchObject({ p_decision: "deny", p_denial_reason: "patient_not_in_context" });
    const both = await call(`/fhir/R4/DocumentReference?patient=Patient/${PATIENT_A.fhir_id}&subject=Patient/${PATIENT_B.fhir_id}`, {
      token: PAT_A,
    });
    expect(both.status).toBe(403);
    const byId = await json(await call(`/fhir/R4/DocumentReference?_id=${DOC_B.id}`, { token: PAT_A }));
    expect(matches(byId)).toEqual([]);
  });

  it("cannot download another patient's file, even with the url from that patient's DocumentReference", async () => {
    const { call, storageCalls } = setup();
    const url = (await json(await call(`/fhir/R4/DocumentReference/${DOC_B.id}`, { token: PAT_B }))).content[0].attachment.url;
    expect(url).toBe(`Binary/${DOC_B.id}`);
    const before = storageCalls().length;
    const res = await call(`/fhir/R4/${url}`, { token: PAT_A });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("B upload");
    expect(storageCalls()).toHaveLength(before);
  });

  it("gets the file of their own upload, as an attachment with safe headers", async () => {
    const { call, audits, contexts } = setup();
    const res = await call(`/fhir/R4/Binary/${DOC_A.id}`, { token: PAT_A });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("%PDF-1.4 A upload");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="blood_test.pdf"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-security-context")).toBe(`DocumentReference/${DOC_A.id}`);
    // Audited before it was served, and counted against the stricter rate limit.
    expect(audits).toEqual([
      expect.objectContaining({
        p_interaction: "read",
        p_resource_type: "Binary",
        p_resource_id: DOC_A.id,
        p_patient_ids: [PATIENT_A.id],
        p_decision: "permit",
        p_http_status: 200,
      }),
    ]);
    expect(contexts[contexts.length - 1]).toMatchObject({ p_sensitive: true });
  });

  it("is refused the file of a clinic record (patient_uploads_only) without Storage being asked", async () => {
    const { call, storageCalls, documentQueries } = setup();
    const res = await call(`/fhir/R4/Binary/${DOC_A_CLINIC.id}`, { token: PAT_A });
    expect(res.status).toBe(404);
    expect(storageCalls()).toHaveLength(0);
    // The restriction is in the query itself.
    expect(decodeURIComponent(documentQueries()[0].url)).toContain("upload_source=eq.patient");
  });

  it("cannot reach another patient's file through a path with ../ in their own row", async () => {
    const { call, storageCalls } = setup();
    expect((await call(`/fhir/R4/Binary/${DOC_A_DOTS.id}`, { token: PAT_A })).status).toBe(404);
    expect((await call(`/fhir/R4/Binary/${DOC_A_DOTS.id}`, { token: DOCTOR })).status).toBe(404);
    expect(storageCalls()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Gateway: Binary downloads (staff)
// ---------------------------------------------------------------------------

describe("Binary downloads", () => {
  it("a doctor downloads a clinic record stored with the bucket prefix", async () => {
    const { call, storageCalls } = setup();
    const res = await call(`/fhir/R4/Binary/${DOC_A_CLINIC.id}`, { token: DOCTOR });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PNG clinic image");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="chest_x-ray.png"');
    // Fetched from the private bucket as the caller, never through a public or signed URL.
    expect(storageCalls().map((c) => new URL(c.url).pathname)).toEqual([
      `/storage/v1/object/authenticated/patient-documents/${PATIENT_A.id}/1756719100000.png`,
    ]);
  });

  it("serves a file declared as HTML as an octet-stream .bin download", async () => {
    const { call } = setup();
    const res = await call(`/fhir/R4/Binary/${DOC_A_HTML.id}`, { token: PAT_A });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="page.bin"');
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  it("refuses a stored URL or a file outside the patient's folder without asking Storage", async () => {
    const { call, storageCalls } = setup();
    for (const doc of [DOC_A_URL, DOC_A_WRONG_FOLDER]) {
      const res = await call(`/fhir/R4/Binary/${doc.id}`, { token: DOCTOR });
      expect(res.status, doc.id).toBe(404);
      expect(await res.text()).not.toMatch(/token=|B secret|B upload|storage/);
    }
    expect(storageCalls()).toHaveLength(0);
  });

  it("answers 404, never an empty file, when the object is missing, empty or refused by Storage", async () => {
    const { call } = setup();
    expect((await call(`/fhir/R4/Binary/${DOC_A_MISSING.id}`, { token: DOCTOR })).status).toBe(404);
    expect((await call(`/fhir/R4/Binary/${DOC_A_EMPTY.id}`, { token: DOCTOR })).status).toBe(404);
    const refusing = setup({ storageVisible: () => false });
    const res = await refusing.call(`/fhir/R4/Binary/${DOC_A.id}`, { token: DOCTOR });
    expect(res.status).toBe(404);
    expect(refusing.storageCalls()).toHaveLength(1);
  });

  it("authorises every download on its own, whatever was read before", async () => {
    const { call } = setup();
    expect((await call(`/fhir/R4/DocumentReference/${DOC_A.id}`, { token: DOCTOR })).status).toBe(200);
    expect((await call(`/fhir/R4/Binary/${DOC_A.id}`, { token: NURSE })).status).toBe(403);
    expect((await call(`/fhir/R4/Binary/${DOC_A.id}`, { token: PAT_B })).status).toBe(404);
  });

  it("only offers the file itself, never a FHIR JSON wrapper", async () => {
    const { call } = setup();
    const res = await call(`/fhir/R4/Binary/${DOC_A.id}`, { token: DOCTOR, headers: { Accept: "application/fhir+json" } });
    expect(res.status).toBe(406);
    // _format overrides Accept, so asking for JSON there is refused too.
    for (const f of ["json", "application/fhir+json"]) {
      const r = await call(`/fhir/R4/Binary/${DOC_A.id}?_format=${encodeURIComponent(f)}`, { token: DOCTOR });
      expect(r.status, f).toBe(406);
    }
  });
});

// ---------------------------------------------------------------------------
// Gateway: merged patients
// ---------------------------------------------------------------------------

describe("merged patients", () => {
  it("a search by the kept record includes documents still on the merged-away record, shown under the kept one", async () => {
    const { call } = setup();
    const b = await json(await call(`/fhir/R4/DocumentReference?patient=Patient/${PATIENT_A.fhir_id}`, { token: DOCTOR }));
    expect(ids(b)).toContain(DOC_M.id);
    const m = matches(b).find((d: Json) => d.id === DOC_M.id);
    expect(m.subject.reference).toBe(`Patient/${PATIENT_A.fhir_id}`);
    expect(JSON.stringify(b)).not.toContain(PATIENT_M.fhir_id);
  });

  it("a search by the merged-away record matches nothing and names the kept record", async () => {
    const { call } = setup();
    const b = await json(await call(`/fhir/R4/DocumentReference?patient=Patient/${PATIENT_M.fhir_id}`, { token: DOCTOR }));
    expect(matches(b)).toEqual([]);
    expect(outcomes(b)[0].diagnostics).toContain(`Patient/${PATIENT_A.fhir_id}`);
  });

  it("the file of a moved document is served from the merged-away record's folder to staff", async () => {
    const { call } = setup();
    const moved = await call(`/fhir/R4/Binary/${DOC_A_MOVED.id}`, { token: DOCTOR });
    expect(moved.status).toBe(200);
    expect(await moved.text()).toBe("%PDF moved");
    const onMerged = await call(`/fhir/R4/Binary/${DOC_M.id}`, { token: DOCTOR });
    expect(onMerged.status).toBe(200);
    // The patient's portal session cannot see the merged-away record, so the
    // file is not reachable for them (a false 404, like Storage's own rule).
    expect((await call(`/fhir/R4/Binary/${DOC_A_MOVED.id}`, { token: PAT_A })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Gateway: search parameters
// ---------------------------------------------------------------------------

describe("DocumentReference search", () => {
  const byA = `/fhir/R4/DocumentReference?patient=Patient/${PATIENT_A.fhir_id}`;
  const A_WITH_M = [...A_LIVE, DOC_M].map((d) => d.id).sort();

  it("filters by type (local codes only)", async () => {
    const { call } = setup();
    const q = async (v: string) => ids(await json(await call(`${byA}&type=${encodeURIComponent(v)}`, { token: DOCTOR })));
    expect(await q("imaging")).toEqual([DOC_A_CLINIC.id, DOC_A_URL.id, DOC_A_WRONG_FOLDER.id].sort());
    expect(await q("https://mbhr.app/codes/document-type|imaging")).toEqual([DOC_A_CLINIC.id, DOC_A_URL.id, DOC_A_WRONG_FOLDER.id].sort());
    // A type recorded as text only matches no code, not even "other".
    expect(await q("other")).toEqual([]);
    expect(await q("http://loinc.org|11502-2")).toEqual([]);
    expect(await q("Referral")).toEqual([]);
  });

  it("filters by category and status, and by date of upload", async () => {
    const { call } = setup();
    const q = async (v: string) => ids(await json(await call(`${byA}&${v}`, { token: DOCTOR })));
    expect(await q("category=staff")).toEqual([DOC_A_CLINIC.id, DOC_A_URL.id, DOC_A_WRONG_FOLDER.id].sort());
    expect(await q("category=https://mbhr.app/codes/document-source|patient")).toEqual(
      A_WITH_M.filter((id) => ![DOC_A_CLINIC.id, DOC_A_URL.id, DOC_A_WRONG_FOLDER.id].includes(id)),
    );
    expect(await q("category=caregiver")).toEqual([]);
    expect(await q("status=current")).toEqual(A_WITH_M);
    expect(await q("status=http://hl7.org/fhir/document-reference-status|current")).toEqual(A_WITH_M);
    expect(await q("status=entered-in-error")).toEqual([]);
    expect(await q("status=superseded")).toEqual([]);
    expect(await q("status=http://example.org|current")).toEqual([]);
    expect(await q("date=2026-09-04")).toEqual([DOC_A_HTML.id]);
    expect(await q("date=ge2026-09-02&date=lt2026-09-04")).toEqual([DOC_A_CLINIC.id, DOC_A_URL.id, DOC_A_WRONG_FOLDER.id].sort());
    expect(await q(`_id=${DOC_A.id}`)).toEqual([DOC_A.id]);
    expect(await q("_id=not-a-uuid")).toEqual([]);
  });

  it("refuses parameters it does not implement", async () => {
    const { call } = setup();
    for (const p of ["author=Practitioner/x", "period=2026", "_lastUpdated=ge2026", "contenttype=application/pdf", "type:text=x"]) {
      expect((await call(`${byA}&${p}`, { token: DOCTOR })).status, p).toBe(400);
    }
  });

  it("pages with a cursor, without duplicates or gaps", async () => {
    const { call } = setup();
    const seen: string[] = [];
    let url: string | null = `${byA}&_count=3`;
    let pages = 0;
    while (url && pages < 10) {
      const b = await json(await call(url, { token: DOCTOR }));
      expect(b.total).toBeUndefined();
      seen.push(...matches(b).map((d: Json) => d.id));
      const next = b.link.find((l: Json) => l.relation === "next");
      url = next ? next.url.replace("https://mbhr.app", "") : null;
      pages++;
    }
    expect(seen).toEqual(A_WITH_M);
    expect(pages).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Never published
// ---------------------------------------------------------------------------

describe("nothing forbidden is served", () => {
  it("no storage path, URL, bucket, account id, staff note, removed file or internal id appears in any response", async () => {
    const { call, served, logs, calls } = setup();
    const byA = `patient=Patient/${PATIENT_A.fhir_id}`;
    for (const [path, token] of [
      [`/fhir/R4/DocumentReference?${byA}`, DOCTOR],
      [`/fhir/R4/DocumentReference?${byA}&category=staff`, DOCTOR],
      ...A_LIVE.map((d) => [`/fhir/R4/DocumentReference/${d.id}`, DOCTOR]),
      ...A_LIVE.map((d) => [`/fhir/R4/DocumentReference/${d.id}`, PAT_A]),
      ...A_LIVE.map((d) => [`/fhir/R4/Binary/${d.id}`, DOCTOR]),
      ...A_LIVE.map((d) => [`/fhir/R4/Binary/${d.id}`, PAT_A]),
      [`/fhir/R4/DocumentReference/${DOC_M.id}`, DOCTOR],
      ["/fhir/R4/DocumentReference", PAT_A],
      [`/fhir/R4/Binary/${DOC_A_REMOVED.id}`, DOCTOR],
    ] as [string, string][]) {
      await call(path, { token });
    }
    const text = served.join("\n");
    for (const secret of [
      ...DOCS.map((d) => d.file_path),
      "patient-documents",
      "/storage/",
      "supabase",
      "token=",
      UPLOADER_UID,
      STAFF_UID,
      STAFF_NOTE,
      "internal-metadata-value",
      "%PDF removed",
      "B secret",
      PATIENT_A.id,
      PATIENT_M.id,
      "uploaded_by",
      "deleted_",
      "file_path",
      "upload_source",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    // Nor in what the CapabilityStatement says about these two types.
    const cs = await json(await call("/fhir/R4/metadata"));
    const mine = JSON.stringify(cs.rest[0].resource.filter((r: Json) => ["DocumentReference", "Binary"].includes(r.type)));
    expect(mine).toContain("DocumentReference");
    for (const secret of ["patient-documents", "file_path", "uploaded_by", "supabase", "/storage/"]) expect(mine, secret).not.toContain(secret);
    // Nor in the server log.
    const logText = logs.join("\n");
    for (const secret of [PATIENT_A.fhir_id, ...DOCS.map((d) => d.file_path), "blood test", DOC_A.description]) {
      expect(logText, secret).not.toContain(secret);
    }
    // The metadata never needed the path: only Binary reads selected file_path.
    for (const c of calls.filter((x) => x.url.includes("/rest/v1/patient_documents"))) {
      const select = new URL(c.url).searchParams.get("select") ?? "";
      expect(select).not.toMatch(/uploaded_by_user_id|deleted_by|updated_at|metadata/);
    }
  });
});
