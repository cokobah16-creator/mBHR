import { describe, it, expect } from "vitest";
import { assessDedupeMatch } from "./dedupeMatch";

const amina = {
  givenName: "Amina",
  familyName: "Bello",
  phone: "+2348031234567",
  dob: "2020-01-01",
  sex: "female",
};

describe("assessDedupeMatch", () => {
  it("calls the same name, phone and birth date likely the same person", () => {
    const match = assessDedupeMatch(amina, { ...amina, givenName: " amina " });
    expect(match.label).toBe("Likely the same person");
    expect(match.tone).toBe("warning");
    expect(match.maybeRelative).toBe(false);
  });

  it("does not call siblings on a family phone with the same birth date the same person", () => {
    const sibling = { ...amina, givenName: "Hauwa" };
    const match = assessDedupeMatch(amina, sibling);
    expect(match.score).toBeGreaterThanOrEqual(70);
    expect(match.label).toBe("Possible match");
    expect(match.tone).toBe("info");
    expect(match.maybeRelative).toBe(true);
  });

  it("still finds the same person registered without a phone", () => {
    const match = assessDedupeMatch(amina, { ...amina, phone: "" });
    expect(match.label).toBe("Likely the same person");
    expect(match.maybeRelative).toBe(false);
  });

  it("does not count two empty names as a match", () => {
    const match = assessDedupeMatch(
      { phone: "+2348031234567" },
      { phone: "+2348031234567" },
    );
    expect(match.score).toBe(50);
    expect(match.label).toBe("Possible match");
  });

  it("marks a weak match", () => {
    const match = assessDedupeMatch(amina, {
      givenName: "Musa",
      familyName: "Bello",
      phone: "+2348099999999",
      dob: "1990-01-01",
      sex: "male",
    });
    expect(match.label).toBe("Weak match");
    expect(match.tone).toBe("neutral");
  });
});
