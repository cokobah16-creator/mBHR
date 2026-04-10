// Role-based access control system

export type Role =
  | "admin"
  | "doctor"
  | "nurse"
  | "pharmacist"
  | "volunteer"
  | "guest"
  | "auditor"
  | "lead_clinician";

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
  | "resolve_conflicts"; // Resolve data conflicts

// Role permission matrix
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
  },
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.[permission] ?? false;
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
  };
  return displayNames[role] || role.charAt(0).toUpperCase() + role.slice(1);
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
