/**
 * Patient portal session helpers.
 *
 * The login flows (offline token and Supabase) store the signed-in patient in
 * localStorage under `patient_portal_user`, and a caregiver's chosen profile
 * under `patient_active_profile`. These helpers read them defensively: a
 * missing or corrupt value returns null instead of throwing mid-render.
 */
import type { ManagedPatient } from "@/services/patientPortalAuth";

export const PORTAL_USER_KEY = "patient_portal_user";
export const ACTIVE_PROFILE_KEY = "patient_active_profile";
export const SESSION_TOKEN_KEY = "patient_session_token";

export interface PortalUser {
  /** Portal account id (Supabase auth uid or local portal user id). */
  id: string;
  /** The patient record this account belongs to. */
  patientId: string;
  givenName: string;
  familyName: string;
  managedPatients: ManagedPatient[];
}

export interface ActiveProfile {
  patientId: string;
  givenName: string;
  familyName: string;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/** Parse the stored portal user. Returns null for missing or unreadable data. */
export function parsePortalUser(raw: string | null): PortalUser | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const u = parsed as Record<string, unknown>;
    return {
      id: asString(u.id),
      patientId: asString(u.patientId),
      givenName: asString(u.givenName),
      familyName: asString(u.familyName),
      managedPatients: Array.isArray(u.managedPatients)
        ? (u.managedPatients as ManagedPatient[])
        : [],
    };
  } catch {
    return null;
  }
}

/** Parse the caregiver's selected profile. Returns null when none is set. */
export function parseActiveProfile(raw: string | null): ActiveProfile | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    const patientId = asString(p.patientId);
    if (!patientId) return null;
    return {
      patientId,
      givenName: asString(p.givenName),
      familyName: asString(p.familyName),
    };
  } catch {
    return null;
  }
}

/**
 * The patient whose records should be shown. A caregiver may switch to a
 * managed patient, but only to one listed on their own account (IDOR guard);
 * anything else falls back to the account's own patient.
 */
export function resolveActivePatientId(
  user: Pick<PortalUser, "patientId" | "managedPatients">,
  activeProfile: Pick<ActiveProfile, "patientId"> | null,
): string {
  if (!activeProfile) return user.patientId;
  const owned = [
    user.patientId,
    ...user.managedPatients.map((m) => m.patientId),
  ];
  return owned.includes(activeProfile.patientId)
    ? activeProfile.patientId
    : user.patientId;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readPortalUser(): PortalUser | null {
  return parsePortalUser(safeGet(PORTAL_USER_KEY));
}

export function readActiveProfile(): ActiveProfile | null {
  return parseActiveProfile(safeGet(ACTIVE_PROFILE_KEY));
}

/** Remove every portal session key from this device. */
export function clearPortalSession(): void {
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(PORTAL_USER_KEY);
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
  } catch {
    // Storage blocked: nothing we can clear.
  }
}

/**
 * True for the keys supabase-js uses to keep a sign-in in this browser
 * ("sb-<project>-auth-token" and its PKCE "-code-verifier").
 */
export function isSupabaseAuthKey(key: string): boolean {
  return /^sb-.+-auth-token(-code-verifier)?$/.test(key);
}

/**
 * Remove any Supabase sign-in kept in this browser. `auth.signOut()` needs
 * the network: offline it returns an error and leaves the session on the
 * phone, so the next person could reopen this patient's records once online.
 */
export function clearStoredSupabaseAuth(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isSupabaseAuthKey(key)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage blocked: nothing we can clear.
  }
}
