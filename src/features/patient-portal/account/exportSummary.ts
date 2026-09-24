/**
 * Plain-language descriptions for health-record exports. The exporter
 * speaks FHIR resource types; patients should read "Clinic visits".
 */

const RESOURCE_LABELS: Record<string, string> = {
  Patient: "Your personal details",
  Observation: "Vital sign readings",
  MedicationRequest: "Medicines",
  MedicationDispense: "Medicines given",
  Encounter: "Clinic visits",
  DiagnosticReport: "Consultation notes",
  AllergyIntolerance: "Allergies",
  Condition: "Health conditions",
  Immunization: "Vaccinations",
};

export function labelForResourceType(type: string): string {
  return RESOURCE_LABELS[type] ?? type;
}

export interface CountRow {
  type: string;
  label: string;
  count: number;
}

/** Rows for display, in a stable order. Zero counts are kept unless dropped. */
export function summariseCounts(
  counts: Record<string, number> | undefined,
  { dropZero = false }: { dropZero?: boolean } = {},
): CountRow[] {
  const order = Object.keys(RESOURCE_LABELS);
  return Object.entries(counts ?? {})
    .filter(([, n]) => Number.isFinite(n) && (!dropZero || n > 0))
    .map(([type, count]) => ({ type, label: labelForResourceType(type), count }))
    .sort((a, b) => {
      const ia = order.indexOf(a.type);
      const ib = order.indexOf(b.type);
      return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
    });
}

export function totalCount(counts: Record<string, number> | undefined): number {
  return Object.values(counts ?? {}).reduce(
    (sum, n) => sum + (Number.isFinite(n) ? n : 0),
    0,
  );
}

export type ExportSectionKey =
  | "includePatient"
  | "includeVitals"
  | "includeMedications"
  | "includeEncounters"
  | "includeConsultations"
  | "includeAllergies";

export interface ExportSection {
  key: ExportSectionKey;
  /** FHIR type the section becomes in the file (for preview counts). */
  resourceType: string;
  title: string;
  description: string;
  /** The preview count is an estimate rather than an exact number. */
  estimated?: boolean;
}

export const EXPORT_SECTIONS: ExportSection[] = [
  {
    key: "includePatient",
    resourceType: "Patient",
    title: "Your personal details",
    description: "Name, date of birth and contact details",
  },
  {
    key: "includeEncounters",
    resourceType: "Encounter",
    title: "Clinic visits",
    description: "When and where you were seen",
  },
  {
    key: "includeVitals",
    resourceType: "Observation",
    title: "Vital sign readings",
    description: "Blood pressure, pulse, temperature and other readings",
    estimated: true,
  },
  {
    key: "includeConsultations",
    resourceType: "DiagnosticReport",
    title: "Consultation notes",
    description: "Notes and diagnoses from your consultations",
  },
  {
    key: "includeMedications",
    resourceType: "MedicationRequest",
    title: "Medicines",
    description: "Medicines prescribed and given to you",
  },
  {
    key: "includeAllergies",
    resourceType: "AllergyIntolerance",
    title: "Allergies",
    description: "Known allergies and reactions",
  },
];

/** Count resources by type in a FHIR Bundle-like object ({ entry: [{ resource }] }). */
export function countBundleResources(bundle: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  const entries =
    bundle && typeof bundle === "object"
      ? (bundle as { entry?: unknown }).entry
      : undefined;
  if (!Array.isArray(entries)) return counts;
  for (const e of entries) {
    const type =
      e && typeof e === "object"
        ? (e as { resource?: { resourceType?: unknown } }).resource?.resourceType
        : undefined;
    if (typeof type === "string") counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

/** What the page tells the patient after a file has been made. */
export interface ExportOutcome {
  fileName: string;
  /** Where the records in the file came from. */
  source: "online" | "device";
  /** The online service failed and the file was made on this device instead. */
  fellBack?: boolean;
  counts?: Record<string, number>;
  /** ISO time: the file only has records changed after this. */
  since?: string;
  validation?: ValidationSummaryInput;
}

/**
 * Friendly text for exporter failures; never shows internal messages.
 * `fellBack`: the online service had already failed before this device was
 * tried, so "connect to the internet" would not help.
 */
export function exportErrorMessage(
  serviceError: string | undefined,
  { fellBack = false }: { fellBack?: boolean } = {},
): string {
  if (serviceError && /not found in local database/i.test(serviceError)) {
    return fellBack
      ? "The online service could not be reached, and your record is not saved on this device, so no file was made. Nothing was downloaded. Please try again later, or ask clinic staff for help."
      : "Your record is not saved on this device, so the file could not be made here. Connect to the internet and try again, or ask clinic staff for help.";
  }
  return fellBack
    ? "The online service could not be reached, and the file could not be made from this device either. Nothing was downloaded. Please try again later."
    : "We could not make your file. Nothing was downloaded. Please try again.";
}

/** "health-data-<patientId>-YYYY-MM-DD" — the name the exporter has always used. */
export function exportFileBase(patientId: string, now: Date = new Date()): string {
  return `health-data-${patientId}-${now.toISOString().split("T")[0]}`;
}

export interface ValidationSummaryInput {
  totalResources: number;
  validResources: number;
  invalidResources: number;
  summary: { warnings: number };
}

export interface ValidationSummary {
  tone: "success" | "warning";
  headline: string;
  detail?: string;
}

/** Honest wording for the format check: never green when items failed. */
export function describeValidation(v: ValidationSummaryInput): ValidationSummary {
  const failed = Math.max(0, v.invalidResources);
  if (failed > 0) {
    return {
      tone: "warning",
      headline: `${v.validResources} of ${v.totalResources} items passed the format check. ${failed} did not.`,
      detail:
        "The file was still created. Some health systems may not accept the items that did not pass.",
    };
  }
  return {
    tone: "success",
    headline: `All ${v.totalResources} items passed the format check.`,
    detail:
      v.summary.warnings > 0
        ? `${v.summary.warnings} minor notes were found. They do not stop the file being used.`
        : undefined,
  };
}
