/**
 * Caregiver ("someone I look after") profiles in the patient portal.
 *
 * addManagedPatient() in services/patientPortalAuth records a new profile in
 * the device's portal-account store, but the signed-in session copy
 * ("patient_portal_user") is what the profile switcher and the dashboard's
 * ownership check read. These helpers keep the two in step and let the
 * account holder remove a profile again.
 *
 * NOTE: LOCAL_PORTAL_USERS_KEY mirrors PORTAL_USERS_KEY in
 * services/patientPortalAuth.ts. Once that service exposes list/remove
 * functions for managed patients, switch to those and delete the storage
 * code here.
 */
import type { ManagedPatient } from "@/services/patientPortalAuth";
import {
  ACTIVE_PROFILE_KEY,
  readPortalUser,
  writePortalUser,
} from "./portalSession";

export const LOCAL_PORTAL_USERS_KEY = "mbhr_portal_users";

export const RELATIONSHIP_OPTIONS = [
  { value: "child", label: "My child" },
  { value: "parent", label: "My parent" },
  { value: "spouse", label: "My spouse or partner" },
  { value: "sibling", label: "My brother or sister" },
  { value: "other", label: "Someone else I look after" },
] as const;

export type Relationship = (typeof RELATIONSHIP_OPTIONS)[number]["value"];

export function relationshipLabel(value: string): string {
  return (
    RELATIONSHIP_OPTIONS.find((o) => o.value === value)?.label ?? "Other"
  );
}

/** Append a profile, replacing any existing entry for the same patient. */
export function withManagedPatient(
  list: ManagedPatient[] | undefined,
  patient: ManagedPatient,
): ManagedPatient[] {
  const rest = (list ?? []).filter((p) => p.patientId !== patient.patientId);
  return [...rest, patient];
}

export function withoutManagedPatient(
  list: ManagedPatient[] | undefined,
  patientId: string,
): ManagedPatient[] {
  return (list ?? []).filter((p) => p.patientId !== patientId);
}

/** Union of two lists, first occurrence of each patient wins. */
export function mergeManagedPatients(
  ...lists: (ManagedPatient[] | undefined)[]
): ManagedPatient[] {
  const seen = new Set<string>();
  const out: ManagedPatient[] = [];
  for (const list of lists) {
    for (const p of list ?? []) {
      if (!p || typeof p.patientId !== "string" || seen.has(p.patientId)) {
        continue;
      }
      seen.add(p.patientId);
      out.push(p);
    }
  }
  return out;
}

interface StoredPortalAccount {
  id: string;
  managedPatients?: ManagedPatient[];
  [key: string]: unknown;
}

export function parsePortalAccounts(raw: string | null): StoredPortalAccount[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredPortalAccount[]) : [];
  } catch {
    return [];
  }
}

function readPortalAccounts(): StoredPortalAccount[] {
  try {
    return parsePortalAccounts(localStorage.getItem(LOCAL_PORTAL_USERS_KEY));
  } catch {
    return [];
  }
}

/**
 * Whether this signed-in account is one kept on this device. Caregiver
 * profiles can only be added to those accounts (online accounts are not
 * supported by addManagedPatient yet).
 */
export function hasLocalPortalAccount(portalUserId: string | undefined): boolean {
  if (!portalUserId) return false;
  return readPortalAccounts().some((u) => u.id === portalUserId);
}

/** Every profile this account currently manages, from both stores. */
export function listManagedPatients(
  portalUserId: string | undefined,
): ManagedPatient[] {
  const session = readPortalUser();
  const stored = portalUserId
    ? readPortalAccounts().find((u) => u.id === portalUserId)?.managedPatients
    : undefined;
  return mergeManagedPatients(session?.managedPatients, stored);
}

/**
 * Copy every profile this account manages on this device into the signed-in
 * session. Logging in does not bring them across yet, so without this the
 * profile switcher and the dashboard cannot reach them after the next login.
 * Returns the merged list (empty when there is no session).
 */
export function syncSessionManagedPatients(
  portalUserId: string | undefined,
): ManagedPatient[] {
  const session = readPortalUser();
  if (!session || !portalUserId) return [];
  const merged = listManagedPatients(portalUserId);
  if (hasProfilesMissingFrom(session.managedPatients, merged)) {
    writePortalUser({ ...session, managedPatients: merged });
  }
  return merged;
}

/** True when `all` holds a profile that `session` does not list. */
export function hasProfilesMissingFrom(
  session: ManagedPatient[] | undefined,
  all: ManagedPatient[],
): boolean {
  const ids = new Set(
    (session ?? []).filter((p) => p && typeof p.patientId === "string").map((p) => p.patientId),
  );
  return all.some((p) => !ids.has(p.patientId));
}

/** Make a just-added profile available in this session (switcher + dashboard). */
export function addManagedPatientToSession(patient: ManagedPatient): boolean {
  const session = readPortalUser();
  if (!session) return false;
  return writePortalUser({
    ...session,
    managedPatients: withManagedPatient(session.managedPatients, patient),
  });
}

/**
 * Stop managing a profile: remove it from the account on this device and
 * from the current session, and switch back to the account holder if it
 * was the profile being viewed. The person's health record itself is not
 * deleted.
 */
export function removeManagedPatientLink(
  portalUserId: string,
  patientId: string,
): boolean {
  try {
    const accounts = readPortalAccounts();
    const updated = accounts.map((u) =>
      u.id === portalUserId
        ? {
            ...u,
            managedPatients: withoutManagedPatient(u.managedPatients, patientId),
          }
        : u,
    );
    localStorage.setItem(LOCAL_PORTAL_USERS_KEY, JSON.stringify(updated));

    const session = readPortalUser();
    if (session) {
      writePortalUser({
        ...session,
        managedPatients: withoutManagedPatient(
          session.managedPatients,
          patientId,
        ),
      });
    }

    const active = localStorage.getItem(ACTIVE_PROFILE_KEY);
    if (active) {
      try {
        const parsed = JSON.parse(active) as { patientId?: string };
        if (parsed?.patientId === patientId) {
          localStorage.removeItem(ACTIVE_PROFILE_KEY);
        }
      } catch {
        localStorage.removeItem(ACTIVE_PROFILE_KEY);
      }
    }
    return true;
  } catch {
    return false;
  }
}
