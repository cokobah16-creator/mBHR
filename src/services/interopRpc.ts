/**
 * Shared helpers for the consent and sharing-status screens.
 *
 * The database functions these screens call (interop_my_consents,
 * interop_withdraw_consent, interop_consent_summary,
 * fhir_interop_admin_status) arrive with a migration that may not be
 * deployed yet. Every caller must treat "the function does not exist" as a
 * normal, quiet outcome: a short neutral message (or nothing), never an
 * error and never a blocked screen.
 *
 * This module has no imports on purpose, so its functions can be tested
 * without the Supabase client.
 */

/** The part of the Supabase client these screens use. */
export interface InteropRpcClient {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown; status?: number }>;
}

/**
 * Why a call did not return data:
 * - missing: the function is not deployed (PostgREST PGRST202, SQL 42883,
 *   or HTTP 404)
 * - denied: the account may not call it (42501, HTTP 401/403)
 * - signed_out: the sign-in expired (PGRST301)
 * - offline: the device is offline or the request never reached the server
 * - failed: anything else
 */
export type RpcFailure = "missing" | "denied" | "signed_out" | "offline" | "failed";

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

/** The PostgREST / SQL error code of an error object, or "". */
export function rpcErrorCode(error: unknown): string {
  const code = field(error, "code");
  return typeof code === "string" ? code : "";
}

/**
 * Sorts an error from supabase.rpc (or a thrown exception) into a
 * RpcFailure. `status` is the HTTP status when the caller has it.
 */
export function classifyRpcError(error: unknown, status?: number): RpcFailure {
  const code = rpcErrorCode(error);
  if (code === "PGRST202" || code === "42883") return "missing";
  if (code === "PGRST301") return "signed_out";
  if (code === "42501") return "denied";
  const httpStatus =
    typeof status === "number"
      ? status
      : typeof field(error, "status") === "number"
        ? (field(error, "status") as number)
        : undefined;
  if (httpStatus === 404) return "missing";
  if (httpStatus === 401 || httpStatus === 403) return "denied";
  // fetch rejects with a TypeError when the request never got an answer.
  if (error instanceof TypeError) return "offline";
  const message = field(error, "message");
  if (
    typeof message === "string" &&
    /failed to fetch|network ?error|load failed|networkerror/i.test(message)
  ) {
    return "offline";
  }
  return "failed";
}

/** A safe label for logs: the error code or class name, never a message. */
export function rpcErrorLabel(error: unknown): string {
  const code = rpcErrorCode(error);
  if (code) return code;
  if (error instanceof Error) return error.name;
  return "unknown";
}

/** navigator.onLine, read safely (true where there is no navigator). */
export function deviceOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

export type RpcOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; reason: RpcFailure; code: string };

/**
 * Calls one database function and sorts the result. Never throws.
 * Offline devices are answered without a request.
 */
export async function callInteropRpc(
  client: InteropRpcClient | null | undefined,
  fn: string,
  args: Record<string, unknown> | undefined,
  online: boolean,
): Promise<RpcOutcome<unknown>> {
  if (!client) return { ok: false, reason: "missing", code: "no_client" };
  if (online === false) return { ok: false, reason: "offline", code: "offline" };
  try {
    const result = await client.rpc(fn, args);
    if (result.error) {
      return {
        ok: false,
        reason: classifyRpcError(result.error, result.status),
        code: rpcErrorLabel(result.error),
      };
    }
    return { ok: true, data: result.data };
  } catch (error) {
    return { ok: false, reason: classifyRpcError(error), code: rpcErrorLabel(error) };
  }
}

/** A finite, whole, non-negative number, or null. */
export function toCount(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/** An ISO timestamp that parses, or null. */
export function toTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : value;
}
