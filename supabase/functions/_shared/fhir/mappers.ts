// Postgres row -> FHIR R4 (US Core 7.0 profiled) resource mappers.
// Phase B refactor: extracted verbatim from index.ts; pure functions, no I/O.
//
// Mapper inputs are snake_case Supabase rows; outputs follow the FHIR R4 JSON
// representation. Each mapper sets `meta.profile` to the relevant US Core
// StructureDefinition URL.

import {
  SDOH_LOINC_CODES,
  SYSTEM_IDENTIFIERS,
  US_CORE,
  VITAL_LOINC_CODES,
} from "./codes.ts";

export type FhirRow = Record<string, unknown>;

export function mapPatientToFHIR(patient: FhirRow) {
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
      profile: [`${US_CORE}/us-core-patient`],
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

export function mapVitalsToFHIR(vitals: FhirRow, patientName?: string) {
  const observations: unknown[] = [];
  const effectiveDateTime =
    (vitals.created_at as string) || new Date().toISOString();

  if (vitals.systolic !== undefined && vitals.diastolic !== undefined) {
    observations.push({
      resourceType: "Observation",
      id: `${vitals.id}-bp`,
      meta: {
        lastUpdated: vitals.updated_at || effectiveDateTime,
        source: "mBHR",
        profile: [`${US_CORE}/us-core-blood-pressure`],
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
            profile: [`${US_CORE}/us-core-vital-signs`],
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

export function mapMedicationRequestToFHIR(
  dispense: FhirRow,
  patientName?: string,
) {
  return {
    resourceType: "MedicationRequest",
    id: dispense.id,
    meta: {
      lastUpdated: dispense.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-medicationrequest`],
    },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: dispense.id }],
    status: "completed",
    intent: "order",
    medicationCodeableConcept: { text: dispense.drug || dispense.item_name },
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

export function mapEncounterToFHIR(visit: FhirRow, patientName?: string) {
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
      profile: [`${US_CORE}/us-core-encounter`],
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

export function mapImmunizationToFHIR(imm: FhirRow, patientName?: string) {
  return {
    resourceType: "Immunization",
    id: imm.id,
    meta: {
      lastUpdated: imm.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-immunization`],
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

export function mapConditionToFHIR(cond: FhirRow, patientName?: string) {
  return {
    resourceType: "Condition",
    id: cond.id,
    meta: {
      lastUpdated: cond.updated_at || new Date().toISOString(),
      source: "mBHR",
      profile: [`${US_CORE}/us-core-condition-problems-health-concerns`],
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
              system: SYSTEM_IDENTIFIERS.SNOMED,
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

export function mapSDOHToFHIR(sdoh: FhirRow, patientName?: string) {
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
      profile: [`${US_CORE}/us-core-observation-sdoh-assessment`],
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

export function mapAllergyIntoleranceToFHIR(
  allergy: FhirRow,
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
    category: allergyType
      ? [categoryMap[allergyType] || "biologic"]
      : undefined,
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

export function mapMedicationDispenseToFHIR(d: FhirRow, patientName?: string) {
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
                (d.medication_code_system as string) ||
                SYSTEM_IDENTIFIERS.RXNORM,
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

export function mapDiagnosticReportToFHIR(
  order: FhirRow,
  results: FhirRow[],
  patientName?: string,
) {
  const lastUpdated =
    (results[0]?.updated_at as string) ||
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
    status:
      order.status === "completed"
        ? "final"
        : order.status === "cancelled"
          ? "cancelled"
          : "preliminary",
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
    conclusion:
      results
        .map((r) => r.notes as string | undefined)
        .filter(Boolean)
        .join("; ") || undefined,
  };
}

export function mapProcedureToFHIR(p: FhirRow, patientName?: string) {
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

export function mapDocumentReferenceToFHIR(doc: FhirRow, patientName?: string) {
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

export function mapCarePlanToFHIR(cp: FhirRow, patientName?: string) {
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

export function mapGoalToFHIR(g: FhirRow, patientName?: string) {
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
              system: "http://terminology.hl7.org/CodeSystem/goal-achievement",
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
                system: "http://terminology.hl7.org/CodeSystem/goal-category",
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

export function mapServiceRequestToFHIR(sr: FhirRow, patientName?: string) {
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
            coding: [{ system: SYSTEM_IDENTIFIERS.SNOMED, code: sr.category }],
          },
        ]
      : undefined,
    code: sr.code
      ? {
          coding: [
            {
              system: (sr.code_system as string) || SYSTEM_IDENTIFIERS.SNOMED,
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
