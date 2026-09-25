// Medication ↔ recorded allergen matching.
//
// A plain substring check misses the most common dangerous case at an
// outreach: an allergy recorded as "Penicillin" and a prescription for
// "Amoxicillin 500 mg". This adds a small, conservative map of drug classes
// commonly stocked at outreaches. It errs toward warning: a match means
// "check before dispensing", not a diagnosis. Every active allergy is
// screened whatever type it was recorded as; an allergen the list does not
// know is shown for a check by hand (uncheckedAllergens).

export interface AllergyMatch {
  kind: "direct" | "class";
  /** Human-readable class name when matched by class, e.g. "penicillin". */
  drugClass?: string;
}

const DRUG_CLASSES: Record<string, { aliases: string[]; members: string[] }> = {
  penicillin: {
    aliases: ["penicillin", "penicillins", "beta-lactam", "beta lactam"],
    members: [
      "penicillin",
      "amoxicillin",
      "amoxycillin",
      "ampicillin",
      "cloxacillin",
      "flucloxacillin",
      "dicloxacillin",
      "augmentin",
      "amoxiclav",
      "co-amoxiclav",
      "ampiclox",
      "benzathine",
      "piperacillin",
    ],
  },
  sulfonamide: {
    aliases: ["sulfa", "sulpha", "sulfonamide", "sulphonamide", "sulfonamides"],
    members: [
      "sulfamethoxazole",
      "sulphamethoxazole",
      "co-trimoxazole",
      "cotrimoxazole",
      "septrin",
      "bactrim",
      "sulfadoxine",
      "fansidar",
      "sulfasalazine",
    ],
  },
  NSAID: {
    aliases: ["nsaid", "nsaids", "anti-inflammatory"],
    members: [
      "aspirin",
      "ibuprofen",
      "diclofenac",
      "naproxen",
      "piroxicam",
      "indomethacin",
      "ketoprofen",
      "mefenamic",
    ],
  },
  cephalosporin: {
    aliases: ["cephalosporin", "cephalosporins"],
    members: [
      "ceftriaxone",
      "cefuroxime",
      "cefalexin",
      "cephalexin",
      "cefixime",
      "cefotaxime",
      "ceftazidime",
      "cefpodoxime",
    ],
  },
  quinolone: {
    aliases: ["quinolone", "quinolones", "fluoroquinolone", "fluoroquinolones"],
    members: ["ciprofloxacin", "levofloxacin", "ofloxacin", "norfloxacin", "moxifloxacin"],
  },
  macrolide: {
    aliases: ["macrolide", "macrolides"],
    members: ["erythromycin", "azithromycin", "clarithromycin"],
  },
  tetracycline: {
    aliases: ["tetracycline", "tetracyclines"],
    members: ["tetracycline", "doxycycline", "oxytetracycline"],
  },
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Classes an allergen belongs to or names. */
function classesForAllergen(allergen: string): string[] {
  const a = norm(allergen);
  return Object.entries(DRUG_CLASSES)
    .filter(
      ([, c]) =>
        c.aliases.some((x) => a.includes(x)) || c.members.some((m) => a.includes(m)),
    )
    .map(([name]) => name);
}

export function matchMedicationToAllergen(
  medicationName: string,
  allergen: string,
): AllergyMatch | null {
  const med = norm(medicationName);
  const all = norm(allergen);
  if (!med || !all) return null;
  if (med.includes(all) || all.includes(med)) return { kind: "direct" };

  for (const cls of classesForAllergen(all)) {
    if (DRUG_CLASSES[cls].members.some((m) => med.includes(m))) {
      return { kind: "class", drugClass: cls };
    }
  }
  return null;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole words only; longest first, so "co-amoxiclav" goes before "amoxiclav". */
const wholeWords = (terms: string[]) =>
  new RegExp(
    `\\b(?:${[...new Set(terms)]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|")})\\b`,
    "g",
  );

const CLASS_TERMS = wholeWords(
  Object.values(DRUG_CLASSES).flatMap((c) => [...c.aliases, ...c.members]),
);
/** Words that say what kind of allergy it is without naming a drug. */
const GENERIC_WORDS = wholeWords(["drug", "drugs", "allergy", "class", "group", "antibiotic", "antibiotics"]);
/** Where one allergen ends and another starts in a free-text list. */
const ALLERGEN_SEPARATORS = /[,;/&+]|\band\b|\bor\b/;

/**
 * Whether the whole allergen is drugs or drug classes in the list above, so
 * a medicine that does not match it can be cleared. Each part of a list
 * ("Penicillin, codeine") must be only names from the list and words such as
 * "drugs"; one other word is enough to need a check by hand. So a food, a
 * drug not in the list, a salt name ("Quinine sulphate" is not a sulfa
 * drug) or a spelling the list does not have is never cleared.
 */
export function isRecognisedAllergen(allergen: string): boolean {
  let named = false;
  for (const part of norm(allergen).split(ALLERGEN_SEPARATORS)) {
    const rest = part
      .replace(CLASS_TERMS, () => {
        named = true;
        return " ";
      })
      .replace(GENERIC_WORDS, " ");
    // Any letter or digit left over, in any script, is something unknown.
    if (/[\p{L}\p{N}]/u.test(rest)) return false;
  }
  return named;
}

/**
 * Recorded allergens that must be checked by hand against these medicines:
 * not recognised (see isRecognisedAllergen) and matching none of them.
 * Listed once each, first spelling kept. There is no guessing at
 * misspellings: an allergen the matcher does not know is never read as
 * "no allergy".
 */
export function uncheckedAllergens(medicationNames: string[], allergens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const allergen of allergens) {
    const key = norm(allergen);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (isRecognisedAllergen(allergen)) continue;
    if (medicationNames.some((med) => matchMedicationToAllergen(med, allergen))) continue;
    out.push(allergen.trim().replace(/\s+/g, " "));
  }
  return out;
}
