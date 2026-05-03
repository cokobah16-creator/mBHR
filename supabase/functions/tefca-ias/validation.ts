// Edge-side US Core 7.0 validation hook for the TEFCA IAS endpoint.
//
// Imports the shared validator core from src/ via a relative path with the
// .ts extension (Deno-style). Vite is not involved here; this file is only
// loaded inside the Supabase Edge Function bundle.
//
// Phase D-1 enforcement model: SOFT-WARNING.
//   - We validate every served resource (single resource and Bundle entries).
//   - On failure we emit a OperationOutcome.issue.severity=warning embedded
//     in the response Bundle's `meta.tag`, AND log a compact summary into
//     tefca_access_logs.error_message (alongside other errors).
//   - We do NOT replace the response with an OperationOutcome — the bug we
//     want to catch is a mapper regression, not a write attempt with a bad
//     payload, and 500-ing on legitimate data we already serve would break
//     production while we shake out validator false positives.
//   - Phase D-2 will gate /oauth/register'd writes and Phase D-3 will tighten
//     read-side enforcement once fixtures are clean.

import {
  summarizeValidationIssues,
  validateResource,
  type ValidationResult,
} from "../../../src/services/fhir/validation/core.ts";

export interface ValidationSummary {
  /** True when every resource passed validation (no errors). */
  allValid: boolean;
  /** Number of resources validated. */
  count: number;
  /** Compact, log-safe textual summary; null if everything passed. */
  errorMessage: string | null;
  /** Up to 5 individual results for diagnostics (not for response payload). */
  sample: ValidationResult[];
}

/**
 * Validate a single resource OR every resource in a Bundle. Designed to be
 * called once per response from the dispatch handlers.
 */
export function validateResponsePayload(payload: unknown): ValidationSummary {
  const sample: ValidationResult[] = [];
  let count = 0;
  let allValid = true;
  const messages: string[] = [];

  const visit = (resource: unknown) => {
    if (
      resource &&
      typeof resource === "object" &&
      "resourceType" in (resource as Record<string, unknown>)
    ) {
      const r = resource as { resourceType: string };
      if (r.resourceType === "Bundle") {
        const b = resource as { entry?: Array<{ resource?: unknown }> };
        for (const entry of b.entry ?? []) {
          if (entry?.resource) visit(entry.resource);
        }
        return;
      }
      if (r.resourceType === "OperationOutcome") {
        // Don't validate error envelopes against US Core profiles.
        return;
      }
      const result = validateResource(
        r as Parameters<typeof validateResource>[0],
      );
      count++;
      if (sample.length < 5) sample.push(result);
      if (!result.valid) allValid = false;

      const summary = summarizeValidationIssues(result);
      if (summary) messages.push(`${r.resourceType}: ${summary}`);
    }
  };

  visit(payload);

  const joined = messages.join(" | ");
  const errorMessage =
    joined.length === 0
      ? null
      : joined.length > 480
        ? joined.slice(0, 477) + "..."
        : joined;

  return { allValid, count, errorMessage, sample };
}

/**
 * Convenience wrapper: parse the response body, validate, and return the
 * summary. Skips validation for non-JSON responses (HTML auth pages, etc.).
 *
 * The Response is read via .clone() so the original can still be returned
 * to the client.
 */
export async function validateResponseClone(
  resp: Response,
): Promise<ValidationSummary | null> {
  const contentType = resp.headers.get("content-type") || "";
  if (!contentType.includes("json")) return null;
  if (resp.status >= 400) return null;
  try {
    const body = await resp.clone().json();
    return validateResponsePayload(body);
  } catch {
    return null;
  }
}
