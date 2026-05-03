import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-QHIN-ID, X-Exchange-Purpose",
};

const SYSTEM_IDENTIFIERS = {
  MBHR: "urn:oid:2.16.840.1.113883.3.9999.1",
  LOINC: "http://loinc.org",
  SNOMED: "http://snomed.info/sct",
  ICD10: "http://hl7.org/fhir/sid/icd-10-cm",
  CVX: "http://hl7.org/fhir/sid/cvx",
  UCUM: "http://unitsofmeasure.org",
  RXNORM: "http://www.nlm.nih.gov/research/umls/rxnorm",
};

const US_CORE = "http://hl7.org/fhir/us/core/StructureDefinition";

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

const SDOH_LOINC_CODES: Record<string, { code: string; display: string }> = {
  housing: { code: "71802-3", display: "Housing status" },
  food: { code: "88122-7", display: "Food insecurity risk" },
  transportation: { code: "93030-5", display: "Transportation needs" },
  employment: { code: "67875-5", display: "Employment status" },
  education: { code: "82589-3", display: "Highest level of education" },
  social: { code: "93159-2", display: "Social connection and isolation" },
  financial: { code: "76513-1", display: "Financial resource strain" },
  safety: { code: "93038-8", display: "Stress due to physical safety" },
};

type ExchangePurpose =
  | "individual-access"
  | "treatment"
  | "payment"
  | "operations";

interface TEFCAContext {
  qhinId: string;
  exchangePurpose: ExchangePurpose;
  requestingOrganization: string;
  ipAddress: string;
}

function createOperationOutcome(
  severity: string,
  code: string,
  diagnostics: string,
) {
  return {
    resourceType: "OperationOutcome",
    issue: [{ severity, code, diagnostics }],
  };
}

function createBundle(resources: unknown[], baseUrl: string, total?: number) {
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

function mapPatientToFHIR(patient: Record<string, unknown>) {
  const name = (patient.name as string) || "";
  const nameParts = name.trim().split(/\s+/);
  const family = nameParts.pop() || "";
  const given = nameParts.length > 0 ? nameParts : undefined;

  let gender: "male" | "female" | "unknown" = "unknown";
  if (patient.sex) {
    const sexLower = (patient.sex as string).toLowerCase();
    if (sexLower === "m" || sexLower === "male") gender = "male";
    else if (sexLower === "f" || sexLower === "female") gender = "female";
  }

  return {
    resourceType: "Patient",
    id: patient.id,
    meta: {
      lastUpdated: patient.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [
        "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient",
      ],
    },
    identifier: [
      { use: "usual", system: SYSTEM_IDENTIFIERS.MBHR, value: patient.id },
    ],
    active: true,
    name: [{ use: "official", family, given, text: name }],
    telecom: [
      ...(patient.phone
        ? [{ system: "phone", value: patient.phone, use: "mobile" }]
        : []),
      ...(patient.email ? [{ system: "email", value: patient.email }] : []),
    ],
    gender,
    birthDate: patient.dob ? (patient.dob as string).split("T")[0] : undefined,
    address:
      patient.address || patient.lga || patient.state
        ? [
            {
              use: "home",
              type: "physical",
              text: patient.address,
              city: patient.lga,
              state: patient.state,
              country: "NG",
            },
          ]
        : [],
  };
}

function mapVitalsToFHIR(
  vitals: Record<string, unknown>,
  patientName?: string,
) {
  const observations = [];
  const effectiveDateTime =
    (vitals.created_at as string) || new Date().toISOString();

  if (vitals.systolic !== undefined && vitals.diastolic !== undefined) {
    observations.push({
      resourceType: "Observation",
      id: `${vitals.id}-bp`,
      meta: {
        lastUpdated: vitals.updated_at || effectiveDateTime,
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
            display: "Blood pressure panel",
          },
        ],
        text: "Blood Pressure",
      },
      subject: {
        reference: `Patient/${vitals.patient_id}`,
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
    });
  }

  const simpleVitals = [
    "heart_rate",
    "temperature",
    "respiratory_rate",
    "oxygen_saturation",
    "weight",
    "height",
    "bmi",
  ];
  for (const vitalType of simpleVitals) {
    const value = vitals[vitalType];
    if (value !== undefined && value !== null) {
      const loincInfo = VITAL_LOINC_CODES[vitalType];
      if (loincInfo) {
        observations.push({
          resourceType: "Observation",
          id: `${vitals.id}-${vitalType}`,
          meta: {
            lastUpdated: vitals.updated_at || effectiveDateTime,
            source: "mBHR",
            profile: [
              "http://hl7.org/fhir/us/core/StructureDefinition/us-core-vital-signs",
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
                code: loincInfo.code,
                display: loincInfo.display,
              },
            ],
            text: loincInfo.display,
          },
          subject: {
            reference: `Patient/${vitals.patient_id}`,
            display: patientName,
          },
          effectiveDateTime,
          valueQuantity: {
            value,
            unit: loincInfo.unit,
            system: SYSTEM_IDENTIFIERS.UCUM,
            code: loincInfo.ucum,
          },
        });
      }
    }
  }

  return observations;
}

function mapMedicationToFHIR(
  dispense: Record<string, unknown>,
  patientName?: string,
) {
  return {
    resourceType: "MedicationRequest",
    id: dispense.id,
    meta: {
      lastUpdated: dispense.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [
        "http://hl7.org/fhir/us/core/StructureDefinition/us-core-medicationrequest",
      ],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: dispense.id }],
    status: "completed",
    intent: "order",
    medicationCodeableConcept: { text: dispense.drug },
    subject: {
      reference: `Patient/${dispense.patient_id}`,
      display: patientName,
    },
    authoredOn: dispense.created_at,
    dosageInstruction: dispense.dosage
      ? [
          {
            text: `${dispense.dosage}${dispense.instructions ? ` - ${dispense.instructions}` : ""}`,
          },
        ]
      : undefined,
    dispenseRequest: dispense.quantity
      ? { quantity: { value: dispense.quantity, unit: "tablets" } }
      : undefined,
  };
}

function mapEncounterToFHIR(
  visit: Record<string, unknown>,
  patientName?: string,
) {
  let status = "unknown";
  if (visit.status) {
    const s = (visit.status as string).toLowerCase();
    if (s === "completed" || s === "done") status = "finished";
    else if (s === "in-progress" || s === "active") status = "in-progress";
    else if (s === "cancelled") status = "cancelled";
    else if (s === "planned" || s === "scheduled") status = "planned";
  }

  return {
    resourceType: "Encounter",
    id: visit.id,
    meta: {
      lastUpdated: visit.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [
        "http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter",
      ],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: visit.id }],
    status,
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory",
    },
    type: visit.visit_type ? [{ text: visit.visit_type }] : undefined,
    subject: { reference: `Patient/${visit.patient_id}`, display: patientName },
    period: { start: visit.start_time, end: visit.end_time },
    reasonCode: visit.chief_complaint
      ? [{ text: visit.chief_complaint }]
      : undefined,
  };
}

