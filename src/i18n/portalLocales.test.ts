import { describe, it, expect } from "vitest";
import en from "./locales/en.json";
import ha from "./locales/ha.json";
import yo from "./locales/yo.json";
import ig from "./locales/ig.json";
import pcm from "./locales/pcm.json";

/*
 * Guards for the patient portal's wording (portal.* keys). A missing key
 * shows the key itself to a patient, and a missing {{placeholder}} drops a
 * date or a count from a sentence, so both fail here instead.
 */

type Locale = Record<string, string>;

const OTHERS: Record<string, Locale> = { ha, yo, ig, pcm };
const EN = en as Locale;
const PORTAL_KEYS = Object.keys(EN).filter((k) => k.startsWith("portal."));

// Source text of the portal and the services it uses, keyed "/src/...".
const SOURCES = import.meta.glob(
  ["/src/features/patient-portal/**/*.{ts,tsx}", "/src/services/**/*.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const KEY_USE = /\bt\(\s*["'](portal\.[A-Za-z0-9_.]+)["']/g;

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
}

describe("portal wording in every language", () => {
  it("has portal wording to check", () => {
    expect(PORTAL_KEYS.length).toBeGreaterThan(100);
  });

  it.each(Object.keys(OTHERS))("%s has every portal key, with a value", (lang) => {
    const locale = OTHERS[lang];
    const missing = PORTAL_KEYS.filter((k) => !locale[k]?.trim());
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(OTHERS))("%s keeps the same {{placeholders}} as English", (lang) => {
    const locale = OTHERS[lang];
    const mismatched = PORTAL_KEYS.filter(
      (k) =>
        locale[k] !== undefined &&
        placeholders(locale[k]).join(",") !== placeholders(EN[k]).join(","),
    );
    expect(mismatched).toEqual([]);
  });

  it("has an English value for every portal key the code asks for by name", () => {
    const missing: string[] = [];
    for (const [file, text] of Object.entries(SOURCES)) {
      if (file.includes(".test.")) continue;
      for (const m of text.matchAll(KEY_USE)) {
        if (!(m[1] in EN)) missing.push(`${file}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
