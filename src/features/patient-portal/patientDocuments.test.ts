import { describe, it, expect } from "vitest";
import {
  buildDocumentInsert,
  canPatientRemove,
  documentSourceLabel,
  documentStoragePath,
  isConnectionFailure,
  readRemoveResult,
  toPortalDocument,
  visiblePortalDocuments,
} from "./patientDocuments";

describe("toPortalDocument", () => {
  it("reads the current column names", () => {
    expect(
      toPortalDocument({
        id: "d1",
        document_name: "Scan.pdf",
        document_type: "imaging",
        file_size: 2048,
        created_at: "2026-09-01T10:00:00Z",
        description: "Chest X-ray",
        upload_source: "patient",
        deleted_at: null,
        file_path: "p1/1700000000000.pdf",
      }),
    ).toEqual({
      id: "d1",
      name: "Scan.pdf",
      documentType: "imaging",
      fileSize: 2048,
      createdAt: "2026-09-01T10:00:00Z",
      description: "Chest X-ray",
      source: "patient",
      removed: false,
      filePath: "p1/1700000000000.pdf",
    });
  });

  it("reads the older column names", () => {
    const doc = toPortalDocument({
      id: "d2",
      file_name: "Letter.pdf",
      document_type: "other",
      file_size: "10",
      upload_date: "2026-08-01T10:00:00Z",
      upload_source: "staff",
    });
    expect(doc?.name).toBe("Letter.pdf");
    expect(doc?.fileSize).toBe(10);
    expect(doc?.createdAt).toBe("2026-08-01T10:00:00Z");
    expect(doc?.source).toBe("staff");
    expect(doc?.filePath).toBeNull();
  });

  it("reads the file path without the bucket name in front", () => {
    expect(
      toPortalDocument({ id: "d5", storage_path: "patient-documents/p1/a.png" })?.filePath,
    ).toBe("p1/a.png");
  });

  it("treats a row without a known upload_source as a clinic record", () => {
    expect(toPortalDocument({ id: "d3" })?.source).toBe("staff");
    expect(toPortalDocument({ id: "d3", upload_source: "PATIENT" })?.source).toBe("staff");
  });

  it("marks removed rows", () => {
    expect(toPortalDocument({ id: "d4", deleted_at: "2026-09-02T00:00:00Z" })?.removed).toBe(true);
  });

  it("drops rows without an id and non-objects", () => {
    expect(toPortalDocument({ document_name: "x" })).toBeNull();
    expect(toPortalDocument(null)).toBeNull();
    expect(toPortalDocument("row")).toBeNull();
    expect(toPortalDocument([])).toBeNull();
  });

  it("does not invent a size or date", () => {
    const doc = toPortalDocument({ id: "d5", file_size: "abc" });
    expect(doc?.fileSize).toBeNull();
    expect(doc?.createdAt).toBeNull();
    expect(doc?.name).toBe("Document");
  });
});

describe("visiblePortalDocuments", () => {
  it("hides removed rows and sorts newest first", () => {
    const docs = visiblePortalDocuments([
      { id: "old", created_at: "2026-01-01T00:00:00Z", upload_source: "staff" },
      { id: "gone", created_at: "2026-09-01T00:00:00Z", deleted_at: "2026-09-02T00:00:00Z" },
      { id: "new", created_at: "2026-06-01T00:00:00Z", upload_source: "patient" },
      { nope: true },
    ]);
    expect(docs.map((d) => d.id)).toEqual(["new", "old"]);
  });

  it("returns an empty list for anything that is not an array", () => {
    expect(visiblePortalDocuments(null)).toEqual([]);
    expect(visiblePortalDocuments({})).toEqual([]);
  });
});

describe("canPatientRemove and documentSourceLabel", () => {
  it("offers removal only for the patient's own uploads", () => {
    const own = toPortalDocument({ id: "a", upload_source: "patient" });
    const clinic = toPortalDocument({ id: "b", upload_source: "staff" });
    expect(own && canPatientRemove(own)).toBe(true);
    expect(clinic && canPatientRemove(clinic)).toBe(false);
    expect(own && canPatientRemove({ ...own, removed: true })).toBe(false);
  });

  it("labels the source in words", () => {
    expect(documentSourceLabel("patient")).toBe("Uploaded by you");
    expect(documentSourceLabel("staff")).toBe("Clinic record");
  });
});

describe("documentStoragePath", () => {
  it("puts the file in the patient's folder", () => {
    expect(documentStoragePath("P1", "Scan.PDF", 1700000000000)).toBe("P1/1700000000000.pdf");
  });

  it("leaves out a missing or unusual extension", () => {
    expect(documentStoragePath("P1", "scan", 1)).toBe("P1/1");
    expect(documentStoragePath("P1", ".hidden", 1)).toBe("P1/1");
    expect(documentStoragePath("P1", "a.p d f", 1)).toBe("P1/1");
  });
});

describe("buildDocumentInsert", () => {
  it("never sends ownership or removal columns", () => {
    const row = buildDocumentInsert({
      patientId: "P1",
      fileName: "Scan.pdf",
      fileType: "application/pdf",
      fileSize: 10,
      documentType: "imaging",
      description: "  ",
      storagePath: "P1/1.pdf",
    });
    expect(row).toEqual({
      patient_id: "P1",
      document_type: "imaging",
      document_name: "Scan.pdf",
      file_path: "P1/1.pdf",
      file_size: 10,
      mime_type: "application/pdf",
      description: null,
    });
    expect(Object.keys(row)).not.toContain("upload_source");
    expect(Object.keys(row)).not.toContain("uploaded_by_user_id");
    expect(Object.keys(row)).not.toContain("deleted_at");
  });
});

describe("readRemoveResult", () => {
  it("reads each server answer", () => {
    expect(readRemoveResult({ outcome: "applied", already_removed: false })).toBe("removed");
    expect(readRemoveResult({ outcome: "applied", already_removed: true })).toBe("already_removed");
    expect(readRemoveResult({ outcome: "rejected", reason: "clinic_document" })).toBe("clinic_document");
    expect(readRemoveResult({ outcome: "rejected", reason: "not_found" })).toBe("not_found");
  });

  it("does not report a removal it cannot read", () => {
    expect(readRemoveResult(null)).toBe("unexpected");
    expect(readRemoveResult({})).toBe("unexpected");
    expect(readRemoveResult({ outcome: "rejected", reason: "other" })).toBe("unexpected");
    expect(readRemoveResult([{ outcome: "applied" }])).toBe("unexpected");
  });
});

describe("isConnectionFailure", () => {
  it("is true whenever the device is offline", () => {
    expect(isConnectionFailure({ code: "42501" }, false)).toBe(true);
  });

  it("recognises fetch and network failures", () => {
    expect(isConnectionFailure(new TypeError("Failed to fetch"), true)).toBe(true);
    expect(isConnectionFailure({ name: "StorageUnknownError" }, true)).toBe(true);
    expect(isConnectionFailure({ message: "TypeError: Failed to fetch", code: "" }, true)).toBe(true);
    expect(isConnectionFailure({ message: "AbortError: signal is aborted", code: "" }, true)).toBe(true);
    expect(isConnectionFailure({ message: "TypeError: Load failed" }, true)).toBe(true);
  });

  it("is false for an answer from the server", () => {
    expect(isConnectionFailure({ message: "permission denied", code: "42501" }, true)).toBe(false);
    expect(isConnectionFailure({ message: "Failed to fetch", code: "PGRST202" }, true)).toBe(false);
    expect(isConnectionFailure(new Error("boom"), true)).toBe(false);
    expect(isConnectionFailure(null, true)).toBe(false);
  });
});
