import { useAuthStore } from "@/stores/auth";
import {
  hasPermission,
  hasRole,
  type Permission,
  type Role,
} from "@/utils/permissions";

export function usePermissions() {
  const { currentUser } = useAuthStore();
  return {
    can: (permission: Permission) => hasPermission(currentUser, permission),
    is: (...roles: Role[]) => hasRole(currentUser, roles),
    user: currentUser,
  };
}
