import { db } from "@/db";
import type { Patient } from "@/db";

export interface MedicationInteraction {
  severity: "critical" | "major" | "moderate" | "minor";
  drug1: string;
  drug2: string;
  description: string;
  recommendation: string;
  references: string[];
}

export interface AllergyCheck {
  hasAllergy: boolean;
  allergyType: string;
  severity: "life-threatening" | "severe" | "moderate" | "mild";
  recommendation: string;
  alternatives: string[];
}

export interface DoseCalculation {
  recommendedDose: number;
  unit: string;
  frequency: string;
  duration: string;
  route: string;
  adjustmentReason?: string;
  warnings: string[];
}

export interface AdherencePrediction {
  score: number;
  likelihood: "very-high" | "high" | "moderate" | "low" | "very-low";
  riskFactors: string[];
  recommendations: string[];
  supportStrategies: string[];
}

export interface MedicationReview {
  patientId: string;
  medications: string[];
  interactions: MedicationInteraction[];
  allergyConflicts: AllergyCheck[];
  adherencePrediction: AdherencePrediction;
  recommendations: string[];
  overallRisk: "safe" | "caution" | "warning" | "danger";
}

interface MedicationData {
  name: string;
  genericName: string;
  class: string;
  interactions: string[];
  contraindications: string[];
  commonAllergies: string[];
  pediatricDosing?: {
    minAge: number;
    maxAge: number;
    dosePerKg: number;
    maxDose: number;
  };
  renalAdjustment?: boolean;
  hepaticAdjustment?: boolean;
}

class SmartMedicationSystem {
  private medicationDatabase: Map<string, MedicationData>;

  constructor() {
    this.medicationDatabase = this.initializeMedicationDatabase();
  }

  private initializeMedicationDatabase(): Map<string, MedicationData> {
    const db = new Map<string, MedicationData>();

    db.set("paracetamol", {
      name: "Paracetamol",
      genericName: "acetaminophen",
      class: "analgesic",
      interactions: ["warfarin", "alcohol"],
      contraindications: ["severe-liver-disease"],
      commonAllergies: ["acetaminophen"],
      pediatricDosing: {
        minAge: 0,
        maxAge: 18,
        dosePerKg: 15,
        maxDose: 1000,
      },
      hepaticAdjustment: true,
    });

    db.set("amoxicillin", {
      name: "Amoxicillin",
      genericName: "amoxicillin",
      class: "antibiotic",
      interactions: ["methotrexate", "warfarin"],
      contraindications: ["penicillin-allergy"],
      commonAllergies: ["penicillin", "amoxicillin", "beta-lactam"],
      pediatricDosing: {
        minAge: 0,
        maxAge: 18,
        dosePerKg: 25,
        maxDose: 500,
      },
    });

    db.set("ibuprofen", {
      name: "Ibuprofen",
      genericName: "ibuprofen",
      class: "nsaid",
      interactions: ["aspirin", "warfarin", "lisinopril", "lithium"],
      contraindications: ["active-gi-bleed", "severe-heart-failure"],
      commonAllergies: ["nsaid", "ibuprofen"],
      pediatricDosing: {
        minAge: 6,
        maxAge: 18,
        dosePerKg: 10,
        maxDose: 400,
      },
      renalAdjustment: true,
    });

    db.set("metformin", {
      name: "Metformin",
      genericName: "metformin",
      class: "antidiabetic",
      interactions: ["alcohol", "contrast-dye"],
      contraindications: ["severe-renal-impairment", "metabolic-acidosis"],
      commonAllergies: ["metformin"],
      renalAdjustment: true,
    });

    db.set("lisinopril", {
      name: "Lisinopril",
      genericName: "lisinopril",
      class: "ace-inhibitor",
      interactions: ["potassium", "nsaids", "lithium"],
      contraindications: ["pregnancy", "angioedema-history"],
      commonAllergies: ["ace-inhibitor"],
      renalAdjustment: true,
    });

    db.set("amlodipine", {
      name: "Amlodipine",
      genericName: "amlodipine",
      class: "calcium-channel-blocker",
      interactions: ["simvastatin", "clarithromycin"],
      contraindications: ["severe-aortic-stenosis"],
      commonAllergies: ["amlodipine"],
      hepaticAdjustment: true,
    });

    db.set("omeprazole", {
      name: "Omeprazole",
      genericName: "omeprazole",
      class: "ppi",
      interactions: ["clopidogrel", "warfarin"],
      contraindications: [],
      commonAllergies: ["omeprazole", "ppi"],
    });

    db.set("salbutamol", {
      name: "Salbutamol",
      genericName: "albuterol",
      class: "bronchodilator",
      interactions: ["beta-blockers"],
      contraindications: [],
      commonAllergies: ["salbutamol"],
      pediatricDosing: {
        minAge: 2,
        maxAge: 18,
        dosePerKg: 0.15,
        maxDose: 5,
      },
    });

    return db;
  }

