// Pure helpers for the lab work queue: lifecycle stage, filters, ordering,
// search and staff-facing error messages. Everything here is derived from
// fields that lab_orders / lab_results actually store; nothing is inferred
// from reference ranges (the result's interpretation is entered by the
// person who records it).

import type { LabOrder, LabResult } from "@/services/labs";
import type { Tone } from "@/components/ui/StatusBadge";

export type LabStage =
  | "ordered"
  | "collected"
  | "processing"
  /** At least one result is recorded and has no reviewed_at. */
  | "awaiting_review"
  /**
   * Every recorded result is reviewed, and at least one is neither released
   * to the patient portal nor withheld from it.
   */
  | "reviewed"
  /** Every result is reviewed and released to the patient portal. */
  | "released"
  /** Every result is reviewed; at least one is withheld from the portal. */
  | "withheld"
  /** Status is completed but no result row exists. */
  | "no_result"
  | "cancelled";

export type Interpretation = LabResult["interpretation"];

/**
 * Severity used for display and ordering. "unknown" is a stored value that
 * is missing or not one of the three interpretations: it needs a check and
 * is never treated as normal.
 */
export type Severity = Interpretation | "unknown";

type StageInput = Pick<LabOrder, "status">;
type ResultInput = Pick<LabResult, "reviewedAt"> &
  Partial<Pick<LabResult, "releasedToPatientAt" | "withheldAt" | "supersededBy">>;

/** Release state of one reviewed result. */
export type ReleaseState = "not_reviewed" | "not_released" | "released" | "withheld";

export function releaseStateOf(result: ResultInput): ReleaseState {
  if (!result.reviewedAt) return "not_reviewed";
  if (result.withheldAt) return "withheld";
  if (result.releasedToPatientAt) return "released";
  return "not_released";
}

/** Reviewed results still waiting for a release or withhold decision. */
export function resultsAwaitingRelease<T extends ResultInput>(
  results: readonly T[],
): T[] {
  return results.filter(
    (r) => !r.supersededBy && releaseStateOf(r) === "not_released",
  );
}

/**
 * Results a "Release to patient" action acts on: reviewed, not released,
 * not replaced. A result someone deliberately withheld is never released
 * together with new ones: withheld results are offered only when nothing
 * else on the order is waiting for a decision (the dialog then says so).
 */
export function resultsToRelease<T extends ResultInput>(
  results: readonly T[],
): T[] {
  const waiting = results.filter(
    (r) => !r.supersededBy && !!r.reviewedAt && !r.releasedToPatientAt,
  );
  const notWithheld = waiting.filter((r) => !r.withheldAt);
  return notWithheld.length > 0 ? notWithheld : waiting;
}

/** Results that could still be withheld (not already withheld). */
export function resultsWithholdable<T extends ResultInput>(
  results: readonly T[],
): T[] {
  return results.filter((r) => !r.supersededBy && !r.withheldAt);
}

export const RELEASE_META: Record<ReleaseState, { label: string; tone: Tone }> = {
  not_reviewed: { label: "Not reviewed", tone: "warning" },
  not_released: { label: "Not released to patient", tone: "neutral" },
  released: { label: "Released to patient", tone: "info" },
  withheld: { label: "Withheld from patient", tone: "warning" },
};

/**
 * Where an order is. A stored result takes precedence over the order's
 * status: addLabResult writes the result first and the status second, so a
 * failed second write must not hide a result that exists. A result nobody
 * has reviewed stays in the review queue even if its order was later
 * cancelled, so it can never drop out of sight unreviewed. Once every
 * result is reviewed, the order shows its release state.
 */
export function deriveLabStage(
  order: StageInput,
  results: readonly ResultInput[],
): LabStage {
  if (results.some((r) => !r.reviewedAt)) return "awaiting_review";
  if (order.status === "cancelled") return "cancelled";
  if (results.length > 0) {
    const current = results.filter((r) => !r.supersededBy);
    const states = (current.length > 0 ? current : results).map(releaseStateOf);
    if (states.includes("not_released")) return "reviewed";
    if (states.includes("withheld")) return "withheld";
    return "released";
  }
  switch (order.status) {
    case "completed":
      return "no_result";
    case "collected":
      return "collected";
    case "processing":
      return "processing";
    default:
      return "ordered";
  }
}

