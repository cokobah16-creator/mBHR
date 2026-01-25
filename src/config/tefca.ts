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
  fhirVersion: '4.0.1',
  fhirBaseUrl: import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tefca-ias`
    : '/api/fhir',
  organizationName: import.meta.env.VITE_ORGANIZATION || 'Med Bridge Health Reach',
  organizationOID: '2.16.840.1.113883.3.9999.1',
  supportedResources: [
    'Patient',
    'Observation',
    'MedicationRequest',
    'Encounter',
    'AllergyIntolerance',
    'Condition',
    'Procedure',
    'Immunization',
    'DiagnosticReport',
  ],
  supportedExchangePurposes: [
    'individual-access',
    'treatment',
    'payment',
    'operations',
  ],
  qhinPartners: [
    {
      id: 'demo-qhin-001',
      name: 'Demo Health Information Network',
      allowedPurposes: ['individual-access', 'treatment'],
      active: true,
    },
  ],
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
    name: 'Foundation',
    status: 'complete',
    features: [
      'FHIR R4 resource mapping (Patient, Observation, MedicationRequest, Encounter)',
      'Basic TEFCA API endpoint',
      'Consent verification',
      'Audit logging',
      'Capability statement',
    ],
  },
  phase2: {
    name: 'IAS Enhancement',
    status: 'planned',
    features: [
      'Patient-facing FHIR data export',
      'SMART on FHIR authorization',
      'Third-party app authorization',
      'Patient access history dashboard',
      'Granular consent management',
    ],
  },
  phase3: {
    name: 'QHIN Integration',
    status: 'planned',
    features: [
      'Production QHIN partnership registration',
      'Real credential management',
      'Cross-network patient matching',
      'Bi-directional data exchange',
      'Network directory integration',
    ],
  },
  phase4: {
    name: 'Advanced Interoperability',
    status: 'future',
    features: [
      'Bulk FHIR export ($export operation)',
      'Subscription-based notifications',
      'CDS Hooks integration',
      'US Core profile compliance certification',
      'CARIN Blue Button compliance',
    ],
  },
};

export const FHIR_PROFILES = {
  patient: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
  observation: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-vital-signs',
  bloodPressure: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure',
  medicationRequest: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-medicationrequest',
  encounter: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter',
  allergyIntolerance: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance',
  condition: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition',
};

export const TERMINOLOGY_SYSTEMS = {
  loinc: 'http://loinc.org',
  snomed: 'http://snomed.info/sct',
  rxnorm: 'http://www.nlm.nih.gov/research/umls/rxnorm',
  icd10: 'http://hl7.org/fhir/sid/icd-10-cm',
  cpt: 'http://www.ama-assn.org/go/cpt',
  ucum: 'http://unitsofmeasure.org',
  npi: 'http://hl7.org/fhir/sid/us-npi',
};
