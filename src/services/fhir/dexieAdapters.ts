import type {
  Patient,
  Vital,
  Consultation,
  Dispense,
  Visit,
  PatientAllergy,
} from '../../db';
import type {
  FHIRPatient,
  FHIRObservation,
  FHIRMedicationRequest,
  FHIREncounter,
  FHIRResource,
  FHIRCodeableConcept,
} from './types';

const SYSTEM_IDENTIFIERS = {
  MBHR: 'urn:oid:2.16.840.1.113883.3.9999.1',
  LOINC: 'http://loinc.org',
  SNOMED: 'http://snomed.info/sct',
  RXNORM: 'http://www.nlm.nih.gov/research/umls/rxnorm',
  UCUM: 'http://unitsofmeasure.org',
};

const VITAL_LOINC_CODES: Record<string, { code: string; display: string; unit: string; ucum: string }> = {
  heightCm: { code: '8302-2', display: 'Body height', unit: 'cm', ucum: 'cm' },
  weightKg: { code: '29463-7', display: 'Body weight', unit: 'kg', ucum: 'kg' },
  tempC: { code: '8310-5', display: 'Body temperature', unit: 'Cel', ucum: 'Cel' },
  pulseBpm: { code: '8867-4', display: 'Heart rate', unit: '/min', ucum: '/min' },
  spo2: { code: '2708-6', display: 'Oxygen saturation', unit: '%', ucum: '%' },
  bmi: { code: '39156-5', display: 'Body mass index', unit: 'kg/m2', ucum: 'kg/m2' },
};

export interface FHIRAllergyIntolerance extends FHIRResource {
  resourceType: 'AllergyIntolerance';
  clinicalStatus?: FHIRCodeableConcept;
  verificationStatus?: FHIRCodeableConcept;
  type?: 'allergy' | 'intolerance';
  category?: ('food' | 'medication' | 'environment' | 'biologic')[];
  criticality?: 'low' | 'high' | 'unable-to-assess';
  code?: FHIRCodeableConcept;
  patient: { reference: string; display?: string };
  onsetDateTime?: string;
  reaction?: Array<{
    manifestation: FHIRCodeableConcept[];
    severity?: 'mild' | 'moderate' | 'severe';
  }>;
  note?: Array<{ text: string }>;
}

export interface FHIRCondition extends FHIRResource {
  resourceType: 'Condition';
  clinicalStatus: FHIRCodeableConcept;
  verificationStatus?: FHIRCodeableConcept;
  category?: FHIRCodeableConcept[];
  severity?: FHIRCodeableConcept;
  code: FHIRCodeableConcept;
  subject: { reference: string; display?: string };
  onsetDateTime?: string;
  recordedDate?: string;
  note?: Array<{ text: string }>;
}

export interface FHIRDiagnosticReport extends FHIRResource {
  resourceType: 'DiagnosticReport';
  status: 'registered' | 'partial' | 'preliminary' | 'final' | 'amended' | 'corrected' | 'appended' | 'cancelled' | 'entered-in-error' | 'unknown';
  category?: FHIRCodeableConcept[];
  code: FHIRCodeableConcept;
  subject: { reference: string; display?: string };
  encounter?: { reference: string };
  effectiveDateTime?: string;
  issued?: string;
  conclusion?: string;
  presentedForm?: Array<{
    contentType?: string;
    data?: string;
    title?: string;
  }>;
}

export function adaptDexiePatient(patient: Patient): FHIRPatient {
  const lastUpdated = patient.updatedAt instanceof Date
    ? patient.updatedAt.toISOString()
    : patient._syncedAt || new Date().toISOString();

  const fhirPatient: FHIRPatient = {
    resourceType: 'Patient',
    id: patient.id,
    meta: {
      lastUpdated,
      source: 'mBHR-dexie',
      profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient'],
    },
    identifier: [
      {
        use: 'usual',
        system: SYSTEM_IDENTIFIERS.MBHR,
        value: patient.id,
      },
    ],
    active: !patient.mergeInto,
    name: [
      {
        use: 'official',
        family: patient.familyName,
        given: [patient.givenName],
        text: `${patient.givenName} ${patient.familyName}`,
      },
    ],
    telecom: [],
    address: [],
  };

  if (patient.phone) {
    fhirPatient.telecom!.push({
      system: 'phone',
      value: patient.phone,
      use: 'mobile',
    });
  }

  if (patient.email) {
    fhirPatient.telecom!.push({
      system: 'email',
      value: patient.email,
    });
  }

  if (patient.sex) {
    const sexLower = patient.sex.toLowerCase();
    if (sexLower === 'male' || sexLower === 'm') {
      fhirPatient.gender = 'male';
    } else if (sexLower === 'female' || sexLower === 'f') {
      fhirPatient.gender = 'female';
    } else {
      fhirPatient.gender = 'other';
    }
  }

  if (patient.dob) {
    fhirPatient.birthDate = patient.dob.split('T')[0];
  }

  if (patient.address || patient.lga || patient.state) {
    fhirPatient.address!.push({
      use: 'home',
      type: 'physical',
      text: patient.address,
      city: patient.lga,
      state: patient.state,
      country: 'NG',
    });
  }

  return fhirPatient;
}

