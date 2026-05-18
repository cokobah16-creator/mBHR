import * as Sentry from "@sentry/react";

const DEV = import.meta.env.DEV;

export const log = (...args: unknown[]): void => {
  if (DEV) console.log(...args);
};

export const warn = (...args: unknown[]): void => {
  if (DEV) console.warn(...args);
};

export const error = (...args: unknown[]): void => {
  console.error(...args);
};

export const info = (...args: unknown[]): void => {
  if (DEV) console.info(...args);
};

export const debug = (...args: unknown[]): void => {
  if (DEV) console.debug(...args);
};

// Report a caught error to Sentry (no-op when Sentry isn't initialised) and
// always echo to console.error. Use this from error boundaries, global
// error handlers, and any catch block where the error is genuinely
// unexpected (vs. a routine network failure that the UI handles).
export const captureError = (
  err: unknown,
  context?: { tag?: string; extra?: Record<string, unknown> },
): void => {
  console.error(context?.tag ?? "[captureError]", err, context?.extra);
  try {
    Sentry.captureException(err, {
      tags: context?.tag ? { source: context.tag } : undefined,
      extra: context?.extra,
    });
  } catch {
    // Sentry not initialised or transport failed; the console.error above
    // is the visible signal.
  }
};

export default { log, warn, error, info, debug, captureError };
