/**
 * Patient Portal Enrollment Service
 *
 * Portal access, invitations and status for staff screens.
 *
 * Portal access is decided by the server (set_patient_portal_access). Turning
 * it on or off here goes through services/portalAccess: the change shows on
 * this device straight away as "waiting for the server" and is sent with
 * the command outbox. Invitations wait until the server has confirmed that
 * access is on.
 *
 * Sending an invitation needs the portal_invite permission (registration
 * lead, lead clinician, admin); turning access on needs only portal_manage.
 * The server functions check the same rule, look up the patient's stored
 * email or phone, build the text and record who sent the invitation.
 *
 * Portal accounts are for adults. For a patient under 18 by date of birth
 * (isMinor), turning access on, sending an invitation and listing them for
 * bulk enrolment are refused here, on this device. Turning access off still
 * works. A record with no date of birth, or one that cannot be read, is not
 * refused. The server does not check age for these yet:
 * set_patient_portal_access and portal_invitation_begin accept a child's
 * record; only portal_link_patient_record refuses one.
 */

import { db, type Patient, type PortalInvitation } from "@/db";
import { supabase } from "@/lib/supabase";
import { appLinkOrigin } from "@/config/canonicalOrigin";
import * as logger from "@/lib/logger";
import { getErrorMessage } from "@/utils/errors";
import { isMinor } from "@/utils/patient";
import { MINOR_PORTAL_ACCESS_MESSAGE } from "@/pages/legal/policyMeta";
import { safeErrorLabel } from "./logSafe";
import {
  requestPortalAccessChange,
  type PortalAccessReason,
} from "./portalAccess";
import { drainServerCommands } from "@/sync/adapter";
import { can, portalInviteRefusal, type Role } from "@/auth/roles";
import { useAuthStore } from "@/stores/auth";

const RATE_LIMIT_MS = Number(import.meta.env.VITE_INVITE_RATE_MS || 60000); // Default 60 seconds

/**
 * failureReason codes recorded when no email or SMS went out and staff were
 * given the registration link to share instead.
 */
export const INVITE_NOT_SENT_REASONS = {
  noServer: "not_sent_no_server",
  serviceFailed: "not_sent_service_failed",
  demoMode: "not_sent_demo_mode",
} as const;

export interface PortalEnrollmentOptions {
  sendInviteNow?: boolean;
  termsAccepted?: boolean;
  /** Why access is being turned on (stored with the request). */
  reason?: PortalAccessReason;
}

export interface PortalAccessChangeOutcome {
  success: boolean;
  error?: string;
  /** Saved on this device and waiting for the server to confirm it. */
  pending?: boolean;
  /** No server is set up on this device: the change stays here. */
  deviceOnly?: boolean;
  /** An invitation was asked for but not sent (see inviteError). */
  inviteDeferred?: boolean;
  inviteError?: string;
  registrationUrl?: string;
  demoOTP?: string;
}

export interface PortalStatusInfo {
  enabled: boolean;
  /** A change made on this device is waiting for the server. */
  pending: boolean;
  verified: boolean;
  lastLogin?: Date;
  lastInviteSent?: Date;
  inviteStatus?: "queued" | "sent" | "delivered" | "failed";
  /** Short code for why the last invitation was not sent. */
  inviteFailureReason?: string | null;
  inviteCount?: number;
  contactMethod?: "email" | "phone";
  canResend: boolean;
  nextResendTime?: Date;
  /** Under 18 by date of birth: access cannot be turned on or invited. */
  minor?: boolean;
}

/**
 * Turn portal access on for a patient (waits for the server to confirm).
 * Refused for a patient under 18 (see the header).
 */