export function adaptDexieVital(vital: Vital, patientName?: string): FHIRObservation[] {
  const observations: FHIRObservation[] = [];
  const effectiveDateTime = vital.takenAt instanceof Date
    ? vital.takenAt.toISOString()
    : new Date().toISOString();
  const lastUpdated = vital._syncedAt || effectiveDateTime;

  if (vital.systolic !== undefined && vital.diastolic !== undefined) {
    const bpObservation: FHIRObservation = {
      resourceType: 'Observation',
      id: `${vital.id}-bp`,
      meta: {
        lastUpdated,
        source: 'mBHR-dexie',
        profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure'],
      },
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'vital-signs',
              display: 'Vital Signs',
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: SYSTEM_IDENTIFIERS.LOINC,
            code: '85354-9',
            display: 'Blood pressure panel with all children optional',
          },
        ],
        text: 'Blood Pressure',
      },
      subject: {
        reference: `Patient/${vital.patientId}`,
        display: patientName,
      },
      effectiveDateTime,
      component: [
        {
          code: {
            coding: [
              {
                system: SYSTEM_IDENTIFIERS.LOINC,
                code: '8480-6',
                display: 'Systolic blood pressure',
              },
            ],
          },
          valueQuantity: {
            value: vital.systolic,
            unit: 'mmHg',
            system: SYSTEM_IDENTIFIERS.UCUM,
            code: 'mm[Hg]',
          },
        },
        {
          code: {
            coding: [
              {
                system: SYSTEM_IDENTIFIERS.LOINC,
                code: '8462-4',
                display: 'Diastolic blood pressure',
              },
            ],
          },
          valueQuantity: {
            value: vital.diastolic,
            unit: 'mmHg',
            system: SYSTEM_IDENTIFIERS.UCUM,
            code: 'mm[Hg]',
          },
        },
      ],
    };
    observations.push(bpObservation);
  }

  const vitalMappings: Array<{ key: keyof Vital; type: string }> = [
    { key: 'heightCm', type: 'heightCm' },
    { key: 'weightKg', type: 'weightKg' },
    { key: 'tempC', type: 'tempC' },
    { key: 'pulseBpm', type: 'pulseBpm' },
    { key: 'spo2', type: 'spo2' },
    { key: 'bmi', type: 'bmi' },
  ];

  for (const { key, type } of vitalMappings) {
    const value = vital[key] as number | undefined;
    if (value === undefined || value === null) continue;

    const loincInfo = VITAL_LOINC_CODES[type];
    if (!loincInfo) continue;

    const observation: FHIRObservation = {
      resourceType: 'Observation',
      id: `${vital.id}-${type}`,
      meta: {
        lastUpdated,
        source: 'mBHR-dexie',
        profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-vital-signs'],
      },
      identifier: [
        {
          system: SYSTEM_IDENTIFIERS.MBHR,
          value: `${vital.id}-${type}`,
        },
      ],
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'vital-signs',
              display: 'Vital Signs',
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
        reference: `Patient/${vital.patientId}`,
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
    observations.push(observation);
  }

  return observations;
}

export function adaptDexieDispense(dispense: Dispense, patientName?: string): FHIRMedicationRequest {
  const dispensedAt = dispense.dispensedAt instanceof Date
    ? dispense.dispensedAt.toISOString()
    : new Date().toISOString();
  const lastUpdated = dispense._syncedAt || dispensedAt;

  return {
    resourceType: 'MedicationRequest',
    id: dispense.id,
    meta: {
      lastUpdated,
      source: 'mBHR-dexie',
      profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-medicationrequest'],
    },
    identifier: [
      {
        system: SYSTEM_IDENTIFIERS.MBHR,
        value: dispense.id,
      },
    ],
    status: 'completed',
    intent: 'order',
    medicationCodeableConcept: {
      text: dispense.itemName,
    },
    subject: {
      reference: `Patient/${dispense.patientId}`,
      display: patientName,
    },
    authoredOn: dispensedAt,
    dosageInstruction: dispense.dosage
      ? [
          {
            text: `${dispense.dosage}${dispense.directions ? ` - ${dispense.directions}` : ''}`,
          },
        ]
      : undefined,
    dispenseRequest: dispense.qty
      ? {
          quantity: {
            value: dispense.qty,
            unit: 'units',
          },
        }
      : undefined,
  };
}

