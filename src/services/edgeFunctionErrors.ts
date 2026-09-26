/**
 * Reading failures from supabase.functions.invoke.
 *
 * invoke() sends the access token of the staff member signed in online, or
 * the public anon key when nobody is (after a PIN unlock, for example).
 * Staff-only functions such as send-otp-email answer 401 to the anon key and
 * 403 to a role they do not serve. A non-2xx answer arrives as a
 * FunctionsHttpError whose `context` is the HTTP Response.
 */

/** Why a staff-only Edge Function refused the caller. */
export type StaffAuthRefusal = "not_signed_in" | "not_permitted";

/**
 * HTTP status of a failed invoke() call, or null when there is none (the
 * request never reached the function, for example on a network error).
 */
export function edgeFunctionStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { status?: unknown; context?: unknown };
  const context = record.context as { status?: unknown } | null | undefined;
  if (
    context &&
    typeof context === "object" &&
    typeof context.status === "number"
  ) {
    return context.status;
  }
  return typeof record.status === "number" ? record.status : null;
}

/**
 * "not_signed_in" for 401 (no online sign-in, or it expired), "not_permitted"
 * for 403 (signed in, but the server does not allow this role), else null.
 */
export function staffAuthRefusal(error: unknown): StaffAuthRefusal | null {
  const status = edgeFunctionStatus(error);
  if (status === 401) return "not_signed_in";
  if (status === 403) return "not_permitted";
  return null;
}

/**
 * The error code and message from the function's JSON reply, when it sent
 * one ({ "error": "...", "message": "..." }). Reads the body at most once.
 */
export async function edgeFunctionErrorBody(
  error: unknown,
): Promise<{ error?: string; message?: string } | null> {
  if (!error || typeof error !== "object") return null;
  const context = (error as { context?: unknown }).context as
    | { json?: unknown; bodyUsed?: unknown }
    | null
    | undefined;
  if (!context || typeof context !== "object") return null;
  if (typeof context.json !== "function" || context.bodyUsed === true) {
    return null;
  }
  try {
    const body = (await (context.json as () => Promise<unknown>).call(
      context,
    )) as { error?: unknown; message?: unknown } | null;
    if (!body || typeof body !== "object") return null;
    return {
      error: typeof body.error === "string" ? body.error : undefined,
      message: typeof body.message === "string" ? body.message : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * The whole JSON object the function replied with, or null when the reply
 * was not a JSON object (or there was no reply). Reads the body at most
 * once, so call either this or edgeFunctionErrorBody for an error, not both.
 */
export async function edgeFunctionJsonBody(
  error: unknown,
): Promise<Record<string, unknown> | null> {
  if (!error || typeof error !== "object") return null;
  const context = (error as { context?: unknown }).context as
    | { json?: unknown; bodyUsed?: unknown }
    | null
    | undefined;
  if (!context || typeof context !== "object") return null;
  if (typeof context.json !== "function" || context.bodyUsed === true) {
    return null;
  }
  try {
    const body = (await (context.json as () => Promise<unknown>).call(
      context,
    )) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
