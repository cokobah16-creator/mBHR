/**
 * Patient Portal Authentication Service
 *
 * Offline-first patient portal auth backed by Dexie + localStorage.
 * Supports login via contact+DOB or contact+PIN (6-digit, SHA-256 hashed).
 */

import { db } from "@/db";
import { supabase } from "@/lib/supabase";
import { normalizePhone } from "@/utils/phone";
import * as logger from "@/lib/logger";
import type { PatientPortalAuthResponse } from "@/types/patientPortal";

const PORTAL_USERS_KEY = "mbhr_portal_users";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface ManagedPatient {
  patientId: string;
  givenName: string;
  familyName: string;
  relationship: string;
}

export interface LocalPortalUser {
  id: string;
  patientId: string;
  givenName: string;
  familyName: string;
  email?: string;
  phone?: string;
  dob: string;
  pin?: string;
  sessionToken?: string;
  sessionExpiresAt?: string;
  createdAt: string;
  isCaregiverAccount?: boolean;
  managedPatients?: ManagedPatient[];
}

function getLocalPortalUsers(): LocalPortalUser[] {
  try {
    return JSON.parse(localStorage.getItem(PORTAL_USERS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalPortalUsers(users: LocalPortalUser[]) {
  localStorage.setItem(PORTAL_USERS_KEY, JSON.stringify(users));
}

function normalize(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

async function hashPIN(pin: string): Promise<string> {
  const data = new TextEncoder().encode("mbhr_pin_salt_" + pin);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildAuthResponse(user: LocalPortalUser): PatientPortalAuthResponse {
  return {
    success: true,
    sessionToken: user.sessionToken,
    portalUser: {
      id: user.id,
      patientId: user.patientId,
      phoneNumber: user.phone || "",
      email: user.email,
      phoneVerified: !!user.phone,
      emailVerified: !!user.email,
      accountStatus: "active",
      failedLoginAttempts: 0,
      consentGiven: true,
      createdAt: new Date(user.createdAt),
      updatedAt: new Date(),
    },
    patient: {
      id: user.patientId,
      givenName: user.givenName,
      familyName: user.familyName,
      dob: user.dob,
      sex: "other",
    },
  };
}

/**
 * Register a new patient portal account.
 * Creates a Dexie patient record and a local portal user, and starts a session.
 */
export async function registerPatientPortalAccount(
  phone: string | undefined,
  email: string | undefined,
  dob: string,
  givenName: string,
  familyName: string,
  pin: string,
): Promise<PatientPortalAuthResponse> {
  try {
    if (!phone && !email) {
      return {
        success: false,
        error: "Please provide either a phone number or email address.",
      };
    }
    if (!dob) {
      return { success: false, error: "Date of birth is required." };
    }
    if (!pin || !/^\d{6}$/.test(pin)) {
      return { success: false, error: "A 6-digit PIN is required." };
    }

    const users = getLocalPortalUsers();
    const normalizedEmail = normalize(email);
    const normalizedPhone = normalize(phone);

    const duplicate = users.find(
      (u) =>
        (normalizedEmail && normalize(u.email) === normalizedEmail) ||
        (normalizedPhone && normalize(u.phone) === normalizedPhone),
    );
    if (duplicate) {
      return {
        success: false,
        error: "An account with that contact already exists. Please log in.",
      };
    }

    // --- Try to find existing patient record (staff-registered) before creating new ---
    let patientId: string | null = null;
    let existingPatientName: { givenName: string; familyName: string } | null =
      null;

    // 1. Check Supabase first (the source of truth for staff-registered patients)
    if (supabase && (email || phone)) {
      try {
        const normPhone = normalizePhone(phone);
        const orClauses: string[] = [];
        if (email) orClauses.push(`email.eq.${email.toLowerCase().trim()}`);
        if (normPhone) orClauses.push(`phone.eq.${normPhone}`);
        if (phone) orClauses.push(`phone.eq.${phone.trim()}`);

        const { data: match } = await supabase
          .from("patients")
          .select("id, given_name, family_name, dob, portal_enabled")
          .or(orClauses.join(","))
          .maybeSingle();

        if (match) {
          if (!match.portal_enabled) {
            return {
              success: false,
              error:
                "Your healthcare provider has not enabled portal access for you yet. Please ask them to enable it.",
            };
          }
          if (match.dob !== dob) {
            return {
              success: false,
              error:
                "Date of birth does not match our records. Please check and try again.",
            };
          }
          patientId = match.id;
          existingPatientName = {
            givenName: match.given_name,
            familyName: match.family_name,
          };
          logger.info(
            "Linked registration to existing Supabase patient:",
            patientId,
          );
        }
      } catch (sbError) {
        logger.warn(
          "Supabase patient lookup failed, falling back to local:",
          sbError,
        );
      }
    }

    // 2. Check local Dexie if no Supabase match
    if (!patientId) {
      const localMatches = await db.patients
        .where("email")
        .equalsIgnoreCase(email || "___nomatch___")
        .or("phone")
        .equals(normalizePhone(phone) || phone || "___nomatch___")
        .toArray();

      const localMatch = localMatches.find(
        (p) =>
          (normalizedEmail && normalize(p.email) === normalizedEmail) ||
          (normalizedPhone && normalize(p.phone) === normalizedPhone),
      );

      if (localMatch) {
        if (!localMatch.portalEnabled) {
          return {
            success: false,
            error:
              "Your healthcare provider has not enabled portal access for you yet. Please ask them to enable it.",
          };
        }
        if (localMatch.dob !== dob) {
          return {
            success: false,
            error:
              "Date of birth does not match our records. Please check and try again.",
          };
        }
        patientId = localMatch.id;
        existingPatientName = {
          givenName: localMatch.givenName,
          familyName: localMatch.familyName,
        };
        logger.info(
          "Linked registration to existing local patient:",
          patientId,
        );
      }
    }

    const now = new Date();

    // 3. No existing record found — create a new self-registered patient
    if (!patientId) {
      patientId = crypto.randomUUID();
      await db.patients.add({
        id: patientId,
        givenName,
        familyName,
        sex: "other",
        dob,
        phone: phone || "",
        address: "",
        state: "",
        lga: "",
        createdAt: now,
        updatedAt: now,
      });
    }

    // Use existing patient's name if we found a match
    const resolvedName = existingPatientName || { givenName, familyName };

    const hashedPin = pin ? await hashPIN(pin) : undefined;

    const portalUser: LocalPortalUser = {
      id: crypto.randomUUID(),
      patientId,
      givenName: resolvedName.givenName,
      familyName: resolvedName.familyName,
      email: email || undefined,
      phone: phone || undefined,
      dob,
      pin: hashedPin,
      sessionToken: crypto.randomUUID(),
      sessionExpiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
      managedPatients: [],
    };

    users.push(portalUser);
    saveLocalPortalUsers(users);

    return buildAuthResponse(portalUser);
  } catch (error) {
    logger.error("Error in registerPatientPortalAccount:", error);
    return {
      success: false,
      error: "Could not create account. Please try again.",
    };
  }
}

/**
 * Log a patient into the portal using their contact + date of birth or PIN.
 */
export async function loginPatientPortal(
  contact: string,
  credential: string,
  method: "dob" | "pin" = "dob",
): Promise<PatientPortalAuthResponse> {
  try {
    if (!contact || !credential) {
      return {
        success: false,
        error:
          "Please enter your contact and " +
          (method === "pin" ? "PIN" : "date of birth") +
          ".",
      };
    }

    const users = getLocalPortalUsers();
    const normalizedContact = normalize(contact);

    const user = users.find(
      (u) =>
        normalize(u.email) === normalizedContact ||
        normalize(u.phone) === normalizedContact,
    );

    if (!user) {
      // --- Dexie fallback: auto-create a portal session for staff-registered patients ---
      // Covers the case where the patient was registered by staff (stored in local Dexie)
      // but has never created a portal account via /patient/register.
      try {
        const emailNorm = contact.toLowerCase().trim();
        const normPhone = normalizePhone(contact);

        const emailMatches = await db.patients
          .where("email")
          .equalsIgnoreCase(emailNorm)
          .toArray();

        let candidates = emailMatches;

        if (candidates.length === 0 && normPhone) {
          candidates = await db.patients
            .where("phone")
            .equals(normPhone)
            .toArray();
        }

        // Filter by portalEnabled and, for DOB method, by credential up-front.
        // This prevents the first non-matching duplicate from blocking a valid login.
        const validCandidates = candidates.filter(
          (p) =>
            p.portalEnabled === 1 && (method !== "dob" || p.dob === credential),
        );

        if (validCandidates.length > 1) {
          return {
            success: false,
            error:
              "Multiple accounts match these details. Please contact your clinic to resolve duplicates.",
          };
        }

        const localPatient = validCandidates[0];

        // If candidates exist but none passed the filter, surface the right error.
        if (!localPatient && candidates.length > 0) {
          const anyEnabled = candidates.some((p) => p.portalEnabled === 1);
          if (!anyEnabled) {
            return {
              success: false,
              error:
                "Your healthcare provider has not enabled portal access for your account yet. Please ask the clinic to enable it.",
            };
          }
          return {
            success: false,
            error:
              "Date of birth does not match our records. Please use the format YYYY-MM-DD.",
          };
        }

        if (localPatient) {
          if (method === "pin") {
            return {
              success: false,
              error:
                "No PIN set for this account. Please log in with your date of birth.",
            };
          }

          // Auto-create a portal session for this staff-registered patient.
          const newPortalUser: LocalPortalUser = {
            id: crypto.randomUUID(),
            patientId: localPatient.id,
            givenName: localPatient.givenName,
            familyName: localPatient.familyName,
            email: localPatient.email || undefined,
            phone: localPatient.phone || undefined,
            dob: localPatient.dob,
            sessionToken: crypto.randomUUID(),
            sessionExpiresAt: new Date(
              Date.now() + SESSION_TTL_MS,
            ).toISOString(),
            createdAt: new Date().toISOString(),
            managedPatients: [],
          };

          users.push(newPortalUser);
          saveLocalPortalUsers(users);
          logger.info(
            "Auto-created portal session for staff-registered patient:",
            localPatient.id,
          );
          return buildAuthResponse(newPortalUser);
        }
      } catch (dexieErr) {
        logger.warn("Dexie patient lookup during login failed:", dexieErr);
      }

      // Supabase hint: give a more helpful error when the patient record exists online
      if (supabase) {
        try {
          const normPhone = normalizePhone(contact);
          const orClauses: string[] = [
            `email.eq.${contact.toLowerCase().trim()}`,
          ];
          if (normPhone) orClauses.push(`phone.eq.${normPhone}`);

          const { data: match } = await supabase
            .from("patients")
            .select("id, portal_enabled")
            .or(orClauses.join(","))
            .maybeSingle();

          if (match && match.portal_enabled) {
            return {
              success: false,
              error:
                "No portal account found. Please register first using the details your clinic has on file.",
            };
          }
        } catch {
          // ignore
        }
      }

      return {
        success: false,
        error: "No account found. Please register first.",
      };
    }

    if (method === "pin") {
      if (!user.pin) {
        return {
          success: false,
          error:
            "No PIN set for this account. Please log in with your date of birth.",
        };
      }
      const inputHash = await hashPIN(credential);
      if (inputHash !== user.pin) {
        return { success: false, error: "Incorrect PIN." };
      }
    } else {
      if (user.dob !== credential) {
        return {
          success: false,
          error: "Date of birth does not match our records.",
        };
      }
    }

    user.sessionToken = crypto.randomUUID();
    user.sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    saveLocalPortalUsers(users);

    return buildAuthResponse(user);
  } catch (error) {
    logger.error("Error in loginPatientPortal:", error);
    return { success: false, error: "Could not log in. Please try again." };
  }
}

/**
 * Validate a session token and return the associated portal user.
 */
export async function validateSession(
  sessionToken: string,
): Promise<LocalPortalUser | null> {
  const users = getLocalPortalUsers();
  const user = users.find((u) => u.sessionToken === sessionToken);
  if (!user) return null;
  if (user.sessionExpiresAt && new Date(user.sessionExpiresAt) < new Date()) {
    return null;
  }
  return user;
}

/**
 * Log the patient out and clear the local session.
 */
export async function logout(sessionToken: string): Promise<boolean> {
  const users = getLocalPortalUsers();
  const user = users.find((u) => u.sessionToken === sessionToken);
  if (user) {
    user.sessionToken = undefined;
    user.sessionExpiresAt = undefined;
    saveLocalPortalUsers(users);
  }
  sessionStorage.removeItem("patient_session_token");
  localStorage.removeItem("patient_portal_user");
  localStorage.removeItem("patient_active_profile");
  return true;
}

/**
 * Add a managed (dependent) patient to a caregiver's portal account.
 */
export async function addManagedPatient(
  portalUserId: string,
  patient: {
    givenName: string;
    familyName: string;
    dob: string;
    relationship: string;
  },
): Promise<{ success: boolean; patientId?: string; error?: string }> {
  try {
    const users = getLocalPortalUsers();
    const user = users.find((u) => u.id === portalUserId);
    if (!user) return { success: false, error: "Account not found." };

    const patientId = crypto.randomUUID();
    const now = new Date();

    await db.patients.add({
      id: patientId,
      givenName: patient.givenName,
      familyName: patient.familyName,
      sex: "other",
      dob: patient.dob,
      phone: "",
      address: "",
      state: "",
      lga: "",
      createdAt: now,
      updatedAt: now,
    });

    if (!user.managedPatients) user.managedPatients = [];
    user.managedPatients.push({
      patientId,
      givenName: patient.givenName,
      familyName: patient.familyName,
      relationship: patient.relationship,
    });
    user.isCaregiverAccount = true;
    saveLocalPortalUsers(users);

    return { success: true, patientId };
  } catch (error) {
    logger.error("Error in addManagedPatient:", error);
    return {
      success: false,
      error: "Could not add patient. Please try again.",
    };
  }
}

/**
 * No-op access logger kept for compatibility with patientPortalData.
 */
export async function logAccess(
  _portalUserId: string | undefined,
  _patientId: string,
  _actionType: string,
  _resourceType: string,
  _resourceId?: string,
  _success: boolean = true,
  _errorMessage?: string,
): Promise<void> {
  return;
}

// ─── Backward-compat stubs ────────────────────────────────────────────────

export interface OTPRequestArgs {
  phone?: string;
  email?: string;
  purpose: "registration" | "login" | "verification";
}

export async function requestOTP(
  _args: OTPRequestArgs,
): Promise<PatientPortalAuthResponse> {
  return { success: true };
}

export interface OTPVerificationArgs {
  phone?: string;
  email?: string;
  otp: string;
  dob?: string;
}

export async function verifyOTP(
  _args: OTPVerificationArgs,
): Promise<PatientPortalAuthResponse> {
  return {
    success: false,
    error: "OTP verification is disabled in offline mode.",
  };
}
