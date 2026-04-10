/**
 * Patient Portal Authentication Service
 *
 * Offline-first patient portal auth backed by Dexie + localStorage.
 * No OTP, no demo mode. The patient registers with their personal info
 * and logs back in using the same identifier (email or phone) + date of birth.
 */
import { db } from "@/db";
import * as logger from "@/lib/logger";
const PORTAL_USERS_KEY = "mbhr_portal_users";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
function getLocalPortalUsers() {
    try {
        return JSON.parse(localStorage.getItem(PORTAL_USERS_KEY) || "[]");
    }
    catch {
        return [];
    }
}
function saveLocalPortalUsers(users) {
    localStorage.setItem(PORTAL_USERS_KEY, JSON.stringify(users));
}
function normalize(value) {
    return (value || "").trim().toLowerCase();
}
function buildAuthResponse(user) {
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
export async function registerPatientPortalAccount(phone, email, dob, givenName, familyName) {
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
        const users = getLocalPortalUsers();
        const normalizedEmail = normalize(email);
        const normalizedPhone = normalize(phone);
        const duplicate = users.find((u) => (normalizedEmail && normalize(u.email) === normalizedEmail) ||
            (normalizedPhone && normalize(u.phone) === normalizedPhone));
        if (duplicate) {
            return {
                success: false,
                error: "An account with that contact already exists. Please log in.",
            };
        }
        const patientId = crypto.randomUUID();
        const now = new Date();
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
        const portalUser = {
            id: crypto.randomUUID(),
            patientId,
            givenName,
            familyName,
            email: email || undefined,
            phone: phone || undefined,
            dob,
            sessionToken: crypto.randomUUID(),
            sessionExpiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
            createdAt: now.toISOString(),
        };
        users.push(portalUser);
        saveLocalPortalUsers(users);
        return buildAuthResponse(portalUser);
    }
    catch (error) {
        logger.error("Error in registerPatientPortalAccount:", error);
        return {
            success: false,
            error: "Could not create account. Please try again.",
        };
    }
}
/**
 * Log a patient into the portal using their contact + date of birth.
 */
export async function loginPatientPortal(contact, dob) {
    try {
        if (!contact || !dob) {
            return {
                success: false,
                error: "Please enter your contact and date of birth.",
            };
        }
        const users = getLocalPortalUsers();
        const normalizedContact = normalize(contact);
        const user = users.find((u) => normalize(u.email) === normalizedContact ||
            normalize(u.phone) === normalizedContact);
        if (!user) {
            return {
                success: false,
                error: "No account found. Please register first.",
            };
        }
        if (user.dob !== dob) {
            return {
                success: false,
                error: "Date of birth does not match our records.",
            };
        }
        user.sessionToken = crypto.randomUUID();
        user.sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
        saveLocalPortalUsers(users);
        return buildAuthResponse(user);
    }
    catch (error) {
        logger.error("Error in loginPatientPortal:", error);
        return { success: false, error: "Could not log in. Please try again." };
    }
}
/**
 * Validate a session token and return the associated portal user.
 */
export async function validateSession(sessionToken) {
    const users = getLocalPortalUsers();
    const user = users.find((u) => u.sessionToken === sessionToken);
    if (!user)
        return null;
    if (user.sessionExpiresAt && new Date(user.sessionExpiresAt) < new Date()) {
        return null;
    }
    return user;
}
/**
 * Log the patient out and clear the local session.
 */
export async function logout(sessionToken) {
    const users = getLocalPortalUsers();
    const user = users.find((u) => u.sessionToken === sessionToken);
    if (user) {
        user.sessionToken = undefined;
        user.sessionExpiresAt = undefined;
        saveLocalPortalUsers(users);
    }
    localStorage.removeItem("patient_session_token");
    localStorage.removeItem("patient_portal_user");
    return true;
}
/**
 * No-op access logger kept for compatibility with patientPortalData.
 * Offline mode does not persist portal access logs.
 */
export async function logAccess(_portalUserId, _patientId, _actionType, _resourceType, _resourceId, _success = true, _errorMessage) {
    return;
}
