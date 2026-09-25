// FHIR errors. Every failure the gateway reports is an OperationOutcome with
// an HTTP status; diagnostics are fixed, caller-safe sentences. Nothing from
// the database (SQL, table or policy names, other ids) or from a thrown
// exception ever reaches a diagnostics string: unexpected errors become a
// generic "exception" outcome and the detail stays in the server log, keyed
// by the request id.

import type { OperationOutcome, OperationOutcomeIssue } from "../types/fhir";

/** Issue codes from http://hl7.org/fhir/issue-type (R4) that this module uses. */
export type IssueCode =
  | "invalid"
  | "structure"
  | "required"
  | "value"
  | "security"
  | "login"
  | "forbidden"
  | "not-supported"
  | "not-found"
  | "too-costly"
  | "throttled"
  | "exception"
  | "processing";

export class FhirError extends Error {
  readonly status: number;
  readonly code: IssueCode;
  /** Extra response headers (e.g. Retry-After, WWW-Authenticate). */
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: IssueCode,
    diagnostics: string,
    headers: Record<string, string> = {},
  ) {
    super(diagnostics);
    this.name = "FhirError";
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export const errors = {
  badRequest: (d: string) => new FhirError(400, "invalid", d),
  unauthenticated: (d = "Authentication is required.") =>
    new FhirError(401, "login", d, { "WWW-Authenticate": 'Bearer realm="mBHR FHIR"' }),
  forbidden: (d = "The requested resource is not available to this client.") =>
    new FhirError(403, "forbidden", d),
  notFound: (d = "The requested resource was not found.") => new FhirError(404, "not-found", d),
  methodNotAllowed: () =>
    new FhirError(405, "not-supported", "Only read and search interactions are supported.", {
      Allow: "GET",
    }),
  notSupported: (d: string) => new FhirError(400, "not-supported", d),
  tooMany: (retryAfterSeconds: number) =>
    new FhirError(429, "throttled", "Too many requests. Try again later.", {
      "Retry-After": String(Math.max(1, Math.floor(retryAfterSeconds))),
    }),
  unavailable: (d = "The service is temporarily unavailable.") =>
    new FhirError(503, "exception", d),
  internal: () => new FhirError(500, "exception", "The server could not complete the request."),
};

export function operationOutcome(
  code: IssueCode,
  diagnostics: string,
  severity: OperationOutcomeIssue["severity"] = "error",
): OperationOutcome {
  return { resourceType: "OperationOutcome", issue: [{ severity, code, diagnostics }] };
}

/** Anything thrown becomes a FhirError; unknown errors become a generic 500. */
export function toFhirError(err: unknown): FhirError {
  return err instanceof FhirError ? err : errors.internal();
}
