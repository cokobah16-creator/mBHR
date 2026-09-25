import { can, getRoleDisplayName, type Permission, type Role } from "@/auth/roles";
import type { User } from "@/db";

/** Roles a staff account on this device can hold. */
export type StaffRole = User["role"];

/** Roles an administrator can give a staff account from this device. */
export const ASSIGNABLE_ROLES: StaffRole[] = [
  "volunteer",
  "registration_lead",
  "nurse",
  "doctor",
  "pharmacist",
  "admin",
];

export interface StaffFormValues {
  fullName: string;
  role: StaffRole;
  email: string;
  phone: string;
  pin: string;
  confirmPin: string;
}

export type StaffFormField = keyof StaffFormValues;
export type StaffFormErrors = Partial<Record<StaffFormField, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks a staff account form. When editing, the PIN may be left blank to
 * keep the current one; when adding, a PIN is required.
 */
export function validateStaffForm(
  values: StaffFormValues,
  mode: "create" | "edit",
): StaffFormErrors {
  const errors: StaffFormErrors = {};
  const name = values.fullName.trim();

  if (!name) errors.fullName = "Enter the person's full name.";
  else if (name.length < 2) errors.fullName = "Enter the full name, not initials.";

  if (!ASSIGNABLE_ROLES.includes(values.role) && mode === "create") {
    errors.role = "Choose a role.";
  }

  const email = values.email.trim();
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.email = "Enter an email address like name@example.com, or leave it blank.";
  }

  const phone = values.phone.trim();
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (!/^[+\d\s()-]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
      errors.phone = "Enter a phone number like 0803 123 4567, or leave it blank.";
    }
  }

  const pinRequired = mode === "create" || values.pin !== "" || values.confirmPin !== "";
  if (pinRequired) {
    if (!/^\d{6}$/.test(values.pin)) {
      errors.pin = "The PIN must be exactly 6 digits.";
    } else if (values.pin !== values.confirmPin) {
      errors.confirmPin = "The two PINs do not match.";
    }
  }

  return errors;
}

const ACCESS_LABELS: [Permission, string][] = [
  ["register", "register patients"],
  ["vitals", "record vital signs"],
  ["consult", "document consultations"],
  ["dispense", "dispense medicines"],
  ["inventory", "manage inventory"],
  ["export", "export data"],
  ["users", "manage staff accounts"],
  ["resolve_conflicts", "resolve sync conflicts"],
  ["queue", "move patients through the queue"],
  ["portal_manage", "manage patient portal access"],
  ["portal_invite", "send patient portal invitations"],
  ["merge_patients", "merge patient records"],
  ["lab_review", "mark lab results reviewed"],
  ["lab_release", "release lab results to patients"],
];

/** What a role can do, in words, from the RBAC matrix in src/auth/roles.ts. */
export function describeRoleAccess(role: Role): string {
  const allowed = ACCESS_LABELS.filter(([p]) => can(role, p)).map(([, l]) => l);
  const name = getRoleDisplayName(role);
  if (allowed.length === 0) return `${name}: no clinical or admin actions.`;
  if (allowed.length === 1) return `${name}: can ${allowed[0]}.`;
  return `${name}: can ${allowed.slice(0, -1).join(", ")} and ${allowed[allowed.length - 1]}.`;
}

/** Actions the new role loses compared with the old one. */
export function lostAccess(from: Role, to: Role): string[] {
  return ACCESS_LABELS.filter(([p]) => can(from, p) && !can(to, p)).map(
    ([, l]) => l,
  );
}

/** Actions the new role gains compared with the old one. */
export function gainedAccess(from: Role, to: Role): string[] {
  return ACCESS_LABELS.filter(([p]) => !can(from, p) && can(to, p)).map(
    ([, l]) => l,
  );
}
