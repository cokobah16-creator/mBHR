// Confirmation text for a conflict decision: exactly what is written on the
// server (the shared conflict log) and what is written on this device.

import type {
  ConflictResolution,
  ResolutionStrategy,
} from "@/services/conflictQueue";
import { formatConflictValue } from "./conflictDiff";
import { recordTypeLabel, strategyActionLabel } from "./conflictLabels";
import type { DevicePlan, FieldChange } from "./devicePlan";

export type SummaryMode = "resolve" | "approve" | "apply";

export interface ResolutionSummary {
  heading: string;
  confirmLabel: string;
  server: string[];
  device: string[];
  /** Field-level changes on this device (empty when nothing is written). */
  changes: FieldChange[];
  warnings: string[];
  /** The decision cannot be confirmed yet (e.g. a field is not chosen). */
  blocked: boolean;
}

export interface SummaryInput {
  mode: SummaryMode;
  conflict: Pick<ConflictResolution, "conflictType" | "entityType">;
  strategy: ResolutionStrategy;
  plan: DevicePlan;
  /** Resolve mode: the decision will wait for approval. */
  needsApproval: boolean;
  /** Display name of the role that must approve, e.g. "Lead Clinician". */
  approverName?: string;
  /** Approve mode: this approval is the first of two. */
  firstOfTwoApprovals?: boolean;
  /** Duplicates: labels for record A and B, e.g. "record A (MBHR-12AB34)". */
  recordALabel?: string;
  recordBLabel?: string;
}

const MERGED_HISTORY =
  "visits, vital signs, consultations, dispensing records, queue tickets, care tasks, allergies and preferences";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function serverLines(input: SummaryInput): string[] {
  const { mode, strategy, needsApproval, approverName } = input;
  const approver = approverName || "an approver";
  if (mode === "apply") {
    return [
      "Nothing new is written to the shared conflict log. The decision was already recorded there.",
    ];
  }
  if (mode === "approve") {
    if (input.firstOfTwoApprovals) {
      return [
        "Records your approval in the shared conflict log as the first of two approvals.",
        "The conflict stays open until a second approver, who is not you, approves it.",
      ];
    }
    return [
      "Marks the conflict as resolved in the shared conflict log.",
      "Adds your approval (your user ID and role, the time and your reason) to the conflict audit log.",
    ];
  }
  if (strategy === "ignore") {
    return [
      "Marks the conflict as dismissed in the shared conflict log.",
      "Adds an audit entry with your user ID, role, the time and your reason.",
    ];
  }
  const lines = needsApproval
    ? [
        `Saves your decision in the shared conflict log as a proposal and sends it to ${approver} for approval.`,
        "The conflict stays open until the proposal is approved.",
      ]
    : ["Marks the conflict as resolved in the shared conflict log."];
  lines.push(
    "Adds an audit entry with your user ID, role, the time and your reason, and records the value chosen for each field.",
  );
  return lines;
}

