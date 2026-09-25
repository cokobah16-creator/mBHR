/**
 * Patient Portal Enrollment Service
 *
 * Handles portal account enrollment, invitation sending, and status management
 * Integrates with the existing Supabase patient portal authentication system
 */

import { db, type Patient, type PortalInvitation } from "@/db";
import { supabase } from "@/lib/supabase";
import { normalizePhone } from "@/utils/phone";
import { isMinor } from "@/utils/patient";
import { MINOR_PORTAL_ACCESS_MESSAGE } from "@/pages/legal/policyMeta";
import * as logger from "@/lib/logger";
import { getErrorMessage } from "@/utils/errors";
import { safeErrorLabel } from "./logSafe";
import { staffAuthRefusal, type StaffAuthRefusal } from "./edgeFunctionErrors";

const RATE_LIMIT_MS = Number(import.meta.env.VITE_INVITE_RATE_MS || 60000); // Default 60 seconds

export interface PortalEnrollmentOptions {
  sendInviteNow?: boolean;
  termsAccepted?: boolean;
}

export interface PortalStatusInfo {
  enabled: boolean;
  verified: boolean;
  lastLogin?: Date;
  lastInviteSent?: Date;
  inviteStatus?: "queued" | "sent" | "delivered" | "failed";
  inviteCount?: number;
  contactMethod?: "email" | "phone";
  canResend: boolean;
  nextResendTime?: Date;
}

/**
 * What happened on the server when portal access was changed on this
 * device. The online portal checks patients.portal_enabled on the server.
 * - "updated": the server's patients.portal_enabled now has the new value.
 * - "no-server": no server is set up on this device.
 * - "offline": this device is offline, so nothing was sent.
 * - "not-signed-in": nobody is signed in online on this device (a PIN
 *   unlock opens the local workspace only), so nothing was sent.
 * - "not-updated": the server was asked but its row did not change. One
 *   reason is a record not uploaded yet; a sign-in that may not change the
 *   column, or a failed request, gets the same answer.
 */
export type ServerPortalWrite =
  | "updated"
  | "no-server"
  | "offline"
  | "not-signed-in"
  | "not-updated";

export interface PortalAccessResult {
  success: boolean;
  error?: string;
  /** Set once the change is saved on this device. */
  server?: ServerPortalWrite;
}

function isMissingColumn(error: unknown): boolean {
  const code =
    error && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined;
  return code === "PGRST204" || code === "42703";
}

/**
 * The server adds one to row_version on every write. When this portal
 * write is the only change since this device last saw the row, keep the
 * new version, so the next upload of other edits made here is not reported
 * as a sync conflict (detectConflict in src/sync/adapter.ts).
 */
async function adoptServerVersion(
  patientId: string,
  version: unknown,
): Promise<void> {
  const next = Number(version);
  if (version === null || version === undefined || !Number.isFinite(next)) {
    return;
  }
  try {
    const current = await db.patients.get(patientId);
    if (current && current._serverVersion === next - 1) {
      await db.patients.update(patientId, { _serverVersion: next });
    }
  } catch (error) {
    // Harmless: at worst the next upload asks staff to review the record.
    logger.warn("Could not keep the server version:", safeErrorLabel(error));
  }
}

/**
 * Write patients.portal_enabled on the server, as enrollPatientInPortal
 * does. Staff with the "register" permission may change this column
 * (app_guard_patient_identity). This is a stopgap until the
 * set_patient_portal_access command exists: nothing retries a failed
 * write, and portal_enabled_changed_at stays empty (only server code sets
 * it), so other staff devices keep their own value (transformPulled in
 * src/sync/adapter.ts).
 */
