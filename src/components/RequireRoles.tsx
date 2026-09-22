import React from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { hasRole, type Role } from "@/utils/permissions";

type Props = {
  roles: Role[];
  children: React.ReactNode;
};

export default function RequireRoles({ roles, children }: Props) {
  const { currentUser } = useAuthStore();

  if (!hasRole(currentUser, roles)) {
    const userRole = currentUser?.role ?? "none";
    return (
      <div className="max-w-lg mx-auto mt-10 panel p-6" role="alert">
        <div className="flex items-start gap-3">
          <ExclamationTriangleIcon
            className="h-6 w-6 text-warning shrink-0"
            aria-hidden
          />
          <div>
            <h1 className="text-h2 text-ink">You can’t open this page</h1>
            <p className="mt-1 text-body text-ink-secondary">
              This page is available to: {roles.join(", ")}. Your role is{" "}
              {userRole}. Ask an administrator if you need access.
            </p>
            <Link to="/dashboard" className="btn-secondary mt-4">
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
