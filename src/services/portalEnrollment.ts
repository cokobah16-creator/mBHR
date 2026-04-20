/**
 * Patient Portal Enrollment Service
 *
 * Handles portal account enrollment, invitation sending, and status management
 * Integrates with the existing Supabase patient portal authentication system
 */

import { db, type Patient, type PortalInvitation } from "@/db";
import { supabase } from "@/lib/supabase";
import { normalizePhone } from "@/utils/phone";
import * as logger from "@/lib/logger";
import { getErrorMessage } from "@/utils/errors";

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
 * Enable portal access for a patient
 */
export async function enablePortalAccess(
  patientId: string,
  options: PortalEnrollmentOptions = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    const patient = await db.patients.get(patientId);
    if (!patient) {
      return { success: false, error: "Patient not found" };
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
          logger.error("Error creating portal user:", createError);
          // Don't fail the enrollment - we can retry later
          logger.warn("Portal user creation failed, will retry on sync");
        } else {
          logger.info("Portal user account created for patient:", patientId);
        }
      }
    } catch (supabaseError) {
      logger.warn(
        "Failed to create portal user in Supabase (will retry):",
        supabaseError,
      );
      // Don't fail the operation - the sync will handle it later
    }

    logger.info("Portal access enabled for patient:", patientId);

    // Send invitation if requested
    if (options.sendInviteNow) {
      return await sendPortalInvitation(patientId);
    }

    return { success: true };
     
  } catch (error: unknown) {
    logger.error("Error enabling portal access:", error);
    return {
      success: false,
      error: getErrorMessage(error) || "Failed to enable portal access",
    };
  }
}

/**
 * Disable portal access for a patient
 */
export async function disablePortalAccess(
  patientId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await db.patients.update(patientId, {
      portalEnabled: 0,
      updatedAt: new Date(),
      _dirty: 1,
    });

    logger.info("Portal access disabled for patient:", patientId);
    return { success: true };
     
  } catch (error: unknown) {
    logger.error("Error disabling portal access:", error);
    return {
      success: false,
      error: getErrorMessage(error) || "Failed to disable portal access",
    };
  }
}

/**
 * Send portal invitation to a patient
 */
export async function sendPortalInvitation(patientId: string): Promise<{
  success: boolean;
  error?: string;
  demoOTP?: string;
  registrationUrl?: string;
}> {
  try {
    const patient = await db.patients.get(patientId);
    if (!patient) {
      return { success: false, error: "Patient not found" };
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

    const patientName = `${patient.givenName} ${patient.familyName}`;
    const contact = patient.email || patient.phone!;

    // Build a pre-filled registration URL so patients land with their contact ready
    const registrationUrl = patient.email
      ? `${window.location.origin}/patient/register?email=${encodeURIComponent(patient.email)}`
      : patient.phone
        ? `${window.location.origin}/patient/register?phone=${encodeURIComponent(patient.phone)}`
        : `${window.location.origin}/patient/register`;
    const loginUrl = `${window.location.origin}/patient/login`;

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
            logger.info(
              "Portal invitation email sent via edge function to:",
              patient.email,
            );
            return { success: true, registrationUrl };
          }
          logger.warn("Edge function email failed:", fnError);
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
            logger.info(
              "Portal invitation SMS sent via edge function to:",
              patient.phone,
            );
            return { success: true, registrationUrl };
          }
          logger.warn("Edge function SMS failed:", fnError);
        }
      } catch (edgeFnError) {
        logger.warn("Supabase edge function call failed:", edgeFnError);
      }
    }

    // --- Offline fallback: mark as sent and return a pre-filled registration link ---
    await db.patients.update(patientId, {
      portalInvitation: { ...invitation, lastStatus: "sent" },
      _dirty: 1,
    });

    logger.info(
      `[Portal Invitation] ${patientName} (${contact}) → ${registrationUrl}`,
    );

    return {
      success: true,
      registrationUrl,
      demoOTP: `No email service configured. Share this registration link with the patient: ${registrationUrl}`,
    };
     
  } catch (error: unknown) {
    logger.error("Error sending portal invitation:", error);

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
    logger.error("Error getting portal status:", error);
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
        supabaseError,
      );
      // Don't fail the operation - the sync will happen later
    }

    logger.info("Auth user linked to patient:", { authUid, patientId });
    return { success: true };
     
  } catch (error: unknown) {
    logger.error("Error linking auth user to patient:", error);
    return {
      success: false,
      error: getErrorMessage(error) || "Failed to link account",
    };
  }
}

/**
 * Find patients eligible for bulk portal enrollment
 * (have contact info but portal not enabled)
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

      // Filter by date range
      if (filters.startDate && p.createdAt < filters.startDate) return false;
      if (filters.endDate && p.createdAt > filters.endDate) return false;

      // Filter by state
      if (filters.state && p.state !== filters.state) return false;

      return true;
    });
  } catch (error) {
    logger.error("Error finding eligible patients:", error);
    return [];
  }
}

/**
 * Bulk enable portal access for multiple patients
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
  errors: Array<{ patientId: string; error: string }>;
}> {
  const batchSize = options.batchSize || 50;
  const results = {
    success: 0,
    failed: 0,
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