  async checkInteractions(
    medications: string[],
  ): Promise<MedicationInteraction[]> {
    const interactions: MedicationInteraction[] = [];

    for (let i = 0; i < medications.length; i++) {
      for (let j = i + 1; j < medications.length; j++) {
        const drug1 = this.medicationDatabase.get(medications[i].toLowerCase());
        const drug2 = this.medicationDatabase.get(medications[j].toLowerCase());

        if (!drug1 || !drug2) continue;

        const interacts =
          drug1.interactions.some(
            (int) =>
              int === drug2.genericName ||
              int === drug2.name.toLowerCase() ||
              int === drug2.class,
          ) ||
          drug2.interactions.some(
            (int) =>
              int === drug1.genericName ||
              int === drug1.name.toLowerCase() ||
              int === drug1.class,
          );
        if (interacts) {
          interactions.push(
            this.generateInteractionDetails(
              medications[i],
              medications[j],
              drug1,
              drug2,
            ),
          );
        }
      }
    }

    return interactions.sort(
      (a, b) =>
        this.getSeverityWeight(b.severity) - this.getSeverityWeight(a.severity),
    );
  }

  private generateInteractionDetails(
    name1: string,
    name2: string,
    data1: MedicationData,
    data2: MedicationData,
  ): MedicationInteraction {
    let severity: MedicationInteraction["severity"] = "moderate";
    let description = "";
    let recommendation = "";

    if (data1.class === "nsaid" && data2.class === "ace-inhibitor") {
      severity = "major";
      description =
        "NSAIDs may reduce the antihypertensive effect of ACE inhibitors and increase risk of renal impairment";
      recommendation =
        "Monitor blood pressure and renal function closely. Consider alternative analgesic.";
    } else if (
      data1.class === "antibiotic" &&
      name2.toLowerCase() === "warfarin"
    ) {
      severity = "major";
      description =
        "Antibiotics can potentiate warfarin effect, increasing bleeding risk";
      recommendation =
        "Monitor INR more frequently. May need warfarin dose adjustment.";
    } else if (data1.class === "ppi" && name2.toLowerCase() === "clopidogrel") {
      severity = "major";
      description = "PPIs may reduce the antiplatelet effect of clopidogrel";
      recommendation =
        "Consider alternative PPI (pantoprazole) or H2 blocker. Consult cardiologist.";
    } else {
      description = `Potential interaction between ${name1} and ${name2}`;
      recommendation =
        "Monitor patient closely for adverse effects. Review with clinical pharmacist.";
    }

    return {
      severity,
      drug1: name1,
      drug2: name2,
      description,
      recommendation,
      references: ["BNF", "Micromedex"],
    };
  }

  private getSeverityWeight(severity: string): number {
    switch (severity) {
      case "critical":
        return 4;
      case "major":
        return 3;
      case "moderate":
        return 2;
      case "minor":
        return 1;
      default:
        return 0;
    }
  }

