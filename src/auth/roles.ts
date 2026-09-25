// Role-based access control system

export type Role =
  | "admin"
  | "doctor"
  | "nurse"
  | "pharmacist"
  | "volunteer"
  | "guest"
  | "auditor"
  | "lead_clinician"
  /**
   * Registration desk lead: register, queue, portal_manage and
   * portal_invite. No vitals (owner decision: registration, not clinical).
   */
  | "registration_lead";

export type Permission =
  | "register" // Register new patients
  | "vitals" // Record vital signs
  | "consult" // Perform consultations
  | "dispense" // Dispense medications
  | "inventory" // Manage inventory
  | "export" // Export data
  | "users" // Manage users
  | "approve_phi_conflicts" // Approve high-sensitivity PHI conflict resolutions
  | "audit_access" // Access audit logs and compliance reports
  | "resolve_conflicts" // Resolve data conflicts
  /**
   * Mark lab results reviewed (the clinical review of a result, including
   * abnormal and critical ones). Kept separate from "consult" so it can be
   * granted to other authorised professionals (for example lab scientists
   * or senior nurses) without granting consultations.
   *
   * Which roles hold it must follow DIOF's clinical policy, and must match
   * public.app_role_has_permission(..., 'lab_review') in the database, which
   * enforces the same rule on the server. Change both together.
   */
  | "lab_review"
  /**
   * Move patients through the queue and issue queue tickets. Station staff:
   * register holders, plus pharmacists (they finish the pharmacy stage).
   * Same list as the server's queue and queue_transitions rules.
   */
  | "queue"
  /** Turn a patient's portal access on or off (register holders). */
  | "portal_manage"
  /** Merge duplicate patient records (resolve_conflicts holders). */
  | "merge_patients"
  /** Release a reviewed lab result to the patient portal (lab_review holders). */
  | "lab_release"
  /**
   * Send a patient portal invitation by SMS or email: registration_lead,
   * lead_clinician and admin (owner decision). Separate from portal_manage:
   * volunteers turn portal access on at registration but do not send
   * invitations. The server checks the same rule before any invitation goes
   * out (public.app_role_has_permission(..., 'portal_invite'), used by the
   * send-sms-reminder and send-otp-email functions).
   */
  | "portal_invite";

// Role permission matrix. lab_review is granted to doctor, lead_clinician
// and admin for now; that list must follow DIOF clinical policy and match
// public.app_role_has_permission in the database (latest definition:
// supabase/migrations/20260925100600_registration_lead_portal_invite.sql).
// src/auth/roleMatrixParity.test.ts fails when the two differ.
const ROLE_PERMISSIONS: Record<Role, Record<Permission, boolean>> = {
  volunteer: {
    register: true,
    vitals: true,
    consult: false,
    dispense: false,
    inventory: false,
    export: false,
    users: false,
    approve_phi_conflicts: false,
    audit_access: false,
    resolve_conflicts: false,
    lab_review: false,
    queue: true,
    portal_manage: true,
    merge_patients: false,
    lab_release: false,
    portal_invite: false,
  },
  nurse: {
    register: true,
    vitals: true,
    consult: false,
    dispense: false,
    inventory: false,
    export: false,
    users: false,
    approve_phi_conflicts: false,
    audit_access: false,
    resolve_conflicts: true,
    lab_review: false,
    queue: true,
    portal_manage: true,
    merge_patients: true,
    lab_release: false,
    portal_invite: false,
  },
  doctor: {
    register: true,
    vitals: true,
    consult: true,
    dispense: false,
    inventory: false,
    export: false,
    users: false,
    approve_phi_conflicts: false,
    audit_access: false,
    resolve_conflicts: true,
    lab_review: true,
    queue: true,
    portal_manage: true,
    merge_patients: true,
    lab_release: true,
    portal_invite: false,
  },
  pharmacist: {
    register: false,
    vitals: false,
    consult: false,
    dispense: true,
    inventory: true,
    export: false,
    users: false,
    approve_phi_conflicts: false,
    audit_access: false,
    resolve_conflicts: false,
    lab_review: false,
    queue: true,
    portal_manage: false,
    merge_patients: false,
    lab_release: false,
    portal_invite: false,
  },
  admin: {
    register: true,
    vitals: true,
    consult: true,
    dispense: true,
    inventory: true,
    export: true,
    users: true,
    approve_phi_conflicts: true,
    audit_access: true,
    resolve_conflicts: true,
    lab_review: true,
    queue: true,
    portal_manage: true,
    merge_patients: true,
    lab_release: true,
    portal_invite: true,
  },
  guest: {
    register: false,
    vitals: false,
    consult: false,
    dispense: false,
    inventory: false,
    export: false,
    users: false,
    approve_phi_conflicts: false,
    audit_access: false,
    resolve_conflicts: false,
    lab_review: false,
    queue: false,
    portal_manage: false,
    merge_patients: false,
    lab_release: false,
    portal_invite: false,
  },
  auditor: {
    register: false,
    vitals: false,
    consult: false,
    dispense: false,
    inventory: false,
    export: true,
    users: false,
    approve_phi_conflicts: true,
    audit_access: true,
    resolve_conflicts: true,
    lab_review: false,
    queue: false,
    portal_manage: false,
    merge_patients: true,
    lab_release: false,
    portal_invite: false,
  },
  lead_clinician: {
    register: true,
    vitals: true,
    consult: true,
    dispense: false,
    inventory: false,
    export: true,
    users: false,
    approve_phi_conflicts: true,
    audit_access: true,
    resolve_conflicts: true,
    lab_review: true,
    queue: true,
    portal_manage: true,
    merge_patients: true,
    lab_release: true,
    portal_invite: true,
  },
  registration_lead: {
    register: true,
    // Owner decision: registration-focused, not clinical. Vitals stay with
    // staff explicitly assigned to that workflow.
    vitals: false,
    consult: false,
    dispense: false,
    inventory: false,
    export: false,
    users: false,
    approve_phi_conflicts: false,
    audit_access: false,
    resolve_conflicts: false,
    lab_review: false,
    queue: true,
    portal_manage: true,
    merge_patients: false,
    lab_release: false,
    portal_invite: true,
  },
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.[permission] ?? false;
}

