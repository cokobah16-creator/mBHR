import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-QHIN-ID, X-Exchange-Purpose",
};

const SYSTEM_IDENTIFIERS = {
  MBHR: "urn:oid:2.16.840.1.113883.3.9999.1",
  LOINC: "http://loinc.org",
  SNOMED: "http://snomed.info/sct",
  ICD10: "http://hl7.org/fhir/sid/icd-10-cm",
  CVX: "http://hl7.org/fhir/sid/cvx",
  UCUM: "http://unitsofmeasure.org",
};

const VITAL_LOINC_CODES: Record<string, { code: string; display: string; unit: string; ucum: string }> = {
  systolic: { code: "8480-6", display: "Systolic blood pressure", unit: "mmHg", ucum: "mm[Hg]" },
  diastolic: { code: "8462-4", display: "Diastolic blood pressure", unit: "mmHg", ucum: "mm[Hg]" },
  heart_rate: { code: "8867-4", display: "Heart rate", unit: "beats/min", ucum: "/min" },
  temperature: { code: "8310-5", display: "Body temperature", unit: "C", ucum: "Cel" },
  respiratory_rate: { code: "9279-1", display: "Respiratory rate", unit: "breaths/min", ucum: "/min" },
  oxygen_saturation: { code: "2708-6", display: "Oxygen saturation", unit: "%", ucum: "%" },
  weight: { code: "29463-7", display: "Body weight", unit: "kg", ucum: "kg" },
  height: { code: "8302-2", display: "Body height", unit: "cm", ucum: "cm" },
  bmi: { code: "39156-5", display: "Body mass index", unit: "kg/m2", ucum: "kg/m2" },
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

type ExchangePurpose = "individual-access" | "treatment" | "payment" | "operations";

interface TEFCAContext {
  qhinId: string;
  exchangePurpose: ExchangePurpose;
  requestingOrganization: string;
  ipAddress: string;
}

function createOperationOutcome(severity: string, code: string, diagnostics: string) {
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
    entry: resources.map((resource: { resourceType?: string; id?: string }) => ({
      fullUrl: resource.id ? `${baseUrl}/${resource.resourceType}/${resource.id}` : undefined,
      resource,
      search: { mode: "match" },
    })),
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
      profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient"],
    },
    identifier: [{ use: "usual", system: SYSTEM_IDENTIFIERS.MBHR, value: patient.id }],
    active: true,
    name: [{ use: "official", family, given, text: name }],
    telecom: [
      ...(patient.phone ? [{ system: "phone", value: patient.phone, use: "mobile" }] : []),
      ...(patient.email ? [{ system: "email", value: patient.email }] : []),
    ],
    gender,
    birthDate: patient.dob ? (patient.dob as string).split("T")[0] : undefined,
    address: patient.address || patient.lga || patient.state
      ? [{
          use: "home",
          type: "physical",
          text: patient.address,
          city: patient.lga,
          state: patient.state,
          country: "NG",
        }]
      : [],
  };
}

