// Comparing the two sides of a conflict and reading back recorded decisions.

import type {
  ConflictField,
  ConflictResolution,
  ResolutionStrategy,
} from "@/services/conflictQueue";
import { formatNigerianDateTime } from "@/utils/dateFormat";

export type Side = "local" | "remote";
export type FieldSelections = Record<string, Side>;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function formatDateString(value: string): string | null {
  const dateOnly = DATE_ONLY.exec(value);
  // Date-only values (date of birth) are shown as written, so a timezone
  // can never move them to the day before.
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  if (DATE_TIME.test(value)) {
    const formatted = formatNigerianDateTime(value);
    return formatted || null;
  }
  return null;
}

/** Human-readable value for comparison tables and summaries. */
export function formatConflictValue(
  value: unknown,
  type?: ConflictField["type"],
): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? "(invalid date)"
      : formatNigerianDateTime(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (type === "date" || DATE_ONLY.test(value) || DATE_TIME.test(value)) {
      return formatDateString(value) ?? value;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "(none)";
    if (value.every((v) => v === null || ["string", "number", "boolean"].includes(typeof v))) {
      return value.map((v) => formatConflictValue(v)).join(", ");
    }
    return JSON.stringify(value, null, 2);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function sameValue(
  a: unknown,
  b: unknown,
  type?: ConflictField["type"],
): boolean {
  return formatConflictValue(a, type) === formatConflictValue(b, type);
}

export function valuesDiffer(
  field: Pick<ConflictField, "localValue" | "remoteValue" | "type">,
): boolean {
  return !sameValue(field.localValue, field.remoteValue, field.type);
}

export function differingFields<T extends Pick<ConflictField, "localValue" | "remoteValue" | "type">>(
  fields: T[] | undefined | null,
): T[] {
  return (fields ?? []).filter(valuesDiffer);
}

/** Which side a strategy takes for one field; null when not chosen yet. */
export function sideForField(
  strategy: ResolutionStrategy,
  field: string,
  selections: FieldSelections,
): Side | null {
  if (strategy === "keep_local") return "local";
  if (strategy === "keep_remote") return "remote";
  if (strategy === "manual" || strategy === "merge") return selections[field] ?? null;
  return null;
}

export function countChosen(
  fields: ConflictField[] | undefined | null,
  selections: FieldSelections,
): { chosen: number; total: number } {
  const diff = differingFields(fields);
  return {
    chosen: diff.filter((f) => selections[f.field]).length,
    total: diff.length,
  };
}

function isSide(v: unknown): v is Side {
  return v === "local" || v === "remote";
}

/** Per-field sides of a decision already recorded in the conflict log. */
export function recordedSelections(
  conflict: Pick<ConflictResolution, "resolutionStrategy" | "resolutionDetails" | "conflictDetails">,
): FieldSelections | null {
  const strategy = conflict.resolutionStrategy;
  const fields = differingFields(conflict.conflictDetails?.fields);
  if (strategy === "keep_local" || strategy === "keep_remote") {
    const side: Side = strategy === "keep_local" ? "local" : "remote";
    return Object.fromEntries(fields.map((f) => [f.field, side]));
  }
  if (strategy === "manual" || strategy === "merge") {
    const raw = conflict.resolutionDetails?.fieldResolutions;
    if (!raw || typeof raw !== "object") return null;
    const out: FieldSelections = {};
    for (const [field, side] of Object.entries(raw as Record<string, unknown>)) {
      if (isSide(side)) out[field] = side;
    }
    return out;
  }
  return null;
}

export type Winner = "local" | "remote" | "mixed" | "none" | "unknown";

/** Which side won a recorded decision, for the history list. */
export function decisionWinner(
  conflict: Pick<ConflictResolution, "resolutionStrategy" | "resolutionDetails" | "conflictDetails">,
): Winner {
  if (!conflict.resolutionStrategy) return "unknown";
  if (conflict.resolutionStrategy === "ignore") return "none";
  const selections = recordedSelections(conflict);
  if (!selections) return "unknown";
  const sides = new Set(Object.values(selections));
  if (sides.size === 0) return "unknown";
  if (sides.size > 1) return "mixed";
  return sides.has("local") ? "local" : "remote";
}
