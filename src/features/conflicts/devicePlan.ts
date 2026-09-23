// What a conflict decision writes on this device.
//
// The same plan object drives the confirmation summary and the write, so
// staff confirm exactly what is applied. Planning is pure: callers pass a
// snapshot of this device's copies of the records involved.

import type {
  ConflictResolution,
  ResolutionStrategy,
} from "@/services/conflictQueue";
import {
  differingFields,
  sameValue,
  sideForField,
  type FieldSelections,
  type Side,
} from "./conflictDiff";

export interface FieldChange {
  field: string;
  label: string;
  side: Side;
  /** Value that will be written on this device. */
  next: unknown;
  /** This device's value now (undefined when the record is not here). */
  current: unknown;
  /** Writing `next` changes this device's value. */
  changesValue: boolean;
  /** This device's value is no longer what was reported with the conflict. */
  changedSinceReport: boolean;
}

export type NoWriteReason =
  | "dismissed"
  | "awaiting_approval"
  | "not_on_device"
  | "partner_not_on_device"
  /** A record of the pair is already merged into a different patient. */
  | "merged_elsewhere"
  | "unsupported_type"
  | "unknown_table"
  | "no_fields"
  | "incomplete_selection";

export type DevicePlan =
  | { kind: "none"; reason: NoWriteReason }
  | {
      kind: "update_record";
      table: string;
      recordId: string;
      changes: FieldChange[];
    }
  | {
      kind: "merge_patients";
      winnerId: string;
      loserId: string;
      /** Values copied from record B into record A (field-by-field merge). */
      copied: FieldChange[];
      alreadyMerged: boolean;
    };

export interface DeviceSnapshot {
  /** Local table for the record type; null when this device has none. */
  table: string | null;
  /** This device's copy of the conflict's record. */
  record: Record<string, unknown> | null;
  /** Duplicates only: this device's copy of the matching record (B). */
  partner: Record<string, unknown> | null;
}

type PlanConflict = Pick<
  ConflictResolution,
  "conflictType" | "entityType" | "entityId" | "candidateIds" | "conflictDetails"
>;

/** Fields a conflict decision must never overwrite. */
function isProtectedField(field: string): boolean {
  return field === "id" || field.startsWith("_");
}

/**
 * Values in the conflict log went through JSON, so dates arrive as strings.
 * Keep this device's shape: a Date stays a Date, a number stays a number.
 */
export function coerceToLocalShape(next: unknown, current: unknown): unknown {
  if (current instanceof Date && (typeof next === "string" || typeof next === "number")) {
    const d = new Date(next);
    return Number.isNaN(d.getTime()) ? next : d;
  }
  if (
    typeof current === "number" &&
    typeof next === "string" &&
    next.trim() !== "" &&
    Number.isFinite(Number(next))
  ) {
    return Number(next);
  }
  return next;
}

export function planDeviceWrite(input: {
  conflict: PlanConflict;
  strategy: ResolutionStrategy;
  selections: FieldSelections;
  /** The decision will wait for approval, so nothing is applied yet. */
  awaitingApproval: boolean;
  snapshot: DeviceSnapshot;
}): DevicePlan {
  const { conflict, strategy, selections, awaitingApproval, snapshot } = input;
  if (strategy === "ignore") return { kind: "none", reason: "dismissed" };
  if (awaitingApproval) return { kind: "none", reason: "awaiting_approval" };

  const fields = differingFields(conflict.conflictDetails?.fields).filter(
    (f) => !isProtectedField(f.field),
  );

  if (conflict.conflictType === "sync_conflict") {
    if (!snapshot.table) return { kind: "none", reason: "unknown_table" };
    if (!snapshot.record) return { kind: "none", reason: "not_on_device" };
    if (fields.length === 0) return { kind: "none", reason: "no_fields" };
    const record = snapshot.record;
    const changes: FieldChange[] = [];
    for (const f of fields) {
      const side = sideForField(strategy, f.field, selections);
      if (!side) return { kind: "none", reason: "incomplete_selection" };
      const current = record[f.field];
      const raw = side === "local" ? f.localValue : f.remoteValue;
      const next = coerceToLocalShape(raw, current);
      changes.push({
        field: f.field,
        label: f.label,
        side,
        next,
        current,
        changesValue: !sameValue(current, next, f.type),
        changedSinceReport: !sameValue(current, f.localValue, f.type),
      });
    }
    return {
      kind: "update_record",
      table: snapshot.table,
      recordId: conflict.entityId,
      changes,
    };
  }

  if (conflict.conflictType === "duplicate") {
    if (conflict.entityType !== "patients") {
      return { kind: "none", reason: "unsupported_type" };
    }
    const partnerId = conflict.candidateIds?.[0];
    if (!snapshot.record) return { kind: "none", reason: "not_on_device" };
    if (!partnerId || !snapshot.partner) {
      return { kind: "none", reason: "partner_not_on_device" };
    }
    const keepB = strategy === "keep_remote";
    const winnerId = keepB ? partnerId : conflict.entityId;
    const loserId = keepB ? conflict.entityId : partnerId;
    const loser = keepB ? snapshot.record : snapshot.partner;
    const winner = keepB ? snapshot.partner : snapshot.record;
    // The scan reports each pair from both sides (A->B and B->A). Once one of
    // them is merged, merging again would move history onto a merged record
    // or create a merge loop, so never plan it.
    if (winner.mergeInto || (loser.mergeInto && loser.mergeInto !== winnerId)) {
      return { kind: "none", reason: "merged_elsewhere" };
    }
    const copied: FieldChange[] = [];
    if (strategy === "manual" || strategy === "merge") {
      for (const f of fields) {
        const side = sideForField(strategy, f.field, selections);
        if (!side) return { kind: "none", reason: "incomplete_selection" };
        if (side !== "remote") continue;
        const current = snapshot.record[f.field];
        const next = coerceToLocalShape(f.remoteValue, current);
        copied.push({
          field: f.field,
          label: f.label,
          side,
          next,
          current,
          changesValue: !sameValue(current, next, f.type),
          changedSinceReport: !sameValue(current, f.localValue, f.type),
        });
      }
    }
    return {
      kind: "merge_patients",
      winnerId,
      loserId,
      copied,
      alreadyMerged: loser.mergeInto === winnerId,
    };
  }

  return { kind: "none", reason: "unsupported_type" };
}

/** Field values to write for a set of changes (only those that change). */
export function buildLocalPatch(changes: FieldChange[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const c of changes) {
    if (c.changesValue && !isProtectedField(c.field)) patch[c.field] = c.next;
  }
  return patch;
}

/** True when applying the plan would change something on this device. */
export function planHasWork(plan: DevicePlan): boolean {
  if (plan.kind === "update_record") return true;
  if (plan.kind === "merge_patients") {
    return !plan.alreadyMerged || plan.copied.some((c) => c.changesValue);
  }
  return false;
}

/** For resolved decisions: does this device's copy still differ from it? */
export function deviceMatchesDecision(plan: DevicePlan): boolean {
  if (plan.kind === "update_record") return plan.changes.every((c) => !c.changesValue);
  if (plan.kind === "merge_patients") {
    return plan.alreadyMerged && plan.copied.every((c) => !c.changesValue);
  }
  return false;
}
