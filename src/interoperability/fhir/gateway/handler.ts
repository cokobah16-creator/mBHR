// The /fhir/R4 gateway, independent of where it is hosted: a function from a
// Web Request to a Web Response. api/fhir.ts adapts it to a Vercel function.
//
//   request -> flags -> routeRequest (the single routing guard)
//           -> authenticate -> load actor (+ rate limits)
//           -> parse the search, resolve the named patient (identity only)
//           -> authorizeFhirRequest (the single access decision)
//           -> resource module: read as the caller, under row-level security
//           -> ownership check -> validate -> audit -> respond
//
// No clinical row is read before the access decision, nothing is returned
// before the audit record is written, and every failure is an
// OperationOutcome with a fixed, caller-safe message. Every response carries
// Cache-Control: private, no-store.

import { readFhirConfig, flagsHeader, FhirConfigError, type Env, type FhirConfig } from "../config/config";
import { errors, FhirError, operationOutcome, toFhirError } from "../errors/operationOutcome";
import { FHIR_JSON, type OperationOutcomeIssue, type Resource } from "../types/fhir";
import { capabilityStatement } from "../capability/capabilityStatement";
import { MODULES } from "../resources/registry";
import { PATIENT_PARAMS, type AccessScope, type QueryCtx, type QueryResult } from "../resources/module";
import { assertNarrowed } from "../resources/shared";
import { cursorBinding, parseSearch, RESULT_PARAMS, type ParsedSearch } from "../search/params";
import { searchsetBundle } from "../search/bundle";
import { validateResource } from "../validation/validate";
import { authorizeFhirRequest, type Actor, type FhirAuthorizationDecision } from "../authorization/authorize";
import { parsePurposeOfUse } from "../consent/policy";
import { parseDirectives } from "../consent/evaluateConsent";
import { hashIp, logLine, recordAccess, type AuditRecord } from "../audit/audit";
import { resolvePatients, resolvePatientSearch, type PatientSearchContext } from "../patients/canonical";
import { authenticate, bearerToken, loadActor } from "./auth";
import { routeRequest, type Route } from "./guard";
import { Postgrest, type FetchLike } from "./postgrest";
import { SupabaseStorage } from "./storage";

export { fhirPath } from "./guard";

export interface GatewayDeps {
  env: Env;
  fetchImpl?: FetchLike;
  now?: () => Date;
  randomId?: () => string;
  log?: (line: string) => void;
}

/** Headers on every response. Patient data must never sit in a shared or browser cache. */
function baseHeaders(requestId: string): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  };
}

function respond(status: number, body: unknown, headers: Record<string, string>, requestId: string): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": `${FHIR_JSON}; charset=utf-8`,
      ...baseHeaders(requestId),
      ...headers,
    },
  });
}

function errorResponse(e: FhirError, requestId: string): Response {
  return respond(e.status, operationOutcome(e.code, e.message), e.headers, requestId);
}

/** Audit denial reason for a failure after the caller is known. */
function failureReason(e: FhirError): string {
  switch (e.status) {
    case 400:
    case 406:
    case 414:
      return "invalid_request";
    case 401:
      return "unauthenticated";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 429:
      return "rate_limited";
    case 500:
      return "server_error";
    default:
      return "unavailable";
  }
}

/** A short digest of the resource as served: meta.versionId and the ETag. */
async function contentVersion(resource: Resource): Promise<string> {
  const { meta, ...rest } = resource;
  const { versionId: _ignored, ...metaRest } = meta ?? {};
  const text = JSON.stringify({ ...rest, meta: metaRest });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((t) => t.trim())
    .some((t) => t === "*" || t === etag || t === etag.slice(2));
}

/** The caller's scope, as a stable string for cursor binding. */
function scopeKey(actor: Actor): string {
  return [actor.kind, actor.role ?? "", [...actor.patientIds].sort().join(",")].join("|");
}

