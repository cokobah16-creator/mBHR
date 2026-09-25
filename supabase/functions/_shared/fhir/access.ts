// Who a FHIR caller may reach, decided from the token alone.
//
// Pure functions (no Deno or npm imports) so they can be unit tested with
// vitest.
//
// Two kinds of access token reach the FHIR endpoints:
//
//   - System tokens (SMART Backend Services, `system/*` scopes) belong to a
//     registered partner organisation. They may reach any patient, but only
//     for treatment, payment or operations, and only where that patient has
//     an active data-sharing consent.
//   - Patient tokens (SMART auth-code flow, `patient/*` scopes) are issued to
//     a signed-in patient. They are bound to that patient (the token's
//     subject) and reach nothing else. Individual access is the only purpose
//     they carry, and the only way to use individual access.

export type ExchangePurposeLike =
  | "individual-access"
  | "treatment"
  | "payment"
  | "operations"
  | string;

/** True when any scope grants system-level (any-patient) access. */
export function hasSystemScope(scopes: string[]): boolean {
  return scopes.some((s) => s.startsWith("system/"));
}

/** True when any scope is a patient-level (`patient/...`) scope. */
export function hasPatientScope(scopes: string[]): boolean {
  return scopes.some((s) => s.startsWith("patient/"));
}

/**
 * The patient a token is bound to, or null for a system token.
 *
 * A token carrying patient scopes and no system scopes is bound to its
 * subject. Such a token with no subject is bound to nobody: it gets an empty
 * string, which matches no patient id, so it reaches nothing.
 */
export function boundPatientId(
  scopes: string[],
  subject: string | null | undefined,
): string | null {
  if (hasSystemScope(scopes)) return null;
  if (!hasPatientScope(scopes)) return null;
  return (subject ?? "").trim();
}

/**
 * Whether the caller may use this exchange purpose. Individual access is the
 * patient reading their own record, so it needs a patient-bound token; a
 * patient-bound token may use nothing else.
 */
export function purposeAllowedForCaller(
  purpose: ExchangePurposeLike,
  patientId: string | null,
): boolean {
  if (patientId !== null) return purpose === "individual-access";
  return purpose !== "individual-access";
}

/** Strip an optional "Patient/" prefix from a reference. */
export function patientRefToId(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const id = trimmed.startsWith("Patient/")
    ? trimmed.slice("Patient/".length)
    : trimmed;
  return id || null;
}

export type PatientGate =
  | { allow: true }
  | { allow: false; reason: string };

/**
 * Gate one tefca-ias request for a patient-bound caller. System callers are
 * not gated here (scope and consent checks still apply to them).
 *
 * `fhirPath` is the path after the function name, e.g. ["Patient", "p1",
 * "$everything"]; `params` are the query parameters.
 */
export function gatePatientBoundRequest(
  boundPatient: string | null,
  method: string,
  fhirPath: string[],
  params: URLSearchParams,
): PatientGate {
  if (boundPatient === null) return { allow: true };

  const [resourceType, resourceId, sub] = fhirPath;
  if (!resourceType || resourceType === "metadata") return { allow: true };

  if (method !== "GET") {
    return { allow: false, reason: "patient access tokens are read-only" };
  }
  if (!boundPatient) {
    return { allow: false, reason: "token is not linked to a patient" };
  }
  if (sub === "_history") {
    return {
      allow: false,
      reason: "history is not available to patient access tokens",
    };
  }

  const mine = (id: string | null) => id !== null && id === boundPatient;

  if (resourceType === "Patient") {
    if (resourceId === "$match") {
      return {
        allow: false,
        reason: "patient matching is not available to patient access tokens",
      };
    }
    if (resourceId === "$everything") {
      return mine(patientRefToId(params.get("patient")))
        ? { allow: true }
        : { allow: false, reason: "token does not grant this patient" };
    }
    if (resourceId) {
      return mine(resourceId)
        ? { allow: true }
        : { allow: false, reason: "token does not grant this patient" };
    }
    // Search: only allowed when it names this patient.
    const ids = [
      patientRefToId(params.get("_id")),
      patientRefToId(identifierValue(params.get("identifier"))),
    ].filter((v): v is string => v !== null);
    return ids.length > 0 && ids.every(mine)
      ? { allow: true }
      : { allow: false, reason: "token does not grant this patient" };
  }

  // Every other resource is read by ?patient= (or ?subject=).
  const refs = [params.get("patient"), params.get("subject")]
    .map(patientRefToId)
    .filter((v): v is string => v !== null);
  if (resourceId) {
    // Direct reads of non-patient resources by id aren't patient-filtered.
    return {
      allow: false,
      reason: "read this resource with ?patient= instead",
    };
  }
  return refs.length > 0 && refs.every(mine)
    ? { allow: true }
    : { allow: false, reason: "token does not grant this patient" };
}

/** The value part of a FHIR token search ("system|value" or "value"). */
export function identifierValue(raw: string | null): string | null {
  if (!raw) return null;
  const idx = raw.indexOf("|");
  return idx >= 0 ? raw.slice(idx + 1) : raw;
}

/**
 * Patient search by a partner must name someone: an id or identifier, or a
 * name together with a birth date. Returns a reason when it doesn't.
 */
export function patientSearchRefusal(params: URLSearchParams): string | null {
  const identifier = identifierValue(params.get("identifier"))?.trim();
  const id = params.get("_id")?.trim();
  if (identifier || id) return null;
  const name = params.get("name")?.trim();
  const birthdate = params.get("birthdate")?.trim();
  if (name && name.length >= 2 && birthdate) return null;
  return "Patient search needs identifier or _id, or name together with birthdate; use Patient/$match for discovery";
}

/** Write verbs that need a write scope. */
export function isWriteMethod(method: string): boolean {
  return ["POST", "PUT", "DELETE", "PATCH"].includes(method);
}

/** Scopes a user-authorised (auth-code) token may carry. */
export function userGrantableScopes(
  requested: string[],
  hasLinkedPatient: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (hasSystemScope(requested)) {
    return {
      ok: false,
      reason: "system scopes are only issued to backend services",
    };
  }
  if (hasPatientScope(requested) && !hasLinkedPatient) {
    return {
      ok: false,
      reason: "patient scopes need an account linked to a patient record",
    };
  }
  return { ok: true };
}

export interface StoredWriteRow {
  source_client_id: string | null;
  patient_id: string | null;
  version_id: number;
}

/**
 * Whether a partner may change (update or delete) a stored FHIR resource.
 * Only the client that wrote it may change it, it may not be moved to another
 * patient, and an If-Match version, when sent, must match.
 */
export function writeChangeRefusal(
  existing: StoredWriteRow | null,
  callerClientId: string,
  newPatientId: string | null | undefined,
  ifMatch: string | null,
): { status: 403 | 409 | 412; reason: string } | null {
  if (existing) {
    if (!existing.source_client_id || existing.source_client_id !== callerClientId) {
      return { status: 403, reason: "resource was written by another client" };
    }
    if (newPatientId !== undefined && existing.patient_id !== newPatientId) {
      return { status: 409, reason: "resource cannot be moved to another patient" };
    }
  }
  if (ifMatch) {
    const wanted = ifMatch.replace(/^W\//, "").replace(/"/g, "").trim();
    const current = existing ? String(existing.version_id) : null;
    if (wanted && wanted !== current) {
      return { status: 412, reason: "If-Match does not match the current version" };
    }
  }
  return null;
}