export const STAGE_META: Record<LabStage, { label: string; tone: Tone }> = {
  ordered: { label: "Ordered", tone: "neutral" },
  collected: { label: "Collected", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  awaiting_review: { label: "Awaiting review", tone: "warning" },
  reviewed: { label: "Reviewed · not released", tone: "success" },
  released: { label: "Reviewed · released to patient", tone: "success" },
  withheld: { label: "Reviewed · withheld from patient", tone: "success" },
  no_result: { label: "Completed · no result", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Display for the stored interpretation. Abnormal and critical carry an icon. */
export const INTERPRETATION_META: Record<
  Interpretation,
  { label: string; tone: Tone }
> = {
  normal: { label: "Normal", tone: "success" },
  abnormal: { label: "Abnormal", tone: "danger" },
  critical: { label: "Critical", tone: "critical" },
};

const UNKNOWN_INTERPRETATION_META: { label: string; tone: Tone } = {
  label: "Interpretation missing, check result",
  tone: "warning",
};

/** Display for any stored value, including a missing or unknown one. */
export function interpretationMeta(value: unknown): { label: string; tone: Tone } {
  return isInterpretation(value)
    ? INTERPRETATION_META[value]
    : UNKNOWN_INTERPRETATION_META;
}

/** The stored interpretation, or "unknown" for anything else. */
export function severityOf(value: unknown): Severity {
  return isInterpretation(value) ? value : "unknown";
}

/** Labels for an order's stored status, where results are not loaded. */
export const ORDER_STATUS_META: Record<
  LabOrder["status"],
  { label: string; tone: Tone }
> = {
  ordered: { label: "Ordered", tone: "neutral" },
  collected: { label: "Collected", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const PRIORITY_LABEL: Record<LabOrder["priority"], string> = {
  stat: "STAT",
  urgent: "Urgent",
  routine: "Routine",
};

const INTERPRETATIONS: readonly Interpretation[] = ["normal", "abnormal", "critical"];

/**
 * True only for a deliberately chosen interpretation. Used before a result
 * is written: an empty or unknown value must never reach the server (older
 * databases still default a missing interpretation to "normal"). Also used
 * to read stored values: anything else is shown as needing a check.
 */
export function isInterpretation(value: unknown): value is Interpretation {
  return (
    typeof value === "string" &&
    (INTERPRETATIONS as readonly string[]).includes(value)
  );
}

// A missing or unknown interpretation needs a clinician's check, so it
// ranks with abnormal: above normal, below critical.
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 2,
  abnormal: 1,
  unknown: 1,
  normal: 0,
};

const PRIORITY_RANK: Record<LabOrder["priority"], number> = {
  stat: 0,
  urgent: 1,
  routine: 2,
};

/**
 * The most severe stored interpretation among the results, or null when
 * there are no results. A missing or unknown value counts as "unknown"
 * (needs a check), never as normal and never skipped.
 */
export function worstInterpretation(
  results: readonly { interpretation?: unknown }[],
): Severity | null {
  let worst: Severity | null = null;
  for (const r of results) {
    const severity = severityOf(r.interpretation);
    if (worst === null || SEVERITY_RANK[severity] > SEVERITY_RANK[worst]) {
      worst = severity;
    }
  }
  return worst;
}

/** The most severe interpretation among results not yet reviewed. */
export function worstUnreviewed(
  results: readonly ({ interpretation?: unknown } & Pick<LabResult, "reviewedAt">)[],
): Severity | null {
  return worstInterpretation(results.filter((r) => !r.reviewedAt));
}

export type LabFilter =
  | "open"
  | "review"
  | "release"
  | "ordered"
  | "collected"
  | "processing"
  | "reviewed"
  | "cancelled"
  | "all";

export const LAB_FILTERS: readonly { id: LabFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "review", label: "Awaiting review" },
  { id: "release", label: "Reviewed, not released" },
  { id: "ordered", label: "Ordered" },
  { id: "collected", label: "Collected" },
  { id: "processing", label: "Processing" },
  { id: "reviewed", label: "Reviewed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" },
];

export const isLabFilter = (id: string): id is LabFilter =>
  LAB_FILTERS.some((f) => f.id === id);

const FINISHED_STAGES: ReadonlySet<LabStage> = new Set<LabStage>([
  "reviewed",
  "released",
  "withheld",
  "cancelled",
]);

export function matchesFilter(stage: LabStage, filter: LabFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      // Clinical work still to do. Releasing to the portal is optional, so
      // reviewed results are finished work here and have their own filter.
      return !FINISHED_STAGES.has(stage);
    case "review":
      return stage === "awaiting_review";
    case "release":
      return stage === "reviewed";
    case "reviewed":
      return stage === "reviewed" || stage === "released" || stage === "withheld";
    default:
      return stage === filter;
  }
}

export function countByFilter(
  stages: readonly LabStage[],
): Record<LabFilter, number> {
  const counts = {} as Record<LabFilter, number>;
  for (const f of LAB_FILTERS) {
    counts[f.id] = stages.filter((s) => matchesFilter(s, f.id)).length;
  }
  return counts;
}

export interface WorklistSortable {
  stage: LabStage;
  /** Worst interpretation that still needs attention (unreviewed first). */
  severity: Severity | null;
  priority: LabOrder["priority"];
  orderedAt?: Date;
  /** Newest result date, when there is one. */
  resultAt?: Date;
}

// Results waiting for review come first, then orders still being worked,
// then completed orders with no result, then finished work.
const STAGE_GROUP: Record<LabStage, number> = {
  awaiting_review: 0,
  ordered: 1,
  collected: 1,
  processing: 1,
  no_result: 2,
  reviewed: 3,
  released: 4,
  withheld: 4,
  cancelled: 5,
};

const time = (d?: Date) => (d ? d.getTime() : 0);

/**
 * Work-queue order. Within results (awaiting review or reviewed), critical
 * comes before abnormal before normal. Open orders go by priority (STAT,
 * urgent, routine), then longest waiting first. Finished work is newest
 * first.
 */
export function compareWorklist(
  a: WorklistSortable,
  b: WorklistSortable,
): number {
  const group = STAGE_GROUP[a.stage] - STAGE_GROUP[b.stage];
  if (group !== 0) return group;

  const sev =
    (b.severity ? SEVERITY_RANK[b.severity] : -1) -
    (a.severity ? SEVERITY_RANK[a.severity] : -1);
  if (sev !== 0) return sev;

  const prio = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (prio !== 0) return prio;

  switch (a.stage) {
    case "awaiting_review":
      // Waiting longest for review first.
      return time(a.resultAt) - time(b.resultAt);
    case "reviewed":
    case "released":
    case "withheld":
      return time(b.resultAt) - time(a.resultAt);
    case "cancelled":
      return time(b.orderedAt) - time(a.orderedAt);
    default:
      return time(a.orderedAt) - time(b.orderedAt);
  }
}

/** Every word in the query must appear in at least one field (case-insensitive). */
export function matchesSearch(
  fields: readonly (string | null | undefined)[],
  query: string,
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields
    .filter((f): f is string => typeof f === "string" && f.length > 0)
    .map((f) => f.toLowerCase());
  return words.every((w) => haystack.some((f) => f.includes(w)));
}

/** "12.5 g/dL", or just the value when no unit is stored. */
export function formatResultValue(
  result: Pick<LabResult, "resultValue" | "resultUnit">,
): string {
  const unit = result.resultUnit?.trim();
  return unit ? `${result.resultValue} ${unit}` : result.resultValue;
}

const REJECTION_TEXT: Record<string, string> = {
  not_reviewed: "The result has not been reviewed yet. Review it first.",
  superseded: "A newer result replaces this one. Refresh the list.",
  no_interpretation:
    "The result has no interpretation recorded. Enter it again with Normal, Abnormal or Critical.",
  reason_required: "Give a reason for withholding the result.",
  reason_too_long: "Shorten the reason to 500 characters or fewer.",
  note_too_long: "Shorten the note for the patient to 1,000 characters or fewer.",
};

function errorField(error: unknown, field: "code" | "name" | "reason"): string {
  if (error && typeof error === "object" && field in error) {
    const value = (error as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
  }
  return "";
}

/**
 * A staff-facing explanation of why a lab call failed. `fallback` says what
 * did not happen ("Nothing was saved."); `foreignKeyHint` explains a
 * missing linked record for this action.
 */
export function describeLabError(
  error: unknown,
  fallback: string,
  foreignKeyHint?: string,
): string {
  const name = errorField(error, "name");
  const code = errorField(error, "code");
  if (name === "LabsUnavailableError") {
    return `${fallback} Lab orders need cloud sync, which is not set up on this device.`;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return `${fallback} This device is offline. Try again when the connection returns.`;
  }
  if (code === "42501" || code === "PGRST301") {
    return `${fallback} The cloud did not accept this for your account. Sign in with your email and password, or ask an admin to check your role.`;
  }
  if (code === "PGRST202") {
    return `${fallback} The cloud has not been updated for lab review and release yet. Ask an admin to apply the latest database update.`;
  }
  if (code === "REJECTED") {
    const reason = errorField(error, "reason");
    return `${fallback} ${REJECTION_TEXT[reason] ?? "The cloud refused this change. Refresh the list and check the result."}`;
  }
  if (code === "INVALID_INTERPRETATION") {
    return `${fallback} Choose Normal, Abnormal or Critical for this result.`;
  }
  if (code === "NO_ROWS") {
    return `${fallback} The record may have been changed or removed, or your account cannot change it. Refresh the list and check it.`;
  }
  if (code === "23503" && foreignKeyHint) {
    return `${fallback} ${foreignKeyHint}`;
  }
  return `${fallback} Check the connection and try again.`;
}
