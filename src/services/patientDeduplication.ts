import { db, Patient, epochDay, normPhone, nameKeyOf } from "@/db";
import { metaphone } from "metaphone";
import logger from "@/lib/logger";

interface DuplicateCandidate {
  patient: Patient;
  score: number;
  matchReasons: string[];
}

interface DeduplicationConfig {
  phoneWeight: number;
  nameWeight: number;
  dobWeight: number;
  addressWeight: number;
  threshold: number;
}

const DEFAULT_CONFIG: DeduplicationConfig = {
  phoneWeight: 0.4,
  nameWeight: 0.3,
  dobWeight: 0.2,
  addressWeight: 0.1,
  threshold: 0.7,
};

export class PatientDeduplication {
  private config: DeduplicationConfig;

  constructor(config: Partial<DeduplicationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async findDuplicates(patient: {
    givenName: string;
    familyName: string;
    phone?: string;
    dob: Date;
    address?: string;
  }): Promise<DuplicateCandidate[]> {
    const dobDay = epochDay(patient.dob);
    const phoneN = normPhone(patient.phone || "");
    const nameKey = nameKeyOf(patient.givenName, patient.familyName);

    // Step 1: Fast filter - find candidates with exact or near matches
    const candidates = await this.findCandidates(dobDay, phoneN, nameKey);

    // Step 2: Score each candidate
    const scored = await Promise.all(
      candidates.map(async (candidate) => {
        const score = this.calculateSimilarity(patient, candidate);
        const matchReasons = this.getMatchReasons(patient, candidate, score);

        return {
          patient: candidate,
          score,
          matchReasons,
        };
      }),
    );

    // Step 3: Filter by threshold and sort by score
    return scored
      .filter((c) => c.score >= this.config.threshold)
      .sort((a, b) => b.score - a.score);
  }

  private async findCandidates(
    dobDay: number,
    phoneN: string,
    nameKey: string,
  ): Promise<Patient[]> {
    // Get patients matching any of the key criteria
    const byPhone = phoneN
      ? await db.patients
          .where("phoneN")
          .equals(phoneN)
          .and((p) => !p.mergeInto)
          .toArray()
      : [];

    const byNameKey = await db.patients
      .where("nameKey")
      .equals(nameKey)
      .and((p) => !p.mergeInto)
      .toArray();

    const byDob = await db.patients
      .where("dobDay")
      .between(dobDay - 1, dobDay + 1, true, true)
      .and((p) => !p.mergeInto)
      .toArray();

    // Combine and deduplicate
    const candidateMap = new Map<string, Patient>();
    [...byPhone, ...byNameKey, ...byDob].forEach((p) => {
      candidateMap.set(p.id, p);
    });

    return Array.from(candidateMap.values());
  }

  private calculateSimilarity(
    newPatient: {
      givenName: string;
      familyName: string;
      phone?: string;
      dob: Date;
      address?: string;
    },
    existing: Patient,
  ): number {
    let score = 0;
    let maxScore = 0;

    // Phone similarity — only counted when both sides have a phone
    const newPhone = normPhone(newPatient.phone || "");
    const existingPhone = normPhone(existing.phone || "");

    if (newPhone && existingPhone) {
      maxScore += this.config.phoneWeight;
      if (newPhone === existingPhone) {
        score += this.config.phoneWeight;
      } else if (this.phonesSimilar(newPhone, existingPhone)) {
        score += this.config.phoneWeight * 0.5;
      }
    }

    // Name similarity — always compared
    maxScore += this.config.nameWeight;
    const nameScore = this.calculateNameSimilarity(
      newPatient.givenName,
      newPatient.familyName,
      existing.givenName,
      existing.familyName,
    );
    score += nameScore * this.config.nameWeight;

    // DOB similarity — always compared
    maxScore += this.config.dobWeight;
    const newDobDay = epochDay(newPatient.dob);
    const existingDobDay = existing.dobDay || epochDay(new Date(existing.dob));

    if (newDobDay === existingDobDay) {
      score += this.config.dobWeight;
    } else if (Math.abs(newDobDay - existingDobDay) <= 1) {
      // Allow 1 day difference (timezone/data entry errors)
      score += this.config.dobWeight * 0.7;
    }

    // Address similarity — only counted when both sides have an address
    if (newPatient.address && existing.address) {
      maxScore += this.config.addressWeight;
      const addressScore = this.stringSimilarity(
        newPatient.address.toLowerCase(),
        existing.address.toLowerCase(),
      );
      score += addressScore * this.config.addressWeight;
    }

    // Normalize against available weight so missing phone/address doesn't cap score below threshold
    return maxScore > 0 ? Math.min(score / maxScore, 1.0) : 0;
  }

  private calculateNameSimilarity(
    givenName1: string,
    familyName1: string,
    givenName2: string,
    familyName2: string,
  ): number {
    // Exact match
    if (
      givenName1.toLowerCase() === givenName2.toLowerCase() &&
      familyName1.toLowerCase() === familyName2.toLowerCase()
    ) {
      return 1.0;
    }

    // Phonetic match
    const phone1 = `${metaphone(givenName1)}-${metaphone(familyName1)}`;
    const phone2 = `${metaphone(givenName2)}-${metaphone(familyName2)}`;

    if (phone1 === phone2) {
      return 0.9;
    }

    // Swapped names (Given/Family reversed)
    if (
      givenName1.toLowerCase() === familyName2.toLowerCase() &&
      familyName1.toLowerCase() === givenName2.toLowerCase()
    ) {
      return 0.85;
    }

    // Partial match on either name
    const givenSim = this.stringSimilarity(
      givenName1.toLowerCase(),
      givenName2.toLowerCase(),
    );
    const familySim = this.stringSimilarity(
      familyName1.toLowerCase(),
      familyName2.toLowerCase(),
    );

    return (givenSim + familySim) / 2;
  }

  private phonesSimilar(phone1: string, phone2: string): boolean {
    // Remove country code variations
    const normalize = (p: string) => {
      if (p.startsWith("234")) return p.substring(3);
      if (p.startsWith("0")) return p.substring(1);
      return p;
    };

    const n1 = normalize(phone1);
    const n2 = normalize(phone2);

    // Check if they match after normalization
    if (n1 === n2) return true;

    // Check if one is a substring of the other (partial number entered)
    if (n1.length >= 7 && n2.length >= 7) {
      return n1.includes(n2.slice(-7)) || n2.includes(n1.slice(-7));
    }

    return false;
  }

  private stringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0;

    // Levenshtein distance based similarity
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1, // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  private getMatchReasons(
    newPatient: {
      givenName: string;
      familyName: string;
      phone?: string;
      dob: Date;
      address?: string;
    },
    existing: Patient,
    score: number,
  ): string[] {
    const reasons: string[] = [];

    // Phone match
    const newPhone = normPhone(newPatient.phone || "");
    const existingPhone = normPhone(existing.phone || "");
    if (newPhone && existingPhone && newPhone === existingPhone) {
      reasons.push("Exact phone number match");
    }

    // Name match
    const fullName1 =
      `${newPatient.givenName} ${newPatient.familyName}`.toLowerCase();
    const fullName2 =
      `${existing.givenName} ${existing.familyName}`.toLowerCase();
    if (fullName1 === fullName2) {
      reasons.push("Exact name match");
    } else {
      const phone1 = `${metaphone(newPatient.givenName)}-${metaphone(newPatient.familyName)}`;
      const phone2 = `${metaphone(existing.givenName)}-${metaphone(existing.familyName)}`;
      if (phone1 === phone2) {
        reasons.push("Names sound similar (phonetic match)");
      }
    }

    // DOB match
    const newDobDay = epochDay(newPatient.dob);
    const existingDobDay = existing.dobDay || epochDay(new Date(existing.dob));
    if (newDobDay === existingDobDay) {
      reasons.push("Same date of birth");
    }

    // Address similarity
    if (newPatient.address && existing.address) {
      const addressSim = this.stringSimilarity(
        newPatient.address.toLowerCase(),
        existing.address.toLowerCase(),
      );
      if (addressSim > 0.8) {
        reasons.push("Similar address");
      }
    }

    // Overall score
    reasons.push(`Overall match confidence: ${(score * 100).toFixed(0)}%`);

    return reasons;
  }