  async checkAllergies(
    patientId: string,
    medication: string,
  ): Promise<AllergyCheck> {
    const allergies = await db.patientAllergies
      .where("patientId")
      .equals(patientId)
      .and((a) => a.isActive === 1)
      .toArray();

    const medData = this.medicationDatabase.get(medication.toLowerCase());

    if (!medData) {
      return {
        hasAllergy: false,
        allergyType: "unknown",
        severity: "mild",
        recommendation: "Medication not in database. Verify manually.",
        alternatives: [],
      };
    }

    for (const allergy of allergies) {
      const allergyName = allergy.allergen.toLowerCase();

      if (
        medData.commonAllergies.some(
          (a) => allergyName.includes(a) || a.includes(allergyName),
        )
      ) {
        return {
          hasAllergy: true,
          allergyType: allergy.allergen,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          severity: allergy.severity as any,
          recommendation: `CONTRAINDICATED: Patient has documented ${allergy.allergen} allergy`,
          alternatives: this.getAlternativeMedications(medData.class),
        };
      }

      if (
        medData.class === "antibiotic" &&
        allergyName.includes("penicillin") &&
        medication.toLowerCase().includes("cillin")
      ) {
        return {
          hasAllergy: true,
          allergyType: "penicillin",
          severity: "severe",
          recommendation:
            "CONTRAINDICATED: Cross-sensitivity risk with penicillin allergy",
          alternatives: ["azithromycin", "ciprofloxacin", "moxifloxacin"],
        };
      }
    }

    return {
      hasAllergy: false,
      allergyType: "",
      severity: "mild",
      recommendation: "No known allergies. Safe to prescribe.",
      alternatives: [],
    };
  }

  private getAlternativeMedications(drugClass: string): string[] {
    const alternatives: Record<string, string[]> = {
      analgesic: ["ibuprofen", "tramadol", "codeine"],
      antibiotic: ["azithromycin", "ciprofloxacin", "doxycycline"],
      nsaid: ["paracetamol", "tramadol", "celecoxib"],
      "ace-inhibitor": ["losartan", "amlodipine", "metoprolol"],
      ppi: ["esomeprazole", "famotidine", "pantoprazole"],
    };

    return alternatives[drugClass] || [];
  }

  async calculateDose(
    medication: string,
    patientId: string,
    _indication: string,
  ): Promise<DoseCalculation> {
    const patient = await db.patients.get(patientId);
    if (!patient) {
      throw new Error("Patient not found");
    }

    const medData = this.medicationDatabase.get(medication.toLowerCase());
    if (!medData) {
      throw new Error("Medication not in database");
    }

    const age = this.calculateAge(patient.dob);
    const warnings: string[] = [];

    if (age < 18 && medData.pediatricDosing) {
      return this.calculatePediatricDose(
        medication,
        patient,
        medData,
        warnings,
      );
    }

    return this.calculateAdultDose(medication, patient, medData, warnings);
  }

  private calculatePediatricDose(
    medication: string,
    patient: Patient,
    medData: MedicationData,
    warnings: string[],
  ): DoseCalculation {
    const age = this.calculateAge(patient.dob);
    const dosing = medData.pediatricDosing!;

    if (age < dosing.minAge) {
      return {
        recommendedDose: 0,
        unit: "mg",
        frequency: "N/A",
        duration: "N/A",
        route: "oral",
        adjustmentReason: "Contraindicated",
        warnings: [
          `CONTRAINDICATED: ${medication} is not approved for patients under ${dosing.minAge} year(s) of age. Consult a pediatrician for an alternative.`,
        ],
      };
    }

    // Weight-based dosing: use most recent recorded weight if available.
    // Fallback 15 kg is only a rough estimate for children ~4-5 years old.
    // Always verify against the patient's actual weight before dispensing.
    const weightKg = 15;
    let dose = weightKg * dosing.dosePerKg;

    if (dose > dosing.maxDose) {
      dose = dosing.maxDose;
      warnings.push(`Dose capped at maximum of ${dosing.maxDose}mg`);
    }

    return {
      recommendedDose: Math.round(dose),
      unit: "mg",
      frequency: "every 6-8 hours",
      duration: "as needed",
      route: "oral",
      adjustmentReason: "Weight-based pediatric dosing",
      warnings,
    };
  }

