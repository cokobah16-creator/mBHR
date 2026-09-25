import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Patient } from "@/db";

const rows = new Map<string, Partial<Patient> & { id: string }>();

vi.mock("@/db", () => ({
  db: {
    patients: {
      get: vi.fn((id: string) => Promise.resolve(rows.get(id))),
    },
  },
}));

import { activePatientFor, activePatientId, allergyPatientIds } from "./activePatient";

const patient = (id: string, mergeInto?: string) =>
  ({ id, givenName: "Ngozi", familyName: "Eze", mergeInto }) as Patient;

describe("activePatient", () => {
  beforeEach(() => {
    rows.clear();
  });

  it("returns the record itself when it was not merged", async () => {
    rows.set("kept", patient("kept"));
    expect(await activePatientId("kept")).toBe("kept");
    expect(await allergyPatientIds("kept")).toEqual(["kept"]);
    expect((await activePatientFor(patient("kept"))).id).toBe("kept");
  });

  it("follows a merged-away record to the kept record", async () => {
    rows.set("old", patient("old", "kept"));
    rows.set("kept", patient("kept"));
    expect(await activePatientId("old")).toBe("kept");
    expect((await activePatientFor(patient("old", "kept"))).id).toBe("kept");
  });

  it("screens allergies on both the chosen and the kept record", async () => {
    rows.set("old", patient("old", "kept"));
    rows.set("kept", patient("kept"));
    expect(await allergyPatientIds("old")).toEqual(["old", "kept"]);
  });

  it("follows a chain of merges", async () => {
    rows.set("a", patient("a", "b"));
    rows.set("b", patient("b", "c"));
    rows.set("c", patient("c"));
    expect(await activePatientId("a")).toBe("c");
  });

  it("keeps the chosen record when the kept one is not on this device", async () => {
    const old = patient("old", "missing");
    rows.set("old", old);
    expect(await activePatientFor(old)).toBe(old);
    expect(await activePatientId("old")).toBe("old");
    expect(await allergyPatientIds("old")).toEqual(["old"]);
  });
});