function mapImmunizationToFHIR(
  imm: Record<string, unknown>,
  patientName?: string,
) {
  return {
    resourceType: "Immunization",
    id: imm.id,
    meta: {
      lastUpdated: imm.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [
        "http://hl7.org/fhir/us/core/StructureDefinition/us-core-immunization",
      ],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: imm.id }],
    status: imm.status || "completed",
    vaccineCode: {
      coding: imm.vaccine_code
        ? [
            {
              system: SYSTEM_IDENTIFIERS.CVX,
              code: imm.vaccine_code,
              display: imm.vaccine_name,
            },
          ]
        : [],
      text: imm.vaccine_name,
    },
    patient: { reference: `Patient/${imm.patient_id}`, display: patientName },
    occurrenceDateTime: imm.administered_at,
    lotNumber: imm.lot_number,
    site: imm.site ? { text: imm.site } : undefined,
    route: imm.route ? { text: imm.route } : undefined,
    doseQuantity: imm.dose_quantity
      ? { value: imm.dose_quantity, unit: imm.dose_unit || "mL" }
      : undefined,
    protocolApplied: imm.series_dose_number
      ? [
          {
            doseNumberPositiveInt: imm.series_dose_number,
            seriesDosesPositiveInt: imm.series_doses_recommended,
          },
        ]
      : undefined,
    note: imm.notes ? [{ text: imm.notes }] : undefined,
  };
}

function mapConditionToFHIR(
  cond: Record<string, unknown>,
  patientName?: string,
) {
  return {
    resourceType: "Condition",
    id: cond.id,
    meta: {
      lastUpdated: cond.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [
        "http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition",
      ],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: cond.id }],
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: cond.clinical_status || "active",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          code: cond.verification_status || "confirmed",
        },
      ],
    },
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-category",
            code: cond.category || "problem-list-item",
            display:
              cond.category === "encounter-diagnosis"
                ? "Encounter Diagnosis"
                : "Problem List Item",
          },
        ],
      },
    ],
    severity: cond.severity
      ? {
          coding: [
            {
              system: "http://snomed.info/sct",
              code:
                cond.severity === "severe"
                  ? "24484000"
                  : cond.severity === "moderate"
                    ? "6736007"
                    : "255604002",
              display: cond.severity,
            },
          ],
        }
      : undefined,
    code: {
      coding: cond.condition_code
        ? [
            {
              system: SYSTEM_IDENTIFIERS.ICD10,
              code: cond.condition_code,
              display: cond.condition_name,
            },
          ]
        : [],
      text: cond.condition_name,
    },
    subject: { reference: `Patient/${cond.patient_id}`, display: patientName },
    onsetDateTime: cond.onset_date,
    abatementDateTime: cond.abatement_date,
    recordedDate: cond.created_at,
    note: cond.notes ? [{ text: cond.notes }] : undefined,
  };
}

function mapSDOHToFHIR(sdoh: Record<string, unknown>, patientName?: string) {
  const loincInfo = SDOH_LOINC_CODES[sdoh.category as string] || {
    code: "unknown",
    display: sdoh.observation_name,
  };

  const observation: Record<string, unknown> = {
    resourceType: "Observation",
    id: sdoh.id,
    meta: {
      lastUpdated: sdoh.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [
        "http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation-sdoh-assessment",
      ],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: sdoh.id }],
    status: "final",
    category: [
      {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "social-history",
            display: "Social History",
          },
        ],
      },
      {
        coding: [
          {
            system: "http://hl7.org/fhir/us/core/CodeSystem/us-core-category",
            code: "sdoh",
            display: "SDOH",
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: SYSTEM_IDENTIFIERS.LOINC,
          code: sdoh.observation_code || loincInfo.code,
          display: sdoh.observation_name || loincInfo.display,
        },
      ],
      text: sdoh.observation_name || loincInfo.display,
    },
    subject: { reference: `Patient/${sdoh.patient_id}`, display: patientName },
    effectiveDateTime: sdoh.effective_date || sdoh.created_at,
  };

  if (sdoh.value_boolean !== undefined && sdoh.value_boolean !== null) {
    observation.valueBoolean = sdoh.value_boolean;
  } else if (sdoh.value_code) {
    observation.valueCodeableConcept = {
      coding: [{ code: sdoh.value_code }],
      text: sdoh.value_text,
    };
  } else if (sdoh.value_text) {
    observation.valueString = sdoh.value_text;
  }

  if (sdoh.notes) {
    observation.note = [{ text: sdoh.notes }];
  }

  return observation;
}

function mapAllergyIntoleranceToFHIR(
  allergy: Record<string, unknown>,
  patientName?: string,
) {
  const categoryMap: Record<string, string> = {
    food: "food",
    medication: "medication",
    environmental: "environment",
    other: "biologic",
  };
  const criticalityMap: Record<string, string> = {
    mild: "low",
    moderate: "low",
    severe: "high",
    "life-threatening": "high",
  };
  const reactionSeverityMap: Record<string, string> = {
    mild: "mild",
    moderate: "moderate",
    severe: "severe",
    "life-threatening": "severe",
  };
  const allergyType = allergy.allergy_type as string | undefined;
  const severity = allergy.severity as string | undefined;
  const isActive = allergy.is_active !== false;

  return {
    resourceType: "AllergyIntolerance",
    id: allergy.id,
    meta: {
      lastUpdated: allergy.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-allergyintolerance`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: allergy.id }],
    clinicalStatus: {
      coding: [
        {
          system:
            "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
          code: isActive ? "active" : "inactive",
          display: isActive ? "Active" : "Inactive",
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
    category: allergyType ? [categoryMap[allergyType] || "biologic"] : undefined,
    criticality: severity
      ? criticalityMap[severity] || "unable-to-assess"
      : undefined,
    code: { text: allergy.allergen },
    patient: {
      reference: `Patient/${allergy.patient_id}`,
      display: patientName,
    },
    onsetDateTime: allergy.onset_date,
    reaction: allergy.reaction
      ? [
          {
            manifestation: [{ text: allergy.reaction }],
            severity: severity
              ? reactionSeverityMap[severity] || "moderate"
              : "moderate",
          },
        ]
      : undefined,
    note: allergy.notes ? [{ text: allergy.notes }] : undefined,
  };
}

function mapMedicationDispenseToFHIR(
  d: Record<string, unknown>,
  patientName?: string,
) {
  const dosageText = [d.dosage, d.directions].filter(Boolean).join(" - ");
  const code = d.medication_code as string | undefined;
  return {
    resourceType: "MedicationDispense",
    id: d.id,
    meta: {
      lastUpdated: d.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-medicationdispense`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: d.id }],
    status: d.dispense_status || "completed",
    medicationCodeableConcept: {
      coding: code
        ? [
            {
              system:
                (d.medication_code_system as string) || SYSTEM_IDENTIFIERS.RXNORM,
              code,
              display: d.item_name,
            },
          ]
        : undefined,
      text: d.item_name,
    },
    subject: {
      reference: `Patient/${d.patient_id}`,
      display: patientName,
    },
    context: d.visit_id ? { reference: `Encounter/${d.visit_id}` } : undefined,
    authorizingPrescription: d.authorizing_prescription_id
      ? [
          {
            reference: `MedicationRequest/${d.authorizing_prescription_id}`,
          },
        ]
      : undefined,
    quantity:
      d.qty !== undefined && d.qty !== null
        ? { value: d.qty, unit: "units" }
        : undefined,
    daysSupply:
      d.days_supply !== undefined && d.days_supply !== null
        ? {
            value: d.days_supply,
            unit: "days",
            system: SYSTEM_IDENTIFIERS.UCUM,
            code: "d",
          }
        : undefined,
    whenHandedOver: d.when_handed_over || d.dispensed_at,
    performer: d.dispensed_by
      ? [
          {
            actor: {
              reference: `Practitioner/${d.dispensed_by}`,
              display: d.dispensed_by,
            },
          },
        ]
      : undefined,
    dosageInstruction: dosageText ? [{ text: dosageText }] : undefined,
  };
}

