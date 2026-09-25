import { can, type Permission, type Role } from "@/auth/roles";

/**
 * Who may open an administration page.
 *
 * Each rule mirrors the guard on the matching route in src/App.tsx:
 * - `roles` mirrors `<RequireRoles roles={[...]}>`
 * - `permission` mirrors `<RequirePermission permission="...">`, or the
 *   in-page `can()` check a page makes when its route has no guard
 *   (/users checks `can(role, "users")` itself).
 * Keep these in step with App.tsx so staff only see links they can open.
 */
export type AdminAccessRule =
  | { kind: "roles"; roles: Role[] }
  | { kind: "permission"; permission: Permission };

export interface AdminEntry {
  id: string;
  title: string;
  /** One plain sentence: what the page does. */
  description: string;
  to: string;
  access: AdminAccessRule;
  /** The page only works with the server (Supabase) and a connection. */
  needsServer?: boolean;
}

export type AdminSectionId =
  | "outreach"
  | "access"
  | "data"
  | "interop"
  | "system";

export interface AdminSection {
  id: AdminSectionId;
  title: string;
  description: string;
  /** Plain-text pointer shown under the links (no link of its own). */
  note?: string;
  entries: AdminEntry[];
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id: "outreach",
    title: "Outreach",
    description: "Reports for the outreach this device is recording.",
    note: "The outreach site this device records visits for is set from the Outreach control at the top of every page.",
    entries: [
      {
        id: "outreach-reports",
        title: "Outreach reports",
        description:
          "Patients seen, demographics, conditions, medicines dispensed and volunteer attendance for an outreach window.",
        to: "/reports/outreach",
        access: { kind: "roles", roles: ["admin", "doctor", "nurse"] },
      },
      {
        id: "pharmacy-reports",
        title: "Pharmacy reports",
        description: "Dispensing and stock reports for the pharmacy.",
        to: "/pharmacy/reports",
        access: { kind: "roles", roles: ["pharmacist", "admin"] },
      },
      {
        id: "analytics",
        title: "Clinic analytics",
        description:
          "Registrations, visits and other activity recorded on this device over a date range.",
        to: "/analytics",
        access: { kind: "roles", roles: ["admin"] },
      },
    ],
  },
  {
    id: "access",
    title: "Users & access",
    description: "Who can sign in on this device and what they can do.",
    entries: [
      {
        id: "users",
        title: "Staff accounts",
        description:
          "Add staff, set their role and PIN, and deactivate accounts that should no longer sign in.",
        to: "/users",
        access: { kind: "permission", permission: "users" },
      },
      {
        id: "approvals",
        title: "Training game approvals",
        description:
          "Review finished training game sessions and approve the tokens they earned.",
        to: "/admin/approvals",
        access: { kind: "roles", roles: ["admin"] },
      },
    ],
  },
  {
    id: "data",
    title: "Data",
    description: "Sync problems and exports of the records stored on this device.",
    note: "Upload status for this device is shown in the sync control at the top of every page.",
    entries: [
      {
        id: "conflicts",
        title: "Sync conflicts",
        description:
          "Records changed both on this device and on the server: choose which version to keep.",
        to: "/admin/conflicts",
        access: { kind: "roles", roles: ["admin", "doctor", "nurse", "lead_clinician", "auditor"] },
      },
      {
        id: "fhir-export",
        title: "Bulk FHIR export",
        description:
          "Download every patient record on this device as FHIR NDJSON files in one ZIP file.",
        to: "/admin/fhir-export",
        access: { kind: "permission", permission: "export" },
      },
    ],
  },
  {
    id: "interop",
    title: "Interoperability",
    description:
      "The patient portal and data exchange. The FHIR export is listed under Data.",
    entries: [
      {
        id: "portal-dashboard",
        title: "Patient portal overview",
        description:
          "How many patients on this device have portal access, have verified their contact and used the portal recently.",
        to: "/admin/portal-dashboard",
        access: { kind: "roles", roles: ["admin"] },
      },
      {
        id: "portal-migration",
        title: "Enable portal access",
        description:
          "Turn on portal access for patients on this device who have a phone number or email, with or without invitations.",
        to: "/admin/portal-migration",
        access: { kind: "roles", roles: ["admin"] },
      },
      {
        id: "bulk-portal-migration",
        title: "Create portal accounts on the server",
        description:
          "Create portal accounts for patients in the server database.",
        to: "/admin/bulk-portal-migration",
        access: { kind: "roles", roles: ["admin"] },
        needsServer: true,
      },
    ],
  },
  {
    id: "system",
    title: "System",
    description: "Settings for this device and the services it depends on.",
    entries: [
      {
        id: "settings",
        title: "Device settings",
        description:
          "Device recovery: erase this device's local data when it is corrupted or being handed over.",
        to: "/admin/settings",
        access: { kind: "roles", roles: ["admin"] },
      },
      {
        id: "email-diagnostics",
        title: "Email delivery check",
        description:
          "Check whether portal emails can be sent and send a test email.",
        to: "/admin/email-diagnostics",
        access: { kind: "roles", roles: ["admin"] },
        needsServer: true,
      },
    ],
  },
];

/** True when `role` passes the same guard App.tsx puts on the entry's route. */
export function canOpenAdminEntry(
  role: Role | null | undefined,
  entry: AdminEntry,
): boolean {
  if (!role) return false;
  const rule = entry.access;
  if (rule.kind === "roles") return rule.roles.includes(role);
  return can(role, rule.permission);
}

/** The sections and entries `role` can open; sections left empty are dropped. */
export function adminSectionsForRole(
  role: Role | null | undefined,
  sections: AdminSection[] = ADMIN_SECTIONS,
): AdminSection[] {
  return sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((e) => canOpenAdminEntry(role, e)),
    }))
    .filter((section) => section.entries.length > 0);
}

/** Whether the Administration overview has anything to show for `role`. */
export function hasAnyAdminEntry(role: Role | null | undefined): boolean {
  return adminSectionsForRole(role).length > 0;
}

/**
 * Portal enrollment pages (/admin/portal-*) are guarded by
 * RequireRoles(["admin"]) in App.tsx and no RBAC permission covers them, so
 * writes on those pages check the same rule.
 */
export function canManagePortalEnrollment(
  role: Role | null | undefined,
): boolean {
  return role === "admin";
}

/**
 * System pages (/admin/settings, /admin/email-diagnostics) are guarded by
 * RequireRoles(["admin"]) in App.tsx; actions on them check the same rule.
 */
export function canUseSystemTools(role: Role | null | undefined): boolean {
  return role === "admin";
}
