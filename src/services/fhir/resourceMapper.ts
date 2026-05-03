import type {
  FHIRResource,
  FHIRPatient,
  FHIRObservation,
  FHIRMedicationRequest,
  FHIREncounter,
  FHIRBundle,
  FHIRCapabilityStatement,
  FHIROperationOutcome,
  FHIRCodeableConcept,
  FHIRCoding,
  FHIRAllergyIntolerance,
  FHIRCondition,
  FHIRImmunization,
  FHIRDiagnosticReport,
  FHIRMedicationDispense,
  FHIRProcedure,
  FHIRDocumentReference,
  FHIRCarePlan,
  FHIRGoal,
  FHIRServiceRequest,
} from "./types";

const SYSTEM_IDENTIFIERS = {
  MBHR: "urn:oid:2.16.840.1.113883.3.9999.1",
  LOINC: "http://loinc.org",
  SNOMED: "http://snomed.info/sct",
  RXNORM: "http://www.nlm.nih.gov/research/umls/rxnorm",
  UCUM: "http://unitsofmeasure.org",
};

const VITAL_LOINC_CODES: Record<
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
  heartRate: {
    code: "8867-4",
    display: "Heart rate",
    unit: "beats/min",
    ucum: "/min",
  },
  temperature: {
    code: "8310-5",
    display: "Body temperature",
    unit: "°C",
    ucum: "Cel",
  },
  respiratoryRate: {
    code: "9279-1",
    display: "Respiratory rate",
    unit: "breaths/min",
    ucum: "/min",
  },
  oxygenSaturation: {
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
    unit: "kg/m²",
    ucum: "kg/m2",
  },
};

interface LocalPatient {
  id: string;
  name: string;
  dob?: string;
  sex?: string;
  phone?: string;
  email?: string;
  address?: string;
  lga?: string;
  state?: string;
  updatedAt?: string;
}