function mapDiagnosticReportToFHIR(
  order: Record<string, unknown>,
  results: Record<string, unknown>[],
  patientName?: string,
) {
  const lastUpdated = (results[0]?.updated_at as string) ||
    (order.updated_at as string) ||
    new Date().toISOString();

  return {
    resourceType: "DiagnosticReport",
    id: order.id,
    meta: {
      lastUpdated,
      source: "mBHR",
      profile: [`${US_CORE}/us-core-diagnosticreport-lab`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: order.id }],
    status: order.status === "completed" ? "final" :
            order.status === "cancelled" ? "cancelled" : "preliminary",
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
      coding: order.test_code
        ? [
            {
              system: SYSTEM_IDENTIFIERS.LOINC,
              code: order.test_code,
              display: order.test_name,
            },
          ]
        : [],
      text: order.test_name,
    },
    subject: {
      reference: `Patient/${order.patient_id}`,
      display: patientName,
    },
    encounter: order.visit_id
      ? { reference: `Encounter/${order.visit_id}` }
      : undefined,
    effectiveDateTime: order.collected_at || order.ordered_at,
    issued: order.completed_at,
    result: results.map((r) => ({ reference: `Observation/${r.id}` })),
    conclusion: results
      .map((r) => r.notes as string | undefined)
      .filter(Boolean)
      .join("; ") || undefined,
  };
}

function mapProcedureToFHIR(
  p: Record<string, unknown>,
  patientName?: string,
) {
  return {
    resourceType: "Procedure",
    id: p.id,
    meta: {
      lastUpdated: p.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-procedure`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: p.id }],
    status: p.status || "completed",
    code: {
      coding: p.code
        ? [
            {
              system: (p.code_system as string) || SYSTEM_IDENTIFIERS.SNOMED,
              code: p.code,
              display: p.display,
            },
          ]
        : [],
      text: p.display,
    },
    subject: {
      reference: `Patient/${p.patient_id}`,
      display: patientName,
    },
    encounter: p.encounter_id
      ? { reference: `Encounter/${p.encounter_id}` }
      : undefined,
    performedDateTime: p.performed_at,
    performer: p.performer_id
      ? [
          {
            actor: {
              reference: `Practitioner/${p.performer_id}`,
              display: p.performer_id,
            },
          },
        ]
      : undefined,
    note: p.notes ? [{ text: p.notes }] : undefined,
  };
}

function mapDocumentReferenceToFHIR(
  doc: Record<string, unknown>,
  patientName?: string,
) {
  return {
    resourceType: "DocumentReference",
    id: doc.id,
    meta: {
      lastUpdated: doc.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-documentreference`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: doc.id }],
    status: doc.status || "current",
    docStatus: doc.doc_status,
    type: doc.type_code
      ? {
          coding: [
            {
              system: (doc.type_system as string) || SYSTEM_IDENTIFIERS.LOINC,
              code: doc.type_code,
              display: doc.type_display,
            },
          ],
          text: doc.type_display,
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
      reference: `Patient/${doc.patient_id}`,
      display: patientName,
    },
    date: doc.authored_at,
    author: doc.author_id
      ? [
          {
            reference: `Practitioner/${doc.author_id}`,
            display: doc.author_id,
          },
        ]
      : undefined,
    content: [
      {
        attachment: {
          contentType: doc.content_type || "application/pdf",
          url: doc.content_url,
          title: doc.content_title,
          creation: doc.authored_at,
        },
      },
    ],
    context: doc.context_encounter_id
      ? {
          encounter: [{ reference: `Encounter/${doc.context_encounter_id}` }],
        }
      : undefined,
  };
}

function mapCarePlanToFHIR(
  cp: Record<string, unknown>,
  patientName?: string,
) {
  const addresses = Array.isArray(cp.addresses)
    ? (cp.addresses as string[])
    : [];
  const goalIds = Array.isArray(cp.goal_ids) ? (cp.goal_ids as string[]) : [];

  return {
    resourceType: "CarePlan",
    id: cp.id,
    meta: {
      lastUpdated: cp.updated_at || new Date().toISOString(),
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
      reference: `Patient/${cp.patient_id}`,
      display: patientName,
    },
    period:
      cp.period_start || cp.period_end
        ? { start: cp.period_start, end: cp.period_end }
        : undefined,
    author: cp.author_id
      ? {
          reference: `Practitioner/${cp.author_id}`,
          display: cp.author_id,
        }
      : undefined,
    addresses: addresses.length
      ? addresses.map((id) => ({ reference: `Condition/${id}` }))
      : undefined,
    goal: goalIds.length
      ? goalIds.map((id) => ({ reference: `Goal/${id}` }))
      : undefined,
  };
}

