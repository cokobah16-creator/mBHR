// The /fhir/R4 gateway, independent of where it is hosted: a function from a
// Web Request to a Web Response. api/fhir.ts adapts it to a Vercel function.
//
//   request -> flags -> route -> authenticate -> load actor (+ rate limit)
//           -> canAccessFHIRResource -> retrieve (as the caller, under RLS)
//           -> map -> validate -> audit -> respond
//
// Nothing clinical is read before the access decision, nothing is returned
// before the audit record is written, and every failure is an
// OperationOutcome with a fixed, caller-safe message.

import { readFhirConfig, FhirConfigError, type Env, type FhirConfig } from "../config/config";
import { errors, FhirError, operationOutcome, toFhirError } from "../errors/operationOutcome";
import { FHIR_JSON, type Resource } from "../types/fhir";
import { capabilityStatement } from "../capability/capabilityStatement";
import { isPublishedType, RESOURCE_DEFINITIONS } from "../mappers/registry";
import { FHIR_ID, parseSearch, RESULT_PARAMS } from "../search/params";
import { searchsetBundle } from "../search/bundle";
import { validateResource } from "../validation/validate";
import { canAccessFHIRResource } from "../authorization/policy";
import { parsePurposeOfUse } from "../consent/policy";
import { hashIp, logLine, recordAccess, type AuditRecord } from "../audit/audit";
import { authenticate, bearerToken, loadActor } from "./auth";
import { Postgrest, type FetchLike } from "./postgrest";
import { READERS, SEARCHERS, type QueryResult } from "./queries";

export interface GatewayDeps {
  env: Env;
  fetchImpl?: FetchLike;
  now?: () => Date;
  randomId?: () => string;
  log?: (line: string) => void;
}

const MAX_URL_LENGTH = 4096;
const PREFIX = "/fhir/R4";

function respond(status: number, body: unknown, headers: Record<string, string>, requestId: string): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": `${FHIR_JSON}; charset=utf-8`,
      // Patient data must never sit in a shared or browser cache.
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
      ...headers,
    },
  });
}

function errorResponse(e: FhirError, requestId: string): Response {
  return respond(e.status, operationOutcome(e.code, e.message), e.headers, requestId);
}

