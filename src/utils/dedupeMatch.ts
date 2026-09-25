// How closely an existing patient matches the one being registered, as
// shown in the duplicate check. Display only: staff decide.

export interface MatchFields {
  givenName?: string | null;
  familyName?: string | null;
  phone?: string | null;
  dob?: string | null;
  sex?: string | null;
}

export interface DedupeMatch {
  score: number;
  label: string;
  tone: "warning" | "info" | "neutral";
  /**
   * Same phone, different first name: often a relative who shares the
   * family phone (and, for children, maybe the same estimated birth date).
   */
  maybeRelative: boolean;
}

function sameText(a?: string | null, b?: string | null): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return x !== "" && x === y;
}

function samePhone(a?: string | null, b?: string | null): boolean {
  const x = (a ?? "").replace(/\D/g, "");
  const y = (b ?? "").replace(/\D/g, "");
  return x !== "" && x === y;
}

export function assessDedupeMatch(
  candidate: MatchFields,
  entered: MatchFields,
): DedupeMatch {
  const phone = samePhone(candidate.phone, entered.phone);
  const givenName = sameText(candidate.givenName, entered.givenName);
  const familyName = sameText(candidate.familyName, entered.familyName);
  const dob = !!candidate.dob && candidate.dob === entered.dob;
  const sex = !!candidate.sex && candidate.sex === entered.sex;

  const score =
    (phone ? 50 : 0) +
    (givenName ? 20 : 0) +
    (familyName ? 20 : 0) +
    (dob ? 30 : 0) +
    (sex ? 10 : 0);

  // A shared phone and birth date (twins, or two children whose ages were
  // given on quick registration) do not make the same person: that needs
  // the first name to match too.
  const base =
    score >= 70 && givenName
      ? { label: "Likely the same person", tone: "warning" as const }
      : score >= 40
        ? { label: "Possible match", tone: "info" as const }
        : { label: "Weak match", tone: "neutral" as const };

  return { score, ...base, maybeRelative: phone && !givenName };
}