export async function enablePortalAccess(
  patientId: string,
  options: PortalEnrollmentOptions = {},
): Promise<PortalAccessChangeOutcome> {
  try {
    const patient = await db.patients.get(patientId);
    if (!patient) {
      return { success: false, error: "Patient not found on this device" };
    }

    if (isMinor(patient.dob) === true) {
      return { success: false, error: MINOR_PORTAL_ACCESS_MESSAGE };
    }

    // Validate contact information
    if (!patient.email && !patient.phone) {
      return {
        success: false,
        error: "Patient must have at least an email or phone number",
      };
    }

    // Check if terms were accepted
    if (!options.termsAccepted) {
      return { success: false, error: "Terms and conditions must be accepted" };
    }

    const change = await requestPortalAccessChange(patientId, true, {
      reason: options.reason ?? "staff_choice",
    });
    if (!change.ok) {
      return { success: false, error: change.error };
    }
    const outcome: PortalAccessChangeOutcome = {
      success: true,
      pending: change.state === "waiting_for_server",
      deviceOnly: change.state === "device_only",
    };
    logger.info(
      change.state === "device_only"
        ? "Portal access turned on on this device (no server set up)"
        : "Portal access change queued for the server",
    );

    if (options.sendInviteNow) {
      // Access is saved either way; the invitation needs portal_invite.
      if (!canSendInvitations()) {
        return { ...outcome, inviteDeferred: true, inviteError: portalInviteRefusal() };
      }
      // The server must confirm access before an invitation goes out.
      if (outcome.pending) await drainServerCommands().catch(() => null);
      const invite = await sendPortalInvitation(patientId);
      if (!invite.success) {
        return { ...outcome, inviteDeferred: true, inviteError: invite.error };
      }
      const confirmed = await db.patients.get(patientId);
      return {
        ...outcome,
        pending: confirmed?.portalPending === 1,
        registrationUrl: invite.registrationUrl,
        demoOTP: invite.demoOTP,
      };
    }

    return outcome;
  } catch (error: unknown) {
    logger.error("Error enabling portal access:", safeErrorLabel(error));
    return {
      success: false,
      error: getErrorMessage(error) || "Failed to enable portal access",
    };
  }
}

/**
 * Turn portal access off for a patient (waits for the server to confirm).
 * Works for a patient under 18 too: a child's record can still have access
 * on from before portal accounts were limited to adults.
 */
export async function disablePortalAccess(
  patientId: string,
  options: { reason?: PortalAccessReason } = {},
): Promise<PortalAccessChangeOutcome> {
  try {
    const change = await requestPortalAccessChange(patientId, false, {
      reason: options.reason ?? "staff_choice",
    });
    if (!change.ok) {
      return { success: false, error: change.error };
    }
    logger.info(
      change.state === "device_only"
        ? "Portal access turned off on this device (no server set up)"
        : "Portal access change queued for the server",
    );
    return {
      success: true,
      pending: change.state === "waiting_for_server",
      deviceOnly: change.state === "device_only",
    };
  } catch (error: unknown) {
    logger.error("Error disabling portal access:", safeErrorLabel(error));
    return {
      success: false,
      error: getErrorMessage(error) || "Failed to disable portal access",
    };
  }
}

interface FunctionReply {
  success?: unknown;
  demo?: unknown;
}

/** Only a reply that says it was sent, and not in demo mode, counts. */
function reallySent(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const reply = data as FunctionReply;
  return reply.success === true && !reply.demo;
}

function isDemoReply(data: unknown): boolean {
  return !!data && typeof data === "object" && !!(data as FunctionReply).demo;
}

/** The signed-in person may send portal invitations (portal_invite). */
function canSendInvitations(): boolean {
  const role = useAuthStore.getState().currentUser?.role as Role | undefined;
  return !!role && can(role, "portal_invite");
}

/**
 * Send portal invitation to a patient. Refused for a patient under 18.
 */