/**
 * A staff role: one this app knows, other than "guest" (the no-access role
 * for an account without a server staff record).
 */
export function isStaffRole(role: unknown): boolean {
  return (
    typeof role === "string" &&
    role !== "guest" &&
    Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role)
  );
}

/**
 * Every role with the permissions it holds (and, under `all`, every
 * permission the app knows). Used to check this matrix against the database
 * copy (src/auth/roleMatrixParity.test.ts).
 */
export function rolePermissionMatrix(): {
  roles: Record<Role, Permission[]>;
  all: Permission[];
} {
  const roles = {} as Record<Role, Permission[]>;
  const all = new Set<Permission>();
  for (const [role, grants] of Object.entries(ROLE_PERMISSIONS) as [
    Role,
    Record<Permission, boolean>,
  ][]) {
    const held: Permission[] = [];
    for (const [permission, granted] of Object.entries(grants) as [
      Permission,
      boolean,
    ][]) {
      all.add(permission);
      if (granted) held.push(permission);
    }
    roles[role] = held;
  }
  return { roles, all: [...all] };
}

export function getRoleColor(role: Role): string {
  switch (role) {
    case "admin":
      return "bg-slate-100 text-slate-800";
    case "doctor":
      return "bg-blue-100 text-blue-800";
    case "nurse":
      return "bg-green-100 text-green-800";
    case "pharmacist":
      return "bg-orange-100 text-orange-800";
    case "volunteer":
      return "bg-gray-100 text-gray-800";
    case "guest":
      return "bg-gray-100 text-gray-500";
    case "auditor":
      return "bg-amber-100 text-amber-800";
    case "lead_clinician":
      return "bg-teal-100 text-teal-800";
    case "registration_lead":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

export function getRoleDisplayName(role: Role): string {
  const displayNames: Record<Role, string> = {
    admin: "Admin",
    doctor: "Doctor",
    nurse: "Nurse",
    pharmacist: "Pharmacist",
    volunteer: "Volunteer",
    guest: "Guest",
    auditor: "Auditor",
    lead_clinician: "Lead Clinician",
    registration_lead: "Registration lead",
  };
  return displayNames[role] || role.charAt(0).toUpperCase() + role.slice(1);
}

/** Roles that hold a permission, in matrix order. */
export function rolesWithPermission(permission: Permission): Role[] {
  return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) =>
    can(role, permission),
  );
}

/**
 * Plain refusal for staff whose role lacks portal_invite, naming the roles
 * that hold it. The services that send invitations and the screens that
 * explain a hidden "Send invitation" action use the same words.
 */
export function portalInviteRefusal(): string {
  const names = rolesWithPermission("portal_invite").map(getRoleDisplayName);
  return `Your role cannot send portal invitations. Roles that can: ${names.join(", ")}.`;
}

export function canApproveConflict(
  role: Role,
  phiSensitivity: "none" | "low" | "medium" | "high",
): boolean {
  if (phiSensitivity !== "high") {
    return can(role, "resolve_conflicts");
  }
  return can(role, "approve_phi_conflicts");
}

export function getRequiredApproverRole(
  entityType: string,
  phiSensitivity: "none" | "low" | "medium" | "high",
  conflictType: string,
): Role | null {
  if (phiSensitivity === "high" && entityType === "patients") {
    return "lead_clinician";
  }
  if (conflictType === "data_quality" && phiSensitivity === "high") {
    return "auditor";
  }
  if (phiSensitivity === "high") {
    return "admin";
  }
  return null;
}