interface LocalVitals {
  id: string;
  patientId: string;
  systolic?: number;
  diastolic?: number;
  heartRate?: number;
  temperature?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  weight?: number;
  height?: number;
  bmi?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface LocalDispense {
  id: string;
  patientId: string;
  drug: string;
  dosage?: string;
  quantity?: number;
  instructions?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface LocalVisit {
  id: string;
  patientId: string;
  visitType?: string;
  chiefComplaint?: string;
  startTime?: string;
  endTime?: string;
  status?: string;
  updatedAt?: string;
}

export function mapPatientToFHIR(patient: LocalPatient): FHIRPatient {
  const nameParts = patient.name.trim().split(/\s+/);
  const family = nameParts.pop() || "";
  const given = nameParts.length > 0 ? nameParts : undefined;

  const fhirPatient: FHIRPatient = {
    resourceType: "Patient",
    id: patient.id,
    meta: {
      lastUpdated: patient.updatedAt || new Date().toISOString(),
      source: "mBHR",
      profile: [
        "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient",
      ],
    },
    identifier: [
      {
        use: "usual",
        system: SYSTEM_IDENTIFIERS.MBHR,
        value: patient.id,
      },
    ],
    active: true,
    name: [
      {
        use: "official",
        family,
        given,
        text: patient.name,
      },
    ],
    telecom: [],
    address: [],
  };

  if (patient.phone) {
    fhirPatient.telecom!.push({
      system: "phone",
      value: patient.phone,
      use: "mobile",
    });
  }

  if (patient.email) {
    fhirPatient.telecom!.push({
      system: "email",
      value: patient.email,
    });
  }

  if (patient.sex) {
    const sexLower = patient.sex.toLowerCase();
    if (sexLower === "m" || sexLower === "male") {
      fhirPatient.gender = "male";
    } else if (sexLower === "f" || sexLower === "female") {
      fhirPatient.gender = "female";
    } else {
      fhirPatient.gender = "unknown";
    }
  }

  if (patient.dob) {
    fhirPatient.birthDate = patient.dob.split("T")[0];
  }

  if (patient.address || patient.lga || patient.state) {
    fhirPatient.address!.push({
      use: "home",
      type: "physical",
      text: patient.address,
      city: patient.lga,
      state: patient.state,
      country: "NG",
    });
  }

  return fhirPatient;
}

export function mapVitalsToFHIR(
  vitals: LocalVitals,
  patientName?: string,
): FHIRObservation[] {
  const observations: FHIRObservation[] = [];
  const effectiveDateTime = vitals.createdAt || new Date().toISOString();

  const createObservation = (
    vitalType: string,
    value: number | undefined,
  ): FHIRObservation | null => {
    if (value === undefined || value === null) return null;

    const loincInfo = VITAL_LOINC_CODES[vitalType];
    if (!loincInfo) return null;

    return {
      resourceType: "Observation",
      id: `${vitals.id}-${vitalType}`,
      meta: {
        lastUpdated: vitals.updatedAt || effectiveDateTime,
        source: "mBHR",
        profile: [
          "http://hl7.org/fhir/us/core/StructureDefinition/us-core-vital-signs",
        ],
      },
      identifier: [
        {
          system: SYSTEM_IDENTIFIERS.MBHR,
          value: `${vitals.id}-${vitalType}`,
        },
      ],
      status: "final",
      category: [
        {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "vital-signs",
              display: "Vital Signs",
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: SYSTEM_IDENTIFIERS.LOINC,
            code: loincInfo.code,
            display: loincInfo.display,
          },
        ],
        text: loincInfo.display,
      },
      subject: {
        reference: `Patient/${vitals.patientId}`,
        display: patientName,
      },
      effectiveDateTime,
      valueQuantity: {
        value,
        unit: loincInfo.unit,
        system: SYSTEM_IDENTIFIERS.UCUM,
        code: loincInfo.ucum,
      },
    };
  };

  if (vitals.systolic !== undefined && vitals.diastolic !== undefined) {
    const bpObservation: FHIRObservation = {
      resourceType: "Observation",
      id: `${vitals.id}-bp`,
      meta: {
        lastUpdated: vitals.updatedAt || effectiveDateTime,
        source: "mBHR",
        profile: [
          "http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure",
        ],
      },
      status: "final",
      category: [
        {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "vital-signs",
              display: "Vital Signs",
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: SYSTEM_IDENTIFIERS.LOINC,
            code: "85354-9",
            display: "Blood pressure panel with all children optional",
          },
        ],
        text: "Blood Pressure",
      },
      subject: {
        reference: `Patient/${vitals.patientId}`,
        display: patientName,
      },
      effectiveDateTime,
      component: [
        {
          code: {
            coding: [
              {
                system: SYSTEM_IDENTIFIERS.LOINC,
                code: "8480-6",
                display: "Systolic blood pressure",
              },
            ],
          },
          valueQuantity: {
            value: vitals.systolic,
            unit: "mmHg",
            system: SYSTEM_IDENTIFIERS.UCUM,
            code: "mm[Hg]",
          },
        },
        {
          code: {
            coding: [
              {
                system: SYSTEM_IDENTIFIERS.LOINC,
                code: "8462-4",
                display: "Diastolic blood pressure",
              },
            ],
          },
          valueQuantity: {
            value: vitals.diastolic,
            unit: "mmHg",
            system: SYSTEM_IDENTIFIERS.UCUM,
            code: "mm[Hg]",
          },
        },
      ],
    };
    observations.push(bpObservation);
  }

  const simpleVitals: Array<{ key: keyof LocalVitals; type: string }> = [
    { key: "heartRate", type: "heartRate" },
    { key: "temperature", type: "temperature" },
    { key: "respiratoryRate", type: "respiratoryRate" },
    { key: "oxygenSaturation", type: "oxygenSaturation" },
    { key: "weight", type: "weight" },
    { key: "height", type: "height" },
    { key: "bmi", type: "bmi" },
  ];

  for (const { key, type } of simpleVitals) {
    const obs = createObservation(type, vitals[key] as number | undefined);
    if (obs) observations.push(obs);
  }

  return observations;
}

export function mapDispenseToFHIR(
  dispense: LocalDispense,
  patientName?: string,
): FHIRMedicationRequest {
  return {
    resourceType: "MedicationRequest",
    id: dispense.id,
    meta: {
      lastUpdated: dispense.updatedAt || new Date().toISOString(),
      source: "mBHR",
      profile: [
        "http://hl7.org/fhir/us/core/StructureDefinition/us-core-medicationrequest",
      ],
    },
    identifier: [
      {
        system: SYSTEM_IDENTIFIERS.MBHR,
        value: dispense.id,
      },
    ],
    status: "completed",
    intent: "order",
    medicationCodeableConcept: {
      text: dispense.drug,
    },
    subject: {
      reference: `Patient/${dispense.patientId}`,
      display: patientName,
    },
    authoredOn: dispense.createdAt,
    dosageInstruction: dispense.dosage
      ? [
          {
            text: `${dispense.dosage}${dispense.instructions ? ` - ${dispense.instructions}` : ""}`,
          },
        ]
      : undefined,
    dispenseRequest: dispense.quantity
      ? {
          quantity: {
            value: dispense.quantity,
            unit: "tablets",
          },
        }
      : undefined,
  };
}

