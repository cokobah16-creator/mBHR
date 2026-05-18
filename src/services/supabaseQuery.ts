// Centralised Supabase call wrapper.
//
// Most of `src/services/` calls supabase.from('x').select(...) directly,
// which means error handling is scattered: every caller has to remember
// to check `error`, distinguish "row not found" from "RLS denied", catch
// network failures, and report unexpected ones to Sentry.
//
// `runQuery` provides one consistent path:
//   - Returns `{ data, error }` where `error` is a discriminated union.
//   - Maps Postgrest error codes to typed reasons UI can branch on:
//       * RLSDeniedError  — code "42501"
//       * SessionExpiredError — code "PGRST301"
//       * NotFoundError — when `mode: 'single'` and no row matches
//       * NetworkError — fetch threw / offline
//       * UnknownError — anything else, captured to Sentry
//
// Migrate services to use this gradually; start with the patient-portal
// and sync paths.

import type {
  PostgrestError,
  PostgrestSingleResponse,
} from "@supabase/supabase-js";
import { captureError } from "@/lib/logger";

export type ServiceErrorKind =
  | "session_expired"
  | "rls_denied"
  | "not_found"
  | "network"
  | "unknown";

export class ServiceError extends Error {
  readonly kind: ServiceErrorKind;
  readonly cause?: unknown;
  readonly postgrestCode?: string;
  readonly label: string;

  constructor(
    kind: ServiceErrorKind,
    label: string,
    message: string,
    options?: { cause?: unknown; postgrestCode?: string },
  ) {
    super(message);
    this.name = "ServiceError";
    this.kind = kind;
    this.label = label;
    this.cause = options?.cause;
    this.postgrestCode = options?.postgrestCode;
  }
}

export interface RunQueryOptions {
  // Logical label, e.g. "patientPortalAuth.findUserByPhone". Used for the
  // Sentry tag and in error messages.
  label: string;
  // If true, a Postgrest result with `data === null` becomes a NotFoundError
  // instead of `{ data: null, error: null }`. Defaults to false.
  required?: boolean;
  // Suppress Sentry capture for expected errors (e.g. when callers handle
  // "not found" as a normal outcome). Defaults to false.
  silent?: boolean;
}

export type QueryResult<T> =
  | { data: T; error: null }
  | { data: null; error: ServiceError };

function isPostgrestError(e: unknown): e is PostgrestError {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    typeof (e as { code: unknown }).code === "string" &&
    "message" in e
  );
}

function isFetchError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const m = e.message.toLowerCase();
  return (
    e.name === "TypeError" &&
    (m.includes("fetch") || m.includes("network") || m.includes("load failed"))
  );
}

function classify(label: string, err: unknown): ServiceError {
  if (err instanceof ServiceError) return err;

  if (isPostgrestError(err)) {
    const code = err.code;
    if (code === "PGRST301") {
      return new ServiceError(
        "session_expired",
        label,
        "Supabase session expired; please sign in again.",
        { cause: err, postgrestCode: code },
      );
    }
    if (code === "42501") {
      return new ServiceError(
        "rls_denied",
        label,
        "You do not have access to this resource.",
        { cause: err, postgrestCode: code },
      );
    }
    if (code === "PGRST116") {
      return new ServiceError("not_found", label, "Row not found.", {
        cause: err,
        postgrestCode: code,
      });
    }
    return new ServiceError(
      "unknown",
      label,
      err.message || `Postgrest error (${code})`,
      { cause: err, postgrestCode: code },
    );
  }

  if (isFetchError(err)) {
    return new ServiceError(
      "network",
      label,
      "Network unavailable while reaching Supabase.",
      { cause: err },
    );
  }

  return new ServiceError(
    "unknown",
    label,
    err instanceof Error ? err.message : "Unknown error from Supabase.",
    { cause: err },
  );
}

// Run a Supabase query, normalising the response into a typed result.
//
// Usage:
//   const r = await runQuery("patients.findById", () =>
//     supabase.from("patients").select("*").eq("id", id).single()
//   );
//   if (r.error) return handle(r.error);
//   const patient = r.data;
export async function runQuery<T>(
  fn: () => PromiseLike<{ data: T | null; error: PostgrestError | null }>,
  options: RunQueryOptions,
): Promise<QueryResult<T>>;
export async function runQuery<T>(
  fn: () => PromiseLike<PostgrestSingleResponse<T>>,
  options: RunQueryOptions,
): Promise<QueryResult<T>>;
export async function runQuery<T>(
  fn: () => PromiseLike<{ data: T | null; error: PostgrestError | null }>,
  options: RunQueryOptions,
): Promise<QueryResult<T>> {
  try {
    const { data, error } = await fn();
    if (error) {
      const wrapped = classify(options.label, error);
      if (!options.silent && wrapped.kind === "unknown") {
        captureError(wrapped, {
          tag: options.label,
          extra: { kind: wrapped.kind, postgrestCode: wrapped.postgrestCode },
        });
      }
      return { data: null, error: wrapped };
    }
    if (data === null && options.required) {
      return {
        data: null,
        error: new ServiceError("not_found", options.label, "Row not found."),
      };
    }
    return { data: data as T, error: null };
  } catch (err) {
    const wrapped = classify(options.label, err);
    if (!options.silent) {
      captureError(wrapped, {
        tag: options.label,
        extra: { kind: wrapped.kind },
      });
    }
    return { data: null, error: wrapped };
  }
}

// Helper for callers that only want to know "did it succeed".
export const isServiceError = (e: unknown): e is ServiceError =>
  e instanceof ServiceError;