function mapVitalsToFHIR(vitals: Record<string, unknown>, patientName?: string) {
  const observations = [];
  const effectiveDateTime = (vitals.created_at as string) || new Date().toISOString();

  if (vitals.systolic !== undefined && vitals.diastolic !== undefined) {
    observations.push({
      resourceType: "Observation",
      id: `${vitals.id}-bp`,
      meta: { lastUpdated: vitals.updated_at || effectiveDateTime, source: "mBHR", profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure"] },
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs", display: "Vital Signs" }] }],
      code: { coding: [{ system: SYSTEM_IDENTIFIERS.LOINC, code: "85354-9", display: "Blood pressure panel" }], text: "Blood Pressure" },
      subject: { reference: `Patient/${vitals.patient_id}`, display: patientName },
      effectiveDateTime,
      component: [
        { code: { coding: [{ system: SYSTEM_IDENTIFIERS.LOINC, code: "8480-6", display: "Systolic blood pressure" }] }, valueQuantity: { value: vitals.systolic, unit: "mmHg", system: SYSTEM_IDENTIFIERS.UCUM, code: "mm[Hg]" } },
        { code: { coding: [{ system: SYSTEM_IDENTIFIERS.LOINC, code: "8462-4", display: "Diastolic blood pressure" }] }, valueQuantity: { value: vitals.diastolic, unit: "mmHg", system: SYSTEM_IDENTIFIERS.UCUM, code: "mm[Hg]" } },
      ],
    });
  }

  const simpleVitals = ["heart_rate", "temperature", "respiratory_rate", "oxygen_saturation", "weight", "height", "bmi"];
  for (const vitalType of simpleVitals) {
    const value = vitals[vitalType];
    if (value !== undefined && value !== null) {
      const loincInfo = VITAL_LOINC_CODES[vitalType];
      if (loincInfo) {
        observations.push({
          resourceType: "Observation",
          id: `${vitals.id}-${vitalType}`,
          meta: { lastUpdated: vitals.updated_at || effectiveDateTime, source: "mBHR", profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-vital-signs"] },
          status: "final",
          category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs", display: "Vital Signs" }] }],
          code: { coding: [{ system: SYSTEM_IDENTIFIERS.LOINC, code: loincInfo.code, display: loincInfo.display }], text: loincInfo.display },
          subject: { reference: `Patient/${vitals.patient_id}`, display: patientName },
          effectiveDateTime,
          valueQuantity: { value, unit: loincInfo.unit, system: SYSTEM_IDENTIFIERS.UCUM, code: loincInfo.ucum },
        });
      }
    }
  }

  return observations;
}

function mapMedicationToFHIR(dispense: Record<string, unknown>, patientName?: string) {
  return {
    resourceType: "MedicationRequest",
    id: dispense.id,
    meta: { lastUpdated: dispense.updated_at || new Date().toISOString(), source: "mBHR", profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-medicationrequest"] },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: dispense.id }],
    status: "completed",
    intent: "order",
    medicationCodeableConcept: { text: dispense.drug },
    subject: { reference: `Patient/${dispense.patient_id}`, display: patientName },
    authoredOn: dispense.created_at,
    dosageInstruction: dispense.dosage ? [{ text: `${dispense.dosage}${dispense.instructions ? ` - ${dispense.instructions}` : ""}` }] : undefined,
    dispenseRequest: dispense.quantity ? { quantity: { value: dispense.quantity, unit: "tablets" } } : undefined,
  };
}

function mapEncounterToFHIR(visit: Record<string, unknown>, patientName?: string) {
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
    meta: { lastUpdated: visit.updated_at || new Date().toISOString(), source: "mBHR", profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter"] },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: visit.id }],
    status,
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
    type: visit.visit_type ? [{ text: visit.visit_type }] : undefined,
    subject: { reference: `Patient/${visit.patient_id}`, display: patientName },
    period: { start: visit.start_time, end: visit.end_time },
    reasonCode: visit.chief_complaint ? [{ text: visit.chief_complaint }] : undefined,
  };
}

function mapImmunizationToFHIR(imm: Record<string, unknown>, patientName?: string) {
  return {
    resourceType: "Immunization",
    id: imm.id,
    meta: { lastUpdated: imm.updated_at || new Date().toISOString(), source: "mBHR", profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-immunization"] },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: imm.id }],
    status: imm.status || "completed",
    vaccineCode: {
      coding: imm.vaccine_code ? [{ system: SYSTEM_IDENTIFIERS.CVX, code: imm.vaccine_code, display: imm.vaccine_name }] : [],
      text: imm.vaccine_name,
    },
    patient: { reference: `Patient/${imm.patient_id}`, display: patientName },
    occurrenceDateTime: imm.administered_at,
    lotNumber: imm.lot_number,
    site: imm.site ? { text: imm.site } : undefined,
    route: imm.route ? { text: imm.route } : undefined,
    doseQuantity: imm.dose_quantity ? { value: imm.dose_quantity, unit: imm.dose_unit || "mL" } : undefined,
    protocolApplied: imm.series_dose_number ? [{
      doseNumberPositiveInt: imm.series_dose_number,
      seriesDosesPositiveInt: imm.series_doses_recommended,
    }] : undefined,
    note: imm.notes ? [{ text: imm.notes }] : undefined,
  };
}

function mapConditionToFHIR(cond: Record<string, unknown>, patientName?: string) {
  return {
    resourceType: "Condition",
    id: cond.id,
    meta: { lastUpdated: cond.updated_at || new Date().toISOString(), source: "mBHR", profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition"] },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: cond.id }],
    clinicalStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: cond.clinical_status || "active" }],
    },
    verificationStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: cond.verification_status || "confirmed" }],
    },
    category: [{
      coding: [{
        system: "http://terminology.hl7.org/CodeSystem/condition-category",
        code: cond.category || "problem-list-item",
        display: cond.category === "encounter-diagnosis" ? "Encounter Diagnosis" : "Problem List Item",
      }],
    }],
    severity: cond.severity ? {
      coding: [{ system: "http://snomed.info/sct", code: cond.severity === "severe" ? "24484000" : cond.severity === "moderate" ? "6736007" : "255604002", display: cond.severity }],
    } : undefined,
    code: {
      coding: cond.condition_code ? [{ system: SYSTEM_IDENTIFIERS.ICD10, code: cond.condition_code, display: cond.condition_name }] : [],
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
  const loincInfo = SDOH_LOINC_CODES[sdoh.category as string] || { code: "unknown", display: sdoh.observation_name };

  const observation: Record<string, unknown> = {
    resourceType: "Observation",
    id: sdoh.id,
    meta: { lastUpdated: sdoh.updated_at || new Date().toISOString(), source: "mBHR", profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation-sdoh-assessment"] },
    identifier: [{ system: SYSTEM_IDENTIFIERS.MBHR, value: sdoh.id }],
    status: "final",
    category: [
      { coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "social-history", display: "Social History" }] },
      { coding: [{ system: "http://hl7.org/fhir/us/core/CodeSystem/us-core-category", code: "sdoh", display: "SDOH" }] },
    ],
    code: {
      coding: [{ system: SYSTEM_IDENTIFIERS.LOINC, code: sdoh.observation_code || loincInfo.code, display: sdoh.observation_name || loincInfo.display }],
      text: sdoh.observation_name || loincInfo.display,
    },
    subject: { reference: `Patient/${sdoh.patient_id}`, display: patientName },
    effectiveDateTime: sdoh.effective_date || sdoh.created_at,
  };

  if (sdoh.value_boolean !== undefined && sdoh.value_boolean !== null) {
    observation.valueBoolean = sdoh.value_boolean;
  } else if (sdoh.value_code) {
    observation.valueCodeableConcept = { coding: [{ code: sdoh.value_code }], text: sdoh.value_text };
  } else if (sdoh.value_text) {
    observation.valueString = sdoh.value_text;
  }

  if (sdoh.notes) {
    observation.note = [{ text: sdoh.notes }];
  }

  return observation;
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
    implementation: { description: "Med Bridge Health Reach TEFCA/IAS Endpoint - Nigeria Medical Outreach", url: baseUrl },
    fhirVersion: "4.0.1",
    format: ["json"],
    rest: [{
      mode: "server",
      security: {
        cors: true,
        service: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/restful-security-service", code: "SMART-on-FHIR" }] }],
        description: "TEFCA IAS compliant authentication required",
      },
      resource: [
        { type: "Patient", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "_id", type: "token" }, { name: "identifier", type: "token" }, { name: "name", type: "string" }, { name: "birthdate", type: "date" }] },
        { type: "Observation", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "_id", type: "token" }, { name: "patient", type: "reference" }, { name: "category", type: "token" }, { name: "date", type: "date" }] },
        { type: "MedicationRequest", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "_id", type: "token" }, { name: "patient", type: "reference" }, { name: "authoredon", type: "date" }] },
        { type: "Encounter", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "_id", type: "token" }, { name: "patient", type: "reference" }, { name: "date", type: "date" }] },
        { type: "Immunization", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "_id", type: "token" }, { name: "patient", type: "reference" }, { name: "date", type: "date" }, { name: "vaccine-code", type: "token" }] },
        { type: "Condition", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "_id", type: "token" }, { name: "patient", type: "reference" }, { name: "clinical-status", type: "token" }, { name: "category", type: "token" }] },
      ],
    }],
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
  const exchangePurpose = (req.headers.get("X-Exchange-Purpose") || "individual-access") as ExchangePurpose;
  const requestingOrg = req.headers.get("X-Requesting-Organization") || qhinId;
  const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";

  const context: TEFCAContext = {
    qhinId,
    exchangePurpose,
    requestingOrganization: requestingOrg,
    ipAddress,
  };

  const validPurposes = ["individual-access", "treatment", "payment", "operations"];
  if (!validPurposes.includes(exchangePurpose)) {
    const outcome = createOperationOutcome("error", "invalid", `Invalid exchange purpose: ${exchangePurpose}`);
    await logTEFCAAccess(supabase, context, [], 0, false, "Invalid exchange purpose", Date.now() - startTime);
    return new Response(JSON.stringify(outcome), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
    });
  }

  try {
    if (fhirPath.length === 0 || fhirPath[0] === "metadata") {
      const capability = createCapabilityStatement(baseUrl);
      await logTEFCAAccess(supabase, context, ["CapabilityStatement"], 1, true, undefined, Date.now() - startTime);
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
          const outcome = createOperationOutcome("error", "not-found", `Patient ${resourceId} not found`);
          await logTEFCAAccess(supabase, context, ["Patient"], 0, false, "Patient not found", Date.now() - startTime, resourceId);
          return new Response(JSON.stringify(outcome), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
          });
        }

        const hasConsent = await verifyPatientConsent(supabase, resourceId, exchangePurpose);
        if (!hasConsent) {
          const outcome = createOperationOutcome("error", "forbidden", "Patient has not consented to data sharing");
          await logTEFCAAccess(supabase, context, ["Patient"], 0, false, "No consent", Date.now() - startTime, resourceId);
          return new Response(JSON.stringify(outcome), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
          });
        }

        const fhirPatient = mapPatientToFHIR(patient);
        await logTEFCAAccess(supabase, context, ["Patient"], 1, true, undefined, Date.now() - startTime, resourceId);
        return new Response(JSON.stringify(fhirPatient), {
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      if (resourceId === "$everything") {
        const patientId = fhirPath[0] === "Patient" ? url.searchParams.get("patient")?.replace("Patient/", "") : resourceId;

        const actualPatientId = url.pathname.match(/Patient\/([^/]+)\/\$everything/)?.[1] || patientId;

        if (!actualPatientId) {
          const outcome = createOperationOutcome("error", "required", "Patient ID is required for $everything operation");
          await logTEFCAAccess(supabase, context, ["$everything"], 0, false, "Missing patient ID", Date.now() - startTime);
          return new Response(JSON.stringify(outcome), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
          });
        }

        const hasConsent = await verifyPatientConsent(supabase, actualPatientId, exchangePurpose);
        if (!hasConsent) {
          const outcome = createOperationOutcome("error", "forbidden", "Patient has not consented to data sharing");
          await logTEFCAAccess(supabase, context, ["$everything"], 0, false, "No consent", Date.now() - startTime, actualPatientId);
          return new Response(JSON.stringify(outcome), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
          });
        }

        const [patientResult, vitalsResult, dispensesResult, visitsResult, immunizationsResult, conditionsResult, sdohResult] = await Promise.all([
          supabase.from("patients").select("*").eq("id", actualPatientId).maybeSingle(),
          supabase.from("vitals").select("*").eq("patient_id", actualPatientId).order("created_at", { ascending: false }),
          supabase.from("dispenses").select("*").eq("patient_id", actualPatientId).order("created_at", { ascending: false }),
          supabase.from("visits").select("*").eq("patient_id", actualPatientId).order("created_at", { ascending: false }),
          supabase.from("immunizations").select("*").eq("patient_id", actualPatientId).order("administered_at", { ascending: false }),
          supabase.from("conditions").select("*").eq("patient_id", actualPatientId).order("created_at", { ascending: false }),
          supabase.from("sdoh_observations").select("*").eq("patient_id", actualPatientId).order("effective_date", { ascending: false }),
        ]);

        if (!patientResult.data) {
          const outcome = createOperationOutcome("error", "not-found", `Patient ${actualPatientId} not found`);
          await logTEFCAAccess(supabase, context, ["$everything"], 0, false, "Patient not found", Date.now() - startTime, actualPatientId);
          return new Response(JSON.stringify(outcome), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
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

        const bundle = {
          resourceType: "Bundle",
          type: "collection",
          total: resources.length,
          entry: resources.map((r) => ({ resource: r })),
        };

        await logTEFCAAccess(supabase, context, ["Patient", "Observation", "MedicationRequest", "Encounter", "Immunization", "Condition"], resources.length, true, undefined, Date.now() - startTime, actualPatientId);
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
        const idValue = identifierSearch.includes("|") ? identifierSearch.split("|")[1] : identifierSearch;
        query = query.eq("id", idValue);
      }

      const { data: patients, error } = await query;

      if (error) {
        const outcome = createOperationOutcome("error", "exception", error.message);
        await logTEFCAAccess(supabase, context, ["Patient"], 0, false, error.message, Date.now() - startTime);
        return new Response(JSON.stringify(outcome), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const fhirPatients = (patients || []).map(mapPatientToFHIR);
      const bundle = createBundle(fhirPatients, `${baseUrl}/Patient`);
      await logTEFCAAccess(supabase, context, ["Patient"], fhirPatients.length, true, undefined, Date.now() - startTime);
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    if (resourceType === "Observation") {
      const patientId = url.searchParams.get("patient")?.replace("Patient/", "");
      const category = url.searchParams.get("category");
      const dateParam = url.searchParams.get("date");

      if (!patientId) {
        const outcome = createOperationOutcome("error", "required", "Patient parameter is required for Observation queries");
        await logTEFCAAccess(supabase, context, ["Observation"], 0, false, "Missing patient parameter", Date.now() - startTime);
        return new Response(JSON.stringify(outcome), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const hasConsent = await verifyPatientConsent(supabase, patientId, exchangePurpose);
      if (!hasConsent) {
        const outcome = createOperationOutcome("error", "forbidden", "Patient has not consented to data sharing");
        await logTEFCAAccess(supabase, context, ["Observation"], 0, false, "No consent", Date.now() - startTime, patientId);
        return new Response(JSON.stringify(outcome), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const { data: patient } = await supabase.from("patients").select("name").eq("id", patientId).maybeSingle();
      const patientName = patient?.name;

      let observations: unknown[] = [];

      if (!category || category === "vital-signs") {
        let vitalsQuery = supabase.from("vitals").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(100);

        if (dateParam) {
          const dateMatch = dateParam.match(/^(ge|le|gt|lt)?(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            const [, prefix, date] = dateMatch;
            if (prefix === "ge") vitalsQuery = vitalsQuery.gte("created_at", date);
            else if (prefix === "le") vitalsQuery = vitalsQuery.lte("created_at", date);
            else if (prefix === "gt") vitalsQuery = vitalsQuery.gt("created_at", date);
            else if (prefix === "lt") vitalsQuery = vitalsQuery.lt("created_at", date);
            else vitalsQuery = vitalsQuery.gte("created_at", date).lt("created_at", `${date}T23:59:59`);
          }
        }

        const { data: vitals } = await vitalsQuery;
        observations = observations.concat((vitals || []).flatMap((v: Record<string, unknown>) => mapVitalsToFHIR(v, patientName)));
      }

      if (!category || category === "sdoh" || category === "social-history") {
        const { data: sdohData } = await supabase.from("sdoh_observations").select("*").eq("patient_id", patientId).order("effective_date", { ascending: false }).limit(100);
        observations = observations.concat((sdohData || []).map((s: Record<string, unknown>) => mapSDOHToFHIR(s, patientName)));
      }

      const bundle = createBundle(observations, `${baseUrl}/Observation`);
      await logTEFCAAccess(supabase, context, ["Observation"], observations.length, true, undefined, Date.now() - startTime, patientId);
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    if (resourceType === "MedicationRequest") {
      const patientId = url.searchParams.get("patient")?.replace("Patient/", "");

      if (!patientId) {
        const outcome = createOperationOutcome("error", "required", "Patient parameter is required for MedicationRequest queries");
        await logTEFCAAccess(supabase, context, ["MedicationRequest"], 0, false, "Missing patient parameter", Date.now() - startTime);
        return new Response(JSON.stringify(outcome), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const hasConsent = await verifyPatientConsent(supabase, patientId, exchangePurpose);
      if (!hasConsent) {
        const outcome = createOperationOutcome("error", "forbidden", "Patient has not consented to data sharing");
        await logTEFCAAccess(supabase, context, ["MedicationRequest"], 0, false, "No consent", Date.now() - startTime, patientId);
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
        const outcome = createOperationOutcome("error", "exception", error.message);
        await logTEFCAAccess(supabase, context, ["MedicationRequest"], 0, false, error.message, Date.now() - startTime, patientId);
        return new Response(JSON.stringify(outcome), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const { data: patient } = await supabase.from("patients").select("name").eq("id", patientId).maybeSingle();
      const patientName = patient?.name;

      const medications = (dispenses || []).map((d: Record<string, unknown>) => mapMedicationToFHIR(d, patientName));
      const bundle = createBundle(medications, `${baseUrl}/MedicationRequest`);
      await logTEFCAAccess(supabase, context, ["MedicationRequest"], medications.length, true, undefined, Date.now() - startTime, patientId);
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    if (resourceType === "Encounter") {
      const patientId = url.searchParams.get("patient")?.replace("Patient/", "");

      if (!patientId) {
        const outcome = createOperationOutcome("error", "required", "Patient parameter is required for Encounter queries");
        await logTEFCAAccess(supabase, context, ["Encounter"], 0, false, "Missing patient parameter", Date.now() - startTime);
        return new Response(JSON.stringify(outcome), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const hasConsent = await verifyPatientConsent(supabase, patientId, exchangePurpose);
      if (!hasConsent) {
        const outcome = createOperationOutcome("error", "forbidden", "Patient has not consented to data sharing");
        await logTEFCAAccess(supabase, context, ["Encounter"], 0, false, "No consent", Date.now() - startTime, patientId);
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
        const outcome = createOperationOutcome("error", "exception", error.message);
        await logTEFCAAccess(supabase, context, ["Encounter"], 0, false, error.message, Date.now() - startTime, patientId);
        return new Response(JSON.stringify(outcome), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const { data: patient } = await supabase.from("patients").select("name").eq("id", patientId).maybeSingle();
      const patientName = patient?.name;

      const encounters = (visits || []).map((v: Record<string, unknown>) => mapEncounterToFHIR(v, patientName));
      const bundle = createBundle(encounters, `${baseUrl}/Encounter`);
      await logTEFCAAccess(supabase, context, ["Encounter"], encounters.length, true, undefined, Date.now() - startTime, patientId);
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    if (resourceType === "Immunization") {
      const patientId = url.searchParams.get("patient")?.replace("Patient/", "");

      if (!patientId) {
        const outcome = createOperationOutcome("error", "required", "Patient parameter is required for Immunization queries");
        await logTEFCAAccess(supabase, context, ["Immunization"], 0, false, "Missing patient parameter", Date.now() - startTime);
        return new Response(JSON.stringify(outcome), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const hasConsent = await verifyPatientConsent(supabase, patientId, exchangePurpose);
      if (!hasConsent) {
        const outcome = createOperationOutcome("error", "forbidden", "Patient has not consented to data sharing");
        await logTEFCAAccess(supabase, context, ["Immunization"], 0, false, "No consent", Date.now() - startTime, patientId);
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
        const outcome = createOperationOutcome("error", "exception", error.message);
        await logTEFCAAccess(supabase, context, ["Immunization"], 0, false, error.message, Date.now() - startTime, patientId);
        return new Response(JSON.stringify(outcome), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const { data: patient } = await supabase.from("patients").select("name").eq("id", patientId).maybeSingle();
      const patientName = patient?.name;

      const fhirImmunizations = (immunizations || []).map((i: Record<string, unknown>) => mapImmunizationToFHIR(i, patientName));
      const bundle = createBundle(fhirImmunizations, `${baseUrl}/Immunization`);
      await logTEFCAAccess(supabase, context, ["Immunization"], fhirImmunizations.length, true, undefined, Date.now() - startTime, patientId);
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    if (resourceType === "Condition") {
      const patientId = url.searchParams.get("patient")?.replace("Patient/", "");
      const clinicalStatus = url.searchParams.get("clinical-status");
      const category = url.searchParams.get("category");

      if (!patientId) {
        const outcome = createOperationOutcome("error", "required", "Patient parameter is required for Condition queries");
        await logTEFCAAccess(supabase, context, ["Condition"], 0, false, "Missing patient parameter", Date.now() - startTime);
        return new Response(JSON.stringify(outcome), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const hasConsent = await verifyPatientConsent(supabase, patientId, exchangePurpose);
      if (!hasConsent) {
        const outcome = createOperationOutcome("error", "forbidden", "Patient has not consented to data sharing");
        await logTEFCAAccess(supabase, context, ["Condition"], 0, false, "No consent", Date.now() - startTime, patientId);
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
        const outcome = createOperationOutcome("error", "exception", error.message);
        await logTEFCAAccess(supabase, context, ["Condition"], 0, false, error.message, Date.now() - startTime, patientId);
        return new Response(JSON.stringify(outcome), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
        });
      }

      const { data: patient } = await supabase.from("patients").select("name").eq("id", patientId).maybeSingle();
      const patientName = patient?.name;

      const fhirConditions = (conditions || []).map((c: Record<string, unknown>) => mapConditionToFHIR(c, patientName));
      const bundle = createBundle(fhirConditions, `${baseUrl}/Condition`);
      await logTEFCAAccess(supabase, context, ["Condition"], fhirConditions.length, true, undefined, Date.now() - startTime, patientId);
      return new Response(JSON.stringify(bundle), {
        headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
      });
    }

    const outcome = createOperationOutcome("error", "not-supported", `Resource type ${resourceType} is not supported`);
    await logTEFCAAccess(supabase, context, [resourceType], 0, false, "Unsupported resource type", Date.now() - startTime);
    return new Response(JSON.stringify(outcome), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const outcome = createOperationOutcome("fatal", "exception", message);
    await logTEFCAAccess(supabase, context, [], 0, false, message, Date.now() - startTime);
    return new Response(JSON.stringify(outcome), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
    });
  }
});