export function adaptDexieVisit(visit: Visit, patientName?: string): FHIREncounter {
  const startedAt = visit.startedAt instanceof Date
    ? visit.startedAt.toISOString()
    : new Date().toISOString();
  const lastUpdated = visit._syncedAt || startedAt;

  let status: FHIREncounter['status'] = 'unknown';
  if (visit.status === 'open') {
    status = 'in-progress';
  } else if (visit.status === 'closed') {
    status = 'finished';
  }

  return {
    resourceType: 'Encounter',
    id: visit.id,
    meta: {
      lastUpdated,
      source: 'mBHR-dexie',
      profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter'],
    },
    identifier: [
      {
        system: SYSTEM_IDENTIFIERS.MBHR,
        value: visit.id,
      },
    ],
    status,
    class: {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      code: 'AMB',
      display: 'ambulatory',
    },
    type: visit.siteName
      ? [
          {
            text: `Visit at ${visit.siteName}`,
          },
        ]
      : undefined,
    subject: {
      reference: `Patient/${visit.patientId}`,
      display: patientName,
    },
    period: {
      start: startedAt,
    },
  };
}

export function adaptDexieConsultation(
  consultation: Consultation,
  patientName?: string
): FHIRDiagnosticReport {
  const createdAt = consultation.createdAt instanceof Date
    ? consultation.createdAt.toISOString()
    : new Date().toISOString();
  const lastUpdated = consultation._syncedAt || createdAt;

  const soapContent = [
    consultation.soapSubjective && `Subjective: ${consultation.soapSubjective}`,
    consultation.soapObjective && `Objective: ${consultation.soapObjective}`,
    consultation.soapAssessment && `Assessment: ${consultation.soapAssessment}`,
    consultation.soapPlan && `Plan: ${consultation.soapPlan}`,
  ].filter(Boolean).join('\n\n');

  const conclusion = consultation.provisionalDx?.length
    ? `Provisional Diagnosis: ${consultation.provisionalDx.join(', ')}`
    : undefined;

  return {
    resourceType: 'DiagnosticReport',
    id: consultation.id,
    meta: {
      lastUpdated,
      source: 'mBHR-dexie',
      profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-diagnosticreport-note'],
    },
    status: 'final',
    category: [
      {
        coding: [
          {
            system: 'http://loinc.org',
            code: '34117-2',
            display: 'History and physical note',
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '11506-3',
          display: 'Provider-unspecified Progress note',
        },
      ],
      text: 'Clinical Progress Note',
    },
    subject: {
      reference: `Patient/${consultation.patientId}`,
      display: patientName,
    },
    encounter: {
      reference: `Encounter/${consultation.visitId}`,
    },
    effectiveDateTime: createdAt,
    issued: createdAt,
    conclusion,
    presentedForm: soapContent
      ? [
          {
            contentType: 'text/plain',
            data: btoa(soapContent),
            title: `SOAP Note by ${consultation.providerName}`,
          },
        ]
      : undefined,
  };
}

export function adaptDexieAllergy(
  allergy: PatientAllergy,
  patientName?: string
): FHIRAllergyIntolerance {
  const createdAt = allergy.createdAt instanceof Date
    ? allergy.createdAt.toISOString()
    : new Date().toISOString();
  const lastUpdated = allergy._syncedAt || allergy.updatedAt?.toISOString?.() || createdAt;

  const categoryMap: Record<string, 'food' | 'medication' | 'environment' | 'biologic'> = {
    food: 'food',
    medication: 'medication',
    environmental: 'environment',
    other: 'biologic',
  };

  const criticalityMap: Record<string, 'low' | 'high' | 'unable-to-assess'> = {
    mild: 'low',
    moderate: 'low',
    severe: 'high',
    'life-threatening': 'high',
  };

  const severityMap: Record<string, 'mild' | 'moderate' | 'severe'> = {
    mild: 'mild',
    moderate: 'moderate',
    severe: 'severe',
    'life-threatening': 'severe',
  };

  return {
    resourceType: 'AllergyIntolerance',
    id: allergy.id,
    meta: {
      lastUpdated,
      source: 'mBHR-dexie',
      profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance'],
    },
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
          code: allergy.isActive ? 'active' : 'inactive',
          display: allergy.isActive ? 'Active' : 'Inactive',
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
          code: 'confirmed',
          display: 'Confirmed',
        },
      ],
    },
    type: 'allergy',
    category: [categoryMap[allergy.allergyType] || 'biologic'],
    criticality: criticalityMap[allergy.severity] || 'unable-to-assess',
    code: {
      text: allergy.allergen,
    },
    patient: {
      reference: `Patient/${allergy.patientId}`,
      display: patientName,
    },
    onsetDateTime: allergy.onsetDate instanceof Date
      ? allergy.onsetDate.toISOString()
      : undefined,
    reaction: allergy.reaction
      ? [
          {
            manifestation: [{ text: allergy.reaction }],
            severity: severityMap[allergy.severity] || 'moderate',
          },
        ]
      : undefined,
    note: allergy.notes ? [{ text: allergy.notes }] : undefined,
  };
}

export type AdaptedResource =
  | FHIRPatient
  | FHIRObservation
  | FHIRMedicationRequest
  | FHIREncounter
  | FHIRDiagnosticReport
  | FHIRAllergyIntolerance
  | FHIRCondition;
