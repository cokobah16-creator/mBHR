import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LockClosedIcon } from "@heroicons/react/24/outline";
import { useAuthStore } from "@/stores/auth";
import { can, getRoleDisplayName, type Permission } from "@/auth/roles";

const PERMISSION_LABEL: Record<Permission, string> = {
  register: "register patients",
  vitals: "record vital signs",
  consult: "document consultations",
  dispense: "dispense medication",
  inventory: "manage inventory",
  export: "export data",
  users: "manage staff accounts",
  approve_phi_conflicts: "approve sensitive record conflicts",
  audit_access: "view audit logs",
  resolve_conflicts: "resolve data conflicts",
  lab_review: "mark lab results reviewed",
};

type Props = {
  permission: Permission;
  children: ReactNode;
};

/**
 * Route guard backed by the RBAC matrix in src/auth/roles.ts.
 * Prefer this over hard-coded role lists so access follows the matrix.
 */
export default function RequirePermission({ permission, children }: Props) {
  const { currentUser } = useAuthStore();

  if (currentUser && can(currentUser.role, permission)) {
    return <>{children}</>;
  }

  return (
    <div className="max-w-lg mx-auto mt-10 panel p-6" role="alert">
      <div className="flex items-start gap-3">
        <LockClosedIcon className="h-6 w-6 text-ink-muted shrink-0" aria-hidden />
        <div>
          <h1 className="text-h2 text-ink">You can’t open this page</h1>
          <p className="mt-1 text-body text-ink-secondary">
            Your role
            {currentUser ? ` (${getRoleDisplayName(currentUser.role)})` : ""} is
            not allowed to {PERMISSION_LABEL[permission]}. Ask an administrator
            if you need access.
          </p>
          <Link to="/queue" className="btn-secondary mt-4">
            Back to queue
          </Link>
        </div>
      </div>
    </div>
  );
}