export function mapVisitToFHIR(
  visit: LocalVisit,
  patientName?: string,
): FHIREncounter {
  let status: FHIREncounter["status"] = "unknown";
  if (visit.status) {
    const s = visit.status.toLowerCase();
    if (s === "completed" || s === "done") status = "finished";
    else if (s === "in-progress" || s === "active") status = "in-progress";
    else if (s === "cancelled") status = "cancelled";
    else if (s === "planned" || s === "scheduled") status = "planned";
  }

  const reasonCode: FHIRCodeableConcept[] = [];
  if (visit.chiefComplaint) {
    reasonCode.push({
      text: visit.chiefComplaint,
    });
  }

  return {
    resourceType: "Encounter",
    id: visit.id,
    meta: {
      lastUpdated: visit.updatedAt || new Date().toISOString(),
      source: "mBHR",
      profile: [
        "http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter",
      ],
    },
    identifier: [
      {
        system: SYSTEM_IDENTIFIERS.MBHR,
        value: visit.id,
      },
    ],
    status,
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory",
    },
    type: visit.visitType
      ? [
          {
            text: visit.visitType,
          },
        ]
      : undefined,
    subject: {
      reference: `Patient/${visit.patientId}`,
      display: patientName,
    },
    period: {
      start: visit.startTime,
      end: visit.endTime,
    },
    reasonCode: reasonCode.length > 0 ? reasonCode : undefined,
  };
}

export function createBundle(
  resources: Array<
    { resourceType: string; id?: string } & Record<string, unknown>
  >,
  baseUrl: string,
  total?: number,
): FHIRBundle {
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: total ?? resources.length,
    link: [
      {
        relation: "self",
        url: baseUrl,
      },
    ],
    entry: resources.map((resource) => ({
      fullUrl: resource.id
        ? `${baseUrl}/${resource.resourceType}/${resource.id}`
        : undefined,
      resource: resource as unknown as FHIRResource,
      search: {
        mode: "match",
      },
    })),
  };
}

export function createCapabilityStatement(
  _baseUrl: string,
): FHIRCapabilityStatement {
  return {
    resourceType: "CapabilityStatement",
    id: "mbhr-tefca-capability",
    meta: {
      lastUpdated: new Date().toISOString(),
    },
    status: "active",
    date: new Date().toISOString(),
    kind: "instance",
    fhirVersion: "4.0.1",
    format: ["json"],
    rest: [
      {
        mode: "server",
        resource: [
          {
            type: "Patient",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "identifier", type: "token" },
              { name: "name", type: "string" },
              { name: "birthdate", type: "date" },
            ],
          },
          {
            type: "Observation",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "patient", type: "reference" },
              { name: "category", type: "token" },
              { name: "date", type: "date" },
            ],
          },
          {
            type: "MedicationRequest",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "patient", type: "reference" },
              { name: "authoredon", type: "date" },
            ],
          },
          {
            type: "Encounter",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "patient", type: "reference" },
              { name: "date", type: "date" },
            ],
          },
        ],
      },
    ],
  };
}

export function createOperationOutcome(
  severity: "fatal" | "error" | "warning" | "information",
  code: string,
  diagnostics: string,
): FHIROperationOutcome {
  return {
    resourceType: "OperationOutcome",
    issue: [
      {
        severity,
        code,
        diagnostics,
      },
    ],
  };
}

export function createLoincCode(code: string, display: string): FHIRCoding {
  return {
    system: SYSTEM_IDENTIFIERS.LOINC,
    code,
    display,
  };
}

export function createSnomedCode(code: string, display: string): FHIRCoding {
  return {
    system: SYSTEM_IDENTIFIERS.SNOMED,
    code,
    display,
  };
}

const US_CORE = "http://hl7.org/fhir/us/core/StructureDefinition";

const ALLERGY_CATEGORY_MAP: Record<
  string,
  "food" | "medication" | "environment" | "biologic"
> = {
  food: "food",
  medication: "medication",
  environmental: "environment",
  other: "biologic",
};

