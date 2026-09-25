import { describe, it, expect } from "vitest";
import { isRecognisedAllergen, matchMedicationToAllergen, uncheckedAllergens } from "./allergyMatch";

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

describe("isRecognisedAllergen", () => {
  it("knows drugs and drug classes on the list", () => {
    expect(isRecognisedAllergen("Penicillin")).toBe(true);
    expect(isRecognisedAllergen("Sulfa drugs")).toBe(true);
    expect(isRecognisedAllergen("amoxicillin")).toBe(true);
  });

  it("does not know foods, other drugs or spellings the list does not have", () => {
    expect(isRecognisedAllergen("Peanuts")).toBe(false);
    expect(isRecognisedAllergen("Chloroquine")).toBe(false);
    expect(isRecognisedAllergen("Penicilin")).toBe(false);
    expect(isRecognisedAllergen("")).toBe(false);
  });

  it("knows a list only when every allergen in it is on the list", () => {
    expect(isRecognisedAllergen("Penicillin, amoxicillin")).toBe(true);
    expect(isRecognisedAllergen("Co-amoxiclav")).toBe(true);
    expect(isRecognisedAllergen("Penicillin group antibiotics")).toBe(true);
    expect(isRecognisedAllergen("Penicillin, codeine")).toBe(false);
    expect(isRecognisedAllergen("Sulfa and chloroquine")).toBe(false);
    expect(isRecognisedAllergen("Penicillin and other antibiotics")).toBe(false);
    expect(isRecognisedAllergen("Drugs")).toBe(false);
  });

  it("does not read a salt name as a drug class", () => {
    expect(isRecognisedAllergen("Quinine sulphate")).toBe(false);
    expect(isRecognisedAllergen("Salbutamol sulphate")).toBe(false);
    expect(isRecognisedAllergen("Morphine sulfate")).toBe(false);
  });
});

describe("uncheckedAllergens", () => {
  it("asks for a check by hand when an allergen is spelt differently from the list", () => {
    // No match is guessed: the misspelt allergen is shown, never dropped.
    expect(matchMedicationToAllergen("Amoxicillin 500 mg", "Penicilin")).toBeNull();
    expect(uncheckedAllergens(["Amoxicillin 500 mg"], ["Penicilin"])).toEqual(["Penicilin"]);
  });

  it("asks for a check by hand for allergens that are not medicines", () => {
    expect(uncheckedAllergens(["Paracetamol 500mg"], ["Peanuts", "Latex"])).toEqual(["Peanuts", "Latex"]);
  });

  it("asks for a check by hand for a salt name or a list with an unknown allergen", () => {
    expect(uncheckedAllergens(["Quinine 300mg"], ["Quinine sulphate"])).toEqual(["Quinine sulphate"]);
    expect(uncheckedAllergens(["Codeine 30mg"], ["Penicillin, codeine"])).toEqual(["Penicillin, codeine"]);
  });

  it("clears a recognised allergen that does not match the medicine", () => {
    expect(uncheckedAllergens(["Paracetamol 500mg"], ["Penicillin", "Sulfa drugs"])).toEqual([]);
  });

  it("leaves an allergen that matches a medicine to the match warning", () => {
    expect(uncheckedAllergens(["Chloroquine 250mg"], ["Chloroquine"])).toEqual([]);
    expect(uncheckedAllergens(["Paracetamol 500mg"], ["Chloroquine"])).toEqual(["Chloroquine"]);
    expect(uncheckedAllergens(["Paracetamol 500mg", "Chloroquine 250mg"], ["Chloroquine"])).toEqual([]);
  });

  it("lists each allergen once and skips blanks", () => {
    expect(uncheckedAllergens(["Paracetamol"], ["Peanuts", " peanuts ", "", "  "])).toEqual(["Peanuts"]);
  });

  it("lists unrecognised allergens even before a medicine is chosen", () => {
    expect(uncheckedAllergens([], ["Peanuts", "Penicillin"])).toEqual(["Peanuts"]);
  });
});