  async mergePatients(
    winnerId: string,
    loserId: string,
    mergedBy: string,
  ): Promise<void> {
    await db.transaction(
      "rw",
      [
        db.patients,
        db.vitals,
        db.consultations,
        db.dispenses,
        db.visits,
        db.queue,
        db.patientMerges,
        db.patientAllergies,
        db.patientPreferences,
        db.careTasks,
      ],
      async () => {
        const now = new Date();

        // Mark loser as merged
        await db.patients.update(loserId, {
          mergeInto: winnerId,
          updatedAt: now,
          _dirty: 1,
        });

        // Reassign all related records to winner
        await db.vitals
          .where("patientId")
          .equals(loserId)
          .modify({ patientId: winnerId, _dirty: 1 });
        await db.consultations
          .where("patientId")
          .equals(loserId)
          .modify({ patientId: winnerId, _dirty: 1 });
        await db.dispenses
          .where("patientId")
          .equals(loserId)
          .modify({ patientId: winnerId, _dirty: 1 });
        await db.visits
          .where("patientId")
          .equals(loserId)
          .modify({ patientId: winnerId, _dirty: 1 });
        await db.queue
          .where("patientId")
          .equals(loserId)
          .modify({ patientId: winnerId, _dirty: 1 });
        await db.careTasks
          .where("patientId")
          .equals(loserId)
          .modify({ patientId: winnerId, _dirty: 1 });

        // Merge allergies and preferences
        const loserAllergies = await db.patientAllergies
          .where("patientId")
          .equals(loserId)
          .toArray();
        const loserPrefs = await db.patientPreferences
          .where("patientId")
          .equals(loserId)
          .toArray();

        for (const allergy of loserAllergies) {
          await db.patientAllergies.update(allergy.id, {
            patientId: winnerId,
            _dirty: 1,
          });
        }

        for (const pref of loserPrefs) {
          await db.patientPreferences.update(pref.id, {
            patientId: winnerId,
            _dirty: 1,
          });
        }

        // Record merge
        await db.patientMerges.add({
          id: crypto.randomUUID(),
          winnerId,
          loserId,
          mergedBy,
          createdDay: epochDay(now),
          reason: "duplicate_resolution",
        });

        // Update winner's updatedAt
        await db.patients.update(winnerId, {
          updatedAt: now,
          _dirty: 1,
        });

        logger.log(`Merged patient ${loserId} into ${winnerId}`);
      },
    );
  }

  async getMergeHistory(patientId: string): Promise<
    Array<{
      mergedPatient: Patient | undefined;
      mergedBy: string;
      mergedAt: Date;
    }>
  > {
    const merges = await db.patientMerges
      .where("winnerId")
      .equals(patientId)
      .toArray();

    const history = await Promise.all(
      merges.map(async (merge) => {
        const mergedPatient = await db.patients.get(merge.loserId);
        return {
          mergedPatient,
          mergedBy: merge.mergedBy,
          mergedAt: new Date(merge.createdDay * 86400000),
        };
      }),
    );

    return history;
  }
}

export const patientDeduplication = new PatientDeduplication();
