// What sync code may write to logs about a failure.
//
// Supabase (PostgREST) errors and Dexie errors can echo row values in their
// message, details or hint (a phone number in a unique-key violation, for
// example). Logs get the error code or the error's name, never the message
// or the error object.

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,40}$/;

/** A short, PHI-free label for an error: its code, else its name. */
export function syncErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && SAFE_CODE.test(code)) return code;
    if (typeof code === "number" && Number.isFinite(code)) return String(code);
  }
  if (error instanceof Error && SAFE_CODE.test(error.name)) return error.name;
  return "unknown";
}

/** An Error that carries only a descriptive name, safe to log and rethrow. */
export function namedSyncError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}
