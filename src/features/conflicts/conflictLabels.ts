// Plain-English labels and tones for conflict records. Display only.

import type { Tone } from "@/components/ui/StatusBadge";
import { getRoleDisplayName, type Role } from "@/auth/roles";
import type {
  ConflictPriority,
  ConflictResolution,
  ConflictStatus,
  ConflictType,
  PHISensitivity,
  RequiredApproverRole,
} from "@/services/conflictQueue";

export const RECORD_TYPES: { value: string; label: string }[] = [
  { value: "patients", label: "Patient" },
  { value: "visits", label: "Visit" },
  { value: "vitals", label: "Vital signs" },
  { value: "consultations", label: "Consultation" },
  { value: "dispenses", label: "Dispensing" },
  { value: "queue", label: "Queue ticket" },
  { value: "patient_allergies", label: "Allergy" },
  { value: "patient_preferences", label: "Patient preference" },
  { value: "inventory", label: "Inventory item" },
  { value: "app_users", label: "Staff account" },
];

/** "patient_allergies" -> "Patient allergies", "careTasks" -> "Care tasks". */
export function humanise(value: string): string {
  const spaced = value
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : value;
}

export function recordTypeLabel(entityType: string): string {
  return (
    RECORD_TYPES.find((t) => t.value === entityType)?.label ??
    humanise(entityType)
  );
}

export const CONFLICT_TYPE_LABEL: Record<ConflictType, string> = {
  sync_conflict: "Sync conflict",
  duplicate: "Possible duplicate",
  data_quality: "Data quality",
};

export function conflictTypeLabel(type: ConflictType | string): string {
  return CONFLICT_TYPE_LABEL[type as ConflictType] ?? humanise(type);
}

export const SENSITIVITY_META: Record<
  PHISensitivity,
  { label: string; tone: Tone; description: string }
> = {
  high: {
    label: "High PHI",
    tone: "danger",
    description: "Names, contact details, date of birth or clinical notes",
  },
  medium: {
    label: "Medium PHI",
    tone: "warning",
    description: "Sex, state or LGA",
  },
  low: {
    label: "Low PHI",
    tone: "info",
    description: "Measurements such as vital signs",
  },
  none: {
    label: "No PHI",
    tone: "neutral",
    description: "No patient-identifying details",
  },
};

export function sensitivityMeta(phi: PHISensitivity | undefined) {
  return SENSITIVITY_META[phi ?? "none"] ?? SENSITIVITY_META.none;
}

export const PRIORITY_META: Record<
  ConflictPriority,
  { label: string; tone: Tone; rank: number }
> = {
  critical: { label: "Critical", tone: "critical", rank: 0 },
  high: { label: "High", tone: "danger", rank: 1 },
  medium: { label: "Medium", tone: "warning", rank: 2 },
  low: { label: "Low", tone: "neutral", rank: 3 },
};

export function priorityMeta(priority: ConflictPriority | undefined) {
  return PRIORITY_META[priority ?? "low"] ?? PRIORITY_META.low;
}

