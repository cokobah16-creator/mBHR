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
  /** Every recorded result has reviewed_at. */
  | "reviewed"
  /** Status is completed but no result row exists. */
  | "no_result"
  | "cancelled";

export type Interpretation = LabResult["interpretation"];

type StageInput = Pick<LabOrder, "status">;
type ResultInput = Pick<LabResult, "reviewedAt">;

/**
 * Where an order is. A stored result takes precedence over the order's
 * status: addLabResult writes the result first and the status second, so a
 * failed second write must not hide a result that exists. A result nobody
 * has reviewed stays in the review queue even if its order was later
 * cancelled, so it can never drop out of sight unreviewed.
 */
export function deriveLabStage(
  order: StageInput,
  results: readonly ResultInput[],
): LabStage {
  if (results.some((r) => !r.reviewedAt)) return "awaiting_review";
  if (order.status === "cancelled") return "cancelled";
  if (results.length > 0) return "reviewed";
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
  reviewed: { label: "Reviewed", tone: "success" },
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
 * is written: an empty or unknown value must never reach the server, where
 * the column's default would file it as "normal".
 */
export function isInterpretation(value: unknown): value is Interpretation {
  return (
    typeof value === "string" &&
    (INTERPRETATIONS as readonly string[]).includes(value)
  );
}

const SEVERITY_RANK: Record<Interpretation, number> = {
  critical: 2,
  abnormal: 1,
  normal: 0,
};

const PRIORITY_RANK: Record<LabOrder["priority"], number> = {
  stat: 0,
  urgent: 1,
  routine: 2,
};

/** The most severe stored interpretation among the results, or null. */
export function worstInterpretation(
  results: readonly Pick<LabResult, "interpretation">[],
): Interpretation | null {
  let worst: Interpretation | null = null;
  for (const r of results) {
    const rank = SEVERITY_RANK[r.interpretation];
    if (rank === undefined) continue;
    if (worst === null || rank > SEVERITY_RANK[worst]) worst = r.interpretation;
  }
  return worst;
}

/** The most severe interpretation among results not yet reviewed. */
export function worstUnreviewed(
  results: readonly Pick<LabResult, "interpretation" | "reviewedAt">[],
): Interpretation | null {
  return worstInterpretation(results.filter((r) => !r.reviewedAt));
}

export type LabFilter =
  | "open"
  | "review"
  | "ordered"
  | "collected"
  | "processing"
  | "reviewed"
  | "cancelled"
  | "all";

export const LAB_FILTERS: readonly { id: LabFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "review", label: "Awaiting review" },
  { id: "ordered", label: "Ordered" },
  { id: "collected", label: "Collected" },
  { id: "processing", label: "Processing" },
  { id: "reviewed", label: "Reviewed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" },
];

export const isLabFilter = (id: string): id is LabFilter =>
  LAB_FILTERS.some((f) => f.id === id);

export function matchesFilter(stage: LabStage, filter: LabFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return stage !== "reviewed" && stage !== "cancelled";
    case "review":
      return stage === "awaiting_review";
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
  severity: Interpretation | null;
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
  cancelled: 4,
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

function errorField(error: unknown, field: "code" | "name"): string {
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
  if (code === "NO_ROWS") {
    return `${fallback} The record may have been changed or removed, or your account cannot change it. Refresh the list and check it.`;
  }
  if (code === "23503" && foreignKeyHint) {
    return `${fallback} ${foreignKeyHint}`;
  }
  return `${fallback} Check the connection and try again.`;
}