export async function sendPortalInvitation(patientId: string): Promise<{
  success: boolean;
  error?: string;
  demoOTP?: string;
  registrationUrl?: string;
}> {
  // Sending an invitation contacts the patient: portal_invite work (not
  // portal_manage), checked here and not only in the screens. The server
  // checks it again before anything is sent.
  if (!canSendInvitations()) {
    return { success: false, error: portalInviteRefusal() };
  }

  try {
    const patient = await db.patients.get(patientId);
    if (!patient) {
      return { success: false, error: "Patient not found" };
    }

    // A child's record can still have access on from before this rule.
    if (isMinor(patient.dob) === true) {
      return { success: false, error: MINOR_PORTAL_ACCESS_MESSAGE };
    }

    if (!patient.portalEnabled) {
      return {
        success: false,
        error: "Portal access is not enabled for this patient",
      };
    }

    if (patient.portalPending === 1) {
      return {
        success: false,
        error:
          "Portal access is waiting for the server to confirm it. Send the invitation after this device syncs.",
      };
    }

    // Check rate limiting
    const canSend = await checkRateLimit(patient);
    if (!canSend.allowed) {
      return { success: false, error: canSend.message };
    }

    const contactMethod = patient.email
      ? "email"
      : patient.phone
        ? "phone"
        : null;
    if (!contactMethod) {
      return { success: false, error: "No contact method available" };
    }

    // Update invitation record
    const invitation: PortalInvitation = {
      lastSentAt: new Date().toISOString(),
      lastStatus: "queued",
      failureReason: null,
      count: (patient.portalInvitation?.count || 0) + 1,
    };

    await db.patients.update(patientId, {
      portalInvitation: invitation,
      updatedAt: new Date(),
      _dirty: 1,
    });

    // Build a pre-filled registration URL so patients land with their contact
    // ready (shown to staff to share; the server builds the one it sends).
    const origin = appLinkOrigin();
    const registrationUrl = patient.email
      ? `${origin}/patient/register?email=${encodeURIComponent(patient.email)}`
      : patient.phone
        ? `${origin}/patient/register?phone=${encodeURIComponent(patient.phone)}`
        : `${origin}/patient/register`;

    let notSentReason: string = INVITE_NOT_SENT_REASONS.noServer;

    // --- Send via Supabase edge function (email preferred, SMS fallback) ---
    // The device sends only the patient id and the purpose: the server
    // checks portal_invite and that access is on, looks up the stored email
    // or phone, builds the text and link, and records who sent it.
    if (supabase) {
      notSentReason = INVITE_NOT_SENT_REASONS.serviceFailed;
      const request = {
        purpose: "portal_invitation",
        patientId,
        appOrigin: origin,
      };
      try {
        if (patient.email) {
          const { data, error: fnError } = await supabase.functions.invoke(
            "send-otp-email",
            { body: request },
          );

          if (!fnError && reallySent(data)) {
            await db.patients.update(patientId, {
              portalInvitation: { ...invitation, lastStatus: "sent" },
              _dirty: 1,
            });
            logger.info("Portal invitation email accepted by the server");
            return { success: true, registrationUrl };
          }
          if (!fnError && isDemoReply(data)) {
            notSentReason = INVITE_NOT_SENT_REASONS.demoMode;
          }
          logger.warn(
            "Portal invitation email not sent:",
            fnError ? safeErrorLabel(fnError) : isDemoReply(data) ? "demo mode" : "no confirmation",
          );
        } else if (patient.phone) {
          const { data, error: fnError } = await supabase.functions.invoke(
            "send-sms-reminder",
            { body: request },
          );

          if (!fnError && reallySent(data)) {
            await db.patients.update(patientId, {
              portalInvitation: { ...invitation, lastStatus: "sent" },
              _dirty: 1,
            });
            logger.info("Portal invitation SMS accepted by the SMS provider");
            return { success: true, registrationUrl };
          }
          if (!fnError && isDemoReply(data)) {
            notSentReason = INVITE_NOT_SENT_REASONS.demoMode;
          }
          logger.warn(
            "Portal invitation SMS not sent:",
            fnError ? safeErrorLabel(fnError) : isDemoReply(data) ? "demo mode" : "no confirmation",
          );
        }
      } catch (edgeFnError) {
        logger.warn(
          "Supabase edge function call failed:",
          safeErrorLabel(edgeFnError),
        );
      }
    }

    // --- No email or SMS went out. Record it as not sent and return the
    // pre-filled registration link for staff to share with the patient.
    await db.patients.update(patientId, {
      portalInvitation: {
        ...invitation,
        lastStatus: "failed",
        failureReason: notSentReason,
      },
      _dirty: 1,
    });

    // No name, contact or link here: the link carries the email or phone.
    logger.info(
      `[Portal Invitation] No email/SMS sent (${notSentReason}); registration link returned for staff to share (${contactMethod})`,
    );

    return {
      success: true,
      registrationUrl,
      demoOTP: `No email or SMS was sent. Share this registration link with the patient: ${registrationUrl}`,
    };
  } catch (error: unknown) {
    logger.error("Error sending portal invitation:", safeErrorLabel(error));

    // Update invitation status to failed
    const patient = await db.patients.get(patientId);
    if (patient?.portalInvitation) {
      await db.patients.update(patientId, {
        portalInvitation: {
          ...patient.portalInvitation,
          lastStatus: "failed",
          failureReason: INVITE_NOT_SENT_REASONS.serviceFailed,
        },
        _dirty: 1,
      });
    }

    return {
      success: false,
      error: getErrorMessage(error) || "Failed to send invitation",
    };
  }
}

/**
 * Check if invitation can be resent (rate limiting)
 */
