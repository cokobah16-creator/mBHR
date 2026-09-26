import { describe, it, expect } from "vitest";
import { parseMyConsents } from "@/services/interopConsent";
import {
  allPrivacyStrings,
  BANNED_WORDS,
  consentNote,
  consentTitle,
  containsBannedWord,
  PRIVACY_COPY,
  REFUSAL_LABEL,
} from "./privacyCopy";

const NOW = new Date("2026-09-25T12:00:00Z");

/** One parsed list item with these provisions. */
function item(provisions: Record<string, unknown>[], scope = "patient-privacy") {
  const [parsed] = parseMyConsents(
    [
      {
        id: "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c01",
        status: "active",
        scope,
        effective_from: "2026-01-01T00:00:00Z",
        withdrawn: false,
        withdrawn_at: null,
        provisions,
      },
    ],
    NOW,
  );
  return parsed;
}

describe("privacy section wording", () => {
  it("never uses technical words", () => {
    const offending = allPrivacyStrings().filter(containsBannedWord);
    expect(offending).toEqual([]);
  });

  it("detects the banned words", () => {
    for (const w of BANNED_WORDS) expect(containsBannedWord(`a ${w.toUpperCase()} b`)).toBe(true);
    expect(containsBannedWord("scoped")).toBe(false);
  });

  it("says what the owner asked for", () => {
    const text = PRIVACY_COPY.intro.join(" ");
    expect(text).toContain("The mBHR care team uses your records to care for you.");
    // What the list is: the choices mBHR has recorded, kept apart from the
    // sharing choices lower down, and not applied on its own yet.
    expect(text).toContain(
      "This list shows the choices about sharing your records that mBHR has recorded for you.",
    );
    expect(text).toContain("It is separate from your sharing choices further down this page.");
    expect(text).toContain("mBHR does not apply these choices automatically yet.");
    expect(text).toContain("You can withdraw a permission here. To change a refusal, ask clinic staff.");
    expect(text).toContain(
      "Withdrawing does not delete your records or the history of who looked at them.",
    );
    expect(PRIVACY_COPY.listTitle).toBe("Your recorded choices");
    expect(PRIVACY_COPY.empty).toBe("No choices are recorded here.");
  });

  it("never claims that mBHR shares nothing", () => {
    const text = allPrivacyStrings().join(" ");
    expect(text).not.toMatch(/does not share|do not share your records with|not given permission to share/i);
    expect(text).not.toMatch(/stops future sharing|will not be shared/i);
  });

  it("says in the withdraw dialog exactly what withdrawing does", () => {
    expect(PRIVACY_COPY.withdrawBody).toStrictEqual([
      "mBHR will record that you withdrew this permission. It will no longer count as your permission.",
      "You cannot undo this here. To give permission again, ask clinic staff.",
      "Your records stay with the mBHR care team. The history of who looked at them is kept.",
    ]);
  });

  it("names a refusal as the patient's own refusal", () => {
    expect(REFUSAL_LABEL.sharing).toBe("You asked us not to share your records outside mBHR");
    expect(REFUSAL_LABEL.research).toBe("You asked us not to use your records for research");
    expect(PRIVACY_COPY.askStaff).toBe("Ask clinic staff if you want to change this.");
  });

  it("uses plain words for the list (no \"consent register\")", () => {
    for (const s of allPrivacyStrings()) expect(s).not.toMatch(/register/i);
  });

  it("names a refusal only when it is for someone outside mBHR", () => {
    for (const actor of ["external_system", "organization", "any", null]) {
      const refusal = item([{ provision_type: "deny", actor_type: actor }]);
      expect(consentTitle(refusal)).toBe("You asked us not to share your records outside mBHR");
      expect(consentNote(refusal)).toBe("Ask clinic staff if you want to change this.");
    }
    for (const actor of ["care_team", "practitioner"]) {
      const choice = item([{ provision_type: "deny", actor_type: actor }]);
      expect(consentTitle(choice)).toBe("A choice about how your records are shared");
      expect(consentNote(choice)).toBe("Ask clinic staff about it.");
    }
    const research = item([{ provision_type: "deny", actor_type: "care_team" }], "research");
    expect(consentTitle(research)).toBe("A choice about how your records are used for research");
  });

  it("never repeats the topic in the purposes", () => {
    const refusal = item(
      [{ provision_type: "deny", actor_type: "organization", purpose: "HRESCH" }],
      "research",
    );
    expect(consentTitle(refusal)).toBe("You asked us not to use your records for research");
    const permit = item(
      [{ provision_type: "permit", actor_type: "organization", purpose: "HRESCH" }],
      "research",
    );
    expect(consentTitle(permit)).toBe("Using your records for research");
    // Another topic keeps the purpose.
    const sharing = item([{ provision_type: "deny", actor_type: "organization", purpose: "HRESCH" }]);
    expect(consentTitle(sharing)).toBe(
      "You asked us not to share your records outside mBHR (for research)",
    );
    for (const s of [refusal, permit, sharing].map(consentTitle)) {
      expect(s).not.toMatch(/for research \(for research\)/);
    }
  });

  it("never reads a refusal as \"when you ask for it\"", () => {
    const patientRequest = item([
      { provision_type: "deny", actor_type: "external_system", purpose: "PATRQT" },
    ]);
    expect(consentTitle(patientRequest)).toBe("A choice about how your records are shared");
    expect(consentNote(patientRequest)).toBe("Ask clinic staff about it.");
    const mixed = item([
      { provision_type: "deny", actor_type: "external_system", purpose: "PATRQT" },
      { provision_type: "deny", actor_type: "organization", purpose: "HRESCH" },
    ]);
    expect(consentTitle(mixed)).not.toContain("when you ask for it");
    // A permission may still say it.
    const permit = item([
      { provision_type: "permit", actor_type: "external_system", purpose: "PATRQT" },
    ]);
    expect(consentTitle(permit)).toBe("Sharing your records outside mBHR (when you ask for it)");
    expect(consentNote(permit)).toBeNull();
  });

  it("says when a refusal also allows something, and when a record says nothing", () => {
    const mixed = item([
      { provision_type: "permit", actor_type: "external_system", purpose: "PATRQT" },
      { provision_type: "deny", actor_type: "organization", purpose: "HRESCH" },
    ]);
    expect(consentNote(mixed)).toBe(
      "This choice also allows some sharing. Ask clinic staff if you want to change this.",
    );
    const empty = item([]);
    expect(consentTitle(empty)).toBe("A choice about sharing your records outside mBHR");
    expect(consentNote(empty)).toBe("It does not say what is allowed. Ask clinic staff about it.");
  });

  it("uses no em-dashes", () => {
    for (const s of allPrivacyStrings()) expect(s).not.toContain("\u2014");
  });

  it("keeps sentences short", () => {
    for (const s of allPrivacyStrings()) {
      for (const sentence of s.split(/(?<=[.?])\s+/)) {
        expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
      }
    }
  });
});
