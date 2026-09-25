import { describe, it, expect } from "vitest";
import { pharmacyConsultation } from "./visitConsultation";

const now = new Date("2026-09-25T11:00:00");
const consult = (id: string, visitId: string, createdAt: Date | string) => ({ id, visitId, createdAt: createdAt as Date });

describe("pharmacyConsultation", () => {
  it("shows today's consultation of this visit as current", () => {
    const today = consult("c2", "v2", new Date("2026-09-25T09:30:00"));
    const old = consult("c1", "v1", new Date("2026-08-01T10:00:00"));
    expect(pharmacyConsultation([old, today], "v2", now)).toEqual({ kind: "current", consultation: today });
  });

  it("never shows an older visit's plan as current", () => {
    const old = consult("c1", "v1", new Date("2026-08-01T10:00:00"));
    expect(pharmacyConsultation([old], "v2", now)).toEqual({ kind: "earlier", consultation: old });
  });

  it("shows the most recent earlier consultation when this visit has none", () => {
    const older = consult("c1", "v1", new Date("2026-07-01T10:00:00"));
    const newer = consult("c2", "v3", "2026-09-10T10:00:00.000Z");
    expect(pharmacyConsultation([newer, older], "v2", now).consultation).toBe(newer);
    expect(pharmacyConsultation([older, newer], "v2", now).consultation).toBe(newer);
  });

  it("treats this visit's consultation from another day as earlier", () => {
    const yesterday = consult("c1", "v2", new Date("2026-09-24T16:00:00"));
    expect(pharmacyConsultation([yesterday], "v2", now).kind).toBe("earlier");
  });

  it("treats a consultation from today on another visit as earlier", () => {
    const otherVisit = consult("c1", "v1", new Date("2026-09-25T08:00:00"));
    expect(pharmacyConsultation([otherVisit], "v2", now).kind).toBe("earlier");
  });

  it("reports none when the patient has no consultation", () => {
    expect(pharmacyConsultation([], "v2", now)).toEqual({ kind: "none" });
  });
});
