import { describe, it, expect } from "vitest";
import {
  countChosen,
  decisionWinner,
  differingFields,
  formatConflictValue,
  recordedSelections,
  sameValue,
} from "./conflictDiff";
import type { ConflictField } from "@/services/conflictQueue";

const field = (
  name: string,
  localValue: unknown,
  remoteValue: unknown,
  type: ConflictField["type"] = "string",
): ConflictField => ({
  field: name,
  label: name,
  localValue,
  remoteValue,
  type,
  phiSensitivity: "none",
});

describe("formatConflictValue", () => {
  it("marks empty values", () => {
    expect(formatConflictValue(null)).toBe("(empty)");
    expect(formatConflictValue("")).toBe("(empty)");
    expect(formatConflictValue([])).toBe("(none)");
  });

  it("shows date-only values as dd/mm/yyyy without timezone shifts", () => {
    expect(formatConflictValue("1990-05-01", "date")).toBe("01/05/1990");
    expect(formatConflictValue("1990-05-01")).toBe("01/05/1990");
  });

  it("formats booleans, numbers and simple lists", () => {
    expect(formatConflictValue(true)).toBe("Yes");
    expect(formatConflictValue(72, "number")).toBe("72");
    expect(formatConflictValue(["Malaria", "Typhoid"])).toBe("Malaria, Typhoid");
  });

  it("falls back to JSON for objects", () => {
    expect(formatConflictValue({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe("differingFields", () => {
  it("drops fields whose values read the same", () => {
    const fields = [
      field("pulseBpm", 72, "72", "number"),
      field("phone", "0803", "0805"),
      field("note", null, ""),
    ];
    expect(differingFields(fields).map((f) => f.field)).toEqual(["phone"]);
    expect(sameValue(72, "72")).toBe(true);
  });
});

describe("recorded decisions", () => {
  const fields = [field("phone", "0803", "0805"), field("address", "Ikeja", "Yaba")];

  it("expands keep-all strategies to every differing field", () => {
    expect(
      recordedSelections({ resolutionStrategy: "keep_remote", conflictDetails: { fields } }),
    ).toEqual({ phone: "remote", address: "remote" });
  });

  it("reads field choices for manual decisions and ignores junk", () => {
    const sel = recordedSelections({
      resolutionStrategy: "manual",
      resolutionDetails: { fieldResolutions: { phone: "local", address: "remote", x: "both" } },
      conflictDetails: { fields },
    });
    expect(sel).toEqual({ phone: "local", address: "remote" });
  });

  it("reports which side won", () => {
    expect(decisionWinner({ resolutionStrategy: "keep_local", conflictDetails: { fields } })).toBe("local");
    expect(decisionWinner({ resolutionStrategy: "ignore", conflictDetails: { fields } })).toBe("none");
    expect(
      decisionWinner({
        resolutionStrategy: "manual",
        resolutionDetails: { fieldResolutions: { phone: "local", address: "remote" } },
        conflictDetails: { fields },
      }),
    ).toBe("mixed");
    expect(decisionWinner({ conflictDetails: { fields } })).toBe("unknown");
    expect(
      decisionWinner({ resolutionStrategy: "manual", resolutionDetails: { bulk: true }, conflictDetails: { fields } }),
    ).toBe("unknown");
  });

  it("counts chosen fields", () => {
    expect(countChosen(fields, { phone: "local" })).toEqual({ chosen: 1, total: 2 });
  });
});
