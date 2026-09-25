/**
 * Unified Portal Enrollment Service
 *
 * Connects staff registration with patient portal access.
 * Creates portal accounts on the server, from the registration form's
 * portal box (only when staff tick it) and BulkPortalMigration.
 *
 * Portal accounts are for adults: every entry point here refuses a patient
 * under 18 by date of birth (isMinor). A record with no date of birth, or
 * one that cannot be read, is not refused.
 */

import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";
import { drainServerCommands } from "@/sync/adapter";
import { isMinor } from "@/utils/patient";
import { MINOR_PORTAL_ACCESS_MESSAGE } from "@/pages/legal/policyMeta";
import { safeErrorLabel } from "./logSafe";
import {
  getPortalAccessCommands,
  requestPortalAccessChange,
} from "./portalAccess";
import { portalRejectionMessage } from "./portalAccessRules";
import { can, portalInviteRefusal, type Role } from "@/auth/roles";
import { useAuthStore } from "@/stores/auth";

export interface EnrollmentResult {
  success: boolean;
  portalUserId?: string;
  error?: string;
  invitationSent?: boolean;
  /**
   * Portal access was asked for and is waiting for the server to confirm it
   * (queued on this device; sent at the next sync).
   */
  pending?: boolean;
  /** No server is set up on this device: access is on for this device only. */
  deviceOnly?: boolean;
  /** Plain note for staff about what still has to happen, if anything. */
  message?: string;
  /** The queued portal access command, to follow the server's answer. */
  commandId?: string;
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
 * Called from the registration form when staff tick portal access for a
 * patient with contact info, and by bulkEnrollPatients and
 * sendPortalInvitation below. Refused for a patient under 18.
 */
export async function enrollPatientInPortal(
  data: PatientEnrollmentData,
): Promise<EnrollmentResult> {
  try {
    const { patientId, givenName, familyName, dob, phone, email, sex } = data;

    if (isMinor(dob) === true) {
      return { success: false, error: MINOR_PORTAL_ACCESS_MESSAGE };
    }

    if (!phone && !email) {
      return {
        success: false,
        error: "Patient must have email or phone number for portal access",
      };
    }

    // Portal accounts and access are portal_manage work (checked again when
    // the access change is saved, and by the server).
    const role = useAuthStore.getState().currentUser?.role as Role | undefined;
    if (!role || !can(role, "portal_manage")) {
      return { success: false, error: "Your role cannot change portal access." };
    }

    // Without the server (offline, or none set up) the portal account cannot
    // be made now, but portal access can still be asked for: it is queued
    // and the server decides at the next sync.
    const unavailable = serverUnavailableReason();
    if (unavailable) {
      const access = await requestPortalAccessChange(patientId, true, {
        reason: "registration",
      });
      if (!access.ok) {
        return { success: false, error: access.error };
      }
      const deviceOnly = access.state === "device_only";
      return {
        success: true,
        pending: !deviceOnly,
        deviceOnly,
        commandId: access.commandId,
        invitationSent: false,
        message: deviceOnly
          ? "Portal access is on for this device only: no server is connected."
          : "Portal access is saved on this device and waits for the server. The portal account is made when this device is online.",
      };
    }

    // Check if patient already has portal account
    const { data: existingPortalUser } = await supabase
      .from("patient_portal_users")
      .select("id")
      .eq("patient_id", patientId)
      .maybeSingle();

    if (existingPortalUser) {
      // Make sure access itself is asked for too (the server ignores a
      // repeat of what it already holds).
      const access = await requestPortalAccessChange(patientId, true, {
        reason: "registration",
        serverRecord: true,
      });
      if (!access.ok) {
        // The account exists, but access itself was not asked for: do not
        // report success.
        return {
          success: false,
          portalUserId: existingPortalUser.id,
          error: access.error ?? "Portal access could not be requested.",
        };
      }
      return {
        success: true,
        portalUserId: existingPortalUser.id,
        error: "Patient already has portal access",
        pending: access.state === "waiting_for_server",
        deviceOnly: access.state === "device_only",
        commandId: access.commandId,
        message:
          access.state === "waiting_for_server"
            ? "The patient already has a portal account. Portal access is saved on this device and waits for the server."
            : undefined,
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

    // Portal access itself is the server's decision: ask for it with the
    // command outbox (never by writing patients.portal_enabled).
    const access = await requestPortalAccessChange(patientId, true, {
      reason: "registration",
      serverRecord: true,
    });

    logger.info("Portal account created on the server");

    if (!access.ok) {
      return {
        success: false,
        portalUserId: newPortalUser.id,
        invitationSent: false,
        error: `Portal account made, but portal access was not turned on: ${access.error}`,
      };
    }

    return {
      success: true,
      portalUserId: newPortalUser.id,
      invitationSent: false,
      pending: access.state === "waiting_for_server",
      deviceOnly: access.state === "device_only",
      commandId: access.commandId,
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
 *
 * Needs portal_invite (registration lead, lead clinician, admin), like
 * sending one; the database refuses anyone else's change to
 * patients.portal_invited_at.
 */
export async function sendPortalInvitation(
  patientId: string,
): Promise<EnrollmentResult> {
  const role = useAuthStore.getState().currentUser?.role as Role | undefined;
  if (!role || !can(role, "portal_invite")) {
    return { success: false, error: portalInviteRefusal() };
  }
  if (!supabase) {
    return {
      success: false,
      error: "Portal invitations are recorded on the mBHR server, which is not connected on this device",
    };
  }
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

    if (isMinor(patient.dob) === true) {
      return { success: false, error: MINOR_PORTAL_ACCESS_MESSAGE };
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
    const { data: invitedRows, error: invitedError } = await supabase
      .from("patients")
      .update({
        portal_invited_at: new Date().toISOString(),
      })
      .eq("id", patientId)
      .select("id");

    if (invitedError || !Array.isArray(invitedRows) || invitedRows.length === 0) {
      logger.warn(
        "Portal invitation time not recorded on the server:",
        invitedError ? safeErrorLabel(invitedError) : "no row changed",
      );
      return {
        success: false,
        invitationSent: false,
        error: "The invitation time could not be saved on the server. Try again.",
      };
    }

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
 * Check if patient can be enrolled in portal (never a patient under 18)
 */
export async function canEnrollInPortal(patientId: string): Promise<{
  canEnroll: boolean;
  reason?: string;
}> {
  try {
    const { data: patient } = await supabase
      .from("patients")
      .select("email, phone, portal_enabled, dob")
      .eq("id", patientId)
      .single();

    if (!patient) {
      return { canEnroll: false, reason: "Patient not found" };
    }

    if (isMinor(patient.dob) === true) {
      return { canEnroll: false, reason: MINOR_PORTAL_ACCESS_MESSAGE };
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
export interface BulkEnrollResult {
  /** Portal account ready and portal access asked for. */
  success: number;
  failed: number;
  errors: Array<{ patientId: string; error: string }>;
  /** What the server said about portal access when the run finished. */
  access?: {
    applied: number;
    /** Still waiting (not sent yet, or no answer yet). */
    pending: number;
    rejected: Array<{ patientId: string; error: string }>;
  };
}

/**
 * A patient under 18 is listed as failed with the reason: no account is
 * made and no access is asked for.
 */
export async function bulkEnrollPatients(patientIds: string[]): Promise<BulkEnrollResult> {
  if (patientIds.length === 0) return { success: 0, failed: 0, errors: [] };

  let success = 0;
  let failed = 0;
  const errors: Array<{ patientId: string; error: string }> = [];
  const queued: Array<{ patientId: string; commandId: string }> = [];

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

    if (isMinor(patient.dob) === true) {
      failed++;
      errors.push({ patientId, error: MINOR_PORTAL_ACCESS_MESSAGE });
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

    if (result.commandId) queued.push({ patientId, commandId: result.commandId });
    if (result.success) {
      success++;
    } else {
      failed++;
      errors.push({ patientId, error: result.error || "Unknown error" });
    }
  }

  logger.info(`Bulk enrollment complete: ${success} success, ${failed} failed`);

  const access = queued.length > 0 ? await followAccessCommands(queued) : undefined;
  return { success, failed, errors, access };
}

/**
 * Send the queued portal access commands now and report what the server
 * answered for these patients (applied, refused, or still waiting).
 */
async function followAccessCommands(
  ids: Array<{ patientId: string; commandId: string }>,
): Promise<BulkEnrollResult["access"]> {
  try {
    await drainServerCommands().catch(() => null);
    const summary = { applied: 0, pending: 0, rejected: [] as Array<{ patientId: string; error: string }> };
    const commands = await getPortalAccessCommands(ids.map((c) => c.commandId));
    ids.forEach(({ patientId }, i) => {
      const command = commands[i];
      if (command?.status === "applied") summary.applied++;
      else if (command?.status === "rejected") {
        summary.rejected.push({ patientId, error: portalRejectionMessage(command.rejectReason) });
      } else summary.pending++;
    });
    return summary;
  } catch (error) {
    logger.warn("Could not read portal access answers:", safeErrorLabel(error));
    return undefined;
  }
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