async function checkRateLimit(
  patient: Patient,
): Promise<{ allowed: boolean; message?: string; waitMs?: number }> {
  if (!patient.portalInvitation?.lastSentAt) {
    return { allowed: true };
  }

  const lastSent = new Date(patient.portalInvitation.lastSentAt).getTime();
  const now = Date.now();
  const timeSince = now - lastSent;

  if (timeSince < RATE_LIMIT_MS) {
    const waitMs = RATE_LIMIT_MS - timeSince;
    const waitMinutes = Math.ceil(waitMs / 60000);
    return {
      allowed: false,
      message: `Please wait ${waitMinutes} minute${waitMinutes !== 1 ? "s" : ""} before resending`,
      waitMs,
    };
  }

  return { allowed: true };
}

/**
 * Get portal status for a patient
 */
export async function getPortalStatus(
  patientId: string,
): Promise<PortalStatusInfo | null> {
  try {
    const patient = await db.patients.get(patientId);
    if (!patient) return null;

    const rateLimit = await checkRateLimit(patient);
    const contactMethod = patient.email
      ? "email"
      : patient.phone
        ? "phone"
        : undefined;
    const pending = patient.portalPending === 1;

    return {
      enabled: patient.portalEnabled === 1,
      pending,
      verified: patient.contactVerified === 1,
      lastLogin: patient.lastPortalActivity
        ? new Date(patient.lastPortalActivity)
        : undefined,
      lastInviteSent: patient.portalInvitation?.lastSentAt
        ? new Date(patient.portalInvitation.lastSentAt)
        : undefined,
      inviteStatus: patient.portalInvitation?.lastStatus,
      inviteFailureReason: patient.portalInvitation?.failureReason ?? null,
      inviteCount: patient.portalInvitation?.count || 0,
      contactMethod,
      canResend: rateLimit.allowed && patient.portalEnabled === 1 && !pending,
      nextResendTime: rateLimit.waitMs
        ? new Date(Date.now() + rateLimit.waitMs)
        : undefined,
      minor: isMinor(patient.dob) === true,
    };
  } catch (error) {
    logger.error("Error getting portal status:", safeErrorLabel(error));
    return null;
  }
}

/**
 * Link authenticated Supabase user to patient record
 */
export async function linkAuthUserToPatient(
  authUid: string,
  patientId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const patient = await db.patients.get(patientId);
    if (!patient) {
      return { success: false, error: "Patient not found" };
    }

    // Check if another patient is already linked to this auth UID
    const existingLink = await db.patients
      .where("authUid")
      .equals(authUid)
      .first();

    if (existingLink && existingLink.id !== patientId) {
      return {
        success: false,
        error: "This account is already linked to another patient",
      };
    }

    // Update local record
    await db.patients.update(patientId, {
      authUid,
      contactVerified: 1,
      lastPortalActivity: new Date().toISOString(),
      updatedAt: new Date(),
      _dirty: 1,
    });

    // Also write it on the server now (best effort). A record already
    // linked to another account is kept by the server.
    if (supabase) {
      try {
        const { error: linkError } = await supabase
          .from("patients")
          .update({
            auth_uid: authUid,
            contact_verified: true,
            last_portal_activity: new Date().toISOString(),
          })
          .eq("id", patientId);
        if (linkError) {
          logger.warn(
            "Auth link not saved on the server now; the patient record uploads at the next sync:",
            safeErrorLabel(linkError),
          );
        }
      } catch (supabaseError) {
        logger.warn(
          "Auth link not saved on the server now; the patient record uploads at the next sync:",
          safeErrorLabel(supabaseError),
        );
      }
    }

    logger.info("Auth user linked to a patient record on this device");
    return { success: true };
  } catch (error: unknown) {
    logger.error(
      "Error linking auth user to patient:",
      safeErrorLabel(error),
    );
    return {
      success: false,
      error: getErrorMessage(error) || "Failed to link account",
    };
  }
}

/**
 * Find patients eligible for bulk portal enrollment
 * (have contact info, portal not enabled, no change waiting, not merged).
 * Patients under 18 are left out: enablePortalAccess refuses them.
 */
