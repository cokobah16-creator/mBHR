import type { Patient } from "@/db";
import type { Tone } from "@/components/ui/StatusBadge";

/** The fields of a patient record the portal admin pages read. */
export type PortalPatientFields = Pick<
  Patient,
  | "givenName"
  | "familyName"
  | "email"
  | "phone"
  | "portalEnabled"
  | "contactVerified"
  | "lastPortalActivity"
  | "portalInvitation"
>;

export type PortalStatus = "verified" | "pending" | "not-enabled";

export const PORTAL_STATUS: Record<PortalStatus, { label: string; tone: Tone }> = {
  verified: { label: "Verified", tone: "success" },
  pending: { label: "Pending verification", tone: "warning" },
  "not-enabled": { label: "Not enabled", tone: "neutral" },
};

export function portalStatusOf(p: PortalPatientFields): PortalStatus {
  if (p.portalEnabled !== 1) return "not-enabled";
  return p.contactVerified === 1 ? "verified" : "pending";
}

export interface PortalStats {
  totalPatients: number;
  portalEnabled: number;
  verified: number;
  active30Days: number;
  /** Patients sent at least one invitation (not the number of messages). */
  invitationsSent: number;
  pendingVerification: number;
}

export function computePortalStats(
  patients: PortalPatientFields[],
  now: Date = new Date(),
): PortalStats {
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  return {
    totalPatients: patients.length,
    portalEnabled: patients.filter((p) => p.portalEnabled === 1).length,
    // Same rule as the "Verified" badge: a verified contact only counts while
    // portal access is on, so the percentage of enabled patients stays <= 100.
    verified: patients.filter((p) => portalStatusOf(p) === "verified").length,
    active30Days: patients.filter(
      (p) =>
        !!p.lastPortalActivity &&
        new Date(p.lastPortalActivity) > thirtyDaysAgo,
    ).length,
    invitationsSent: patients.filter(
      (p) => (p.portalInvitation?.count ?? 0) > 0,
    ).length,
    pendingVerification: patients.filter(
      (p) => p.portalEnabled === 1 && p.contactVerified !== 1,
    ).length,
  };
}

/** Whole-number percentage, or null when there is nothing to divide by. */
export function percentOf(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

export type PortalFilter = "all" | "enabled" | "disabled" | "verified" | "pending";

export const PORTAL_FILTERS: { id: PortalFilter; label: string }[] = [
  { id: "all", label: "All patients" },
  { id: "enabled", label: "Portal enabled" },
  { id: "disabled", label: "Portal not enabled" },
  { id: "verified", label: "Verified" },
  { id: "pending", label: "Pending verification" },
];

export function isPortalFilter(value: string): value is PortalFilter {
  return PORTAL_FILTERS.some((f) => f.id === value);
}

export function filterPortalPatients<T extends PortalPatientFields>(
  patients: T[],
  query: string,
  filter: PortalFilter,
): T[] {
  const q = query.trim().toLowerCase();
  return patients.filter((p) => {
    if (
      q &&
      !(
        p.givenName.toLowerCase().includes(q) ||
        p.familyName.toLowerCase().includes(q) ||
        (p.email ?? "").toLowerCase().includes(q) ||
        (p.phone ?? "").includes(q)
      )
    ) {
      return false;
    }
    switch (filter) {
      case "enabled":
        return p.portalEnabled === 1;
      case "disabled":
        return p.portalEnabled !== 1;
      case "verified":
        return portalStatusOf(p) === "verified";
      case "pending":
        return p.portalEnabled === 1 && p.contactVerified !== 1;
      default:
        return true;
    }
  });
}

// ---------- Bulk run reports ----------

export interface BulkRunTarget {
  id: string;
  name: string;
}

export interface BulkRunError {
  patientId: string;
  error: string;
}

/**
 * Quotes a CSV cell so commas, quotes and line breaks survive. A cell that
 * starts with = + - @ (or a tab/CR) is prefixed with ' so a spreadsheet
 * shows it as text instead of running it as a formula.
 */
export function csvCell(value: string): string {
  const safe = /^[=+@\t\r-]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

/** One row per patient in the run: succeeded, or failed with the reason. */
export function buildRunCsv(
  targets: BulkRunTarget[],
  errors: BulkRunError[],
): string {
  const byId = new Map(errors.map((e) => [e.patientId, e.error]));
  const rows = [
    ["Patient ID", "Name", "Result", "Reason"],
    ...targets.map((t) => {
      const reason = byId.get(t.id);
      return [t.id, t.name, reason === undefined ? "Succeeded" : "Failed", reason ?? ""];
    }),
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

/** Groups failure reasons so a summary can say "12 × Patient not found". */
export function groupFailureReasons(
  errors: BulkRunError[],
): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of errors) counts.set(e.error, (counts.get(e.error) ?? 0) + 1);
  return Array.from(counts, ([reason, count]) => ({ reason, count })).sort(
    (a, b) => b.count - a.count || a.reason.localeCompare(b.reason),
  );
}