const ALLERGY_CRITICALITY_MAP: Record<
  string,
  "low" | "high" | "unable-to-assess"
> = {
  mild: "low",
  moderate: "low",
  severe: "high",
  "life-threatening": "high",
};

const ALLERGY_REACTION_SEVERITY_MAP: Record<
  string,
  "mild" | "moderate" | "severe"
> = {
  mild: "mild",
  moderate: "moderate",
  severe: "severe",
  "life-threatening": "severe",
};

export interface LocalAllergy {
  id: string;
  patientId: string;
  allergen: string;
  allergyType?: string;
  reaction?: string;
  severity?: string;
  onsetDate?: string;
  notes?: string;
  isActive?: boolean;
  updatedAt?: string;
}

export function mapAllergyIntoleranceToFHIR(
  allergy: LocalAllergy,
  patientName?: string,
): FHIRAllergyIntolerance {
  return {
    resourceType: "AllergyIntolerance",
    id: allergy.id,
    meta: {
      lastUpdated: allergy.updatedAt || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-allergyintolerance`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: allergy.id }],
    clinicalStatus: {
      coding: [
        {
          system:
            "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
          code: allergy.isActive === false ? "inactive" : "active",
          display: allergy.isActive === false ? "Inactive" : "Active",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system:
            "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
          code: "confirmed",
          display: "Confirmed",
        },
      ],
    },
    type: "allergy",
    category: allergy.allergyType
      ? [ALLERGY_CATEGORY_MAP[allergy.allergyType] || "biologic"]
      : undefined,
    criticality: allergy.severity
      ? ALLERGY_CRITICALITY_MAP[allergy.severity] || "unable-to-assess"
      : undefined,
    code: { text: allergy.allergen },
    patient: {
      reference: `Patient/${allergy.patientId}`,
      display: patientName,
    },
    onsetDateTime: allergy.onsetDate,
    reaction: allergy.reaction
      ? [
          {
            manifestation: [{ text: allergy.reaction }],
            severity: allergy.severity
              ? ALLERGY_REACTION_SEVERITY_MAP[allergy.severity] || "moderate"
              : "moderate",
          },
        ]
      : undefined,
    note: allergy.notes ? [{ text: allergy.notes }] : undefined,
  };
}

export interface LocalCondition {
  id: string;
  patientId: string;
  conditionCode?: string;
  conditionName: string;
  clinicalStatus?: string;
  verificationStatus?: string;
  category?: string;
  severity?: "mild" | "moderate" | "severe";
  onsetDate?: string;
  abatementDate?: string;
  recordedDate?: string;
  notes?: string;
  updatedAt?: string;
}

export function mapConditionToFHIR(
  cond: LocalCondition,
  patientName?: string,
): FHIRCondition {
  const SEVERITY_SNOMED: Record<string, { code: string; display: string }> = {
    mild: { code: "255604002", display: "Mild" },
    moderate: { code: "6736007", display: "Moderate" },
    severe: { code: "24484000", display: "Severe" },
  };

  return {
    resourceType: "Condition",
    id: cond.id,
    meta: {
      lastUpdated: cond.updatedAt || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-condition-problems-health-concerns`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: cond.id }],
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: cond.clinicalStatus || "active",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          code: cond.verificationStatus || "confirmed",
        },
      ],
    },
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-category",
            code: cond.category || "problem-list-item",
          },
        ],
      },
    ],
    severity: cond.severity
      ? {
          coding: [
            {
              system: SYSTEM_IDENTIFIERS.SNOMED,
              ...SEVERITY_SNOMED[cond.severity],
            },
          ],
        }
      : undefined,
    code: {
      coding: cond.conditionCode
        ? [
            {
              system: "http://hl7.org/fhir/sid/icd-10-cm",
              code: cond.conditionCode,
              display: cond.conditionName,
            },
          ]
        : [],
      text: cond.conditionName,
    },
    subject: {
      reference: `Patient/${cond.patientId}`,
      display: patientName,
    },
    onsetDateTime: cond.onsetDate,
    abatementDateTime: cond.abatementDate,
    recordedDate: cond.recordedDate,
    note: cond.notes ? [{ text: cond.notes }] : undefined,
  };
}