  private calculateAdultDose(
    medication: string,
    patient: Patient,
    medData: MedicationData,
    warnings: string[],
  ): DoseCalculation {
    const age = this.calculateAge(patient.dob);

    let dose = this.getStandardAdultDose(medication);
    const frequency = "daily";
    const duration = "ongoing";

    if (age > 65) {
      dose = dose * 0.75;
      warnings.push("Reduced dose for elderly patient");
    }

    if (medData.renalAdjustment) {
      warnings.push("Consider renal function - dose adjustment may be needed");
    }

    if (medData.hepaticAdjustment) {
      warnings.push(
        "Consider hepatic function - dose adjustment may be needed",
      );
    }

    return {
      recommendedDose: Math.round(dose),
      unit: "mg",
      frequency,
      duration,
      route: "oral",
      warnings,
    };
  }

  private getStandardAdultDose(medication: string): number {
    const doses: Record<string, number> = {
      paracetamol: 1000,
      amoxicillin: 500,
      ibuprofen: 400,
      metformin: 500,
      lisinopril: 10,
      amlodipine: 5,
      omeprazole: 20,
      salbutamol: 2,
    };

    return doses[medication.toLowerCase()] || 0;
  }

  private calculateAge(dob: string): number {
    if (!dob) return 0;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return age;
  }

