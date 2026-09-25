// Who may open the staff pages that show patients, from the permission
// matrix in src/auth/roles.ts. The route guards in src/App.tsx and the
// navigation in src/components/Layout.tsx both use these lists, so staff
// only see links to pages they can open.

import { can, rolePermissionMatrix, type Permission, type Role } from "@/auth/roles";

/**
 * Station work with patients: registration, vitals, consultation and
 * pharmacy. The same list as the server's app_is_station_staff.
 */
const STATION_PERMISSIONS: Permission[] = ["register", "vitals", "consult", "dispense"];

/** Roles holding any of the permissions, in matrix order. */
function rolesWithAny(permissions: Permission[]): Role[] {
  const roles = Object.keys(rolePermissionMatrix().roles) as Role[];
  return roles.filter((role) => permissions.some((p) => can(role, p)));
}

/**
 * Patient list and patient records (/patients, /patients/:id): staff who see
 * patients at a station.
 */
export const PATIENT_RECORD_ROLES: Role[] = rolesWithAny(STATION_PERMISSIONS);

/** The queue (/queue): staff who move patients through it. */
export const QUEUE_ROLES: Role[] = rolesWithAny(["queue"]);

/**
 * Stock levels (/inventory): station staff, who check what is available,
 * and staff who manage stock. Only the inventory permission changes stock.
 */
export const INVENTORY_ROLES: Role[] = rolesWithAny([...STATION_PERMISSIONS, "inventory"]);

/** True when `role` is one of `roles`. */
export function roleIn(role: Role | null | undefined, roles: readonly Role[]): boolean {
  return !!role && roles.includes(role);
}