export async function findEligiblePatients(
  filters: {
    startDate?: Date;
    endDate?: Date;
    state?: string;
    contactMethod?: "email" | "phone" | "any";
  } = {},
): Promise<Patient[]> {
  try {
    const query = db.patients.where("portalEnabled").equals(0);

    const patients = await query.toArray();

    // Filter by contact method and other criteria
    return patients.filter((p) => {
      // A change is already waiting for the server, or the record was merged.
      if (p.portalPending === 1 || p.mergeInto) return false;

      // Must have contact info
      const hasEmail = p.email && p.email.trim() !== "";
      const hasPhone = p.phone && p.phone.trim() !== "";

      if (filters.contactMethod === "email" && !hasEmail) return false;
      if (filters.contactMethod === "phone" && !hasPhone) return false;
      if (filters.contactMethod === "any" && !hasEmail && !hasPhone)
        return false;
      if (!hasEmail && !hasPhone) return false;

      if (isMinor(p.dob) === true) return false;

      // Filter by date range
      if (filters.startDate && p.createdAt < filters.startDate) return false;
      if (filters.endDate && p.createdAt > filters.endDate) return false;

      // Filter by state
      if (filters.state && p.state !== filters.state) return false;

      return true;
    });
  } catch (error) {
    logger.error("Error finding eligible patients:", safeErrorLabel(error));
    return [];
  }
}

export interface BulkEnableResult {
  /** Patients whose change was saved (waiting for the server, or device-only). */
  success: number;
  failed: number;
  errors: Array<{ patientId: string; error: string }>;
  /** Of `success`: still waiting for the server when the run finished. */
  pending: number;
  /** Of `success`: saved on this device only (no server set up). */
  deviceOnly: number;
  /** Invitations, when asked for. */
  invitations?: {
    sent: number;
    /** Not sent (link only, not confirmed yet, rate limited...). */
    notSent: Array<{ patientId: string; error: string }>;
  };
}

/**
 * Bulk enable portal access for multiple patients.
 *
 * Every change is queued first; with `sendInvitations`, queued changes are
 * sent to the server once, and invitations go only to patients whose access
 * the server confirmed. `sendInvitations` needs portal_invite: without it
 * nothing is changed and every patient is reported with the refusal.
 * A patient under 18 is listed as failed with the reason: enablePortalAccess
 * refuses them, so nothing is queued and no invitation is sent.
 */
export async function bulkEnablePortalAccess(
  patientIds: string[],
  options: {
    sendInvitations?: boolean;
    batchSize?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {},
): Promise<BulkEnableResult> {
  const batchSize = options.batchSize || 50;
  const results: BulkEnableResult = {
    success: 0,
    failed: 0,
    errors: [],
    pending: 0,
    deviceOnly: 0,
  };
  const saved: string[] = [];

  // "Enable and invite" needs portal_invite: refuse the whole run before
  // changing anything, rather than enabling access and quietly inviting no one.
  if (options.sendInvitations && !canSendInvitations()) {
    const refusal = portalInviteRefusal();
    return {
      ...results,
      failed: patientIds.length,
      errors: patientIds.map((patientId) => ({ patientId, error: refusal })),
    };
  }

  for (let i = 0; i < patientIds.length; i += batchSize) {
    const batch = patientIds.slice(i, i + batchSize);

    // One at a time: each change is its own Dexie transaction and command.
    for (const patientId of batch) {
      try {
        const result = await enablePortalAccess(patientId, {
          termsAccepted: true, // Bulk operations assume consent
          reason: "bulk_enable",
        });

        if (result.success) {
          results.success++;
          saved.push(patientId);
          if (result.deviceOnly) results.deviceOnly++;
        } else {
          results.failed++;
          results.errors.push({
            patientId,
            error: result.error || "Unknown error",
          });
        }
      } catch (error: unknown) {
        results.failed++;
        results.errors.push({
          patientId,
          error: getErrorMessage(error) || "Unknown error",
        });
      }

      if (options.onProgress) {
        options.onProgress(results.success + results.failed, patientIds.length);
      }
    }
  }

  if (options.sendInvitations && saved.length > 0) {
    // Send the queued changes now so confirmed patients can be invited.
    await drainServerCommands().catch(() => null);
    const invitations = { sent: 0, notSent: [] as Array<{ patientId: string; error: string }> };
    for (let i = 0; i < saved.length; i++) {
      const patientId = saved[i];
      // Pause between batches so the email/SMS services' rate limits hold.
      if (i > 0 && i % batchSize === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const invite = await sendPortalInvitation(patientId);
      if (invite.success && !invite.demoOTP) {
        invitations.sent++;
      } else {
        invitations.notSent.push({
          patientId,
          error: invite.success
            ? "No email or SMS was sent; share the registration link from the patient's record"
            : invite.error || "Invitation not sent",
        });
      }
    }
    results.invitations = invitations;
  }

  // Count what is still waiting for the server after the run.
  const after = await db.patients.bulkGet(saved).catch(() => []);
  results.pending = after.filter((p) => p?.portalPending === 1).length;

  return results;
}
