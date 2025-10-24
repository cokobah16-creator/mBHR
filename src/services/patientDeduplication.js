import { db, epochDay, normPhone, nameKeyOf } from '@/db';
import { metaphone } from 'metaphone';
import logger from '@/lib/logger';
const DEFAULT_CONFIG = {
    phoneWeight: 0.4,
    nameWeight: 0.3,
    dobWeight: 0.2,
    addressWeight: 0.1,
    threshold: 0.7
};
export class PatientDeduplication {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    async findDuplicates(patient) {
        const dobDay = epochDay(patient.dob);
        const phoneN = normPhone(patient.phone || '');
        const nameKey = nameKeyOf(patient.givenName, patient.familyName);
        // Step 1: Fast filter - find candidates with exact or near matches
        const candidates = await this.findCandidates(dobDay, phoneN, nameKey);
        // Step 2: Score each candidate
        const scored = await Promise.all(candidates.map(async (candidate) => {
            const score = this.calculateSimilarity(patient, candidate);
            const matchReasons = this.getMatchReasons(patient, candidate, score);
            return {
                patient: candidate,
                score,
                matchReasons
            };
        }));
        // Step 3: Filter by threshold and sort by score
        return scored
            .filter(c => c.score >= this.config.threshold)
            .sort((a, b) => b.score - a.score);
    }
    async findCandidates(dobDay, phoneN, nameKey) {
        // Get patients matching any of the key criteria
        const byPhone = phoneN
            ? await db.patients.where('phoneN').equals(phoneN).and(p => !p.mergeInto).toArray()
            : [];
        const byNameKey = await db.patients
            .where('nameKey').equals(nameKey)
            .and(p => !p.mergeInto)
            .toArray();
        const byDob = await db.patients
            .where('dobDay').between(dobDay - 1, dobDay + 1)
            .and(p => !p.mergeInto)
            .toArray();
        // Combine and deduplicate
        const candidateMap = new Map();
        [...byPhone, ...byNameKey, ...byDob].forEach(p => {
            candidateMap.set(p.id, p);
        });
        return Array.from(candidateMap.values());
    }
    calculateSimilarity(newPatient, existing) {
        let score = 0;
        // Phone similarity
        const newPhone = normPhone(newPatient.phone || '');
        const existingPhone = normPhone(existing.phone || '');
        if (newPhone && existingPhone) {
            if (newPhone === existingPhone) {
                score += this.config.phoneWeight;
            }
            else if (this.phonesSimilar(newPhone, existingPhone)) {
                score += this.config.phoneWeight * 0.5;
            }
        }
        // Name similarity
        const nameScore = this.calculateNameSimilarity(newPatient.givenName, newPatient.familyName, existing.givenName, existing.familyName);
        score += nameScore * this.config.nameWeight;
        // DOB similarity
        const newDobDay = epochDay(newPatient.dob);
        const existingDobDay = existing.dobDay || epochDay(new Date(existing.dob));
        if (newDobDay === existingDobDay) {
            score += this.config.dobWeight;
        }
        else if (Math.abs(newDobDay - existingDobDay) <= 1) {
            // Allow 1 day difference (timezone/data entry errors)
            score += this.config.dobWeight * 0.7;
        }
        // Address similarity (if available)
        if (newPatient.address && existing.address) {
            const addressScore = this.stringSimilarity(newPatient.address.toLowerCase(), existing.address.toLowerCase());
            score += addressScore * this.config.addressWeight;
        }
        return Math.min(score, 1.0);
    }
    calculateNameSimilarity(givenName1, familyName1, givenName2, familyName2) {
        // Exact match
        if (givenName1.toLowerCase() === givenName2.toLowerCase() &&
            familyName1.toLowerCase() === familyName2.toLowerCase()) {
            return 1.0;
        }
        // Phonetic match
        const phone1 = `${metaphone(givenName1)}-${metaphone(familyName1)}`;
        const phone2 = `${metaphone(givenName2)}-${metaphone(familyName2)}`;
        if (phone1 === phone2) {
            return 0.9;
        }
        // Swapped names (Given/Family reversed)
        if (givenName1.toLowerCase() === familyName2.toLowerCase() &&
            familyName1.toLowerCase() === givenName2.toLowerCase()) {
            return 0.85;
        }
        // Partial match on either name
        const givenSim = this.stringSimilarity(givenName1.toLowerCase(), givenName2.toLowerCase());
        const familySim = this.stringSimilarity(familyName1.toLowerCase(), familyName2.toLowerCase());
        return (givenSim + familySim) / 2;
    }
    phonesSimilar(phone1, phone2) {
        // Remove country code variations
        const normalize = (p) => {
            if (p.startsWith('234'))
                return p.substring(3);
            if (p.startsWith('0'))
                return p.substring(1);
            return p;
        };
        const n1 = normalize(phone1);
        const n2 = normalize(phone2);
        // Check if they match after normalization
        if (n1 === n2)
            return true;
        // Check if one is a substring of the other (partial number entered)
        if (n1.length >= 7 && n2.length >= 7) {
            return n1.includes(n2.slice(-7)) || n2.includes(n1.slice(-7));
        }
        return false;
    }
    stringSimilarity(str1, str2) {
        if (str1 === str2)
            return 1.0;
        if (!str1 || !str2)
            return 0;
        // Levenshtein distance based similarity
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        if (longer.length === 0)
            return 1.0;
        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }
    levenshteinDistance(str1, str2) {
        const matrix = [];
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
                }
                else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1, // insertion
                    matrix[i - 1][j] + 1 // deletion
                    );
                }
            }
        }
        return matrix[str2.length][str1.length];
    }
    getMatchReasons(newPatient, existing, score) {
        const reasons = [];
        // Phone match
        const newPhone = normPhone(newPatient.phone || '');
        const existingPhone = normPhone(existing.phone || '');
        if (newPhone && existingPhone && newPhone === existingPhone) {
            reasons.push('Exact phone number match');
        }
        // Name match
        const fullName1 = `${newPatient.givenName} ${newPatient.familyName}`.toLowerCase();
        const fullName2 = `${existing.givenName} ${existing.familyName}`.toLowerCase();
        if (fullName1 === fullName2) {
            reasons.push('Exact name match');
        }
        else {
            const phone1 = `${metaphone(newPatient.givenName)}-${metaphone(newPatient.familyName)}`;
            const phone2 = `${metaphone(existing.givenName)}-${metaphone(existing.familyName)}`;
            if (phone1 === phone2) {
                reasons.push('Names sound similar (phonetic match)');
            }
        }
        // DOB match
        const newDobDay = epochDay(newPatient.dob);
        const existingDobDay = existing.dobDay || epochDay(new Date(existing.dob));
        if (newDobDay === existingDobDay) {
            reasons.push('Same date of birth');
        }
        // Address similarity
        if (newPatient.address && existing.address) {
            const addressSim = this.stringSimilarity(newPatient.address.toLowerCase(), existing.address.toLowerCase());
            if (addressSim > 0.8) {
                reasons.push('Similar address');
            }
        }
        // Overall score
        reasons.push(`Overall match confidence: ${(score * 100).toFixed(0)}%`);
        return reasons;
    }
    async mergePatients(winnerId, loserId, mergedBy) {
        await db.transaction('rw', [
            db.patients,
            db.vitals,
            db.consultations,
            db.dispenses,
            db.visits,
            db.queue,
            db.patientMerges,
            db.patientAllergies,
            db.patientPreferences,
            db.careTasks
        ], async () => {
            const now = new Date();
            // Mark loser as merged
            await db.patients.update(loserId, {
                mergeInto: winnerId,
                updatedAt: now,
                _dirty: 1
            });
            // Reassign all related records to winner
            await db.vitals.where('patientId').equals(loserId).modify({ patientId: winnerId, _dirty: 1 });
            await db.consultations.where('patientId').equals(loserId).modify({ patientId: winnerId, _dirty: 1 });
            await db.dispenses.where('patientId').equals(loserId).modify({ patientId: winnerId, _dirty: 1 });
            await db.visits.where('patientId').equals(loserId).modify({ patientId: winnerId, _dirty: 1 });
            await db.queue.where('patientId').equals(loserId).modify({ patientId: winnerId, _dirty: 1 });
            // Merge allergies and preferences
            const loserAllergies = await db.patientAllergies.where('patientId').equals(loserId).toArray();
            const loserPrefs = await db.patientPreferences.where('patientId').equals(loserId).toArray();
            for (const allergy of loserAllergies) {
                await db.patientAllergies.update(allergy.id, { patientId: winnerId, _dirty: 1 });
            }
            for (const pref of loserPrefs) {
                await db.patientPreferences.update(pref.id, { patientId: winnerId, _dirty: 1 });
            }
            // Record merge
            await db.patientMerges.add({
                id: `merge-${Date.now()}`,
                winnerId,
                loserId,
                mergedBy,
                createdDay: epochDay(now),
                reason: 'duplicate_resolution'
            });
            // Update winner's updatedAt
            await db.patients.update(winnerId, {
                updatedAt: now,
                _dirty: 1
            });
            logger.log(`Merged patient ${loserId} into ${winnerId}`);
        });
    }
    async getMergeHistory(patientId) {
        const merges = await db.patientMerges
            .where('winnerId').equals(patientId)
            .toArray();
        const history = await Promise.all(merges.map(async (merge) => {
            const mergedPatient = await db.patients.get(merge.loserId);
            return {
                mergedPatient,
                mergedBy: merge.mergedBy,
                mergedAt: new Date(merge.createdDay * 86400000)
            };
        }));
        return history;
    }
}
export const patientDeduplication = new PatientDeduplication();
