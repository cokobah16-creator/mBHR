/**
 * Unified Portal Enrollment Service
 *
 * Connects staff registration with patient portal access.
 * When staff register a patient with email/phone, automatically creates portal account.
 */

import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";
import { safeErrorLabel } from "./logSafe";

export interface EnrollmentResult {
  success: boolean;
  portalUserId?: string;
  error?: string;
  invitationSent?: boolean;
}

export interface PatientEnrollmentData {
  patientId: string;
  givenName: string;
  familyName: string;
  dob: string;
  phone?: string;
  email?: string;
  sex?: string;
}

/**
 * Why portal accounts cannot be created from this device right now, or null.
 * Portal accounts live only on the mBHR server.
 */
function serverUnavailableReason(): string | null {
  if (!supabase) {
    return "Portal accounts are made on the mBHR server, which is not connected on this device";
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "This device is offline. Portal accounts can only be made when it is online";
  }
  return null;
}

/**
 * Enroll a patient in the portal (creates portal user account)
 * Called automatically when staff registers a patient with contact info
 */
export async function enrollPatientInPortal(
  data: PatientEnrollmentData,
): Promise<EnrollmentResult> {
  try {
    const { patientId, givenName, familyName, dob, phone, email, sex } = data;

    if (!phone && !email) {
      return {
        success: false,
        error: "Patient must have email or phone number for portal access",
      };
    }

    // Say plainly that this needs the server, instead of failing on a
    // missing client or a network error.
    const unavailable = serverUnavailableReason();
    if (unavailable) {
      return { success: false, error: unavailable };
    }

    // Check if patient already has portal account
    const { data: existingPortalUser } = await supabase
      .from("patient_portal_users")
      .select("id")
      .eq("patient_id", patientId)
      .maybeSingle();

    if (existingPortalUser) {
      return {
        success: true,
        portalUserId: existingPortalUser.id,
        error: "Patient already has portal access",
      };
    }

    // Check for duplicate email/phone in portal users
    if (email) {
      const { data: emailConflict } = await supabase
        .from("patient_portal_users")
        .select("id")
        .ilike("email", email)
        .maybeSingle();

      if (emailConflict) {
        return {
          success: false,
          error: "Email already registered in portal",
        };
      }
    }

    if (phone) {
      const { data: phoneConflict } = await supabase
        .from("patient_portal_users")
        .select("id")
        .eq("phone_number", phone)
        .maybeSingle();

      if (phoneConflict) {
        return {
          success: false,
          error: "Phone number already registered in portal",
        };
      }
    }

    // Create portal user account
    const { data: newPortalUser, error: createError } = await supabase
      .from("patient_portal_users")
      .insert({
        patient_id: patientId,
        phone_number: phone || null,
        email: email || null,
        given_name: givenName,
        family_name: familyName,
        dob,
        sex: sex || null,
        account_status: "active",
        phone_verified: false,
        email_verified: false,
        consent_given: false,
      })
      .select()
      .single();

    if (createError || !newPortalUser) {
      // The raw error can echo the email or phone that clashed.
      logger.error(
        "Failed to create portal user:",
        createError ? safeErrorLabel(createError) : "no row returned",
      );
      return {
        success: false,
        error: "Failed to create portal account",
      };
    }

    // Update patient record to reflect portal enrollment
    await supabase
      .from("patients")
      .update({
        portal_enabled: true,
        portal_invited_at: new Date().toISOString(),
      })
      .eq("id", patientId);

    logger.info("Portal account created on the server");

    return {
      success: true,
      portalUserId: newPortalUser.id,
      invitationSent: false,
    };
  } catch (error) {
    logger.error("Error in enrollPatientInPortal:", safeErrorLabel(error));
    return {
      success: false,
      error: "An error occurred during enrollment",
    };
  }
}

/**
 * Prepare a portal invitation for an existing patient: makes sure the portal
 * account exists and records the invitation time on the server.
 *
 * No email or SMS is sent from here (none is wired up), so the result always
 * has `invitationSent: false`. Use services/portalEnrollment
 * sendPortalInvitation to actually send one.
 */
