// Which sync conflicts may be settled straight away in the Sync now dialog
// on this device. The rules are the review queue's: the role needs the
// permission for the conflict's sensitivity (and for staff/stock records),
// and nothing that the queue would send for approval is settled here.

import { getRequiredApproverRole, type Role } from "@/auth/roles";
import { canResolveConflict } from "./conflictPermissions";
import { getFieldPHISensitivity, overallPHISensitivity } from "./sensitivity";

interface DeviceConflict {
  entityType: string;
  conflicts: { field: string }[];
}

export function deviceConflictSensitivity(conflict: DeviceConflict) {
  return overallPHISensitivity(
    conflict.conflicts.map((c) => ({ phiSensitivity: getFieldPHISensitivity(c.field) })),
  );
}

export function canResolveOnDevice(role: Role | null | undefined, conflict: DeviceConflict): boolean {
  if (!role) return false;
  const phiSensitivity = deviceConflictSensitivity(conflict);
  if (!canResolveConflict(role, { phiSensitivity, entityType: conflict.entityType })) return false;
  return getRequiredApproverRole(conflict.entityType, phiSensitivity, "sync_conflict") === null;
}
