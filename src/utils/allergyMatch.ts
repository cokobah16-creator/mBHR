// Medication ↔ recorded allergen matching.
//
// A plain substring check misses the most common dangerous case at an
// outreach: an allergy recorded as "Penicillin" and a prescription for
// "Amoxicillin 500 mg". This adds a small, conservative map of drug classes
// commonly stocked at outreaches. It errs toward warning: a match means
// "check before dispensing", not a diagnosis.

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
