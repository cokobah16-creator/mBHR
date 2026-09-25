import { describe, it, expect } from "vitest";
import {
  allPrivacyStrings,
  BANNED_WORDS,
  containsBannedWord,
  PRIVACY_COPY,
  REFUSAL_LABEL,
} from "./privacyCopy";

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
    // What the list is: the consent register, kept apart from the sharing
    // choices lower down, and not applied on its own yet.
    expect(text).toContain(
      "This list shows choices about sharing your records that are recorded in mBHR's consent register.",
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
