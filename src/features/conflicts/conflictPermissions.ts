// Who may act on a conflict. Used by the conflict queue service (the action
// layer) and by the screens (to explain, not to enforce).
//
// - Deciding a conflict: high-sensitivity PHI needs approve_phi_conflicts,
//   everything else needs resolve_conflicts (roles.canApproveConflict).
//   Staff accounts and stock records also need the permission that governs
//   writing those records ("users", "inventory").
// - Approving a decision: the same permission plus the approver hierarchy
//   the queue has always used (admin approves anything; an auditor can also
//   approve lead-clinician items).

import {
  can,
  canApproveConflict,
  getRoleDisplayName,
  type Permission,
  type Role,
} from "@/auth/roles";
import type {
  ConflictResolution,
  PHISensitivity,
  RequiredApproverRole,
  ResolutionStrategy,
} from "@/services/conflictQueue";

export const ALL_ROLES: Role[] = [
  "admin",
  "doctor",
  "nurse",
  "pharmacist",
  "volunteer",
  "guest",
  "auditor",
  "lead_clinician",
];

/** Extra write permission needed for record types outside clinical care. */
const RECORD_WRITE_PERMISSION: Record<string, Permission> = {
  app_users: "users",
  inventory: "inventory",
};

type ConflictAccessInput = Pick<ConflictResolution, "phiSensitivity" | "entityType">;
type ApprovalInput = ConflictAccessInput &
  Pick<ConflictResolution, "requiredApproverRole">;

export function permissionForSensitivity(phi: PHISensitivity): Permission {
  return phi === "high" ? "approve_phi_conflicts" : "resolve_conflicts";
}

export function recordWritePermission(entityType: string): Permission | null {
  return RECORD_WRITE_PERMISSION[entityType] ?? null;
}

export function canResolveConflict(
  role: Role | null | undefined,
  conflict: ConflictAccessInput,
): boolean {
  if (!role) return false;
  if (!canApproveConflict(role, conflict.phiSensitivity)) return false;
  const extra = recordWritePermission(conflict.entityType);
  return extra ? can(role, extra) : true;
}

/** The approval hierarchy the conflict queue applies to a required role. */
export function roleCanApprove(
  approverRole: Role,
  requiredRole: RequiredApproverRole | undefined,
): boolean {
  if (!requiredRole) return true;
  if (approverRole === "admin") return true;
  if (
    requiredRole === "lead_clinician" &&
    (approverRole === "lead_clinician" || approverRole === "auditor")
  )
    return true;
  if (requiredRole === "auditor" && approverRole === "auditor") return true;
  return false;
}

export function canApproveDecision(
  role: Role | null | undefined,
  conflict: ApprovalInput,
): boolean {
  if (!role) return false;
  return (
    canResolveConflict(role, conflict) &&
    roleCanApprove(role, conflict.requiredApproverRole ?? null)
  );
}

/** A recorded decision waits for approval when the conflict names an approver. */
export function decisionNeedsApproval(
  conflict: Pick<ConflictResolution, "requiredApproverRole">,
  strategy: ResolutionStrategy,
): boolean {
  return conflict.requiredApproverRole != null && strategy !== "ignore";
}

export function rolesWhoCanResolve(conflict: ConflictAccessInput): string[] {
  return ALL_ROLES.filter((r) => canResolveConflict(r, conflict)).map(
    getRoleDisplayName,
  );
}

export function rolesWhoCanApprove(conflict: ApprovalInput): string[] {
  return ALL_ROLES.filter((r) => canApproveDecision(r, conflict)).map(
    getRoleDisplayName,
  );
}

function listOf(names: string[]): string {
  if (names.length === 0) return "no role";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

export function resolveDeniedMessage(conflict: ConflictAccessInput): string {
  const who = listOf(rolesWhoCanResolve(conflict));
  if (conflict.phiSensitivity === "high") {
    return `This conflict includes high-sensitivity patient details. Only ${who} can resolve it.`;
  }
  return `Only ${who} can resolve this conflict.`;
}

export function approveDeniedMessage(conflict: ApprovalInput): string {
  return `Only ${listOf(rolesWhoCanApprove(conflict))} can approve this decision.`;
}
