import { describe, it, expect } from "vitest";
import {
  hasProfilesMissingFrom,
  mergeManagedPatients,
  parsePortalAccounts,
  relationshipLabel,
  withManagedPatient,
  withoutManagedPatient,
} from "./caregiverAccess";

const ada = {
  patientId: "p-ada",
  givenName: "Ada",
  familyName: "Obi",
  relationship: "child",
};
const chidi = {
  patientId: "p-chidi",
  givenName: "Chidi",
  familyName: "Obi",
  relationship: "parent",
};

describe("withManagedPatient", () => {
  it("appends to an empty or missing list", () => {
    expect(withManagedPatient(undefined, ada)).toEqual([ada]);
    expect(withManagedPatient([], ada)).toEqual([ada]);
  });

  it("replaces an existing entry for the same patient instead of duplicating", () => {
    const renamed = { ...ada, relationship: "other" };
    expect(withManagedPatient([ada, chidi], renamed)).toEqual([chidi, renamed]);
  });

  it("does not mutate the input list", () => {
    const list = [chidi];
    withManagedPatient(list, ada);
    expect(list).toEqual([chidi]);
  });
});

describe("withoutManagedPatient", () => {
  it("removes only the named patient", () => {
    expect(withoutManagedPatient([ada, chidi], "p-ada")).toEqual([chidi]);
  });

  it("is a no-op for an unknown id or missing list", () => {
    expect(withoutManagedPatient([ada], "nobody")).toEqual([ada]);
    expect(withoutManagedPatient(undefined, "p-ada")).toEqual([]);
  });
});

describe("mergeManagedPatients", () => {
  it("unions lists and keeps the first occurrence of each patient", () => {
    const older = { ...ada, relationship: "other" };
    expect(mergeManagedPatients([ada], [older, chidi])).toEqual([ada, chidi]);
  });

  it("skips malformed entries", () => {
    const bad = [null, { givenName: "x" }] as unknown as typeof ada[];
    expect(mergeManagedPatients(bad, [chidi])).toEqual([chidi]);
  });
});

describe("hasProfilesMissingFrom", () => {
  it("is true when the account has a profile the session does not list", () => {
    expect(hasProfilesMissingFrom([], [ada])).toBe(true);
    expect(hasProfilesMissingFrom(undefined, [ada])).toBe(true);
    expect(hasProfilesMissingFrom([ada], [ada, chidi])).toBe(true);
  });

  it("is false when the session already lists every profile", () => {
    expect(hasProfilesMissingFrom([ada, chidi], [chidi])).toBe(false);
    expect(hasProfilesMissingFrom([], [])).toBe(false);
  });

  it("ignores malformed session entries", () => {
    const bad = [null] as unknown as typeof ada[];
    expect(hasProfilesMissingFrom(bad, [ada])).toBe(true);
  });
});

describe("parsePortalAccounts", () => {
  it("returns [] for missing, invalid or non-array JSON", () => {
    expect(parsePortalAccounts(null)).toEqual([]);
    expect(parsePortalAccounts("{not json")).toEqual([]);
    expect(parsePortalAccounts('{"id":"u1"}')).toEqual([]);
  });

  it("parses a stored account list", () => {
    expect(parsePortalAccounts('[{"id":"u1"}]')).toEqual([{ id: "u1" }]);
  });
});

describe("relationshipLabel", () => {
  it("describes known relationships in plain words", () => {
    expect(relationshipLabel("child")).toBe("My child");
    expect(relationshipLabel("spouse")).toBe("My spouse or partner");
  });

  it("falls back to Other for unknown values", () => {
    expect(relationshipLabel("cousin")).toBe("Other");
  });
});
