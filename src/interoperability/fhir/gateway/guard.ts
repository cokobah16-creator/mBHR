// The single routing guard: every request passes through routeRequest()
// before anything else happens (no database call, no token check). It
// decides what kind of request this is and refuses everything the gateway
// does not do, always with a FHIR OperationOutcome:
//
//   414  URL too long
//   405  any method but GET (writes are disabled; FHIR_WRITE_ENABLED is refused)
//   400  a body on a GET, a malformed id, parameters on a read
//   406  an Accept header or _format that is not FHIR JSON
//   404  a resource type that is not published, or reads switched off
//
// The flags themselves were validated by readFhirConfig(); an unknown path
// under /fhir/R4 never falls through to the web app.

import type { FhirConfig } from "../config/config";
import { errors, FhirError } from "../errors/operationOutcome";
import { isPublishedType } from "../resources/registry";
import type { FhirResourceType } from "../authorization/permissions";
import { FHIR_ID } from "../search/params";

export type Route =
  | { kind: "metadata" }
  | { kind: "read"; type: FhirResourceType; id: string; query: URLSearchParams }
  | { kind: "search"; type: FhirResourceType; query: URLSearchParams };

const MAX_URL_LENGTH = 4096;
const PREFIX = "/fhir/R4";
const JSON_FORMATS = ["json", "application/json", "application/fhir+json"];
const JSON_ACCEPT = ["*/*", "application/*", "application/json", "application/fhir+json"];

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
export function clientQuery(url: URL): URLSearchParams {
  const q = new URLSearchParams(url.search);
  q.delete("__fhir_path");
  return q;
}

/** Media types an Accept header lists (parameters and q-values dropped). */
function acceptedTypes(accept: string): string[] {
  return accept
    .split(",")
    .map((part) => part.split(";")[0].trim().toLowerCase())
    .filter(Boolean);
}

function acceptsJson(accept: string | null): boolean {
  if (accept === null || accept.trim() === "") return true;
  return acceptedTypes(accept).some((t) => JSON_ACCEPT.includes(t));
}

function checkFormat(query: URLSearchParams): void {
  const formats = query.getAll("_format");
  if (formats.length > 1) throw errors.badRequest("_format may appear only once.");
  if (formats.length && !JSON_FORMATS.includes(formats[0])) {
    throw new FhirError(406, "not-supported", "Only the FHIR JSON format is supported.");
  }
}

export function routeRequest(request: Request, config: FhirConfig): Route {
  if (request.url.length > MAX_URL_LENGTH) throw new FhirError(414, "too-costly", "The request URL is too long.");
  if (request.method !== "GET") throw errors.methodNotAllowed();
  const len = request.headers.get("content-length");
  if ((len && len !== "0") || request.headers.get("transfer-encoding")) {
    throw errors.badRequest("A read or search request has no body.");
  }

  const url = new URL(request.url);
  const segments = fhirPath(url);
  const query = clientQuery(url);
  const accept = request.headers.get("accept");
  const binary = segments[0] === "Binary";
  if (!binary && !acceptsJson(accept)) {
    throw new FhirError(406, "not-supported", "Only the FHIR JSON format (application/fhir+json) is supported.");
  }
  checkFormat(query);

  if (segments.length === 1 && segments[0] === "metadata") {
    if ([...query.keys()].some((k) => k !== "_format")) throw errors.badRequest("The capability statement takes no parameters.");
    return { kind: "metadata" };
  }
  if (!config.readEnabled) throw errors.notFound("Read and search are not enabled.");
  if (segments.length === 0) throw errors.notSupported("Whole-system search is not supported.");
  if (segments.length > 2) throw errors.notSupported("Only read and search interactions are supported.");
  const [type, id] = segments;
  if (!isPublishedType(type)) throw new FhirError(404, "not-supported", "This resource type is not available.");

  if (id === undefined) {
    if (type === "Binary") throw errors.notSupported("Documents are read by id only (Binary/[id]).");
    return { kind: "search", type, query };
  }
  // $operations and _history/_search are not supported; anything else that
  // is not a FHIR id cannot name a record (checked before any database call).
  if (id.startsWith("$") || id.startsWith("_")) throw errors.notSupported("Only read and search interactions are supported.");
  if (!FHIR_ID.test(id)) throw errors.badRequest("The resource id is not valid.");
  if ([...query.keys()].some((k) => k !== "_format")) throw errors.badRequest("A read takes no search parameters.");
  if (binary && accept !== null && accept.trim() !== "") {
    const types = acceptedTypes(accept);
    // Binary is served as the file itself; a client that accepts only the
    // FHIR JSON wrapper cannot be given it.
    if (types.every((t) => t === "application/fhir+json" || t === "application/json")) {
      throw new FhirError(406, "not-supported", "Documents are available as the file itself, not as FHIR JSON.");
    }
  }
  return { kind: "read", type, id, query };
}
