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
