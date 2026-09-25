// Conflict actions as the screens call them. Each one checks permissions
// before any write, records the decision on the server (the service writes
// the conflict audit entry), then applies the confirmed plan on this device.

import type { Role } from "@/auth/roles";
import {
  conflictQueueService,
  type ConflictResolution,
  type ResolutionStrategy,
} from "@/services/conflictQueue";
import logger from "@/lib/logger";
import { applyPlanOnDevice } from "./applyOnDevice";
import {
  approveDeniedMessage,
  canApproveDecision,
  canResolveConflict,
  resolveDeniedMessage,
} from "./conflictPermissions";
import { approverLabel } from "./conflictLabels";
import type { FieldSelections } from "./conflictDiff";
import type { DevicePlan } from "./devicePlan";
import type { BulkStrategy, BulkTally } from "./resolutionSummary";

export interface ConflictActor {
  id: string;
  role: Role;
}

export type DeviceOutcome = "applied" | "not_applied" | "failed";

export interface ActionResult {
  ok: boolean;
  /** Where the conflict stands afterwards. */
  status?: "resolved" | "needs_approval" | "first_approval" | "pending";
  device: DeviceOutcome;
  /** Short, plain-English result for a toast or banner. */
  title: string;
  body?: string;
}

export const REASON_REQUIRED =
  "Add a reason. It is required for conflicts with high-sensitivity patient details.";