const STATUS_META: Record<ConflictStatus, { label: string; tone: Tone }> = {
  pending: { label: "Open", tone: "warning" },
  needs_approval: { label: "Awaiting approval", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
  ignored: { label: "Dismissed", tone: "neutral" },
  auto_resolved: { label: "Auto-resolved", tone: "neutral" },
};

/**
 * Status as staff should read it. A high-sensitivity conflict starts out
 * "awaiting approval" with no decision yet; that still needs a decision.
 */
export function displayStatus(
  c: Pick<ConflictResolution, "status" | "resolutionStrategy">,
): { label: string; tone: Tone } {
  if (c.status === "resolved" && c.resolutionStrategy === "ignore") {
    return STATUS_META.ignored;
  }
  if (c.status === "needs_approval" && !c.resolutionStrategy) {
    return { label: "Needs a decision", tone: "warning" };
  }
  return STATUS_META[c.status] ?? { label: humanise(c.status), tone: "neutral" };
}

export interface SideLabels {
  local: string;
  remote: string;
  localHint: string;
  remoteHint: string;
}

export function sideLabels(conflictType: ConflictType): SideLabels {
  switch (conflictType) {
    case "duplicate":
      return {
        local: "Record A",
        remote: "Record B",
        localHint: "The record the duplicate scan started from",
        remoteHint: "The closest possible match found on this device",
      };
    case "sync_conflict":
      return {
        local: "Device copy",
        remote: "Server copy",
        localHint:
          "Saved on the device that reported the conflict and not yet uploaded",
        remoteHint: "The copy stored on the server when the conflict was found",
      };
    default:
      return {
        local: "Local value",
        remote: "Server value",
        localHint: "The value recorded on the device",
        remoteHint: "The value stored on the server",
      };
  }
}

/** Button wording for a decision. */
export function strategyActionLabel(
  strategy: string,
  conflictType: ConflictType,
): string {
  const dup = conflictType === "duplicate";
  switch (strategy) {
    case "keep_local":
      return dup ? "Keep record A" : "Keep device copy";
    case "keep_remote":
      return dup ? "Keep record B" : "Keep server copy";
    case "manual":
    case "merge":
      return dup ? "Combine into record A" : "Use my field choices";
    case "ignore":
      return dup ? "Not a duplicate" : "Dismiss";
    default:
      return humanise(strategy);
  }
}

/** Past-tense wording for a recorded decision. */
export function strategyLabel(
  strategy: string | undefined | null,
  conflictType: ConflictType,
): string {
  const dup = conflictType === "duplicate";
  switch (strategy) {
    case undefined:
    case null:
    case "":
      return "No decision recorded";
    case "keep_local":
      return dup ? "Kept record A" : "Kept device copy";
    case "keep_remote":
      return dup ? "Kept record B" : "Kept server copy";
    case "manual":
      return dup ? "Combined into record A" : "Chose field by field";
    case "merge":
      return "Merged";
    case "ignore":
      return dup ? "Not a duplicate, no change" : "Dismissed, no change";
    case "keep_newer":
      return "Kept the newer copy (automatic rule)";
    case "keep_more_complete":
      return "Kept the more complete copy (automatic rule)";
    default:
      return humanise(strategy);
  }
}

export const AUDIT_ACTION_META: Record<string, { label: string; tone: Tone }> = {
  created: { label: "Reported", tone: "info" },
  viewed: { label: "Viewed", tone: "neutral" },
  resolved: { label: "Decision recorded", tone: "success" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  auto_resolved: { label: "Auto-resolved", tone: "neutral" },
  appealed: { label: "Appealed", tone: "warning" },
};

export function auditActionMeta(action: string): { label: string; tone: Tone } {
  return AUDIT_ACTION_META[action] ?? { label: humanise(action), tone: "neutral" };
}

export function roleLabel(role: string | null | undefined): string {
  if (!role) return "";
  return getRoleDisplayName(role as Role);
}

export function approverLabel(role: RequiredApproverRole | undefined): string {
  return role ? getRoleDisplayName(role) : "";
}

/** "Just now", "12 min", "3 h", "2 days". */
export function formatConflictAge(
  createdAt: string | Date | undefined | null,
  now: Date = new Date(),
): string {
  if (!createdAt) return "Unknown";
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return "Unknown";
  const minutes = Math.max(0, Math.floor((now.getTime() - t) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** "3 Mar 2026, 14:05" in Nigerian English; empty when unknown. */
export function formatTimestamp(value: string | Date | undefined | null): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Staff member shown by name when this device knows them. */
export function staffLabel(
  id: string | null | undefined,
  names: Record<string, string>,
  currentUserId?: string | null,
): string {
  if (!id) return "Not recorded";
  if (currentUserId && id === currentUserId) return "You";
  if (names[id]) return names[id];
  return `Staff ID …${id.replace(/-/g, "").slice(-4).toUpperCase()}`;
}
