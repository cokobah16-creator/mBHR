import type { User } from "@/db";

export const ROLES = [
  "volunteer",
  "inventory_lead",
  "pharmacist",
  "nurse",
  "doctor",
  "admin",
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  viewPatients: ["nurse", "doctor", "admin"] as Role[],
  editPatients: ["nurse", "doctor", "admin"] as Role[],
  prescribe: ["doctor", "admin"] as Role[],
  dispense: ["pharmacist", "admin"] as Role[],
  orderLabs: ["nurse", "doctor", "admin"] as Role[],
  viewLabs: ["nurse", "doctor", "admin"] as Role[],
  manageInventory: ["inventory_lead", "pharmacist", "admin"] as Role[],
  viewReports: ["doctor", "admin"] as Role[],
  manageStaff: ["admin"] as Role[],
  manageSites: ["admin"] as Role[],
  viewQueue: ["volunteer", "nurse", "doctor", "admin"] as Role[],
  manageQueue: ["nurse", "doctor", "admin"] as Role[],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function hasRole(user: User | null, roles: Role[]): boolean {
  if (!user) return false;
  return roles.includes(user.role as Role);
}

export function hasPermission(
  user: User | null,
  permission: Permission,
): boolean {
  if (!user) return false;
  return hasRole(user, PERMISSIONS[permission]);
}

/** Throws a descriptive error if the user lacks the required permission.
 *  Use at service entry points for operations that mutate sensitive data. */
export function assertPermission(
  user: User | null,
  permission: Permission,
  context = "",
): void {
  if (!hasPermission(user, permission)) {
    const role = user?.role ?? "unauthenticated";
    const allowed = PERMISSIONS[permission].join(" | ");
    throw new Error(
      `Permission denied: '${permission}' requires [${allowed}], user has '${role}'` +
        (context ? ` — ${context}` : ""),
    );
  }
}
