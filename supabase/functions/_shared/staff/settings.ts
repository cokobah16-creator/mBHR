// The staff-admin function's settings (function secrets), read into values.
//
// Pure functions (no Deno APIs) so they can be unit tested with vitest/bun.
// index.ts reads each secret and passes the raw text in. Nothing here logs.

import {
  DEFAULT_INVITE_LIFETIME_SECONDS,
  INVITE_LIFETIME_MAX_SECONDS,
  INVITE_LIFETIME_MIN_SECONDS,
} from "./constants.ts";
import { refusal, type Refusal } from "./errors.ts";

/**
 * CORS fails closed: with ALLOWED_ORIGINS unset (cors.ts allowedOrigins()
 * returns null) nothing but ping runs, so the refusal is 503 not_configured.
 * null when origins are set.
 */
export function preflightRefusal(origins: readonly string[] | null): Refusal | null {
  return origins === null ? refusal("not_configured") : null;
}

/**
 * STAFF_INVITE_LIFETIME_SECONDS as a whole number from 300 to 86400, else
 * the default (3600).
 */
export function inviteLifetimeSeconds(raw: string | null | undefined): number {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : NaN;
  if (
    Number.isInteger(value) &&
    value >= INVITE_LIFETIME_MIN_SECONDS &&
    value <= INVITE_LIFETIME_MAX_SECONDS
  ) {
    return value;
  }
  return DEFAULT_INVITE_LIFETIME_SECONDS;
}

/** STAFF_ADMIN_LAUNCHED_AT as a date, or null when unset or not a date. */
export function launchedAt(raw: string | null | undefined): Date | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const time = Date.parse(raw.trim());
  return Number.isNaN(time) ? null : new Date(time);
}
