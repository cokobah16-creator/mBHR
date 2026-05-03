// TEFCA IAS FHIR endpoint — slim router.
//
// Phase B refactor: structural split with no behavior change at the wire.
// - shared.ts        types, constants, corsHeaders, createBundle/OperationOutcome
// - audit.ts         logTEFCAAccess, verifyPatientConsent
// - mappers.ts       all row -> FHIR R4 mappers (US Core 7.0 profiled)
// - registry.ts      declarative ResourceConfig per FHIR resource type
// - capability.ts    registry-driven CapabilityStatement
// - index.ts (this)  request routing + a generic patient-scoped handler that
//                    drives 11 resource types from the registry
//
// Custom handlers remain inline for Patient (read/search/$everything),
// Observation (vitals + SDOH union), and DiagnosticReport (lab_orders +
// lab_results join). Future Phase B-2 work: _history/vread, $match, and
// further extracting per-resource modules.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { logTEFCAAccess, verifyPatientConsent } from "../_shared/fhir/audit.ts";
import {
  resolveAuth,
  scopeAllowsResource,
} from "../_shared/fhir/bearer-auth.ts";
import { createCapabilityStatement } from "./capability.ts";
import { validateResponseClone } from "./validation.ts";
import {
  loadResourceHistory,
  loadResourceVersion,
  resourceSupportsHistory,
  resourceSupportsVread,
} from "./history.ts";
import {
  mapDiagnosticReportToFHIR,
  mapPatientToFHIR,
  mapSDOHToFHIR,
  mapVitalsToFHIR,
} from "../_shared/fhir/mappers.ts";
import { matchPatientIdentity, parseMatchParameters } from "./patient-match.ts";
import {
  loadFhirResourceById,
  loadFhirResourcesByPatient,
  loadFhirResourcesEverything,
} from "./read-merge.ts";
import { handleCreate, handleDelete, handleUpdate } from "./writes.ts";
import {
  getResourceConfig,
  type ResourceConfig,
} from "../_shared/fhir/registry.ts";
import {
  corsHeaders,
  createBundle,
  createOperationOutcome,
  errorResponse,
  fhirJsonHeaders,
  fhirJsonResponse,
  type TEFCAContext,
  VALID_EXCHANGE_PURPOSES,
} from "./shared.ts";

type SupabaseLike = ReturnType<typeof createClient>;

async function handleGenericPatientScoped(
  supabase: SupabaseLike,
  url: URL,
  baseUrl: string,
  context: TEFCAContext,
  startTime: number,
  config: ResourceConfig,
): Promise<Response> {
  const patientId = url.searchParams.get("patient")?.replace("Patient/", "");

  if (!patientId) {
    await logTEFCAAccess(
      supabase,
      context,
      [config.resourceType],
      0,
      false,
      "Missing patient parameter",
      Date.now() - startTime,
    );
    return errorResponse(
      "error",
      "required",
      `Patient parameter is required for ${config.resourceType} queries`,
      400,
    );
  }

  const hasConsent = await verifyPatientConsent(
    supabase,
    patientId,
    context.exchangePurpose,
  );
  if (!hasConsent) {
    await logTEFCAAccess(
      supabase,
      context,
      [config.resourceType],
      0,
      false,
      "No consent",
      Date.now() - startTime,
      patientId,
    );
    return errorResponse(
      "error",
      "forbidden",
      "Patient has not consented to data sharing",
      403,
    );
  }

  let query = supabase
    .from(config.table)
    .select("*")
    .eq("patient_id", patientId)
    .order(config.orderColumn, { ascending: false })
    .limit(100);

  for (const sp of config.searchParams) {
    if (!sp.column || sp.name === "_id" || sp.name === "patient") continue;
    const v = url.searchParams.get(sp.name);
    if (v) query = query.eq(sp.column, v);
  }

  const { data, error } = await query;

  if (error) {
    await logTEFCAAccess(
      supabase,
      context,
      [config.resourceType],
      0,
      false,
      error.message,
      Date.now() - startTime,
      patientId,
    );
    return errorResponse("error", "exception", error.message, 500);
  }

  const { data: patient } = await supabase
    .from("patients")
    .select("name")
    .eq("id", patientId)
    .maybeSingle();
  const patientName = (patient as { name?: string } | null)?.name;

  const canonical = (data || []).map((row: Record<string, unknown>) =>
    config.mapper(row, patientName),
  );
  // Phase I: union with the validator-gated fhir_resources passthrough
  // store so writes posted via Phase H endpoints surface on subsequent
  // reads alongside the canonical clinical-table data.
  const merged = await loadFhirResourcesByPatient(
    supabase,
    config.resourceType,
    patientId,
  );
  const resources = [...canonical, ...merged];
  const bundle = createBundle(resources, `${baseUrl}/${config.resourceType}`);
  await logTEFCAAccess(
    supabase,
    context,
    [config.resourceType],
    resources.length,
    true,
    undefined,
    Date.now() - startTime,
    patientId,
  );
  return fhirJsonResponse(bundle);
}

