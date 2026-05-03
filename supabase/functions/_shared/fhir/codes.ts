// FHIR domain constants, types, and small helpers shared by every Supabase
// edge function that speaks FHIR (tefca-ias, tefca-bulk, tefca-oauth).
//
// Endpoint-specific HTTP helpers (corsHeaders, fhirJsonHeaders, response
// shorthand) live next to each function in its own shared.ts; only the FHIR
// payload surface lives here.

export const SYSTEM_IDENTIFIERS = {
  MBHR: "urn:oid:2.16.840.1.113883.3.9999.1",
  LOINC: "http://loinc.org",
  SNOMED: "http://snomed.info/sct",
  ICD10: "http://hl7.org/fhir/sid/icd-10-cm",
  CVX: "http://hl7.org/fhir/sid/cvx",
  UCUM: "http://unitsofmeasure.org",
  RXNORM: "http://www.nlm.nih.gov/research/umls/rxnorm",
} as const;

export const US_CORE = "http://hl7.org/fhir/us/core/StructureDefinition";

export const VITAL_LOINC_CODES: Record<
  string,
  { code: string; display: string; unit: string; ucum: string }
> = {
  systolic: {
    code: "8480-6",
    display: "Systolic blood pressure",
    unit: "mmHg",
    ucum: "mm[Hg]",
  },
  diastolic: {
    code: "8462-4",
    display: "Diastolic blood pressure",
    unit: "mmHg",
    ucum: "mm[Hg]",
  },
  heart_rate: {
    code: "8867-4",
    display: "Heart rate",
    unit: "beats/min",
    ucum: "/min",
  },
  temperature: {
    code: "8310-5",
    display: "Body temperature",
    unit: "C",
    ucum: "Cel",
  },
  respiratory_rate: {
    code: "9279-1",
    display: "Respiratory rate",
    unit: "breaths/min",
    ucum: "/min",
  },
  oxygen_saturation: {
    code: "2708-6",
    display: "Oxygen saturation",
    unit: "%",
    ucum: "%",
  },
  weight: { code: "29463-7", display: "Body weight", unit: "kg", ucum: "kg" },
  height: { code: "8302-2", display: "Body height", unit: "cm", ucum: "cm" },
  bmi: {
    code: "39156-5",
    display: "Body mass index",
    unit: "kg/m2",
    ucum: "kg/m2",
  },
};

export const SDOH_LOINC_CODES: Record<
  string,
  { code: string; display: string }
> = {
  housing: { code: "71802-3", display: "Housing status" },
  food: { code: "88122-7", display: "Food insecurity risk" },
  transportation: { code: "93030-5", display: "Transportation needs" },
  employment: { code: "67875-5", display: "Employment status" },
  education: { code: "82589-3", display: "Highest level of education" },
  social: { code: "93159-2", display: "Social connection and isolation" },
  financial: { code: "76513-1", display: "Financial resource strain" },
  safety: { code: "93038-8", display: "Stress due to physical safety" },
};

export type ExchangePurpose =
  | "individual-access"
  | "treatment"
  | "payment"
  | "operations";

export const VALID_EXCHANGE_PURPOSES: ExchangePurpose[] = [
  "individual-access",
  "treatment",
  "payment",
  "operations",
];

export interface TEFCAContext {
  qhinId: string;
  exchangePurpose: ExchangePurpose;
  requestingOrganization: string;
  ipAddress: string;
}

export function createOperationOutcome(
  severity: string,
  code: string,
  diagnostics: string,
) {
  return {
    resourceType: "OperationOutcome",
    issue: [{ severity, code, diagnostics }],
  };
}

export function createBundle(
  resources: unknown[],
  baseUrl: string,
  total?: number,
) {
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: total ?? resources.length,
    link: [{ relation: "self", url: baseUrl }],
    entry: resources.map(
      (resource: { resourceType?: string; id?: string }) => ({
        fullUrl: resource.id
          ? `${baseUrl}/${resource.resourceType}/${resource.id}`
          : undefined,
        resource,
        search: { mode: "match" },
      }),
    ),
  };
}