function deviceLines(input: SummaryInput): { lines: string[]; blocked: boolean } {
  const { plan, conflict, mode } = input;
  const record = `${recordTypeLabel(conflict.entityType).toLowerCase()} record`;
  const a = input.recordALabel || "record A";
  const b = input.recordBLabel || "record B";

  if (plan.kind === "none") {
    switch (plan.reason) {
      case "dismissed":
        return { lines: ["Nothing changes on this device or in any record."], blocked: false };
      case "awaiting_approval":
        return {
          lines: [
            mode === "approve"
              ? "Nothing changes on this device yet."
              : "Nothing changes on this device until the decision is approved.",
          ],
          blocked: false,
        };
      case "not_on_device":
        return {
          lines:
            conflict.conflictType === "duplicate"
              ? [`${capitalise(a)} is not stored on this device, so the records cannot be merged here.`]
              : [
                  `This ${record} is not stored on this device, so nothing changes here.`,
                  "The device that reported the conflict keeps its own copy. If that copy still differs from the decision, it will report the conflict again at its next sync.",
                ],
          blocked: false,
        };
      case "partner_not_on_device":
        return {
          lines: [`${capitalise(b)} is not stored on this device, so the records cannot be merged here.`],
          blocked: false,
        };
      case "merged_elsewhere":
        return {
          lines: [
            `${capitalise(a)} or ${b} is already merged into another patient record on this device. Merging them again would attach history to a merged record, so this cannot be applied.`,
            mode === "resolve"
              ? "Mark them as not a duplicate instead, or check the patient records first."
              : "Send the decision back, or check the patient records first.",
          ],
          blocked: true,
        };
      case "unknown_table":
        return {
          lines: ["This type of record is not stored on this device, so nothing changes here."],
          blocked: false,
        };
      case "no_fields":
        return {
          lines: ["The two copies no longer differ, so nothing changes on this device."],
          blocked: false,
        };
      case "incomplete_selection":
        return { lines: ["Choose a value for every field that differs first."], blocked: true };
      case "unsupported_type":
      default:
        return {
          lines: ["This screen records the decision only. The record itself is not changed here."],
          blocked: false,
        };
    }
  }

  if (plan.kind === "update_record") {
    const changed = plan.changes.filter((c) => c.changesValue).length;
    return {
      lines: [
        changed > 0
          ? `Updates ${plural(changed, "field")} on this device's copy of the ${record}.`
          : `This device's copy of the ${record} already has these values.`,
        "Marks the record to upload at the next sync. When the upload succeeds, the server copy is updated to match this device.",
        "Adds an entry to this device's audit log.",
      ],
      blocked: false,
    };
  }

  const keepB = input.strategy === "keep_remote";
  const kept = keepB ? b : a;
  const merged = keepB ? a : b;
  const lines: string[] = [];
  const copied = plan.copied.filter((c) => c.changesValue).length;
  if (copied > 0) {
    lines.push(`Copies ${plural(copied, "value")} from ${b} into ${a}.`);
  }
  if (plan.alreadyMerged) {
    lines.push(`${capitalise(merged)} is already marked as merged into ${kept} on this device.`);
  } else {
    lines.push(
      `Moves the ${MERGED_HISTORY} of ${merged} to ${kept}, and marks ${merged} as merged into ${kept}. Neither record is deleted.`,
    );
  }
  lines.push("Marks the changed records to upload at the next sync.");
  lines.push("Adds an entry to this device's audit log.");
  return { lines, blocked: false };
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function warnings(plan: DevicePlan): string[] {
  const changes =
    plan.kind === "update_record"
      ? plan.changes
      : plan.kind === "merge_patients"
        ? plan.copied
        : [];
  return changes
    .filter((c) => c.changedSinceReport && c.changesValue)
    .map(
      (c) =>
        `${c.label}: this device now holds "${formatConflictValue(c.current)}", not the value reported with the conflict (it may have been edited or downloaded since). It will be replaced with "${formatConflictValue(c.next)}".`,
    );
}

function confirmLabel(input: SummaryInput): string {
  const { mode, strategy, needsApproval, plan } = input;
  if (mode === "apply") return "Apply on this device";
  if (mode === "approve") {
    if (input.firstOfTwoApprovals) return "Record first approval";
    return plan.kind === "none" ? "Approve" : "Approve and apply";
  }
  if (strategy === "ignore") {
    return input.conflict.conflictType === "duplicate" ? "Mark as not a duplicate" : "Dismiss conflict";
  }
  return needsApproval ? "Send for approval" : "Resolve conflict";
}

export function summariseResolution(input: SummaryInput): ResolutionSummary {
  const device = deviceLines(input);
  const changes =
    input.plan.kind === "update_record"
      ? input.plan.changes
      : input.plan.kind === "merge_patients"
        ? input.plan.copied
        : [];
  return {
    heading: strategyActionLabel(input.strategy, input.conflict.conflictType),
    confirmLabel: confirmLabel(input),
    server: serverLines(input),
    device: device.lines,
    changes,
    warnings: warnings(input.plan),
    blocked: device.blocked,
  };
}

// ---------------------------------------------------------------------------
// Bulk decisions

export type BulkStrategy = "keep_local" | "keep_remote" | "ignore";

export interface BulkItem {
  conflict: Pick<ConflictResolution, "id" | "conflictType">;
  /** The current user may decide this conflict. */
  allowed: boolean;
  needsApproval: boolean;
  plan: DevicePlan;
}

export interface BulkSummary {
  eligibleIds: string[];
  skippedOtherTypes: number;
  skippedPermission: number;
  sentForApproval: number;
  deviceUpdates: number;
  notOnDevice: number;
  lines: string[];
}

/**
 * Bulk "keep device/server copy" applies to sync conflicts only: merging
 * duplicate patients needs a pair-by-pair review. Dismissing applies to all.
 */
export function summariseBulk(items: BulkItem[], strategy: BulkStrategy): BulkSummary {
  let skippedOtherTypes = 0;
  let skippedPermission = 0;
  let sentForApproval = 0;
  let deviceUpdates = 0;
  let notOnDevice = 0;
  const eligibleIds: string[] = [];

  for (const item of items) {
    if (strategy !== "ignore" && item.conflict.conflictType !== "sync_conflict") {
      skippedOtherTypes++;
      continue;
    }
    if (!item.allowed) {
      skippedPermission++;
      continue;
    }
    eligibleIds.push(item.conflict.id);
    if (strategy === "ignore") continue;
    if (item.needsApproval) sentForApproval++;
    else if (item.plan.kind === "update_record") deviceUpdates++;
    else if (item.plan.kind === "none" && item.plan.reason !== "awaiting_approval") notOnDevice++;
  }

  const lines: string[] = [];
  const n = eligibleIds.length;
  if (strategy === "ignore") {
    lines.push(`Marks ${plural(n, "conflict")} as dismissed in the shared conflict log. No record values change.`);
  } else {
    const resolvedNow = n - sentForApproval;
    if (resolvedNow > 0) {
      lines.push(`Marks ${plural(resolvedNow, "conflict")} as resolved in the shared conflict log.`);
    }
    if (sentForApproval > 0) {
      lines.push(`Sends ${plural(sentForApproval, "decision")} for approval. Nothing changes on this device for those until approved.`);
    }
    if (deviceUpdates > 0) {
      lines.push(
        `Updates ${plural(deviceUpdates, "record")} on this device and marks them to upload at the next sync.`,
      );
    }
    if (notOnDevice > 0) {
      lines.push(
        `${plural(notOnDevice, "record")} ${notOnDevice === 1 ? "is" : "are"} not stored on this device, so only the decision is recorded for ${notOnDevice === 1 ? "it" : "them"}.`,
      );
    }
  }
  lines.push("Each decision is added to the conflict audit log with your user ID and role.");
  if (skippedOtherTypes > 0) {
    lines.push(
      `Skips ${plural(skippedOtherTypes, "possible duplicate or data-quality item")}: review those one at a time.`,
    );
  }
  if (skippedPermission > 0) {
    lines.push(
      `Skips ${plural(skippedPermission, "conflict")} your role cannot resolve.`,
    );
  }

  return {
    eligibleIds,
    skippedOtherTypes,
    skippedPermission,
    sentForApproval,
    deviceUpdates,
    notOnDevice,
    lines,
  };
}

export interface BulkTally {
  resolved: number;
  sentForApproval: number;
  notSaved: number;
  /** Resolved on the server but this device's copy could not be updated. */
  deviceFailed: number;
}

/** One sentence per bulk run, e.g. "3 resolved, 1 not saved." */
export function bulkResultText(tally: BulkTally, strategy: BulkStrategy): string {
  const parts = [`${tally.resolved} ${strategy === "ignore" ? "dismissed" : "resolved"}`];
  if (tally.sentForApproval > 0) parts.push(`${tally.sentForApproval} sent for approval`);
  if (tally.notSaved > 0) parts.push(`${tally.notSaved} not saved`);
  let text = `${parts.join(", ")}.`;
  if (tally.deviceFailed > 0) {
    text += ` ${plural(tally.deviceFailed, "record")} could not be updated on this device; apply ${
      tally.deviceFailed === 1 ? "it" : "them"
    } from Resolved.`;
  }
  return text;
}
