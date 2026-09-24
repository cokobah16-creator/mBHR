// Views, filters and ordering for the conflict list.

import type {
  ConflictPriority,
  ConflictResolution,
  ConflictType,
  ConflictView,
  PHISensitivity,
} from "@/services/conflictQueue";
import { PRIORITY_META } from "./conflictLabels";

export const CONFLICT_VIEWS: ConflictView[] = ["open", "needs_approval", "resolved"];

export function isConflictView(v: string): v is ConflictView {
  return (CONFLICT_VIEWS as string[]).includes(v);
}

const CONFLICT_TYPES: ConflictType[] = ["sync_conflict", "duplicate", "data_quality"];
const PRIORITIES: ConflictPriority[] = ["critical", "high", "medium", "low"];
const SENSITIVITIES: PHISensitivity[] = ["high", "medium", "low", "none"];

export function isConflictType(v: string): v is ConflictType {
  return (CONFLICT_TYPES as string[]).includes(v);
}
export function isPriority(v: string): v is ConflictPriority {
  return (PRIORITIES as string[]).includes(v);
}
export function isSensitivity(v: string): v is PHISensitivity {
  return (SENSITIVITIES as string[]).includes(v);
}

export interface ConflictFilterState {
  entityType: string;
  conflictType: ConflictType | "";
  priority: ConflictPriority | "";
  phiSensitivity: PHISensitivity | "";
}

export const EMPTY_FILTERS: ConflictFilterState = {
  entityType: "",
  conflictType: "",
  priority: "",
  phiSensitivity: "",
};

export function hasActiveFilters(f: ConflictFilterState): boolean {
  return !!(f.entityType || f.conflictType || f.priority || f.phiSensitivity);
}

/** Filter values as the service expects them (empty means "any"). */
export function toServiceFilters(f: ConflictFilterState) {
  return {
    entityType: f.entityType || undefined,
    conflictType: f.conflictType || undefined,
    priority: f.priority || undefined,
    phiSensitivity: f.phiSensitivity || undefined,
  };
}

function time(value: string | undefined): number {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

/** Open conflicts: most urgent first, then the ones waiting longest. */
export function sortOpenConflicts<T extends Pick<ConflictResolution, "priority" | "createdAt">>(
  conflicts: T[],
): T[] {
  return [...conflicts].sort((a, b) => {
    const rank =
      (PRIORITY_META[a.priority]?.rank ?? 9) - (PRIORITY_META[b.priority]?.rank ?? 9);
    return rank || time(a.createdAt) - time(b.createdAt);
  });
}

export function pageOf<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice(page * pageSize, (page + 1) * pageSize);
}

/** "21–40 of 57" style range for pagination text. */
export function pageRange(page: number, pageSize: number, total: number) {
  if (total === 0) return { from: 0, to: 0 };
  return {
    from: page * pageSize + 1,
    to: Math.min((page + 1) * pageSize, total),
  };
}