async function writeServerPortalEnabled(
  patientId: string,
  enabled: boolean,
): Promise<ServerPortalWrite> {
  const client = supabase;
  if (!client) return "no-server";
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "offline";
  }
  try {
    // The stored online sign-in, read without a network call, as
    // checkCloudSession does. Without one, RLS would refuse the update and
    // the answer would look like a record that is not uploaded yet.
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session) return "not-signed-in";

    let result: { data: unknown; error: unknown } = await client
      .from("patients")
      .update({ portal_enabled: enabled })
      .eq("id", patientId)
      .select("id, portal_enabled, row_version");
    if (result.error && isMissingColumn(result.error)) {
      // A server without the sync foundation migration has no row_version.
      result = await client
        .from("patients")
        .update({ portal_enabled: enabled })
        .eq("id", patientId)
        .select("id, portal_enabled");
    }
    const { data, error } = result;
    if (error) {
      logger.warn(
        "Portal access not changed on the server:",
        safeErrorLabel(error),
      );
      return "not-updated";
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { portal_enabled?: unknown; row_version?: unknown }
      | null
      | undefined;
    if (!row || row.portal_enabled !== enabled) {
      // No row came back (the record is not on the server yet, or this
      // sign-in may not change it), or the server kept its old value.
      logger.warn("Portal access not changed on the server: no row updated");
      return "not-updated";
    }
    await adoptServerVersion(patientId, row.row_version);
    return "updated";
  } catch (error) {
    logger.warn(
      "Portal access not changed on the server:",
      safeErrorLabel(error),
    );
    return "not-updated";
  }
}

/**
 * Turn portal access on for a patient. Saved on this device first; then,
 * when this device is online, also on the server (see
 * writeServerPortalEnabled). `server` in the result says which.
 *
 * Refused for a patient under 18: portal accounts are for adults. A record
 * whose date of birth cannot be read is not refused here.
 */