/** Binary's securityContext as the X-Security-Context header (FHIR RESTful API, Binary). */
function securityContextHeader(resource: Resource): Record<string, string> {
  const ctx = (resource as { securityContext?: { reference?: unknown } }).securityContext;
  return typeof ctx?.reference === "string" ? { "X-Security-Context": ctx.reference } : {};
}

export async function handleFhirRequest(request: Request, deps: GatewayDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const requestId = deps.randomId?.() ?? crypto.randomUUID();
  const log = deps.log ?? ((line: string) => console.log(line));
  const fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const started = now().getTime();

  let config: FhirConfig;
  try {
    config = readFhirConfig(deps.env);
  } catch (e) {
    // Misconfigured while enabled: fail closed, say nothing about why.
    logLine(log, { requestId, status: 503, outcome: e instanceof FhirConfigError ? "config_invalid" : "config_error" });
    return errorResponse(errors.unavailable(), requestId);
  }
  if (!config.enabled) {
    return errorResponse(errors.notFound("The FHIR interface is not enabled."), requestId);
  }

  let resourceTypeForLog: string | undefined;
  // Set once the caller is known: failures from then on are audited too.
  let auditFailure: ((e: FhirError) => Promise<void>) | null = null;
  try {
    const route: Route = routeRequest(request, config);
    const baseUrl = config.baseUrl as string;

    if (route.kind === "metadata") {
      return respond(
        200,
        capabilityStatement(baseUrl, undefined, {
          patientAccessEnabled: config.patientAccessEnabled,
          readEnabled: config.readEnabled,
        }),
        { "X-MBHR-FHIR-Flags": flagsHeader(config) },
        requestId,
      );
    }
    const type = route.type;
    resourceTypeForLog = type;
    const module = MODULES[type];
    const def = module.definition;

    // Authentication: a Supabase session for this project.
    const token = bearerToken(request.headers.get("authorization"));
    if (!token) throw errors.unauthenticated();
    const userId = await authenticate(token, {
      supabaseUrl: config.supabaseUrl as string,
      anonKey: config.supabaseAnonKey as string,
      fetchImpl,
      nowMs: now().getTime(),
    });
    const connection = {
      supabaseUrl: config.supabaseUrl as string,
      anonKey: config.supabaseAnonKey as string,
      accessToken: token,
      fetchImpl,
    };
    const db = new Postgrest(connection);

    // Who the caller is to mBHR, and the rate limits (a stricter one for
    // searches on sensitive types and for document downloads).
    const sensitive = (route.kind === "search" && def.sensitiveSearch) || type === "Binary";
    const loaded = await loadActor(db, userId, {
      perMinute: config.rateLimitPerMinute,
      sensitivePerMinute: config.sensitiveRateLimitPerMinute,
      sensitive,
    });
    const actor = loaded.actor;

    const interaction = route.kind;
    const resourceId = route.kind === "read" ? route.id : null;
    const query = route.query;
    const purpose = parsePurposeOfUse(
      request.headers.get("x-purpose-of-use"),
      actor.kind === "patient" ? "PATRQT" : "TREAT",
    );
    const audit: Omit<
      AuditRecord,
      | "decision"
      | "denialReason"
      | "resultCount"
      | "patientIds"
      | "httpStatus"
      | "consentDecision"
      | "consentId"
      | "provisionId"
      | "restrictions"
    > = {
      requestId,
      interaction,
      resourceType: type,
      resourceId,
      purpose: purpose ?? "invalid",
      // Parameter names only, never values. A name the type does not
      // support is recorded as "unsupported": names are client text too.
      searchParams: [
        ...new Set(
          [...query.keys()].map((k) =>
            RESULT_PARAMS.has(k) || def.searchParams.some((d) => d.name === k) ? k : "unsupported",
          ),
        ),
      ].sort(),
      userAgent: request.headers.get("user-agent"),
      ipHash: await hashIp(
        (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
        config.auditIpSecret,
      ),
      actorKind: actor.kind,
    };
    let decision: FhirAuthorizationDecision | null = null;
    let requestedPatientIds: string[] = [];
    auditFailure = async (e: FhirError) => {
      await recordAccess(db, {
        ...audit,
        decision: "deny",
        denialReason: failureReason(e),
        resultCount: 0,
        patientIds: requestedPatientIds,
        httpStatus: e.status,
        consentDecision: decision?.consent?.decision ?? null,
        consentId: decision?.consent?.consentId ?? null,
        provisionId: decision?.consent?.provisionId ?? null,
        restrictions: decision?.restrictions ?? [],
      });
    };

    if (loaded.retryAfter !== null) throw errors.tooMany(loaded.retryAfter);

    // The search, bound to this caller and scope, and the patient it names
    // (resolved server-side; a patient id in the URL never grants access).
    let search: ParsedSearch | null = null;
    let patients: PatientSearchContext | undefined;
    let binding = "";
    let namedPatients: string[] | null | undefined;
    // A malformed search is reported only after the access decision, so a
    // caller who may not read the type learns nothing about its parameters.
    let searchError: unknown = null;
    if (route.kind === "search") {
      binding = await cursorBinding({ resourceType: type, query, userId, scope: scopeKey(actor) });
      try {
        search = parseSearch(query, def.searchParams, {
          defaultCount: config.defaultPageSize,
          maxCount: config.maxPageSize,
          cursorBinding: binding,
        });
      } catch (e) {
        searchError = e;
      }
      if (search) {
        const params = PATIENT_PARAMS.filter((p) => def.searchParams.some((d) => d.name === p));
        try {
          patients = await resolvePatientSearch(db, search, params);
        } catch (e) {
          // A patient reference that is not a Patient/[id] is a bad request.
          searchError = e;
          search = null;
        }
      }
      if (patients) {
        requestedPatientIds = patients.requested;
        namedPatients = patients.requested.length ? patients.requested : null;
      }
    } else if (type === "Patient" && actor.kind === "patient") {
      // A patient reading a Patient names that patient: it must be their own.
      const [res] = await resolvePatients(db, { fhirIds: [route.id] });
      namedPatients = res ? [res.id] : null;
      if (res) requestedPatientIds = [res.id];
    }

    decision = await authorizeFhirRequest(
      {
        actor,
        client: null,
        interaction,
        resourceType: type,
        resourceId,
        patientIds: namedPatients,
        requestedScopes: [],
        purposeOfUse: purpose,
        dataClass: def.consentClass,
      },
      {
        config,
        now: now(),
        loadDirectives: async (ids) =>
          parseDirectives(
            await db.rpc<unknown>("fhir_consent_directives", {
              p_patient_ids: ids,
              p_consent_ids: null,
              p_after: null,
              p_limit: 100,
            }),
          ),
      },
    );
    if (!decision.allowed) {
      const denied = decision;
      auditFailure = null;
      // A refusal is returned even when it cannot be recorded (no data leaves).
      await recordAccess(db, {
        ...audit,
        decision: "deny",
        denialReason: denied.reason,
        resultCount: 0,
        patientIds: requestedPatientIds,
        httpStatus: denied.status,
        consentDecision: denied.consent?.decision ?? null,
        consentId: denied.consent?.consentId ?? null,
        provisionId: denied.consent?.provisionId ?? null,
        restrictions: denied.restrictions,
      }).catch(() => logLine(log, { requestId, status: denied.status, outcome: "audit_failed_on_error", resourceType: type }));
      if (denied.status === 401) throw errors.unauthenticated();
      if (denied.status === 404) throw errors.notFound("Read and search are not enabled.");
      throw errors.forbidden();
    }
    const allowed = decision;
    if (searchError) throw searchError;

    // Staff searches must name a specific record (anti-enumeration).
    if (search && actor.kind === "staff") {
      try {
        assertNarrowed(def, search);
      } catch (e) {
        auditFailure = null;
        await recordAccess(db, {
          ...audit,
          decision: "deny",
          denialReason: "search_not_narrowed",
          resultCount: 0,
          patientIds: requestedPatientIds,
          httpStatus: 403,
          consentDecision: allowed.consent?.decision ?? null,
          consentId: allowed.consent?.consentId ?? null,
          provisionId: allowed.consent?.provisionId ?? null,
          restrictions: allowed.restrictions,
        }).catch(() => logLine(log, { requestId, status: 403, outcome: "audit_failed_on_error", resourceType: type }));
        throw e;
      }
    }

    const scope: AccessScope =
      actor.kind === "patient" ? { kind: "patient", patientIds: actor.patientIds } : { kind: "staff", patientIds: null };
    const ctx: QueryCtx = {
      db,
      scope,
      permissions: actor.permissions,
      restrictions: new Set(allowed.restrictions),
      baseUrl,
      cursorBinding: binding,
      storage: new SupabaseStorage(connection),
      patients,
    };

    let result: QueryResult;
    if (route.kind === "read") {
      result = await module.read(ctx, route.id);
      if (result.page.resources.length > 1) {
        logLine(log, { requestId, status: 500, outcome: "read_returned_many", resourceType: type });
        throw errors.internal();
      }
    } else {
      if (!module.search) throw errors.notSupported(`${type} is read by id only.`);
      result = await module.search(ctx, search as ParsedSearch);
    }
    // A resource's id is exactly the id asked for (FHIR read): a lookup
    // that matched another spelling of it (an upper-case uuid) found nothing.
    const askedIds = route.kind === "read" ? [route.id] : route.query.getAll("_id").flatMap((v) => v.split(","));
    if (askedIds.length) {
      const keep = result.page.resources.map((r) => askedIds.includes(String(r.id)));
      if (keep.includes(false)) {
        result = {
          ...result,
          page: { ...result.page, resources: result.page.resources.filter((_, i) => keep[i]) },
          owners: result.owners.filter((_, i) => keep[i]),
        };
      }
    }
    if (result.requestedPatientIds?.length) {
      requestedPatientIds = [...new Set([...requestedPatientIds, ...result.requestedPatientIds])];
    }

    // Ownership: every resource must belong to a patient the caller may see
    // (patients: their own records; any search naming a patient: that
    // patient). A mismatch is a server fault and releases nothing.
    const resources = result.page.resources;
    if (result.owners.length !== resources.length) {
      logLine(log, { requestId, status: 500, outcome: "owners_mismatch", resourceType: type });
      throw errors.internal();
    }
    const named = patients?.ids ?? null;
    for (const owner of result.owners) {
      const outsideSelf = actor.kind === "patient" && (owner === null || !actor.patientIds.has(owner));
      const outsideNamed = named !== null && owner !== null && !named.includes(owner);
      if (outsideSelf || outsideNamed) {
        logLine(log, { requestId, status: 500, outcome: "scope_violation", resourceType: type });
        throw errors.internal();
      }
    }

    // Validate before release. A read fails closed; a search leaves the
    // record out and says so.
    const released: Resource[] = [];
    const releasedOwners: (string | null)[] = [];
    let withheld = 0;
    for (let i = 0; i < resources.length; i++) {
      const issues = validateResource(resources[i], module.validate?.bind(module));
      if (issues.length) {
        withheld++;
        continue;
      }
      released.push(resources[i]);
      releasedOwners.push(result.owners[i]);
    }
    if (withheld) {
      logLine(log, { requestId, status: route.kind === "read" ? 500 : 200, outcome: `invalid_resource:${withheld}`, resourceType: type });
      if (route.kind === "read") throw errors.internal();
    }
    for (const r of released) r.meta = { ...r.meta, versionId: await contentVersion(r) };

    // Audit before release. A patient's permit names their own records: the
    // ones returned or named, or (nothing matched) the records the query
    // was confined to.
    let auditIds = [
      ...new Set([...releasedOwners.filter((o): o is string => o !== null), ...requestedPatientIds]),
    ];
    if (actor.kind === "patient" && !auditIds.length) auditIds = [...actor.patientIds];
    // The access record holds at most 100 patients; a response naming more
    // would be served partly unaudited, so it is refused instead.
    if (auditIds.length > 100) {
      logLine(log, { requestId, status: 500, outcome: "audit_patients_over_limit", resourceType: type });
      throw errors.internal();
    }
    const found = route.kind === "search" || released.length > 0;
    auditFailure = null;
    try {
      await recordAccess(db, {
        ...audit,
        decision: "permit",
        denialReason: null,
        resultCount: released.length,
        patientIds: auditIds,
        httpStatus: found ? 200 : 404,
        consentDecision: allowed.consent?.decision ?? null,
        consentId: allowed.consent?.consentId ?? null,
        provisionId: allowed.consent?.provisionId ?? null,
        restrictions: allowed.restrictions,
      });
    } catch {
      logLine(log, { requestId, status: 503, outcome: "audit_failed", resourceType: type });
      throw errors.unavailable();
    }

    if (route.kind === "read") {
      const resource = released[0];
      if (!resource) throw errors.notFound();
      if (type === "Binary") {
        const file = result.binary;
        if (!file) {
          logLine(log, { requestId, status: 500, outcome: "binary_missing", resourceType: type });
          throw errors.internal();
        }
        logLine(log, { requestId, status: 200, outcome: "read", resourceType: type, ms: now().getTime() - started });
        return new Response(file.body, {
          status: 200,
          headers: {
            "Content-Type": file.contentType,
            "Content-Disposition": `attachment; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "document"}"`,
            "Content-Security-Policy": "default-src 'none'; sandbox",
            ...securityContextHeader(resource),
            ...baseHeaders(requestId),
          },
        });
      }
      const etag = `W/"${resource.meta?.versionId}"`;
      const headers: Record<string, string> = { ETag: etag };
      if (resource.meta?.lastUpdated) headers["Last-Modified"] = new Date(resource.meta.lastUpdated).toUTCString();
      logLine(log, { requestId, status: 200, outcome: "read", resourceType: type, ms: now().getTime() - started });
      if (etagMatches(request.headers.get("if-none-match"), etag)) return respond(304, null, headers, requestId);
      return respond(200, resource, headers, requestId);
    }

    const outcomes: OperationOutcomeIssue[] = [...(result.outcomes ?? [])];
    if (withheld) {
      outcomes.push({
        severity: "warning",
        code: "processing",
        diagnostics: `${withheld} matching record(s) were left out because they could not be shown as valid FHIR. Quote the X-Request-Id header when reporting this.`,
      });
    }
    const bundle = searchsetBundle({
      baseUrl,
      resourceType: type,
      query,
      count: (search as ParsedSearch).count,
      page: { resources: released, next: result.page.next },
      now: now(),
      cursorBinding: binding,
      outcomes,
      newId: deps.randomId,
    });
    logLine(log, { requestId, status: 200, outcome: "search", resourceType: type, ms: now().getTime() - started });
    return respond(200, bundle, {}, requestId);
  } catch (err) {
    const e = toFhirError(err);
    if (!(err instanceof FhirError)) {
      // Unexpected: keep only the error class, never its message (it may
      // contain data).
      logLine(log, { requestId, status: 500, outcome: `unexpected:${(err as Error)?.name ?? "unknown"}`, resourceType: resourceTypeForLog });
    } else {
      logLine(log, { requestId, status: e.status, outcome: e.code, resourceType: resourceTypeForLog });
    }
    if (auditFailure) {
      // Best effort: the refusal is still returned if it cannot be recorded.
      try {
        await auditFailure(e);
      } catch {
        logLine(log, { requestId, status: e.status, outcome: "audit_failed_on_error", resourceType: resourceTypeForLog });
      }
    }
    return errorResponse(e, requestId);
  }
}