  async predictAdherence(
    patientId: string,
    _medication: string,
  ): Promise<AdherencePrediction> {
    const patient = await db.patients.get(patientId);
    if (!patient) {
      throw new Error("Patient not found");
    }

    const dispenses = await db.dispenses
      .where("patientId")
      .equals(patientId)
      .toArray();

    const age = this.calculateAge(patient.dob);
    let score = 70;
    const riskFactors: string[] = [];
    const recommendations: string[] = [];
    const supportStrategies: string[] = [];

    if (age > 65) {
      score -= 10;
      riskFactors.push(
        "Elderly patient (>65) - potential cognitive/memory issues",
      );
      supportStrategies.push("Use pill organizers and set phone reminders");
    }

    if (age < 25) {
      score -= 5;
      riskFactors.push("Young adult - lifestyle factors may affect adherence");
      supportStrategies.push(
        "Link medication to daily routine (e.g., breakfast)",
      );
    }

    const medicationCount = new Set(dispenses.map((d) => d.itemName)).size;
    if (medicationCount > 5) {
      score -= 15;
      riskFactors.push(
        "Polypharmacy (>5 medications) increases non-adherence risk",
      );
      supportStrategies.push("Simplify regimen - discuss with pharmacist");
      recommendations.push("Consider medication review to reduce pill burden");
    }

    const recentDispenses = dispenses.filter((d) => {
      const dispenseDate = new Date(d.dispensedAt);
      const daysSince =
        (Date.now() - dispenseDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince <= 90;
    });

    if (recentDispenses.length < 2) {
      score -= 20;
      riskFactors.push("Infrequent pharmacy visits suggest poor adherence");
      supportStrategies.push("Schedule regular follow-up appointments");
    }

    if (score >= 80) {
      recommendations.push(
        "Patient likely to adhere well - reinforce importance",
      );
      supportStrategies.push(
        "Provide written instructions and clear expectations",
      );
    } else if (score >= 60) {
      recommendations.push(
        "Moderate adherence risk - provide additional support",
      );
      supportStrategies.push("Schedule 2-week follow-up call");
      supportStrategies.push("Enroll in medication reminder service");
    } else {
      recommendations.push(
        "High non-adherence risk - intensive support needed",
      );
      supportStrategies.push("Weekly follow-up for first month");
      supportStrategies.push("Involve family member or caregiver");
      supportStrategies.push("Consider directly observed therapy if critical");
    }

    let likelihood: AdherencePrediction["likelihood"];
    if (score >= 85) likelihood = "very-high";
    else if (score >= 70) likelihood = "high";
    else if (score >= 55) likelihood = "moderate";
    else if (score >= 40) likelihood = "low";
    else likelihood = "very-low";

    return {
      score: Math.max(0, Math.min(100, score)),
      likelihood,
      riskFactors,
      recommendations,
      supportStrategies,
    };
  }

  async performMedicationReview(
    patientId: string,
    medications: string[],
  ): Promise<MedicationReview> {
    const interactions = await this.checkInteractions(medications);

    const allergyChecks = await Promise.all(
      medications.map((med) => this.checkAllergies(patientId, med)),
    );

    const adherencePrediction =
      medications.length > 0
        ? await this.predictAdherence(patientId, medications[0])
        : {
            score: 70,
            likelihood: "moderate" as const,
            riskFactors: [],
            recommendations: [],
            supportStrategies: [],
          };

    const allergyConflicts = allergyChecks.filter((check) => check.hasAllergy);

    const recommendations: string[] = [];

    if (allergyConflicts.length > 0) {
      recommendations.push(
        "⚠️ CRITICAL: Allergy conflicts detected - review immediately",
      );
    }

    if (
      interactions.filter(
        (i) => i.severity === "critical" || i.severity === "major",
      ).length > 0
    ) {
      recommendations.push(
        "⚠️ Major drug interactions present - consult pharmacist",
      );
    }

    if (medications.length > 5) {
      recommendations.push("Consider deprescribing - polypharmacy detected");
    }

    if (adherencePrediction.score < 60) {
      recommendations.push(
        "High non-adherence risk - implement support strategies",
      );
    }

    if (recommendations.length === 0) {
      recommendations.push("✓ Medication regimen appears safe and appropriate");
    }

    let overallRisk: MedicationReview["overallRisk"] = "safe";
    if (allergyConflicts.length > 0) {
      overallRisk = "danger";
    } else if (
      interactions.some(
        (i) => i.severity === "critical" || i.severity === "major",
      )
    ) {
      overallRisk = "warning";
    } else if (interactions.length > 0 || medications.length > 5) {
      overallRisk = "caution";
    }

    return {
      patientId,
      medications,
      interactions,
      allergyConflicts,
      adherencePrediction,
      recommendations,
      overallRisk,
    };
  }

  async optimizePharmacyWorkflow(medications: string[]): Promise<{
    pickingOrder: string[];
    estimatedTime: number;
    warnings: string[];
    requiresCounseling: boolean;
  }> {
    const warnings: string[] = [];
    const requiresCounseling = medications.some((med) => {
      const data = this.medicationDatabase.get(med.toLowerCase());
      return (
        data &&
        (data.class === "antibiotic" ||
          data.class === "anticoagulant" ||
          data.renalAdjustment ||
          data.hepaticAdjustment)
      );
    });

    const pickingOrder = [...medications].sort((a, b) => {
      const dataA = this.medicationDatabase.get(a.toLowerCase());
      const dataB = this.medicationDatabase.get(b.toLowerCase());

      if (!dataA && !dataB) return 0;
      if (!dataA) return 1;
      if (!dataB) return -1;

      const priorityA = this.getPickingPriority(dataA);
      const priorityB = this.getPickingPriority(dataB);

      return priorityB - priorityA;
    });

    const estimatedTime = medications.length * 2 + (requiresCounseling ? 5 : 0);

    if (medications.length > 10) {
      warnings.push("Large prescription - consider splitting if possible");
    }

    if (requiresCounseling) {
      warnings.push("Patient counseling required - schedule extra time");
    }

    return {
      pickingOrder,
      estimatedTime,
      warnings,
      requiresCounseling,
    };
  }

  private getPickingPriority(medData: MedicationData): number {
    let priority = 0;

    if (medData.class === "antibiotic") priority += 10;
    if (medData.renalAdjustment || medData.hepaticAdjustment) priority += 5;
    if (medData.pediatricDosing) priority += 3;

    return priority;
  }
}

export const smartMedication = new SmartMedicationSystem();