export interface LocalImmunization {
  id: string;
  patientId: string;
  vaccineCode?: string;
  vaccineName: string;
  status?: "completed" | "entered-in-error" | "not-done";
  administeredAt?: string;
  lotNumber?: string;
  site?: string;
  route?: string;
  doseQuantity?: number;
  doseUnit?: string;
  seriesDoseNumber?: number;
  seriesDosesRecommended?: number;
  notes?: string;
  updatedAt?: string;
}

export function mapImmunizationToFHIR(
  imm: LocalImmunization,
  patientName?: string,
): FHIRImmunization {
  return {
    resourceType: "Immunization",
    id: imm.id,
    meta: {
      lastUpdated: imm.updatedAt || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-immunization`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: imm.id }],
    status: imm.status || "completed",
    vaccineCode: {
      coding: imm.vaccineCode
        ? [
            {
              system: "http://hl7.org/fhir/sid/cvx",
              code: imm.vaccineCode,
              display: imm.vaccineName,
            },
          ]
        : [],
      text: imm.vaccineName,
    },
    patient: {
      reference: `Patient/${imm.patientId}`,
      display: patientName,
    },
    occurrenceDateTime: imm.administeredAt,
    lotNumber: imm.lotNumber,
    site: imm.site ? { text: imm.site } : undefined,
    route: imm.route ? { text: imm.route } : undefined,
    doseQuantity:
      imm.doseQuantity !== undefined
        ? { value: imm.doseQuantity, unit: imm.doseUnit || "mL" }
        : undefined,
    protocolApplied:
      imm.seriesDoseNumber !== undefined
        ? [
            {
              doseNumberPositiveInt: imm.seriesDoseNumber,
              seriesDosesPositiveInt: imm.seriesDosesRecommended,
            },
          ]
        : undefined,
    note: imm.notes ? [{ text: imm.notes }] : undefined,
  };
}

export interface LocalDiagnosticReport {
  id: string;
  patientId: string;
  encounterId?: string;
  testName: string;
  testCode?: string;
  status?: FHIRDiagnosticReport["status"];
  effectiveDateTime?: string;
  issued?: string;
  conclusion?: string;
  resultRefs?: string[];
  updatedAt?: string;
}

export function mapDiagnosticReportToFHIR(
  report: LocalDiagnosticReport,
  patientName?: string,
): FHIRDiagnosticReport {
  return {
    resourceType: "DiagnosticReport",
    id: report.id,
    meta: {
      lastUpdated: report.updatedAt || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-diagnosticreport-lab`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: report.id }],
    status: report.status || "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v2-0074",
            code: "LAB",
            display: "Laboratory",
          },
        ],
      },
    ],
    code: {
      coding: report.testCode
        ? [
            {
              system: SYSTEM_IDENTIFIERS.LOINC,
              code: report.testCode,
              display: report.testName,
            },
          ]
        : [],
      text: report.testName,
    },
    subject: {
      reference: `Patient/${report.patientId}`,
      display: patientName,
    },
    encounter: report.encounterId
      ? { reference: `Encounter/${report.encounterId}` }
      : undefined,
    effectiveDateTime: report.effectiveDateTime,
    issued: report.issued,
    result: report.resultRefs?.map((ref) => ({
      reference: `Observation/${ref}`,
    })),
    conclusion: report.conclusion,
  };
}

export interface LocalMedicationDispense {
  id: string;
  patientId: string;
  visitId?: string;
  itemName: string;
  medicationCode?: string;
  medicationCodeSystem?: string;
  qty?: number;
  daysSupply?: number;
  status?: FHIRMedicationDispense["status"];
  whenHandedOver?: string;
  authorizingPrescriptionId?: string;
  dispensedBy?: string;
  dosage?: string;
  directions?: string;
  updatedAt?: string;
}