export async function enablePortalAccess(
  patientId: string,
  options: PortalEnrollmentOptions = {},
): Promise<PortalAccessResult> {
  try {
    const patient = await db.patients.get(patientId);
    if (!patient) {
      return { success: false, error: "Patient not found" };
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

    // Update patient record to enable portal
    await db.patients.update(patientId, {
      portalEnabled: 1,
      updatedAt: new Date(),
      _dirty: 1,
    });

    // The online portal checks the server's copy, which starts off.
    const server = await writeServerPortalEnabled(patientId, true);

    // Create patient portal user account in Supabase
    try {
      // Check if portal user already exists
      const { data: existingPortalUser } = await supabase
        .from("patient_portal_users")
        .select("id")
        .eq("patient_id", patientId)
        .maybeSingle();

      if (!existingPortalUser) {
        // Create new portal user account
        const { error: createError } = await supabase
          .from("patient_portal_users")
          .insert({
            patient_id: patientId,
            phone_number: normalizePhone(patient.phone) || "",
            email: patient.email || null,
            account_status: "active",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

        if (createError) {
          // The raw error can echo the email or phone that clashed.
          logger.error(
            "Error creating portal user:",
            safeErrorLabel(createError),
          );
          // Don't fail the enrollment: portal access stays enabled on the
          // patient record. No background job re-creates the server account,
          // so say so.
          logger.warn(
            "Portal user not created on the server; nothing retries this automatically",
          );
        } else {
          logger.info("Portal user account created on the server");
        }
      }
    } catch (supabaseError) {
      logger.warn(
        "Failed to create portal user in Supabase (nothing retries this automatically):",
        safeErrorLabel(supabaseError),
      );
      // Don't fail the operation: the local change stands
    }

    logger.info(
      server === "updated"
        ? "Portal access enabled on this device and on the server"
        : "Portal access enabled on this device only",
    );

    // Send invitation if requested
    if (options.sendInviteNow) {
      return { ...(await sendPortalInvitation(patientId)), server };
    }

    return { success: true, server };

  } catch (error: unknown) {
    logger.error("Error enabling portal access:", safeErrorLabel(error));
    return {
      success: false,
      error: getErrorMessage(error) || "Failed to enable portal access",
    };
  }
}

/**
 * Turn portal access off for a patient. Saved on this device first; then,
 * when this device is online, also on the server, so a switch that can
 * turn online access on can also turn it off. `server` says which. Works
 * for a patient under 18 too.
 */
export async function disablePortalAccess(
  patientId: string,
): Promise<PortalAccessResult> {
  try {
    await db.patients.update(patientId, {
      portalEnabled: 0,
      updatedAt: new Date(),
      _dirty: 1,
    });

    const server = await writeServerPortalEnabled(patientId, false);

    logger.info(
      server === "updated"
        ? "Portal access disabled on this device and on the server"
        : "Portal access disabled on this device only",
    );
    return { success: true, server };
     
  } catch (error: unknown) {
    logger.error("Error disabling portal access:", safeErrorLabel(error));
    return {
      success: false,
      error: getErrorMessage(error) || "Failed to disable portal access",
    };
  }
}

/**
 * Send portal invitation to a patient.
 *
 * The email and SMS functions accept only a staff member signed in online:
 * supabase.functions.invoke sends that person's access token, or the public
 * anon key when nobody is signed in online (after a PIN unlock), which the
 * server refuses. When no message is sent, the registration link is returned
 * for staff to share by hand. Refused for a patient under 18.
 */
export async function sendPortalInvitation(patientId: string): Promise<{
  success: boolean;
  error?: string;
  demoOTP?: string;
  registrationUrl?: string;
  /**
   * Why the server refused to send the invitation, when it said so:
   * "not_signed_in" (no online sign-in, HTTP 401) or "not_permitted" (the
   * server does not accept this staff account, HTTP 403).
   */
  notSentReason?: StaffAuthRefusal;
}> {
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

    // Build a pre-filled registration URL so patients land with their contact ready
    const registrationUrl = patient.email
      ? `${window.location.origin}/patient/register?email=${encodeURIComponent(patient.email)}`
      : patient.phone
        ? `${window.location.origin}/patient/register?phone=${encodeURIComponent(patient.phone)}`
        : `${window.location.origin}/patient/register`;
    const loginUrl = `${window.location.origin}/patient/login`;

    let notSentReason: StaffAuthRefusal | null = null;

    // --- Send via Supabase edge function (email preferred, SMS fallback) ---
    if (supabase) {
      try {
        if (patient.email) {
          const { error: fnError } = await supabase.functions.invoke(
            "send-otp-email",
            {
              body: {
                email: patient.email,
                subject: "Your mBHR Patient Portal is Ready",
                message:
                  `Hi ${patient.givenName},\n\n` +
                  `Your patient portal has been set up by your healthcare provider.\n\n` +
                  `Click the link below to create your account — your email will be pre-filled:\n\n` +
                  `${registrationUrl}\n\n` +
                  `You will be asked to enter your date of birth to complete registration.\n\n` +
                  `Already registered? Log in here: ${loginUrl}\n\n` +
                  `Med Bridge Health Reach`,
              },
            },
          );

          if (!fnError) {
            await db.patients.update(patientId, {
              portalInvitation: { ...invitation, lastStatus: "sent" },
              _dirty: 1,
            });
            logger.info("Portal invitation email accepted by the server");
            return { success: true, registrationUrl };
          }
          logger.warn("Edge function email failed:", safeErrorLabel(fnError));
          notSentReason = staffAuthRefusal(fnError);
        } else if (patient.phone) {
          const { error: fnError } = await supabase.functions.invoke(
            "send-otp-sms",
            {
              body: {
                phone: normalizePhone(patient.phone) || patient.phone,
                message:
                  `Hi ${patient.givenName}, your mBHR patient portal is ready. ` +
                  `Register at: ${registrationUrl} — use your phone number and date of birth.`,
              },
            },
          );

          if (!fnError) {
            await db.patients.update(patientId, {
              portalInvitation: { ...invitation, lastStatus: "sent" },
              _dirty: 1,
            });
            logger.info("Portal invitation SMS accepted by the server");
            return { success: true, registrationUrl };
          }
          logger.warn("Edge function SMS failed:", safeErrorLabel(fnError));
          notSentReason = staffAuthRefusal(fnError);
        }
      } catch (edgeFnError) {
        logger.warn(
          "Supabase edge function call failed:",
          safeErrorLabel(edgeFnError),
        );
      }
    }

    // --- Offline fallback: no message was sent. Record it as "sent" (the
    // screen labels this "Sent or link shared") and return the pre-filled
    // registration link for staff to share with the patient.
    await db.patients.update(patientId, {
      portalInvitation: { ...invitation, lastStatus: "sent" },
      _dirty: 1,
    });

    // No name, contact or link here: the link carries the email or phone.
    logger.info(
      `[Portal Invitation] No email/SMS was sent${notSentReason ? ` (${notSentReason})` : ""}; registration link returned for staff to share (${contactMethod})`,
    );

    return {
      success: true,
      registrationUrl,
      demoOTP: `No email or SMS was sent. Share this registration link with the patient: ${registrationUrl}`,
      ...(notSentReason ? { notSentReason } : {}),
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
          failureReason: getErrorMessage(error) || "Unknown error",
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

    return {
      enabled: patient.portalEnabled === 1,
      verified: patient.contactVerified === 1,
      lastLogin: patient.lastPortalActivity
        ? new Date(patient.lastPortalActivity)
        : undefined,
      lastInviteSent: patient.portalInvitation?.lastSentAt
        ? new Date(patient.portalInvitation.lastSentAt)
        : undefined,
      inviteStatus: patient.portalInvitation?.lastStatus,
      inviteCount: patient.portalInvitation?.count || 0,
      contactMethod,
      canResend: rateLimit.allowed && patient.portalEnabled === 1,
      nextResendTime: rateLimit.waitMs
        ? new Date(Date.now() + rateLimit.waitMs)
        : undefined,
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

    // Sync to Supabase
    try {
      await supabase
        .from("patients")
        .update({
          auth_uid: authUid,
          contact_verified: true,
          last_portal_activity: new Date().toISOString(),
        })
        .eq("id", patientId);
    } catch (supabaseError) {
      logger.warn(
        "Failed to sync auth link to Supabase (will retry):",
        safeErrorLabel(supabaseError),
      );
      // Don't fail the operation - the sync will happen later
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
 * (have contact info but portal not enabled). Patients under 18 are left
 * out: portal accounts are for adults, and enablePortalAccess refuses them.
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

/**
 * Bulk enable portal access for multiple patients. A patient under 18 is
 * listed as failed with the reason (see enablePortalAccess).
 */
export async function bulkEnablePortalAccess(
  patientIds: string[],
  options: {
    sendInvitations?: boolean;
    batchSize?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {},
): Promise<{
  success: number;
  failed: number;
  /** Successes that were also saved on the server (server: "updated"). */
  serverUpdated: number;
  errors: Array<{ patientId: string; error: string }>;
}> {
  const batchSize = options.batchSize || 50;
  const results = {
    success: 0,
    failed: 0,
    serverUpdated: 0,
    errors: [] as Array<{ patientId: string; error: string }>,
  };

  for (let i = 0; i < patientIds.length; i += batchSize) {
    const batch = patientIds.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (patientId) => {
        try {
          const result = await enablePortalAccess(patientId, {
            sendInviteNow: options.sendInvitations,
            termsAccepted: true, // Bulk operations assume consent
          });

          if (result.success) {
            results.success++;
            if (result.server === "updated") results.serverUpdated++;
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
          options.onProgress(
            results.success + results.failed,
            patientIds.length,
          );
        }
      }),
    );

    // Rate limit between batches
    if (i + batchSize < patientIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results;
}