async function handlePatientRead(
  supabase: SupabaseLike,
  resourceId: string,
  context: TEFCAContext,
  startTime: number,
): Promise<Response> {
  const { data: patient, error } = await supabase
    .from("patients")
    .select("*")
    .eq("id", resourceId)
    .maybeSingle();

  if (error || !patient) {
    // Phase I: fall through to the validator-gated fhir_resources store
    // for Patients created via POST /Patient. The write-store keeps the
    // server-assigned uuid as the FHIR id.
    const fromWrites = await loadFhirResourceById(
      supabase,
      "Patient",
      resourceId,
    );
    if (fromWrites) {
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
      return fhirJsonResponse(fromWrites);
    }

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
    return errorResponse(
      "error",
      "not-found",
      `Patient ${resourceId} not found`,
      404,
    );
  }

  const hasConsent = await verifyPatientConsent(
    supabase,
    resourceId,
    context.exchangePurpose,
  );
  if (!hasConsent) {
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
    return errorResponse(
      "error",
      "forbidden",
      "Patient has not consented to data sharing",
      403,
    );
  }

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
  return fhirJsonResponse(mapPatientToFHIR(patient));
}

async function handlePatientEverything(
  supabase: SupabaseLike,
  patientId: string,
  context: TEFCAContext,
  startTime: number,
): Promise<Response> {
  const hasConsent = await verifyPatientConsent(
    supabase,
    patientId,
    context.exchangePurpose,
  );
  if (!hasConsent) {
    await logTEFCAAccess(
      supabase,
      context,
      ["$everything"],
      0,
      false,
      "No consent",
      Date.now() - startTime,
      patientId,
    );
    return errorResponse(
      "error",
      "forbidden",
      "Patient has not consented to data sharing",
      403,
    );
  }

  // Drive the fan-out from the registry where possible. Patient, Observation
  // (vitals + SDOH), and DiagnosticReport (lab_orders + lab_results) are
  // handled separately because they fan out across multiple tables.
  const everythingTables: Array<{
    table: string;
    orderColumn: string;
    mapper: (
      row: Record<string, unknown>,
      patientName?: string,
    ) => unknown | unknown[];
  }> = [];

  for (const cfg of (await import("../_shared/fhir/registry.ts"))
    .RESOURCE_REGISTRY) {
    if (cfg.customHandler) continue;
    everythingTables.push({
      table: cfg.table,
      orderColumn: cfg.orderColumn,
      mapper: cfg.mapper,
    });
  }

  const [
    patientResult,
    vitalsResult,
    sdohResult,
    labOrdersResult,
    ...registryResults
  ] = await Promise.all([
    supabase.from("patients").select("*").eq("id", patientId).maybeSingle(),
    supabase
      .from("vitals")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false }),
    supabase
      .from("sdoh_observations")
      .select("*")
      .eq("patient_id", patientId)
      .order("effective_date", { ascending: false }),
    supabase
      .from("lab_orders")
      .select("*")
      .eq("patient_id", patientId)
      .order("ordered_at", { ascending: false }),
    ...everythingTables.map((t) =>
      supabase
        .from(t.table)
        .select("*")
        .eq("patient_id", patientId)
        .order(t.orderColumn, { ascending: false }),
    ),
  ]);

  if (!patientResult.data) {
    await logTEFCAAccess(
      supabase,
      context,
      ["$everything"],
      0,
      false,
      "Patient not found",
      Date.now() - startTime,
      patientId,
    );
    return errorResponse(
      "error",
      "not-found",
      `Patient ${patientId} not found`,
      404,
    );
  }

  const patient = patientResult.data as Record<string, unknown>;
  const patientName = patient.name as string | undefined;
  const resources: unknown[] = [mapPatientToFHIR(patient)];

  for (const v of vitalsResult.data || []) {
    resources.push(
      ...mapVitalsToFHIR(v as Record<string, unknown>, patientName),
    );
  }
  for (const sdoh of sdohResult.data || []) {
    resources.push(mapSDOHToFHIR(sdoh as Record<string, unknown>, patientName));
  }

  // Lab orders + their results -> DiagnosticReport
  if ((labOrdersResult.data || []).length > 0) {
    const orderIds = (labOrdersResult.data as Record<string, unknown>[]).map(
      (o) => o.id as string,
    );
    const { data: results } = await supabase
      .from("lab_results")
      .select("*")
      .in("order_id", orderIds);
    const resultsByOrder: Record<string, Record<string, unknown>[]> = {};
    for (const r of results || []) {
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

  for (let i = 0; i < everythingTables.length; i++) {
    const cfg = everythingTables[i];
    const result = registryResults[i];
    for (const row of result.data || []) {
      const mapped = cfg.mapper(row as Record<string, unknown>, patientName);
      if (Array.isArray(mapped)) {
        resources.push(...mapped);
      } else {
        resources.push(mapped);
      }
    }
  }

  // Phase I: union with the validator-gated fhir_resources passthrough
  // store. $everything pulls every resource type for this patient from the
  // write store and concatenates after the canonical-table fan-out.
  const fromWrites = await loadFhirResourcesEverything(supabase, patientId);
  resources.push(...fromWrites);

  const bundle = {
    resourceType: "Bundle",
    type: "collection",
    total: resources.length,
    entry: resources.map((r) => ({ resource: r })),
  };

  await logTEFCAAccess(
    supabase,
    context,
    ["$everything"],
    resources.length,
    true,
    undefined,
    Date.now() - startTime,
    patientId,
  );
  return fhirJsonResponse(bundle);
}

async function handlePatientSearch(
  supabase: SupabaseLike,
  url: URL,
  baseUrl: string,
  context: TEFCAContext,
  startTime: number,
): Promise<Response> {
  const nameSearch = url.searchParams.get("name");
  const birthdateSearch = url.searchParams.get("birthdate");
  const identifierSearch = url.searchParams.get("identifier");

  let query = supabase.from("patients").select("*").limit(50);

  if (nameSearch) query = query.ilike("name", `%${nameSearch}%`);
  if (birthdateSearch) query = query.eq("dob", birthdateSearch);
  if (identifierSearch) {
    const idValue = identifierSearch.includes("|")
      ? identifierSearch.split("|")[1]
      : identifierSearch;
    query = query.eq("id", idValue);
  }

  const { data: patients, error } = await query;
  if (error) {
    await logTEFCAAccess(
      supabase,
      context,
      ["Patient"],
      0,
      false,
      error.message,
      Date.now() - startTime,
    );
    return errorResponse("error", "exception", error.message, 500);
  }

  const fhirPatients = (patients || []).map((p) =>
    mapPatientToFHIR(p as Record<string, unknown>),
  );
  await logTEFCAAccess(
    supabase,
    context,
    ["Patient"],
    fhirPatients.length,
    true,
    undefined,
    Date.now() - startTime,
  );
  return fhirJsonResponse(createBundle(fhirPatients, `${baseUrl}/Patient`));
}

async function handleObservationSearch(
  supabase: SupabaseLike,
  url: URL,
  baseUrl: string,
  context: TEFCAContext,
  startTime: number,
): Promise<Response> {
  const patientId = url.searchParams.get("patient")?.replace("Patient/", "");
  const category = url.searchParams.get("category");
  const dateParam = url.searchParams.get("date");

  if (!patientId) {
    await logTEFCAAccess(
      supabase,
      context,
      ["Observation"],
      0,
      false,
      "Missing patient parameter",
      Date.now() - startTime,
    );
    return errorResponse(
      "error",
      "required",
      "Patient parameter is required for Observation queries",
      400,
    );
  }

  const hasConsent = await verifyPatientConsent(
    supabase,
    patientId,
    context.exchangePurpose,
  );
  if (!hasConsent) {
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
    return errorResponse(
      "error",
      "forbidden",
      "Patient has not consented to data sharing",
      403,
    );
  }

  const { data: patient } = await supabase
    .from("patients")
    .select("name")
    .eq("id", patientId)
    .maybeSingle();
  const patientName = (patient as { name?: string } | null)?.name;

  let observations: unknown[] = [];

  if (!category || category === "vital-signs") {
    let vitalsQuery = supabase
      .from("vitals")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (dateParam) {
      const dateMatch = dateParam.match(/^(ge|le|gt|lt)?(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        const [, prefix, date] = dateMatch;
        if (prefix === "ge") vitalsQuery = vitalsQuery.gte("created_at", date);
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

  // Phase I: union with the validator-gated fhir_resources passthrough
  // store. Observation reads still pull vitals + SDOH from the canonical
  // tables; the write-store contributes any Observations posted via
  // Phase H endpoints (e.g. third-party app sync).
  const fromWrites = await loadFhirResourcesByPatient(
    supabase,
    "Observation",
    patientId,
  );
  const merged = [...observations, ...fromWrites];

  await logTEFCAAccess(
    supabase,
    context,
    ["Observation"],
    merged.length,
    true,
    undefined,
    Date.now() - startTime,
    patientId,
  );
  return fhirJsonResponse(createBundle(merged, `${baseUrl}/Observation`));
}

async function handleDiagnosticReportSearch(
  supabase: SupabaseLike,
  url: URL,
  baseUrl: string,
  context: TEFCAContext,
  startTime: number,
): Promise<Response> {
  const patientId = url.searchParams.get("patient")?.replace("Patient/", "");

  if (!patientId) {
    await logTEFCAAccess(
      supabase,
      context,
      ["DiagnosticReport"],
      0,
      false,
      "Missing patient parameter",
      Date.now() - startTime,
    );
    return errorResponse(
      "error",
      "required",
      "Patient parameter is required for DiagnosticReport queries",
      400,
    );
  }

  const hasConsent = await verifyPatientConsent(
    supabase,
    patientId,
    context.exchangePurpose,
  );
  if (!hasConsent) {
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
    return errorResponse(
      "error",
      "forbidden",
      "Patient has not consented to data sharing",
      403,
    );
  }

  const { data: orders, error: ordersError } = await supabase
    .from("lab_orders")
    .select("*")
    .eq("patient_id", patientId)
    .order("ordered_at", { ascending: false })
    .limit(100);

  if (ordersError) {
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
    return errorResponse("error", "exception", ordersError.message, 500);
  }

  const orderIds = (orders || []).map(
    (o: Record<string, unknown>) => o.id as string,
  );
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

  const reports = (orders || []).map((o: Record<string, unknown>) =>
    mapDiagnosticReportToFHIR(
      o,
      resultsByOrder[(o as { id: string }).id] || [],
      patientName,
    ),
  );
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
  // Phase I: union with the validator-gated fhir_resources passthrough.
  const fromWrites = await loadFhirResourcesByPatient(
    supabase,
    "DiagnosticReport",
    patientId,
  );
  const merged = [...reports, ...fromWrites];
  return fhirJsonResponse(createBundle(merged, `${baseUrl}/DiagnosticReport`));
}

async function handlePatientMatch(
  supabase: SupabaseLike,
  req: Request,
  baseUrl: string,
  context: TEFCAContext,
  startTime: number,
): Promise<Response> {
  if (req.method !== "POST") {
    await logTEFCAAccess(
      supabase,
      context,
      ["Patient/$match"],
      0,
      false,
      "Method not allowed",
      Date.now() - startTime,
    );
    return errorResponse(
      "error",
      "not-supported",
      "Patient/$match requires POST",
      405,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    await logTEFCAAccess(
      supabase,
      context,
      ["Patient/$match"],
      0,
      false,
      "Malformed body",
      Date.now() - startTime,
    );
    return errorResponse(
      "error",
      "structure",
      "Patient/$match body must be a FHIR Parameters resource",
      400,
    );
  }

  const identifiers = parseMatchParameters(body);
  if (Object.keys(identifiers).length === 0) {
    await logTEFCAAccess(
      supabase,
      context,
      ["Patient/$match"],
      0,
      false,
      "No matchable identifiers",
      Date.now() - startTime,
    );
    return errorResponse(
      "error",
      "required",
      "Patient/$match requires at least one of identifier, telecom (phone/email), or name+birthDate",
      400,
    );
  }

  const match = await matchPatientIdentity(supabase, identifiers);

  if (!match) {
    await logTEFCAAccess(
      supabase,
      context,
      ["Patient/$match"],
      0,
      true,
      undefined,
      Date.now() - startTime,
    );
    return fhirJsonResponse({
      resourceType: "Bundle",
      type: "searchset",
      total: 0,
      entry: [],
    });
  }

  const { data: patient } = await supabase
    .from("patients")
    .select("*")
    .eq("id", match.patientId)
    .maybeSingle();

  const fhirPatient = patient
    ? mapPatientToFHIR(patient as Record<string, unknown>)
    : null;

  await logTEFCAAccess(
    supabase,
    context,
    ["Patient/$match"],
    fhirPatient ? 1 : 0,
    true,
    undefined,
    Date.now() - startTime,
    match.patientId,
  );

  return fhirJsonResponse({
    resourceType: "Bundle",
    type: "searchset",
    total: fhirPatient ? 1 : 0,
    entry: fhirPatient
      ? [
          {
            fullUrl: `${baseUrl}/Patient/${match.patientId}`,
            resource: fhirPatient,
            search: {
              mode: "match",
              score: match.confidence,
              extension: [
                {
                  url: "http://hl7.org/fhir/StructureDefinition/match-grade",
                  valueCode:
                    match.confidence >= 0.95
                      ? "certain"
                      : match.confidence >= 0.85
                        ? "probable"
                        : "possible",
                },
              ],
            },
          },
        ]
      : [],
  });
}

async function handleResourceHistory(
  supabase: SupabaseLike,
  config: ResourceConfig,
  logicalId: string,
  baseUrl: string,
  context: TEFCAContext,
  startTime: number,
): Promise<Response> {
  if (!resourceSupportsHistory(config)) {
    await logTEFCAAccess(
      supabase,
      context,
      [`${config.resourceType}/_history`],
      0,
      false,
      "History not supported for this resource type",
      Date.now() - startTime,
    );
    return errorResponse(
      "error",
      "not-supported",
      `_history is not available for ${config.resourceType}`,
      400,
    );
  }

  // Consent gate: scope by patient_id where applicable. For Patient/{id} the
  // resource id IS the patient_id; for other versioned resources we look up
  // the row first.
  const patientId = await resolvePatientIdForVersionedResource(
    supabase,
    config,
    logicalId,
  );
  if (!patientId) {
    await logTEFCAAccess(
      supabase,
      context,
      [`${config.resourceType}/_history`],
      0,
      false,
      "Resource not found",
      Date.now() - startTime,
    );
    return errorResponse(
      "error",
      "not-found",
      `${config.resourceType}/${logicalId} not found`,
      404,
    );
  }

  const hasConsent = await verifyPatientConsent(
    supabase,
    patientId,
    context.exchangePurpose,
  );
  if (!hasConsent) {
    await logTEFCAAccess(
      supabase,
      context,
      [`${config.resourceType}/_history`],
      0,
      false,
      "No consent",
      Date.now() - startTime,
      patientId,
    );
    return errorResponse(
      "error",
      "forbidden",
      "Patient has not consented to data sharing",
      403,
    );
  }

  const result = await loadResourceHistory(
    supabase,
    config,
    logicalId,
    baseUrl,
  );
  if (!result || result.entryCount === 0) {
    await logTEFCAAccess(
      supabase,
      context,
      [`${config.resourceType}/_history`],
      0,
      true,
      undefined,
      Date.now() - startTime,
      patientId,
    );
    return fhirJsonResponse({
      resourceType: "Bundle",
      type: "history",
      total: 0,
      entry: [],
    });
  }

  await logTEFCAAccess(
    supabase,
    context,
    [`${config.resourceType}/_history`],
    result.entryCount,
    true,
    undefined,
    Date.now() - startTime,
    patientId,
  );
  return fhirJsonResponse(result.bundle);
}

async function handleVread(
  supabase: SupabaseLike,
  config: ResourceConfig,
  logicalId: string,
  versionId: string,
  context: TEFCAContext,
  startTime: number,
): Promise<Response> {
  if (!resourceSupportsVread(config)) {
    await logTEFCAAccess(
      supabase,
      context,
      [`${config.resourceType}/vread`],
      0,
      false,
      "vread not supported for this resource type",
      Date.now() - startTime,
    );
    return errorResponse(
      "error",
      "not-supported",
      `vread is not available for ${config.resourceType}`,
      400,
    );
  }

  const patientId = await resolvePatientIdForVersionedResource(
    supabase,
    config,
    logicalId,
  );
  if (!patientId) {
    await logTEFCAAccess(
      supabase,
      context,
      [`${config.resourceType}/vread`],
      0,
      false,
      "Resource not found",
      Date.now() - startTime,
    );
    return errorResponse(
      "error",
      "not-found",
      `${config.resourceType}/${logicalId} not found`,
      404,
    );
  }

  const hasConsent = await verifyPatientConsent(
    supabase,
    patientId,
    context.exchangePurpose,
  );
  if (!hasConsent) {
    await logTEFCAAccess(
      supabase,
      context,
      [`${config.resourceType}/vread`],
      0,
      false,
      "No consent",
      Date.now() - startTime,
      patientId,
    );
    return errorResponse(
      "error",
      "forbidden",
      "Patient has not consented to data sharing",
      403,
    );
  }

  const resource = await loadResourceVersion(
    supabase,
    config,
    logicalId,
    versionId,
  );
  if (!resource) {
    await logTEFCAAccess(
      supabase,
      context,
      [`${config.resourceType}/vread`],
      0,
      false,
      "Version not found",
      Date.now() - startTime,
      patientId,
    );
    return errorResponse(
      "error",
      "not-found",
      `${config.resourceType}/${logicalId}/_history/${versionId} not found`,
      404,
    );
  }

  await logTEFCAAccess(
    supabase,
    context,
    [`${config.resourceType}/vread`],
    1,
    true,
    undefined,
    Date.now() - startTime,
    patientId,
  );
  return fhirJsonResponse(resource);
}

/**
 * Resolve the underlying patient_id for a versioned resource so the consent
 * gate can be applied uniformly. For Patient/{id}, the id IS the patient_id;
 * for other clinician-mutated resources, we look the row up by primary key.
 */
async function resolvePatientIdForVersionedResource(
  supabase: SupabaseLike,
  config: ResourceConfig,
  logicalId: string,
): Promise<string | null> {
  if (config.resourceType === "Patient") {
    const { data } = await supabase
      .from("patients")
      .select("id")
      .eq("id", logicalId)
      .maybeSingle();
    return (data as { id: string } | null)?.id || null;
  }

  const { data } = await supabase
    .from(config.table)
    .select("patient_id")
    .eq("id", logicalId)
    .maybeSingle();
  return (data as { patient_id: string } | null)?.patient_id || null;
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

  const auth = await resolveAuth(supabase, req);
  const { context } = auth;
  const exchangePurpose = context.exchangePurpose;

  // Apply Deprecation / Sunset headers for any response when the caller is
  // still using the legacy X-QHIN-ID auth path.
  const deprecationHeaders = auth.deprecationHeaders;

  if (auth.unauthorized) {
    await logTEFCAAccess(
      supabase,
      context,
      [],
      0,
      false,
      auth.unauthorizedReason ?? "unauthorized",
      Date.now() - startTime,
    );
    return new Response(
      JSON.stringify(
        createOperationOutcome(
          "error",
          "login",
          auth.unauthorizedReason ?? "Authorization required",
        ),
      ),
      {
        status: 401,
        headers: {
          ...fhirJsonHeaders,
          "WWW-Authenticate": 'Bearer realm="tefca-ias", error="invalid_token"',
        },
      },
    );
  }

  if (!VALID_EXCHANGE_PURPOSES.includes(exchangePurpose)) {
    await logTEFCAAccess(
      supabase,
      context,
      [],
      0,
      false,
      "Invalid exchange purpose",
      Date.now() - startTime,
    );
    return new Response(
      JSON.stringify(
        createOperationOutcome(
          "error",
          "invalid",
          `Invalid exchange purpose: ${exchangePurpose}`,
        ),
      ),
      { status: 400, headers: fhirJsonHeaders },
    );
  }

  const dispatchResp: Response = await (async (): Promise<Response> => {
    try {
      // /metadata - CapabilityStatement
      if (fhirPath.length === 0 || fhirPath[0] === "metadata") {
        await logTEFCAAccess(
          supabase,
          context,
          ["CapabilityStatement"],
          1,
          true,
          undefined,
          Date.now() - startTime,
        );
        return fhirJsonResponse(createCapabilityStatement(baseUrl));
      }

      const resourceType = fhirPath[0];
      const resourceId = fhirPath[1];

      // SMART scope enforcement for bearer-authed callers. Legacy X-QHIN-ID
      // callers retain unrestricted access during the deprecation window
      // (see bearer-auth.ts:legacySunsetDate). TODO Phase C-1.1: emit
      // Deprecation/Sunset/Warning headers on every response from a legacy
      // caller — currently only this comment carries the contract.
      const writeVerbs = new Set(["POST", "PUT", "DELETE", "PATCH"]);
      const isWrite = writeVerbs.has(req.method);
      const requiredVerb: "read" | "write" = isWrite ? "write" : "read";
      if (
        !auth.isLegacy &&
        !scopeAllowsResource(auth.scopes, resourceType, requiredVerb)
      ) {
        await logTEFCAAccess(
          supabase,
          context,
          [resourceType],
          0,
          false,
          `scope does not authorize ${requiredVerb} on ${resourceType}`,
          Date.now() - startTime,
        );
        return new Response(
          JSON.stringify(
            createOperationOutcome(
              "error",
              "forbidden",
              `Access token scope does not authorize ${requiredVerb} on ${resourceType}`,
            ),
          ),
          {
            status: 403,
            headers: {
              ...fhirJsonHeaders,
              "WWW-Authenticate": `Bearer realm="tefca-ias", error="insufficient_scope", scope="system/${resourceType}.${requiredVerb}"`,
            },
          },
        );
      }

      // Phase H: write paths (POST / PUT / DELETE) land in the
      // validator-gated fhir_resources passthrough store.
      if (req.method === "POST" && !resourceId) {
        const writeCaller = {
          clientId: context.requestingOrganization,
          qhinId: context.qhinId,
          scopes: auth.scopes,
        };
        return await handleCreate(
          supabase,
          req,
          baseUrl,
          resourceType,
          writeCaller,
          context,
          startTime,
        );
      }
      if (req.method === "PUT" && resourceId) {
        const writeCaller = {
          clientId: context.requestingOrganization,
          qhinId: context.qhinId,
          scopes: auth.scopes,
        };
        return await handleUpdate(
          supabase,
          req,
          baseUrl,
          resourceType,
          resourceId,
          writeCaller,
          context,
          startTime,
        );
      }
      if (req.method === "DELETE" && resourceId) {
        return await handleDelete(
          supabase,
          resourceType,
          resourceId,
          context,
          startTime,
        );
      }

      // Patient/$match (TEFCA Patient Discovery) — POST with FHIR Parameters
      if (resourceType === "Patient" && resourceId === "$match") {
        return await handlePatientMatch(
          supabase,
          req,
          baseUrl,
          context,
          startTime,
        );
      }

      // _history-instance and vread — generic across any registry resource that
      // advertises the interaction.
      if (resourceId && fhirPath[2] === "_history") {
        const cfg = getResourceConfig(resourceType);
        if (!cfg) {
          await logTEFCAAccess(
            supabase,
            context,
            [resourceType],
            0,
            false,
            "Unsupported resource type for history",
            Date.now() - startTime,
          );
          return errorResponse(
            "error",
            "not-supported",
            `Resource type ${resourceType} is not supported`,
            400,
          );
        }
        const versionId = fhirPath[3];
        if (versionId) {
          return await handleVread(
            supabase,
            cfg,
            resourceId,
            versionId,
            context,
            startTime,
          );
        }
        return await handleResourceHistory(
          supabase,
          cfg,
          resourceId,
          baseUrl,
          context,
          startTime,
        );
      }

      // Patient: read by id, $everything, search
      if (resourceType === "Patient") {
        // /Patient/{id}/$everything
        const everythingMatch = url.pathname.match(
          /Patient\/([^/]+)\/\$everything/,
        );
        if (everythingMatch) {
          return await handlePatientEverything(
            supabase,
            everythingMatch[1],
            context,
            startTime,
          );
        }

        if (resourceId && resourceId !== "$everything") {
          return await handlePatientRead(
            supabase,
            resourceId,
            context,
            startTime,
          );
        }

        if (resourceId === "$everything") {
          const everythingPatientId = url.searchParams
            .get("patient")
            ?.replace("Patient/", "");
          if (!everythingPatientId) {
            await logTEFCAAccess(
              supabase,
              context,
              ["$everything"],
              0,
              false,
              "Missing patient ID",
              Date.now() - startTime,
            );
            return errorResponse(
              "error",
              "required",
              "Patient ID is required for $everything operation",
              400,
            );
          }
          return await handlePatientEverything(
            supabase,
            everythingPatientId,
            context,
            startTime,
          );
        }

        return await handlePatientSearch(
          supabase,
          url,
          baseUrl,
          context,
          startTime,
        );
      }

      if (resourceType === "Observation") {
        return await handleObservationSearch(
          supabase,
          url,
          baseUrl,
          context,
          startTime,
        );
      }

      if (resourceType === "DiagnosticReport") {
        return await handleDiagnosticReportSearch(
          supabase,
          url,
          baseUrl,
          context,
          startTime,
        );
      }

      // Registry-driven generic dispatch for the remaining 11 resources
      const config = getResourceConfig(resourceType);
      if (config && !config.customHandler) {
        return await handleGenericPatientScoped(
          supabase,
          url,
          baseUrl,
          context,
          startTime,
          config,
        );
      }

      await logTEFCAAccess(
        supabase,
        context,
        [resourceType],
        0,
        false,
        "Unsupported resource type",
        Date.now() - startTime,
      );
      return errorResponse(
        "error",
        "not-supported",
        `Resource type ${resourceType} is not supported`,
        400,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await logTEFCAAccess(
        supabase,
        context,
        [],
        0,
        false,
        message,
        Date.now() - startTime,
      );
      return new Response(
        JSON.stringify(createOperationOutcome("fatal", "exception", message)),
        { status: 500, headers: fhirJsonHeaders },
      );
    }
  })();

  if (deprecationHeaders) {
    for (const [k, v] of Object.entries(deprecationHeaders)) {
      dispatchResp.headers.set(k, v);
    }
  }

  // Phase D-1: SOFT-WARNING US Core 7.0 validation. We never replace the
  // response body — even on validation failures we serve the original — but
  // we tag the response and append a compact issue summary to the most
  // recent tefca_access_logs row so mapper regressions are observable.
  try {
    const validation = await validateResponseClone(dispatchResp);
    if (validation && !validation.allValid) {
      dispatchResp.headers.set(
        "X-mBHR-Validation",
        `failed; ${validation.count} resources, see tefca_access_logs`,
      );
      // Best-effort tagging on the latest log row for this request — we
      // logged 'success' inside the dispatch already. Update the most-recent
      // row for this client+timestamp window with the validation summary.
      // No await because failures here must not affect the response.
      void supabase
        .from("tefca_access_logs")
        .update({
          error_message: `validation_warning: ${validation.errorMessage ?? "issues present"}`,
        })
        .match({
          qhin_id: context.qhinId,
          requesting_organization: context.requestingOrganization,
          success: true,
        })
        .order("created_at", { ascending: false })
        .limit(1);
    } else if (validation) {
      dispatchResp.headers.set(
        "X-mBHR-Validation",
        `passed; ${validation.count} resources`,
      );
    }
  } catch {
    // Validation must never break the response. Failures here are
    // diagnostic-only and we'd rather miss a warning than surface a 500.
  }

  return dispatchResp;
});