function mapGoalToFHIR(
  g: Record<string, unknown>,
  patientName?: string,
) {
  return {
    resourceType: "Goal",
    id: g.id,
    meta: {
      lastUpdated: g.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-goal`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: g.id }],
    lifecycleStatus: g.lifecycle_status || "active",
    achievementStatus: g.achievement_status
      ? {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/goal-achievement",
              code: g.achievement_status,
            },
          ],
        }
      : undefined,
    category: g.category
      ? [
          {
            coding: [
              {
                system:
                  "http://terminology.hl7.org/CodeSystem/goal-category",
                code: g.category,
              },
            ],
          },
        ]
      : undefined,
    description: { text: g.description },
    subject: {
      reference: `Patient/${g.patient_id}`,
      display: patientName,
    },
    startDate: g.start_date,
    target: g.target_date ? [{ dueDate: g.target_date }] : undefined,
  };
}

function mapServiceRequestToFHIR(
  sr: Record<string, unknown>,
  patientName?: string,
) {
  return {
    resourceType: "ServiceRequest",
    id: sr.id,
    meta: {
      lastUpdated: sr.updated_at || new Date().toISOString(),
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
              { system: SYSTEM_IDENTIFIERS.SNOMED, code: sr.category },
            ],
          },
        ]
      : undefined,
    code: sr.code
      ? {
          coding: [
            {
              system:
                (sr.code_system as string) || SYSTEM_IDENTIFIERS.SNOMED,
              code: sr.code,
              display: sr.display,
            },
          ],
          text: sr.display,
        }
      : { text: sr.display },
    subject: {
      reference: `Patient/${sr.patient_id}`,
      display: patientName,
    },
    encounter: sr.encounter_id
      ? { reference: `Encounter/${sr.encounter_id}` }
      : undefined,
    occurrenceDateTime: sr.occurrence_at,
    requester: sr.requester_id
      ? {
          reference: `Practitioner/${sr.requester_id}`,
          display: sr.requester_id,
        }
      : undefined,
    note: sr.notes ? [{ text: sr.notes }] : undefined,
  };
}

function createCapabilityStatement(baseUrl: string) {
  return {
    resourceType: "CapabilityStatement",
    id: "mbhr-tefca-capability",
    meta: { lastUpdated: new Date().toISOString() },
    status: "active",
    date: new Date().toISOString(),
    kind: "instance",
    software: { name: "mBHR TEFCA Gateway", version: "2.0.0" },
    implementation: {
      description:
        "Med Bridge Health Reach TEFCA/IAS Endpoint - Nigeria Medical Outreach",
      url: baseUrl,
    },
    fhirVersion: "4.0.1",
    format: ["json"],
    rest: [
      {
        mode: "server",
        security: {
          cors: true,
          service: [
            {
              coding: [
                {
                  system:
                    "http://terminology.hl7.org/CodeSystem/restful-security-service",
                  code: "SMART-on-FHIR",
                },
              ],
            },
          ],
          description: "TEFCA IAS compliant authentication required",
        },
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
          {
            type: "Immunization",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "patient", type: "reference" },
              { name: "date", type: "date" },
              { name: "vaccine-code", type: "token" },
            ],
          },
          {
            type: "Condition",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "patient", type: "reference" },
              { name: "clinical-status", type: "token" },
              { name: "category", type: "token" },
            ],
          },
          {
            type: "AllergyIntolerance",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "patient", type: "reference" },
              { name: "clinical-status", type: "token" },
            ],
          },
          {
            type: "MedicationDispense",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "patient", type: "reference" },
              { name: "status", type: "token" },
              { name: "whenhandedover", type: "date" },
            ],
          },
          {
            type: "DiagnosticReport",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "patient", type: "reference" },
              { name: "category", type: "token" },
              { name: "status", type: "token" },
              { name: "date", type: "date" },
            ],
          },
          {
            type: "Procedure",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "patient", type: "reference" },
              { name: "status", type: "token" },
              { name: "date", type: "date" },
            ],
          },
          {
            type: "DocumentReference",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "patient", type: "reference" },
              { name: "category", type: "token" },
              { name: "status", type: "token" },
              { name: "type", type: "token" },
            ],
          },
          {
            type: "CarePlan",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "patient", type: "reference" },
              { name: "category", type: "token" },
              { name: "status", type: "token" },
            ],
          },
          {
            type: "Goal",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "patient", type: "reference" },
              { name: "lifecycle-status", type: "token" },
            ],
          },
          {
            type: "ServiceRequest",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: [
              { name: "_id", type: "token" },
              { name: "patient", type: "reference" },
              { name: "status", type: "token" },
              { name: "intent", type: "token" },
            ],
          },
        ],
      },
    ],
  };
}

async function logTEFCAAccess(
  supabase: ReturnType<typeof createClient>,
  context: TEFCAContext,
  resourcesRequested: string[],
  resourcesReturned: number,
  success: boolean,
  errorMessage?: string,
  responseTimeMs?: number,
  patientId?: string,
) {
  try {
    await supabase.from("tefca_access_logs").insert({
      requesting_organization: context.requestingOrganization,
      qhin_id: context.qhinId,
      exchange_purpose: context.exchangePurpose,
      patient_id: patientId,
      resources_requested: resourcesRequested,
      resources_returned: resourcesReturned,
      success,
      error_message: errorMessage,
      ip_address: context.ipAddress,
      response_time_ms: responseTimeMs,
    });
  } catch {
    console.error("Failed to log TEFCA access");
  }
}

async function verifyPatientConsent(
  supabase: ReturnType<typeof createClient>,
  patientId: string,
  exchangePurpose: ExchangePurpose,
): Promise<boolean> {
  if (exchangePurpose === "individual-access") {
    return true;
  }

  const { data: consent } = await supabase
    .from("patient_consent_records")
    .select("*")
    .eq("patient_id", patientId)
    .eq("consent_type", "data_sharing")
    .eq("consented", true)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return !!consent;
}

interface PatientScopedHandlerOptions {
  resourceType: string;
  table: string;
  orderColumn: string;
  filters?: Array<{
    param: string;
    column: string;
    op?: "eq";
  }>;
  mapper: (row: Record<string, unknown>, patientName?: string) => unknown;
}

async function handlePatientScopedResource(
  supabase: ReturnType<typeof createClient>,
  url: URL,
  baseUrl: string,
  context: TEFCAContext,
  startTime: number,
  opts: PatientScopedHandlerOptions,
): Promise<Response> {
  const headers = { ...corsHeaders, "Content-Type": "application/fhir+json" };
  const patientId = url.searchParams.get("patient")?.replace("Patient/", "");

  if (!patientId) {
    const outcome = createOperationOutcome(
      "error",
      "required",
      `Patient parameter is required for ${opts.resourceType} queries`,
    );
    await logTEFCAAccess(
      supabase,
      context,
      [opts.resourceType],
      0,
      false,
      "Missing patient parameter",
      Date.now() - startTime,
    );
    return new Response(JSON.stringify(outcome), { status: 400, headers });
  }

  const hasConsent = await verifyPatientConsent(
    supabase,
    patientId,
    context.exchangePurpose,
  );
  if (!hasConsent) {
    const outcome = createOperationOutcome(
      "error",
      "forbidden",
      "Patient has not consented to data sharing",
    );
    await logTEFCAAccess(
      supabase,
      context,
      [opts.resourceType],
      0,
      false,
      "No consent",
      Date.now() - startTime,
      patientId,
    );
    return new Response(JSON.stringify(outcome), { status: 403, headers });
  }

  let query = supabase
    .from(opts.table)
    .select("*")
    .eq("patient_id", patientId)
    .order(opts.orderColumn, { ascending: false })
    .limit(100);

  for (const f of opts.filters || []) {
    const v = url.searchParams.get(f.param);
    if (v) query = query.eq(f.column, v);
  }

  const { data, error } = await query;

  if (error) {
    const outcome = createOperationOutcome(
      "error",
      "exception",
      error.message,
    );
    await logTEFCAAccess(
      supabase,
      context,
      [opts.resourceType],
      0,
      false,
      error.message,
      Date.now() - startTime,
      patientId,
    );
    return new Response(JSON.stringify(outcome), { status: 500, headers });
  }

  const { data: patient } = await supabase
    .from("patients")
    .select("name")
    .eq("id", patientId)
    .maybeSingle();
  const patientName = (patient as { name?: string } | null)?.name;

  const resources = (data || []).map((row: Record<string, unknown>) =>
    opts.mapper(row, patientName),
  );
  const bundle = createBundle(resources, `${baseUrl}/${opts.resourceType}`);
  await logTEFCAAccess(
    supabase,
    context,
    [opts.resourceType],
    resources.length,
    true,
    undefined,
    Date.now() - startTime,
    patientId,
  );
  return new Response(JSON.stringify(bundle), { headers });
}

Deno.serve(async (req: Request) => {
  const startTime = Date.now();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const functionIndex = pathParts.indexOf("tefca-ias");
  const fhirPath = pathParts.slice(functionIndex + 1);
  const baseUrl = `${supabaseUrl}/functions/v1/tefca-ias`;

  const qhinId = req.headers.get("X-QHIN-ID") || "unknown";
  const exchangePurpose = (req.headers.get("X-Exchange-Purpose") ||
    "individual-access") as ExchangePurpose;
  const requestingOrg = req.headers.get("X-Requesting-Organization") || qhinId;
  const ipAddress =
    req.headers.get("x-forwarded-for") ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";

  const context: TEFCAContext = {
    qhinId,
    exchangePurpose,
    requestingOrganization: requestingOrg,
    ipAddress,
  };

  const validPurposes = [
    "individual-access",
    "treatment",
    "payment",
    "operations",
  ];
  if (!validPurposes.includes(exchangePurpose)) {
    const outcome = createOperationOutcome(
      "error",
      "invalid",
      `Invalid exchange purpose: ${exchangePurpose}`,
    );
    await logTEFCAAccess(
      supabase,
      context,
      [],
      0,
      false,
      "Invalid exchange purpose",
      Date.now() - startTime,
    );
    return new Response(JSON.stringify(outcome), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
    });
  }

  try {
    if (fhirPath.length === 0 || fhirPath[0] === "metadata") {
      const capability = createCapabilityStatement(baseUrl);
      await logTEFCAAccess(
        supabase,
        context,
        ["CapabilityStatement"],
        1,
        true,
        undefined,
        Date.now() - startTime,
      );
      return new Response(JSON.stringify(capability), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    const resourceType = fhirPath[0];
    const resourceId = fhirPath[1];

    if (resourceType === "Patient") {
      if (resourceId && resourceId !== "$everything") {
        const { data: patient, error } = await supabase
          .from("patients")
          .select("*")
          .eq("id", resourceId)
          .maybeSingle();

        if (error || !patient) {
          const outcome = createOperationOutcome(
            "error",
            "not-found",
            `Patient ${resourceId} not found`,
          );
          await logTEFCAAccess(
            supabase,
            context,
            ["Patient"],
            0,
            false,
            "Patient not found",
            Date.now() - startTime,
            resourceId,
          );
          return new Response(JSON.stringify(outcome), {
            status: 404,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/fhir+json",
            },
          });
        }

        const hasConsent = await verifyPatientConsent(
          supabase,
          resourceId,
          exchangePurpose,
        );
        if (!hasConsent) {
          const outcome = createOperationOutcome(
            "error",
            "forbidden",
            "Patient has not consented to data sharing",
          );
          await logTEFCAAccess(
            supabase,
            context,
            ["Patient"],
            0,
            false,
            "No consent",
            Date.now() - startTime,
            resourceId,
          );
          return new Response(JSON.stringify(outcome), {
            status: 403,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/fhir+json",
            },
          });
        }

        const fhirPatient = mapPatientToFHIR(patient);
        await logTEFCAAccess(
          supabase,
          context,
          ["Patient"],
          1,
          true,
          undefined,
          Date.now() - startTime,
          resourceId,
        );
        return new Response(JSON.stringify(fhirPatient), {
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      if (resourceId === "$everything") {
        const patientId =
          fhirPath[0] === "Patient"
            ? url.searchParams.get("patient")?.replace("Patient/", "")
            : resourceId;

        const actualPatientId =
          url.pathname.match(/Patient\/([^/]+)\/\$everything/)?.[1] ||
          patientId;

        if (!actualPatientId) {
          const outcome = createOperationOutcome(
            "error",
            "required",
            "Patient ID is required for $everything operation",
          );
          await logTEFCAAccess(
            supabase,
            context,
            ["$everything"],
            0,
            false,
            "Missing patient ID",
            Date.now() - startTime,
          );
          return new Response(JSON.stringify(outcome), {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/fhir+json",
            },
          });
        }

        const hasConsent = await verifyPatientConsent(
          supabase,
          actualPatientId,
          exchangePurpose,
        );
        if (!hasConsent) {
          const outcome = createOperationOutcome(
            "error",
            "forbidden",
            "Patient has not consented to data sharing",
          );
          await logTEFCAAccess(
            supabase,
            context,
            ["$everything"],
            0,
            false,
            "No consent",
            Date.now() - startTime,
            actualPatientId,
          );
          return new Response(JSON.stringify(outcome), {
            status: 403,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/fhir+json",
            },
          });
        }

        const [
          patientResult,
          vitalsResult,
          dispensesResult,
          visitsResult,
          immunizationsResult,
          conditionsResult,
          sdohResult,
          allergiesResult,
          proceduresResult,
          docRefsResult,
          carePlansResult,
          goalsResult,
          serviceRequestsResult,
          labOrdersResult,
        ] = await Promise.all([
          supabase
            .from("patients")
            .select("*")
            .eq("id", actualPatientId)
            .maybeSingle(),
          supabase
            .from("vitals")
            .select("*")
            .eq("patient_id", actualPatientId)
            .order("created_at", { ascending: false }),
          supabase
            .from("dispenses")
            .select("*")
            .eq("patient_id", actualPatientId)
            .order("created_at", { ascending: false }),
          supabase
            .from("visits")
            .select("*")
            .eq("patient_id", actualPatientId)
            .order("created_at", { ascending: false }),
          supabase
            .from("immunizations")
            .select("*")
            .eq("patient_id", actualPatientId)
            .order("administered_at", { ascending: false }),
          supabase
            .from("conditions")
            .select("*")
            .eq("patient_id", actualPatientId)
            .order("created_at", { ascending: false }),
          supabase
            .from("sdoh_observations")
            .select("*")
            .eq("patient_id", actualPatientId)
            .order("effective_date", { ascending: false }),
          supabase
            .from("patient_allergies")
            .select("*")
            .eq("patient_id", actualPatientId)
            .order("created_at", { ascending: false }),
          supabase
            .from("procedures")
            .select("*")
            .eq("patient_id", actualPatientId)
            .order("performed_at", { ascending: false }),
          supabase
            .from("document_references")
            .select("*")
            .eq("patient_id", actualPatientId)
            .order("authored_at", { ascending: false }),
          supabase
            .from("care_plans")
            .select("*")
            .eq("patient_id", actualPatientId)
            .order("created_at", { ascending: false }),
          supabase
            .from("goals")
            .select("*")
            .eq("patient_id", actualPatientId)
            .order("created_at", { ascending: false }),
          supabase
            .from("service_requests")
            .select("*")
            .eq("patient_id", actualPatientId)
            .order("occurrence_at", { ascending: false }),
          supabase
            .from("lab_orders")
            .select("*")
            .eq("patient_id", actualPatientId)
            .order("ordered_at", { ascending: false }),
        ]);

        if (!patientResult.data) {
          const outcome = createOperationOutcome(
            "error",
            "not-found",
            `Patient ${actualPatientId} not found`,
          );
          await logTEFCAAccess(
            supabase,
            context,
            ["$everything"],
            0,
            false,
            "Patient not found",
            Date.now() - startTime,
            actualPatientId,
          );
          return new Response(JSON.stringify(outcome), {
            status: 404,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/fhir+json",
            },
          });
        }

        const patient = patientResult.data;
        const patientName = patient.name;
        const resources: unknown[] = [mapPatientToFHIR(patient)];

        for (const v of vitalsResult.data || []) {
          resources.push(...mapVitalsToFHIR(v, patientName));
        }
        for (const d of dispensesResult.data || []) {
          resources.push(mapMedicationToFHIR(d, patientName));
          resources.push(mapMedicationDispenseToFHIR(d, patientName));
        }
        for (const visit of visitsResult.data || []) {
          resources.push(mapEncounterToFHIR(visit, patientName));
        }
        for (const imm of immunizationsResult.data || []) {
          resources.push(mapImmunizationToFHIR(imm, patientName));
        }
        for (const cond of conditionsResult.data || []) {
          resources.push(mapConditionToFHIR(cond, patientName));
        }
        for (const sdoh of sdohResult.data || []) {
          resources.push(mapSDOHToFHIR(sdoh, patientName));
        }
        for (const allergy of allergiesResult.data || []) {
          resources.push(mapAllergyIntoleranceToFHIR(allergy, patientName));
        }
        for (const proc of proceduresResult.data || []) {
          resources.push(mapProcedureToFHIR(proc, patientName));
        }
        for (const doc of docRefsResult.data || []) {
          resources.push(mapDocumentReferenceToFHIR(doc, patientName));
        }
        for (const cp of carePlansResult.data || []) {
          resources.push(mapCarePlanToFHIR(cp, patientName));
        }
        for (const goal of goalsResult.data || []) {
          resources.push(mapGoalToFHIR(goal, patientName));
        }
        for (const sr of serviceRequestsResult.data || []) {
          resources.push(mapServiceRequestToFHIR(sr, patientName));
        }
        if ((labOrdersResult.data || []).length > 0) {
          const orderIds = (labOrdersResult.data as Record<string, unknown>[]).map(
            (o) => o.id as string,
          );
          const { data: labResults } = await supabase
            .from("lab_results")
            .select("*")
            .in("order_id", orderIds);
          const resultsByOrder: Record<string, Record<string, unknown>[]> = {};
          for (const r of labResults || []) {
            const oid = r.order_id as string;
            (resultsByOrder[oid] ||= []).push(r);
          }
          for (const order of labOrdersResult.data as Record<string, unknown>[]) {
            resources.push(
              mapDiagnosticReportToFHIR(
                order,
                resultsByOrder[order.id as string] || [],
                patientName,
              ),
            );
          }
        }

        const bundle = {
          resourceType: "Bundle",
          type: "collection",
          total: resources.length,
          entry: resources.map((r) => ({ resource: r })),
        };

        await logTEFCAAccess(
          supabase,
          context,
          [
            "Patient",
            "Observation",
            "MedicationRequest",
            "MedicationDispense",
            "Encounter",
            "Immunization",
            "Condition",
            "AllergyIntolerance",
            "Procedure",
            "DocumentReference",
            "CarePlan",
            "Goal",
            "ServiceRequest",
            "DiagnosticReport",
          ],
          resources.length,
          true,
          undefined,
          Date.now() - startTime,
          actualPatientId,
        );
        return new Response(JSON.stringify(bundle), {
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const nameSearch = url.searchParams.get("name");
      const birthdateSearch = url.searchParams.get("birthdate");
      const identifierSearch = url.searchParams.get("identifier");

      let query = supabase.from("patients").select("*").limit(50);

      if (nameSearch) {
        query = query.ilike("name", `%${nameSearch}%`);
      }
      if (birthdateSearch) {
        query = query.eq("dob", birthdateSearch);
      }
      if (identifierSearch) {
        const idValue = identifierSearch.includes("|")
          ? identifierSearch.split("|")[1]
          : identifierSearch;
        query = query.eq("id", idValue);
      }

      const { data: patients, error } = await query;

      if (error) {
        const outcome = createOperationOutcome(
          "error",
          "exception",
          error.message,
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["Patient"],
          0,
          false,
          error.message,
          Date.now() - startTime,
        );
        return new Response(JSON.stringify(outcome), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const fhirPatients = (patients || []).map(mapPatientToFHIR);
      const bundle = createBundle(fhirPatients, `${baseUrl}/Patient`);
      await logTEFCAAccess(
        supabase,
        context,
        ["Patient"],
        fhirPatients.length,
        true,
        undefined,
        Date.now() - startTime,
      );
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    if (resourceType === "Observation") {
      const patientId = url.searchParams
        .get("patient")
        ?.replace("Patient/", "");
      const category = url.searchParams.get("category");
      const dateParam = url.searchParams.get("date");

      if (!patientId) {
        const outcome = createOperationOutcome(
          "error",
          "required",
          "Patient parameter is required for Observation queries",
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["Observation"],
          0,
          false,
          "Missing patient parameter",
          Date.now() - startTime,
        );
        return new Response(JSON.stringify(outcome), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const hasConsent = await verifyPatientConsent(
        supabase,
        patientId,
        exchangePurpose,
      );
      if (!hasConsent) {
        const outcome = createOperationOutcome(
          "error",
          "forbidden",
          "Patient has not consented to data sharing",
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["Observation"],
          0,
          false,
          "No consent",
          Date.now() - startTime,
          patientId,
        );
        return new Response(JSON.stringify(outcome), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const { data: patient } = await supabase
        .from("patients")
        .select("name")
        .eq("id", patientId)
        .maybeSingle();
      const patientName = patient?.name;

      let observations: unknown[] = [];

      if (!category || category === "vital-signs") {
        let vitalsQuery = supabase
          .from("vitals")
          .select("*")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(100);

        if (dateParam) {
          const dateMatch = dateParam.match(
            /^(ge|le|gt|lt)?(\d{4}-\d{2}-\d{2})/,
          );
          if (dateMatch) {
            const [, prefix, date] = dateMatch;
            if (prefix === "ge")
              vitalsQuery = vitalsQuery.gte("created_at", date);
            else if (prefix === "le")
              vitalsQuery = vitalsQuery.lte("created_at", date);
            else if (prefix === "gt")
              vitalsQuery = vitalsQuery.gt("created_at", date);
            else if (prefix === "lt")
              vitalsQuery = vitalsQuery.lt("created_at", date);
            else
              vitalsQuery = vitalsQuery
                .gte("created_at", date)
                .lt("created_at", `${date}T23:59:59`);
          }
        }

        const { data: vitals } = await vitalsQuery;
        observations = observations.concat(
          (vitals || []).flatMap((v: Record<string, unknown>) =>
            mapVitalsToFHIR(v, patientName),
          ),
        );
      }

      if (!category || category === "sdoh" || category === "social-history") {
        const { data: sdohData } = await supabase
          .from("sdoh_observations")
          .select("*")
          .eq("patient_id", patientId)
          .order("effective_date", { ascending: false })
          .limit(100);
        observations = observations.concat(
          (sdohData || []).map((s: Record<string, unknown>) =>
            mapSDOHToFHIR(s, patientName),
          ),
        );
      }

      const bundle = createBundle(observations, `${baseUrl}/Observation`);
      await logTEFCAAccess(
        supabase,
        context,
        ["Observation"],
        observations.length,
        true,
        undefined,
        Date.now() - startTime,
        patientId,
      );
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    if (resourceType === "MedicationRequest") {
      const patientId = url.searchParams
        .get("patient")
        ?.replace("Patient/", "");

      if (!patientId) {
        const outcome = createOperationOutcome(
          "error",
          "required",
          "Patient parameter is required for MedicationRequest queries",
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["MedicationRequest"],
          0,
          false,
          "Missing patient parameter",
          Date.now() - startTime,
        );
        return new Response(JSON.stringify(outcome), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const hasConsent = await verifyPatientConsent(
        supabase,
        patientId,
        exchangePurpose,
      );
      if (!hasConsent) {
        const outcome = createOperationOutcome(
          "error",
          "forbidden",
          "Patient has not consented to data sharing",
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["MedicationRequest"],
          0,
          false,
          "No consent",
          Date.now() - startTime,
          patientId,
        );
        return new Response(JSON.stringify(outcome), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const { data: dispenses, error } = await supabase
        .from("dispenses")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        const outcome = createOperationOutcome(
          "error",
          "exception",
          error.message,
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["MedicationRequest"],
          0,
          false,
          error.message,
          Date.now() - startTime,
          patientId,
        );
        return new Response(JSON.stringify(outcome), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const { data: patient } = await supabase
        .from("patients")
        .select("name")
        .eq("id", patientId)
        .maybeSingle();
      const patientName = patient?.name;

      const medications = (dispenses || []).map((d: Record<string, unknown>) =>
        mapMedicationToFHIR(d, patientName),
      );
      const bundle = createBundle(medications, `${baseUrl}/MedicationRequest`);
      await logTEFCAAccess(
        supabase,
        context,
        ["MedicationRequest"],
        medications.length,
        true,
        undefined,
        Date.now() - startTime,
        patientId,
      );
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    if (resourceType === "Encounter") {
      const patientId = url.searchParams
        .get("patient")
        ?.replace("Patient/", "");

      if (!patientId) {
        const outcome = createOperationOutcome(
          "error",
          "required",
          "Patient parameter is required for Encounter queries",
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["Encounter"],
          0,
          false,
          "Missing patient parameter",
          Date.now() - startTime,
        );
        return new Response(JSON.stringify(outcome), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const hasConsent = await verifyPatientConsent(
        supabase,
        patientId,
        exchangePurpose,
      );
      if (!hasConsent) {
        const outcome = createOperationOutcome(
          "error",
          "forbidden",
          "Patient has not consented to data sharing",
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["Encounter"],
          0,
          false,
          "No consent",
          Date.now() - startTime,
          patientId,
        );
        return new Response(JSON.stringify(outcome), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const { data: visits, error } = await supabase
        .from("visits")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        const outcome = createOperationOutcome(
          "error",
          "exception",
          error.message,
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["Encounter"],
          0,
          false,
          error.message,
          Date.now() - startTime,
          patientId,
        );
        return new Response(JSON.stringify(outcome), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const { data: patient } = await supabase
        .from("patients")
        .select("name")
        .eq("id", patientId)
        .maybeSingle();
      const patientName = patient?.name;

      const encounters = (visits || []).map((v: Record<string, unknown>) =>
        mapEncounterToFHIR(v, patientName),
      );
      const bundle = createBundle(encounters, `${baseUrl}/Encounter`);
      await logTEFCAAccess(
        supabase,
        context,
        ["Encounter"],
        encounters.length,
        true,
        undefined,
        Date.now() - startTime,
        patientId,
      );
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    if (resourceType === "Immunization") {
      const patientId = url.searchParams
        .get("patient")
        ?.replace("Patient/", "");

      if (!patientId) {
        const outcome = createOperationOutcome(
          "error",
          "required",
          "Patient parameter is required for Immunization queries",
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["Immunization"],
          0,
          false,
          "Missing patient parameter",
          Date.now() - startTime,
        );
        return new Response(JSON.stringify(outcome), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const hasConsent = await verifyPatientConsent(
        supabase,
        patientId,
        exchangePurpose,
      );
      if (!hasConsent) {
        const outcome = createOperationOutcome(
          "error",
          "forbidden",
          "Patient has not consented to data sharing",
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["Immunization"],
          0,
          false,
          "No consent",
          Date.now() - startTime,
          patientId,
        );
        return new Response(JSON.stringify(outcome), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const { data: immunizations, error } = await supabase
        .from("immunizations")
        .select("*")
        .eq("patient_id", patientId)
        .order("administered_at", { ascending: false })
        .limit(100);

      if (error) {
        const outcome = createOperationOutcome(
          "error",
          "exception",
          error.message,
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["Immunization"],
          0,
          false,
          error.message,
          Date.now() - startTime,
          patientId,
        );
        return new Response(JSON.stringify(outcome), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const { data: patient } = await supabase
        .from("patients")
        .select("name")
        .eq("id", patientId)
        .maybeSingle();
      const patientName = patient?.name;

      const fhirImmunizations = (immunizations || []).map(
        (i: Record<string, unknown>) => mapImmunizationToFHIR(i, patientName),
      );
      const bundle = createBundle(fhirImmunizations, `${baseUrl}/Immunization`);
      await logTEFCAAccess(
        supabase,
        context,
        ["Immunization"],
        fhirImmunizations.length,
        true,
        undefined,
        Date.now() - startTime,
        patientId,
      );
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    if (resourceType === "Condition") {
      const patientId = url.searchParams
        .get("patient")
        ?.replace("Patient/", "");
      const clinicalStatus = url.searchParams.get("clinical-status");
      const category = url.searchParams.get("category");

      if (!patientId) {
        const outcome = createOperationOutcome(
          "error",
          "required",
          "Patient parameter is required for Condition queries",
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["Condition"],
          0,
          false,
          "Missing patient parameter",
          Date.now() - startTime,
        );
        return new Response(JSON.stringify(outcome), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const hasConsent = await verifyPatientConsent(
        supabase,
        patientId,
        exchangePurpose,
      );
      if (!hasConsent) {
        const outcome = createOperationOutcome(
          "error",
          "forbidden",
          "Patient has not consented to data sharing",
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["Condition"],
          0,
          false,
          "No consent",
          Date.now() - startTime,
          patientId,
        );
        return new Response(JSON.stringify(outcome), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      let query = supabase
        .from("conditions")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (clinicalStatus) {
        query = query.eq("clinical_status", clinicalStatus);
      }
      if (category) {
        query = query.eq("category", category);
      }

      const { data: conditions, error } = await query;

      if (error) {
        const outcome = createOperationOutcome(
          "error",
          "exception",
          error.message,
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["Condition"],
          0,
          false,
          error.message,
          Date.now() - startTime,
          patientId,
        );
        return new Response(JSON.stringify(outcome), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const { data: patient } = await supabase
        .from("patients")
        .select("name")
        .eq("id", patientId)
        .maybeSingle();
      const patientName = patient?.name;

      const fhirConditions = (conditions || []).map(
        (c: Record<string, unknown>) => mapConditionToFHIR(c, patientName),
      );
      const bundle = createBundle(fhirConditions, `${baseUrl}/Condition`);
      await logTEFCAAccess(
        supabase,
        context,
        ["Condition"],
        fhirConditions.length,
        true,
        undefined,
        Date.now() - startTime,
        patientId,
      );
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    if (resourceType === "AllergyIntolerance") {
      return await handlePatientScopedResource(
        supabase,
        url,
        baseUrl,
        context,
        startTime,
        {
          resourceType: "AllergyIntolerance",
          table: "patient_allergies",
          orderColumn: "created_at",
          filters: [
            { param: "clinical-status", column: "is_active" },
          ],
          mapper: mapAllergyIntoleranceToFHIR,
        },
      );
    }

    if (resourceType === "MedicationDispense") {
      return await handlePatientScopedResource(
        supabase,
        url,
        baseUrl,
        context,
        startTime,
        {
          resourceType: "MedicationDispense",
          table: "dispenses",
          orderColumn: "when_handed_over",
          filters: [{ param: "status", column: "dispense_status" }],
          mapper: mapMedicationDispenseToFHIR,
        },
      );
    }

    if (resourceType === "DiagnosticReport") {
      const headers = {
        ...corsHeaders,
        "Content-Type": "application/fhir+json",
      };
      const patientId = url.searchParams
        .get("patient")
        ?.replace("Patient/", "");

      if (!patientId) {
        const outcome = createOperationOutcome(
          "error",
          "required",
          "Patient parameter is required for DiagnosticReport queries",
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["DiagnosticReport"],
          0,
          false,
          "Missing patient parameter",
          Date.now() - startTime,
        );
        return new Response(JSON.stringify(outcome), { status: 400, headers });
      }

      const hasConsent = await verifyPatientConsent(
        supabase,
        patientId,
        exchangePurpose,
      );
      if (!hasConsent) {
        const outcome = createOperationOutcome(
          "error",
          "forbidden",
          "Patient has not consented to data sharing",
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["DiagnosticReport"],
          0,
          false,
          "No consent",
          Date.now() - startTime,
          patientId,
        );
        return new Response(JSON.stringify(outcome), { status: 403, headers });
      }

      const { data: orders, error: ordersError } = await supabase
        .from("lab_orders")
        .select("*")
        .eq("patient_id", patientId)
        .order("ordered_at", { ascending: false })
        .limit(100);

      if (ordersError) {
        const outcome = createOperationOutcome(
          "error",
          "exception",
          ordersError.message,
        );
        await logTEFCAAccess(
          supabase,
          context,
          ["DiagnosticReport"],
          0,
          false,
          ordersError.message,
          Date.now() - startTime,
          patientId,
        );
        return new Response(JSON.stringify(outcome), { status: 500, headers });
      }

      const orderIds = (orders || []).map((o) => o.id as string);
      const resultsByOrder: Record<string, Record<string, unknown>[]> = {};
      if (orderIds.length > 0) {
        const { data: results } = await supabase
          .from("lab_results")
          .select("*")
          .in("order_id", orderIds);
        for (const r of results || []) {
          const oid = r.order_id as string;
          (resultsByOrder[oid] ||= []).push(r);
        }
      }

      const { data: patient } = await supabase
        .from("patients")
        .select("name")
        .eq("id", patientId)
        .maybeSingle();
      const patientName = (patient as { name?: string } | null)?.name;

      const reports = (orders || []).map((o) =>
        mapDiagnosticReportToFHIR(
          o as Record<string, unknown>,
          resultsByOrder[(o as { id: string }).id] || [],
          patientName,
        ),
      );
      const bundle = createBundle(reports, `${baseUrl}/DiagnosticReport`);
      await logTEFCAAccess(
        supabase,
        context,
        ["DiagnosticReport"],
        reports.length,
        true,
        undefined,
        Date.now() - startTime,
        patientId,
      );
      return new Response(JSON.stringify(bundle), { headers });
    }

    if (resourceType === "Procedure") {
      return await handlePatientScopedResource(
        supabase,
        url,
        baseUrl,
        context,
        startTime,
        {
          resourceType: "Procedure",
          table: "procedures",
          orderColumn: "performed_at",
          filters: [{ param: "status", column: "status" }],
          mapper: mapProcedureToFHIR,
        },
      );
    }

    if (resourceType === "DocumentReference") {
      return await handlePatientScopedResource(
        supabase,
        url,
        baseUrl,
        context,
        startTime,
        {
          resourceType: "DocumentReference",
          table: "document_references",
          orderColumn: "authored_at",
          filters: [
            { param: "status", column: "status" },
            { param: "category", column: "category" },
            { param: "type", column: "type_code" },
          ],
          mapper: mapDocumentReferenceToFHIR,
        },
      );
    }

    if (resourceType === "CarePlan") {
      return await handlePatientScopedResource(
        supabase,
        url,
        baseUrl,
        context,
        startTime,
        {
          resourceType: "CarePlan",
          table: "care_plans",
          orderColumn: "created_at",
          filters: [
            { param: "status", column: "status" },
            { param: "category", column: "category" },
          ],
          mapper: mapCarePlanToFHIR,
        },
      );
    }

    if (resourceType === "Goal") {
      return await handlePatientScopedResource(
        supabase,
        url,
        baseUrl,
        context,
        startTime,
        {
          resourceType: "Goal",
          table: "goals",
          orderColumn: "created_at",
          filters: [
            { param: "lifecycle-status", column: "lifecycle_status" },
          ],
          mapper: mapGoalToFHIR,
        },
      );
    }

    if (resourceType === "ServiceRequest") {
      return await handlePatientScopedResource(
        supabase,
        url,
        baseUrl,
        context,
        startTime,
        {
          resourceType: "ServiceRequest",
          table: "service_requests",
          orderColumn: "occurrence_at",
          filters: [
            { param: "status", column: "status" },
            { param: "intent", column: "intent" },
          ],
          mapper: mapServiceRequestToFHIR,
        },
      );
    }

    const outcome = createOperationOutcome(
      "error",
      "not-supported",
      `Resource type ${resourceType} is not supported`,
    );
    await logTEFCAAccess(
      supabase,
      context,
      [resourceType],
      0,
      false,
      "Unsupported resource type",
      Date.now() - startTime,
    );
    return new Response(JSON.stringify(outcome), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const outcome = createOperationOutcome("fatal", "exception", message);
    await logTEFCAAccess(
      supabase,
      context,
      [],
      0,
      false,
      message,
      Date.now() - startTime,
    );
    return new Response(JSON.stringify(outcome), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
    });
  }
});