/** The FHIR path segments after /fhir/R4, from the original or rewritten URL. */
export function fhirPath(url: URL): string[] {
  const rewritten = url.searchParams.get("__fhir_path");
  let path: string;
  if (rewritten !== null) path = rewritten;
  else if (url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`)) path = url.pathname.slice(PREFIX.length);
  else path = "";
  return path.split("/").filter(Boolean);
}

/** The client's query, minus the rewrite's own parameter. */
function clientQuery(url: URL): URLSearchParams {
  const q = new URLSearchParams(url.search);
  q.delete("__fhir_path");
  return q;
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
  try {
    if (request.url.length > MAX_URL_LENGTH) throw new FhirError(414, "too-costly", "The request URL is too long.");
    if (request.method !== "GET") throw errors.methodNotAllowed();
    const len = request.headers.get("content-length");
    if ((len && len !== "0") || request.headers.get("transfer-encoding")) {
      throw errors.badRequest("A read or search request has no body.");
    }

    const url = new URL(request.url);
    const segments = fhirPath(url);
    const query = clientQuery(url);
    const baseUrl = config.baseUrl as string;

    if (segments.length === 1 && segments[0] === "metadata") {
      return respond(200, capabilityStatement(baseUrl), { "Cache-Control": "no-cache" }, requestId);
    }
    if (segments.length === 0) throw errors.notSupported("Whole-system search is not supported.");
    if (segments.length > 2) throw errors.notSupported("Only read and search interactions are supported.");
    const [type, id] = segments;
    if (!isPublishedType(type)) {
      throw new FhirError(404, "not-supported", "This resource type is not available.");
    }
    resourceTypeForLog = type;
    if (id !== undefined) {
      // $operations and _history/_search are not supported; anything else
      // that is not a FHIR id cannot name a record (checked before any
      // database call, and keeps audit rows within their bounds).
      if (id.startsWith("$") || id.startsWith("_")) throw errors.notSupported("Only read and search interactions are supported.");
      if (!FHIR_ID.test(id)) throw errors.badRequest("The resource id is not valid.");
    }
    if (id !== undefined && query.toString() !== "" && [...query.keys()].some((k) => k !== "_format")) {
      throw errors.badRequest("A read takes no search parameters.");
    }

    // 1-2. Authentication.
    const token = bearerToken(request.headers.get("authorization"));
    if (!token) throw errors.unauthenticated();
    const userId = await authenticate(token, {
      supabaseUrl: config.supabaseUrl as string,
      anonKey: config.supabaseAnonKey as string,
      fetchImpl,
      nowMs: now().getTime(),
    });
    const db = new Postgrest({
      supabaseUrl: config.supabaseUrl as string,
      anonKey: config.supabaseAnonKey as string,
      accessToken: token,
      fetchImpl,
    });

    // Role, permissions and rate limit, from the database for this account.
    const actor = await loadActor(db, userId, config.rateLimitPerMinute);

    const action = id === undefined ? "search" : "read";
    const rawPurpose = request.headers.get("x-purpose-of-use");
    const purpose = parsePurposeOfUse(rawPurpose);
    const audit: Omit<AuditRecord, "decision" | "denialReason" | "resultCount" | "patientIds"> = {
      requestId,
      action,
      resourceType: type,
      resourceId: id ?? null,
      purpose: purpose ?? "invalid",
      // Parameter names only, never values. A name the type does not
      // support is recorded as "unsupported": names are client text too.
      searchParams: [
        ...new Set(
          [...query.keys()].map((k) =>
            RESULT_PARAMS.has(k) || RESOURCE_DEFINITIONS[type].searchParams.some((d) => d.name === k) ? k : "unsupported",
          ),
        ),
      ].sort(),
      userAgent: request.headers.get("user-agent"),
      ipHash: await hashIp(
        (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
        config.auditIpSecret,
      ),
    };

    // 3-10. The access decision.
    const decision = purpose
      ? canAccessFHIRResource({ actor, action, resourceType: type, purposeOfUse: purpose })
      : ({ permit: false, status: 403, reason: "purpose_invalid" } as const);
    if (decision.permit === false) {
      await recordAccess(db, { ...audit, decision: "deny", denialReason: decision.reason, resultCount: 0, patientIds: [] });
      throw errors.forbidden();
    }

    // Retrieve and map, as the caller.
    let result: QueryResult<Resource>;
    let search = null;
    if (id !== undefined) {
      result = await READERS[type](db, id);
    } else {
      search = parseSearch(query, RESOURCE_DEFINITIONS[type].searchParams, {
        defaultCount: config.defaultPageSize,
        maxCount: config.maxPageSize,
      });
      result = await SEARCHERS[type](db, search);
    }

    for (const resource of result.page.resources) {
      const issues = validateResource(resource);
      if (issues.length) {
        logLine(log, { requestId, status: 500, outcome: "invalid_resource", resourceType: type });
        throw errors.internal();
      }
    }

    // Audit before release.
    try {
      await recordAccess(db, {
        ...audit,
        decision: "permit",
        denialReason: null,
        resultCount: result.page.resources.length,
        patientIds: result.patientIds,
      });
    } catch {
      logLine(log, { requestId, status: 503, outcome: "audit_failed", resourceType: type });
      throw errors.unavailable();
    }

    if (id !== undefined) {
      const resource = result.page.resources[0];
      if (!resource) throw errors.notFound();
      const version = resource.meta?.versionId ?? "0";
      const etag = `W/"${version}"`;
      const headers: Record<string, string> = { ETag: etag };
      if (resource.meta?.lastUpdated) headers["Last-Modified"] = new Date(resource.meta.lastUpdated).toUTCString();
      logLine(log, { requestId, status: 200, outcome: "read", resourceType: type, ms: now().getTime() - started });
      if (request.headers.get("if-none-match") === etag) return respond(304, null, headers, requestId);
      return respond(200, resource, headers, requestId);
    }

    const bundle = searchsetBundle({
      baseUrl,
      resourceType: type,
      query,
      count: search!.count,
      page: result.page,
      now: now(),
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
    return errorResponse(e, requestId);
  }
}