export async function sendPortalInvitation(
  patientId: string,
): Promise<EnrollmentResult> {
  try {
    // Get patient details
    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .select("*")
      .eq("id", patientId)
      .single();

    if (patientError || !patient) {
      return {
        success: false,
        error: "Patient not found",
      };
    }

    if (!patient.email && !patient.phone) {
      return {
        success: false,
        error: "Patient has no contact information",
      };
    }

    // Check if portal user exists
    const { data: portalUser } = await supabase
      .from("patient_portal_users")
      .select("*")
      .eq("patient_id", patientId)
      .maybeSingle();

    if (!portalUser) {
      // Create portal account first
      const enrollResult = await enrollPatientInPortal({
        patientId: patient.id,
        givenName: patient.given_name,
        familyName: patient.family_name,
        dob: patient.dob,
        phone: patient.phone,
        email: patient.email,
        sex: patient.sex,
      });

      if (!enrollResult.success) {
        return enrollResult;
      }
    }

    // No email/SMS provider is wired up here: only the invitation time is
    // recorded. Never report the invitation as sent.
    await supabase
      .from("patients")
      .update({
        portal_invited_at: new Date().toISOString(),
      })
      .eq("id", patientId);

    logger.info("Portal invitation recorded on the server; no message sent");

    return {
      success: true,
      invitationSent: false,
    };
  } catch (error) {
    logger.error("Error in sendPortalInvitation:", safeErrorLabel(error));
    return {
      success: false,
      error: "Failed to send invitation",
    };
  }
}

/**
 * Check if patient can be enrolled in portal
 */
export async function canEnrollInPortal(patientId: string): Promise<{
  canEnroll: boolean;
  reason?: string;
}> {
  try {
    const { data: patient } = await supabase
      .from("patients")
      .select("email, phone, portal_enabled")
      .eq("id", patientId)
      .single();

    if (!patient) {
      return { canEnroll: false, reason: "Patient not found" };
    }

    if (patient.portal_enabled) {
      return { canEnroll: false, reason: "Already enrolled" };
    }

    if (!patient.email && !patient.phone) {
      return { canEnroll: false, reason: "No contact information" };
    }

    return { canEnroll: true };
  } catch (error) {
    logger.error(
      "Error checking enrollment eligibility:",
      safeErrorLabel(error),
    );
    return { canEnroll: false, reason: "Error checking eligibility" };
  }
}

/**
 * Bulk enroll multiple patients in portal
 * Useful for migrating existing patients
 */
export async function bulkEnrollPatients(patientIds: string[]): Promise<{
  success: number;
  failed: number;
  errors: Array<{ patientId: string; error: string }>;
}> {
  if (patientIds.length === 0) return { success: 0, failed: 0, errors: [] };

  let success = 0;
  let failed = 0;
  const errors: Array<{ patientId: string; error: string }> = [];

  // Without the server nothing can be enrolled; say why for every patient
  // instead of reporting them as "not found".
  const unavailable = serverUnavailableReason();
  if (unavailable) {
    return {
      success: 0,
      failed: patientIds.length,
      errors: patientIds.map((patientId) => ({ patientId, error: unavailable })),
    };
  }

  const { data: patients, error: loadError } = await supabase
    .from("patients")
    .select("*")
    .in("id", patientIds);

  if (loadError) {
    logger.error(
      "Bulk enrollment: could not load patients:",
      safeErrorLabel(loadError),
    );
    return {
      success: 0,
      failed: patientIds.length,
      errors: patientIds.map((patientId) => ({
        patientId,
        error: "Could not load this patient from the server. Try again.",
      })),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const found = new Map((patients ?? []).map((p: any) => [p.id, p]));

  for (const patientId of patientIds) {
    const patient = found.get(patientId);

    if (!patient) {
      failed++;
      errors.push({ patientId, error: "Patient not found" });
      continue;
    }

    const result = await enrollPatientInPortal({
      patientId: patient.id,
      givenName: patient.given_name,
      familyName: patient.family_name,
      dob: patient.dob,
      phone: patient.phone,
      email: patient.email,
      sex: patient.sex,
    });

    if (result.success) {
      success++;
    } else {
      failed++;
      errors.push({ patientId, error: result.error || "Unknown error" });
    }
  }

  logger.info(`Bulk enrollment complete: ${success} success, ${failed} failed`);

  return { success, failed, errors };
}

/**
 * Get portal enrollment status for a patient
 */
export async function getPortalStatus(patientId: string): Promise<{
  enrolled: boolean;
  verified: boolean;
  invitedAt?: Date;
  portalUserId?: string;
}> {
  try {
    const { data: patient } = await supabase
      .from("patients")
      .select("portal_enabled, portal_invited_at, contact_verified")
      .eq("id", patientId)
      .single();

    const { data: portalUser } = await supabase
      .from("patient_portal_users")
      .select("id, phone_verified, email_verified")
      .eq("patient_id", patientId)
      .maybeSingle();

    return {
      enrolled: patient?.portal_enabled || false,
      verified:
        portalUser?.phone_verified || portalUser?.email_verified || false,
      invitedAt: patient?.portal_invited_at
        ? new Date(patient.portal_invited_at)
        : undefined,
      portalUserId: portalUser?.id,
    };
  } catch (error) {
    logger.error("Error getting portal status:", safeErrorLabel(error));
    return {
      enrolled: false,
      verified: false,
    };
  }
}