export function reasonRequired(conflict: Pick<ConflictResolution, "phiSensitivity">): boolean {
  return conflict.phiSensitivity === "high";
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

interface DeviceApply {
  outcome: DeviceOutcome;
  /** Why nothing was written, when this device refused (merges). */
  message?: string;
  merge?: { willSync: boolean; skippedFields: string[] };
}

async function applyPlan(
  plan: DevicePlan,
  actor: ConflictActor,
  conflict: Pick<ConflictResolution, "entityType" | "conflictDetails">,
): Promise<DeviceApply> {
  if (plan.kind === "none") return { outcome: "not_applied" };
  try {
    const result = await applyPlanOnDevice(
      plan,
      actor,
      conflict.entityType,
      conflict.conflictDetails?.remoteTimestamp,
    );
    return result.applied === true
      ? { outcome: "applied", merge: result.merge }
      : { outcome: "not_applied", message: result.message };
  } catch (error) {
    logger.error("Could not apply conflict decision on this device", errorName(error));
    return { outcome: "failed" };
  }
}

function mergeAppliedBody(merge: DeviceApply["merge"]): string {
  const lines = [
    merge && !merge.willSync
      ? "The records were merged on this device. Cloud sync is not set up here, so other devices and the server do not get this merge."
      : "The records were merged on this device. The merge is waiting to sync: the server then moves the history to the kept record and every device shows the same result after its next sync. If the server refuses the merge, it is undone here and listed for review.",
  ];
  const skipped = merge?.skippedFields.length ?? 0;
  if (skipped > 0) {
    lines.push(
      `${skipped} chosen ${skipped === 1 ? "value was" : "values were"} not copied: a name, sex or date of birth cannot be left empty.`,
    );
  }
  return lines.join(" ");
}

function deviceBody(plan: DevicePlan, device: DeviceApply): string {
  if (device.outcome === "failed") {
    return "The decision is saved on the server, but this device's copy could not be updated. Open it under Resolved and choose Apply on this device.";
  }
  if (device.outcome === "applied") {
    if (plan.kind === "merge_patients") {
      return plan.alreadyMerged
        ? "The records were already merged on this device. Any chosen values were copied to the kept record and upload at the next sync."
        : mergeAppliedBody(device.merge);
    }
    return "This device's copy was updated and will upload at the next sync.";
  }
  if (device.message) {
    return `Nothing changed on this device. ${device.message}`;
  }
  if (plan.kind === "none") {
    switch (plan.reason) {
      case "dismissed":
        return "No record values changed.";
      case "not_on_device":
      case "partner_not_on_device":
      case "unknown_table":
        return "The record is not on this device, so nothing changed here.";
      case "merged_elsewhere":
        return "A record of this pair is already merged into another patient on this device, so nothing changed here.";
      default:
        return "Nothing changed on this device.";
    }
  }
  return "Nothing changed on this device.";
}

export async function resolveWithPlan(input: {
  conflict: ConflictResolution;
  strategy: ResolutionStrategy;
  selections: FieldSelections;
  justification: string;
  actor: ConflictActor;
  plan: DevicePlan;
  bulk?: boolean;
}): Promise<ActionResult> {
  const { conflict, strategy, selections, actor, plan } = input;
  const justification = input.justification.trim();
  if (!canResolveConflict(actor.role, conflict)) {
    return { ok: false, device: "not_applied", title: "Not resolved", body: resolveDeniedMessage(conflict) };
  }
  if (reasonRequired(conflict) && !justification) {
    return { ok: false, device: "not_applied", title: "Not resolved", body: REASON_REQUIRED };
  }

  const resolutionDetails: Record<string, unknown> =
    strategy === "manual" || strategy === "merge"
      ? { fieldResolutions: selections }
      : input.bulk
        ? { bulk: true }
        : {};

  const outcome = await conflictQueueService.resolve({
    conflictId: conflict.id,
    strategy,
    resolutionDetails,
    resolvedBy: actor.id,
    resolverRole: actor.role,
    justification: justification || undefined,
  });

  if (!outcome.ok) {
    return {
      ok: false,
      device: "not_applied",
      title: "Decision not saved",
      body: outcome.message,
    };
  }

  if (outcome.status === "needs_approval") {
    const approver = approverLabel(conflict.requiredApproverRole) || "an approver";
    return {
      ok: true,
      status: "needs_approval",
      device: "not_applied",
      title: "Sent for approval",
      body: `Nothing changes until ${approver} approves the decision.`,
    };
  }

  // The plan was confirmed assuming the decision would wait for approval;
  // it resolved straight away, so apply it later from the Resolved list.
  const device: DeviceApply =
    plan.kind === "none" && plan.reason === "awaiting_approval"
      ? { outcome: "not_applied" }
      : await applyPlan(plan, actor, conflict);
  return {
    ok: true,
    status: "resolved",
    device: device.outcome,
    title: strategy === "ignore" ? "Conflict dismissed" : "Conflict resolved",
    body: deviceBody(plan, device),
  };
}

export async function approveWithPlan(input: {
  conflict: ConflictResolution;
  isSecondApproval: boolean;
  justification: string;
  actor: ConflictActor;
  plan: DevicePlan;
}): Promise<ActionResult> {
  const { conflict, actor, plan } = input;
  const justification = input.justification.trim();
  if (!canApproveDecision(actor.role, conflict)) {
    return { ok: false, device: "not_applied", title: "Not approved", body: approveDeniedMessage(conflict) };
  }
  if (reasonRequired(conflict) && !justification) {
    return { ok: false, device: "not_applied", title: "Not approved", body: REASON_REQUIRED };
  }

  const result = await conflictQueueService.approveResolution({
    conflictId: conflict.id,
    approvedBy: actor.id,
    approverRole: actor.role,
    justification: justification || undefined,
    isSecondApproval: input.isSecondApproval,
  });

  if (!result.success) {
    return {
      ok: false,
      device: "not_applied",
      title: "Not approved",
      body: result.error || "The approval was not saved. Try again.",
    };
  }
  if (result.needsSecondApproval) {
    return {
      ok: true,
      status: "first_approval",
      device: "not_applied",
      title: "First approval recorded",
      body: "A second approver, who is not you, must approve before the decision is applied.",
    };
  }

  const device = await applyPlan(plan, actor, conflict);
  return {
    ok: true,
    status: "resolved",
    device: device.outcome,
    title: "Decision approved",
    body: deviceBody(plan, device),
  };
}

export async function rejectDecision(input: {
  conflict: ConflictResolution;
  reason: string;
  actor: ConflictActor;
}): Promise<ActionResult> {
  const { conflict, actor } = input;
  const reason = input.reason.trim();
  if (!canApproveDecision(actor.role, conflict)) {
    return { ok: false, device: "not_applied", title: "Not rejected", body: approveDeniedMessage(conflict) };
  }
  if (!reason) {
    return { ok: false, device: "not_applied", title: "Not rejected", body: "Add a reason for sending the decision back." };
  }
  const ok = await conflictQueueService.rejectResolution({
    conflictId: conflict.id,
    rejectedBy: actor.id,
    rejectorRole: actor.role,
    reason,
  });
  return ok
    ? {
        ok: true,
        status: "pending",
        device: "not_applied",
        title: "Decision sent back",
        body: "The conflict is open again and needs a new decision.",
      }
    : {
        ok: false,
        device: "not_applied",
        title: "Not rejected",
        body: "The rejection was not saved. It may already have been handled, or the server could not be reached.",
      };
}

/** Apply an already-recorded decision on this device (no server write). */
export async function applyRecordedDecision(input: {
  conflict: ConflictResolution;
  actor: ConflictActor;
  plan: DevicePlan;
}): Promise<ActionResult> {
  const { conflict, actor, plan } = input;
  if (!canResolveConflict(actor.role, conflict)) {
    return { ok: false, device: "not_applied", title: "Not applied", body: resolveDeniedMessage(conflict) };
  }
  if (conflict.status !== "resolved" || conflict.resolutionStrategy === "ignore") {
    return { ok: false, device: "not_applied", title: "Not applied", body: "Only resolved decisions can be applied." };
  }
  const device = await applyPlan(plan, actor, conflict);
  if (device.outcome === "failed") {
    return {
      ok: false,
      device: device.outcome,
      title: "Not applied",
      body: "This device's copy could not be updated. Try again; if it keeps failing, check the device storage.",
    };
  }
  return {
    ok: device.outcome === "applied",
    status: "resolved",
    device: device.outcome,
    title: device.outcome === "applied" ? "Applied on this device" : "Nothing to apply",
    body: deviceBody(plan, device),
  };
}

/**
 * Bulk decisions, one conflict at a time through the same path as a single
 * decision (permission check, server decision, then this device).
 */
export async function resolveMany(input: {
  entries: { conflict: ConflictResolution; plan: DevicePlan }[];
  strategy: BulkStrategy;
  justification: string;
  actor: ConflictActor;
}): Promise<BulkTally> {
  const tally: BulkTally = { resolved: 0, sentForApproval: 0, notSaved: 0, deviceFailed: 0 };
  for (const { conflict, plan } of input.entries) {
    try {
      const r = await resolveWithPlan({
        conflict,
        strategy: input.strategy,
        selections: {},
        justification: input.justification,
        actor: input.actor,
        plan,
        bulk: true,
      });
      if (!r.ok) tally.notSaved++;
      else if (r.status === "needs_approval") tally.sentForApproval++;
      else {
        tally.resolved++;
        if (r.device === "failed") tally.deviceFailed++;
      }
    } catch (error) {
      logger.error("Bulk conflict decision failed", errorName(error));
      tally.notSaved++;
    }
  }
  return tally;
}