export function mapMedicationDispenseToFHIR(
  d: LocalMedicationDispense,
  patientName?: string,
): FHIRMedicationDispense {
  const dosageText = [d.dosage, d.directions].filter(Boolean).join(" - ");

  return {
    resourceType: "MedicationDispense",
    id: d.id,
    meta: {
      lastUpdated: d.updatedAt || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-medicationdispense`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: d.id }],
    status: d.status || "completed",
    medicationCodeableConcept: {
      coding: d.medicationCode
        ? [
            {
              system: d.medicationCodeSystem || SYSTEM_IDENTIFIERS.RXNORM,
              code: d.medicationCode,
              display: d.itemName,
            },
          ]
        : undefined,
      text: d.itemName,
    },
    subject: {
      reference: `Patient/${d.patientId}`,
      display: patientName,
    },
    context: d.visitId ? { reference: `Encounter/${d.visitId}` } : undefined,
    authorizingPrescription: d.authorizingPrescriptionId
      ? [
          {
            reference: `MedicationRequest/${d.authorizingPrescriptionId}`,
          },
        ]
      : undefined,
    quantity: d.qty !== undefined ? { value: d.qty, unit: "units" } : undefined,
    daysSupply:
      d.daysSupply !== undefined
        ? {
            value: d.daysSupply,
            unit: "days",
            system: SYSTEM_IDENTIFIERS.UCUM,
            code: "d",
          }
        : undefined,
    whenHandedOver: d.whenHandedOver,
    performer: d.dispensedBy
      ? [
          {
            actor: {
              reference: `Practitioner/${d.dispensedBy}`,
              display: d.dispensedBy,
            },
          },
        ]
      : undefined,
    dosageInstruction: dosageText ? [{ text: dosageText }] : undefined,
  };
}

export interface LocalProcedure {
  id: string;
  patientId: string;
  encounterId?: string;
  codeSystem?: string;
  code?: string;
  display: string;
  status?: FHIRProcedure["status"];
  performedAt?: string;
  performerId?: string;
  notes?: string;
  updatedAt?: string;
}

export function mapProcedureToFHIR(
  p: LocalProcedure,
  patientName?: string,
): FHIRProcedure {
  return {
    resourceType: "Procedure",
    id: p.id,
    meta: {
      lastUpdated: p.updatedAt || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-procedure`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: p.id }],
    status: p.status || "completed",
    code: {
      coding: p.code
        ? [
            {
              system: p.codeSystem || SYSTEM_IDENTIFIERS.SNOMED,
              code: p.code,
              display: p.display,
            },
          ]
        : [],
      text: p.display,
    },
    subject: {
      reference: `Patient/${p.patientId}`,
      display: patientName,
    },
    encounter: p.encounterId
      ? { reference: `Encounter/${p.encounterId}` }
      : undefined,
    performedDateTime: p.performedAt,
    performer: p.performerId
      ? [
          {
            actor: {
              reference: `Practitioner/${p.performerId}`,
              display: p.performerId,
            },
          },
        ]
      : undefined,
    note: p.notes ? [{ text: p.notes }] : undefined,
  };
}

export interface LocalDocumentReference {
  id: string;
  patientId: string;
  contextEncounterId?: string;
  typeSystem?: string;
  typeCode?: string;
  typeDisplay?: string;
  category?: string;
  status?: FHIRDocumentReference["status"];
  docStatus?: FHIRDocumentReference["docStatus"];
  contentUrl: string;
  contentType?: string;
  contentTitle?: string;
  authorId?: string;
  authoredAt?: string;
  updatedAt?: string;
}

export function mapDocumentReferenceToFHIR(
  doc: LocalDocumentReference,
  patientName?: string,
): FHIRDocumentReference {
  return {
    resourceType: "DocumentReference",
    id: doc.id,
    meta: {
      lastUpdated: doc.updatedAt || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-documentreference`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: doc.id }],
    status: doc.status || "current",
    docStatus: doc.docStatus,
    type: doc.typeCode
      ? {
          coding: [
            {
              system: doc.typeSystem || SYSTEM_IDENTIFIERS.LOINC,
              code: doc.typeCode,
              display: doc.typeDisplay,
            },
          ],
          text: doc.typeDisplay,
        }
      : undefined,
    category: doc.category
      ? [
          {
            coding: [
              {
                system:
                  "http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category",
                code: doc.category,
              },
            ],
          },
        ]
      : undefined,
    subject: {
      reference: `Patient/${doc.patientId}`,
      display: patientName,
    },
    date: doc.authoredAt,
    author: doc.authorId
      ? [
          {
            reference: `Practitioner/${doc.authorId}`,
            display: doc.authorId,
          },
        ]
      : undefined,
    content: [
      {
        attachment: {
          contentType: doc.contentType || "application/pdf",
          url: doc.contentUrl,
          title: doc.contentTitle,
          creation: doc.authoredAt,
        },
      },
    ],
    context: doc.contextEncounterId
      ? {
          encounter: [{ reference: `Encounter/${doc.contextEncounterId}` }],
        }
      : undefined,
  };
}

export interface LocalCarePlan {
  id: string;
  patientId: string;
  category?: string;
  intent?: FHIRCarePlan["intent"];
  status?: FHIRCarePlan["status"];
  title?: string;
  description?: string;
  periodStart?: string;
  periodEnd?: string;
  addresses?: string[];
  goalIds?: string[];
  authorId?: string;
  updatedAt?: string;
}

export function mapCarePlanToFHIR(
  cp: LocalCarePlan,
  patientName?: string,
): FHIRCarePlan {
  return {
    resourceType: "CarePlan",
    id: cp.id,
    meta: {
      lastUpdated: cp.updatedAt || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-careplan`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: cp.id }],
    status: cp.status || "active",
    intent: cp.intent || "plan",
    category: cp.category
      ? [
          {
            coding: [
              {
                system:
                  "http://hl7.org/fhir/us/core/CodeSystem/careplan-category",
                code: cp.category,
              },
            ],
          },
        ]
      : undefined,
    title: cp.title,
    description: cp.description,
    subject: {
      reference: `Patient/${cp.patientId}`,
      display: patientName,
    },
    period:
      cp.periodStart || cp.periodEnd
        ? { start: cp.periodStart, end: cp.periodEnd }
        : undefined,
    author: cp.authorId
      ? {
          reference: `Practitioner/${cp.authorId}`,
          display: cp.authorId,
        }
      : undefined,
    addresses: cp.addresses?.map((id) => ({
      reference: `Condition/${id}`,
    })),
    goal: cp.goalIds?.map((id) => ({ reference: `Goal/${id}` })),
  };
}

