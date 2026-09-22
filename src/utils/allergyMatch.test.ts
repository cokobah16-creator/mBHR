import { describe, it, expect } from "vitest";
import { matchMedicationToAllergen } from "./allergyMatch";

describe("matchMedicationToAllergen", () => {
  it("matches by name", () => {
    expect(matchMedicationToAllergen("Penicillin V 250mg", "penicillin")).toEqual({
      kind: "direct",
    });
  });

  it("catches amoxicillin for a penicillin allergy", () => {
    expect(matchMedicationToAllergen("Amoxicillin 500 mg caps", "Penicillin")).toEqual({
      kind: "class",
      drugClass: "penicillin",
    });
  });

  it("catches co-trimoxazole for a sulfa allergy", () => {
    expect(matchMedicationToAllergen("Co-trimoxazole 480mg", "Sulfa drugs")?.drugClass).toBe(
      "sulfonamide",
    );
  });

  it("flags other NSAIDs when aspirin is the recorded allergen", () => {
    expect(matchMedicationToAllergen("Ibuprofen 400mg", "Aspirin")?.kind).toBe("class");
  });

  it("does not match unrelated drugs", () => {
    expect(matchMedicationToAllergen("Aspirin", "Penicillin")).toBeNull();
    expect(matchMedicationToAllergen("Paracetamol 500mg", "Penicillin")).toBeNull();
    expect(matchMedicationToAllergen("", "Penicillin")).toBeNull();
  });
});
