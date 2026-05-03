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

import { logTEFCAAccess, verifyPatientConsent } from "./audit.ts";
import { createCapabilityStatement } from "./capability.ts";
import {
  mapDiagnosticReportToFHIR,
  mapPatientToFHIR,
  mapSDOHToFHIR,
  mapVitalsToFHIR,
} from "./mappers.ts";
import { getResourceConfig, type ResourceConfig } from "./registry.ts";
import {
  corsHeaders,
  createBundle,
  createOperationOutcome,
  errorResponse,
  fhirJsonHeaders,
  fhirJsonResponse,
  type ExchangePurpose,
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

  const resources = (data || []).map((row: Record<string, unknown>) =>
    config.mapper(row, patientName),
  );
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

  for (const cfg of (await import("./registry.ts")).RESOURCE_REGISTRY) {
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
  return fhirJsonResponse(createBundle(observations, `${baseUrl}/Observation`));
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
  return fhirJsonResponse(createBundle(reports, `${baseUrl}/DiagnosticReport`));
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
});
