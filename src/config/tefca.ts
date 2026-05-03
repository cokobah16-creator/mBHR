export interface TEFCAConfig {
  enabled: boolean;
  fhirVersion: string;
  fhirBaseUrl: string;
  organizationName: string;
  organizationOID: string;
  supportedResources: string[];
  supportedExchangePurposes: string[];
  qhinPartners: QHINPartnerConfig[];
  auditRetentionDays: number;
  rateLimitPerMinute: number;
}

export interface QHINPartnerConfig {
  id: string;
  name: string;
  endpoint?: string;
  allowedPurposes: string[];
  active: boolean;
}

const defaultConfig: TEFCAConfig = {
  enabled: true,
  fhirVersion: "4.0.1",
  fhirBaseUrl: import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tefca-ias`
    : "/api/fhir",
  organizationName:
    import.meta.env.VITE_ORGANIZATION || "Med Bridge Health Reach",
  organizationOID: "2.16.840.1.113883.3.9999.1",
  supportedResources: [
    "Patient",
    "Observation",
    "MedicationRequest",
    "MedicationDispense",
    "Encounter",
    "AllergyIntolerance",
    "Condition",
    "Procedure",
    "Immunization",
    "DiagnosticReport",
    "DocumentReference",
    "CarePlan",
    "Goal",
    "ServiceRequest",
  ],
  supportedExchangePurposes: [
    "individual-access",
    "treatment",
    "payment",
    "operations",
  ],
  qhinPartners: [],
  auditRetentionDays: 365 * 6,
  rateLimitPerMinute: 100,
};

let currentConfig: TEFCAConfig = { ...defaultConfig };

export function getTEFCAConfig(): TEFCAConfig {
  return { ...currentConfig };
}

export function updateTEFCAConfig(updates: Partial<TEFCAConfig>): void {
  currentConfig = { ...currentConfig, ...updates };
}

export function isTEFCAEnabled(): boolean {
  return currentConfig.enabled;
}

export function getFHIRBaseUrl(): string {
  return currentConfig.fhirBaseUrl;
}

export function isResourceSupported(resourceType: string): boolean {
  return currentConfig.supportedResources.includes(resourceType);
}

export function isExchangePurposeSupported(purpose: string): boolean {
  return currentConfig.supportedExchangePurposes.includes(purpose);
}

export function getQHINPartner(qhinId: string): QHINPartnerConfig | undefined {
  return currentConfig.qhinPartners.find((p) => p.id === qhinId);
}

export const TEFCA_ROADMAP = {
  phase1: {
    name: "Foundation",
    status: "complete",
    features: [
      "FHIR R4 resource mapping (Patient, Observation, MedicationRequest, Encounter)",
      "Basic TEFCA API endpoint",
      "Consent verification",
      "Audit logging",
      "Capability statement",
    ],
  },
  phase2: {
    name: "IAS Enhancement",
    status: "planned",
    features: [
      "Patient-facing FHIR data export",
      "SMART on FHIR authorization",
      "Third-party app authorization",
      "Patient access history dashboard",
      "Granular consent management",
    ],
  },
  phase3: {
    name: "QHIN Integration",
    status: "planned",
    features: [
      "Production QHIN partnership registration",
      "Real credential management",
      "Cross-network patient matching",
      "Bi-directional data exchange",
      "Network directory integration",
    ],
  },
  phase4: {
    name: "Advanced Interoperability",
    status: "in-progress",
    features: [
      "Bulk FHIR export ($export operation)",
      "Subscription-based notifications",
      "CDS Hooks integration",
      "US Core profile compliance certification",
      "CARIN Blue Button compliance",
    ],
  },
};

export const US_CORE_VERSION = "7.0.0";
const US_CORE_BASE = "http://hl7.org/fhir/us/core/StructureDefinition";

export const FHIR_PROFILES = {
  patient: `${US_CORE_BASE}/us-core-patient`,
  observation: `${US_CORE_BASE}/us-core-vital-signs`,
  bloodPressure: `${US_CORE_BASE}/us-core-blood-pressure`,
  medicationRequest: `${US_CORE_BASE}/us-core-medicationrequest`,
  medicationDispense: `${US_CORE_BASE}/us-core-medicationdispense`,
  encounter: `${US_CORE_BASE}/us-core-encounter`,
  allergyIntolerance: `${US_CORE_BASE}/us-core-allergyintolerance`,
  condition: `${US_CORE_BASE}/us-core-condition-problems-health-concerns`,
  immunization: `${US_CORE_BASE}/us-core-immunization`,
  diagnosticReport: `${US_CORE_BASE}/us-core-diagnosticreport-lab`,
  procedure: `${US_CORE_BASE}/us-core-procedure`,
  documentReference: `${US_CORE_BASE}/us-core-documentreference`,
  carePlan: `${US_CORE_BASE}/us-core-careplan`,
  goal: `${US_CORE_BASE}/us-core-goal`,
  serviceRequest: `${US_CORE_BASE}/us-core-servicerequest`,
};

export const TERMINOLOGY_SYSTEMS = {
  loinc: "http://loinc.org",
  snomed: "http://snomed.info/sct",
  rxnorm: "http://www.nlm.nih.gov/research/umls/rxnorm",
  icd10: "http://hl7.org/fhir/sid/icd-10-cm",
  cpt: "http://www.ama-assn.org/go/cpt",
  ucum: "http://unitsofmeasure.org",
  npi: "http://hl7.org/fhir/sid/us-npi",
};
