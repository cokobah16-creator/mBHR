/**
 * Small, safe readers for the patient-portal session copy kept in
 * localStorage ("patient_portal_user"). Every access is wrapped so a
 * private window, cleared storage or a corrupt value never crashes a page.
 */
import type { ManagedPatient } from "@/services/patientPortalAuth";

export const PORTAL_USER_KEY = "patient_portal_user";
export const ACTIVE_PROFILE_KEY = "patient_active_profile";

export interface PortalSessionUser {
  id?: string;
  patientId?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  managedPatients?: ManagedPatient[];
  [key: string]: unknown;
}

/** Parse a stored portal user. Returns null for missing or unreadable values. */
export function parsePortalUser(raw: string | null): PortalSessionUser | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as PortalSessionUser;
  } catch {
    return null;
  }
}

export function readPortalUser(): PortalSessionUser | null {
  try {
    return parsePortalUser(localStorage.getItem(PORTAL_USER_KEY));
  } catch {
    return null;
  }
}

export function writePortalUser(user: PortalSessionUser): boolean {
  try {
    localStorage.setItem(PORTAL_USER_KEY, JSON.stringify(user));
    return true;
  } catch {
    return false;
  }
}

/**
 * A log-safe description of an error: its name or code, never its message
 * (Supabase and storage messages can echo names, phone numbers or notes).
 */
export function errorName(err: unknown): string {
  if (err instanceof Error) return err.name;
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") {
      return `code ${code}`;
    }
    return "object";
  }
  return typeof err;
}
