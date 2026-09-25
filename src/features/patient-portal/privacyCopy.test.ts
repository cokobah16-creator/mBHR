import { describe, it, expect } from "vitest";
import {
  allPrivacyStrings,
  BANNED_WORDS,
  containsBannedWord,
  PRIVACY_COPY,
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
    expect(text).toContain("mBHR does not share your records with outside organisations or apps.");
    expect(text).toContain("You can withdraw it at any time.");
    expect(text).toContain(
      "It does not delete your records or the history of who looked at them.",
    );
  });

  it("keeps sentences short", () => {
    for (const s of allPrivacyStrings()) {
      for (const sentence of s.split(/(?<=[.?])\s+/)) {
        expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
      }
    }
  });
});