export interface LocalGoal {
  id: string;
  patientId: string;
  carePlanId?: string;
  lifecycleStatus?: FHIRGoal["lifecycleStatus"];
  achievementStatus?: string;
  category?: string;
  description: string;
  startDate?: string;
  targetDate?: string;
  updatedAt?: string;
}

export function mapGoalToFHIR(g: LocalGoal, patientName?: string): FHIRGoal {
  return {
    resourceType: "Goal",
    id: g.id,
    meta: {
      lastUpdated: g.updatedAt || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-goal`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: g.id }],
    lifecycleStatus: g.lifecycleStatus || "active",
    achievementStatus: g.achievementStatus
      ? {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/goal-achievement",
              code: g.achievementStatus,
            },
          ],
        }
      : undefined,
    category: g.category
      ? [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/goal-category",
                code: g.category,
              },
            ],
          },
        ]
      : undefined,
    description: { text: g.description },
    subject: {
      reference: `Patient/${g.patientId}`,
      display: patientName,
    },
    startDate: g.startDate,
    target: g.targetDate ? [{ dueDate: g.targetDate }] : undefined,
  };
}

export interface LocalServiceRequest {
  id: string;
  patientId: string;
  encounterId?: string;
  intent?: FHIRServiceRequest["intent"];
  status?: FHIRServiceRequest["status"];
  category?: string;
  codeSystem?: string;
  code?: string;
  display: string;
  requesterId?: string;
  occurrenceAt?: string;
  notes?: string;
  updatedAt?: string;
}

export function mapServiceRequestToFHIR(
  sr: LocalServiceRequest,
  patientName?: string,
): FHIRServiceRequest {
  return {
    resourceType: "ServiceRequest",
    id: sr.id,
    meta: {
      lastUpdated: sr.updatedAt || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-servicerequest`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: sr.id }],
    status: sr.status || "active",
    intent: sr.intent || "order",
    category: sr.category
      ? [
          {
            coding: [
              {
                system: SYSTEM_IDENTIFIERS.SNOMED,
                code: sr.category,
              },
            ],
          },
        ]
      : undefined,
    code: sr.code
      ? {
          coding: [
            {
              system: sr.codeSystem || SYSTEM_IDENTIFIERS.SNOMED,
              code: sr.code,
              display: sr.display,
            },
          ],
          text: sr.display,
        }
      : { text: sr.display },
    subject: {
      reference: `Patient/${sr.patientId}`,
      display: patientName,
    },
    encounter: sr.encounterId
      ? { reference: `Encounter/${sr.encounterId}` }
      : undefined,
    occurrenceDateTime: sr.occurrenceAt,
    requester: sr.requesterId
      ? {
          reference: `Practitioner/${sr.requesterId}`,
          display: sr.requesterId,
        }
      : undefined,
    note: sr.notes ? [{ text: sr.notes }] : undefined,
  };
}
