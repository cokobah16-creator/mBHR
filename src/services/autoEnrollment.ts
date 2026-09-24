import { supabase } from "@/lib/supabase";
import { db, Patient } from "@/db";
import * as logger from "@/lib/logger";
import { can, type Role } from "@/auth/roles";
import { useAuthStore } from "@/stores/auth";
import { drainServerCommands } from "@/sync/adapter";
import { requestPortalAccessChange } from "./portalAccess";
import { safeErrorLabel } from "./logSafe";

interface EnrollmentSettings {
  autoEnrollmentEnabled: boolean;
  requireEmail: boolean;
  sendWelcomeNotification: boolean;
}

let cachedSettings: EnrollmentSettings | null = null;
let settingsCacheTime: number = 0;
const SETTINGS_CACHE_TTL = 60000;

function currentRole(): Role | null {
  const role = useAuthStore.getState().currentUser?.role;
  return role ? (role as Role) : null;
}

export async function getEnrollmentSettings(): Promise<EnrollmentSettings> {
  const now = Date.now();

  if (cachedSettings && now - settingsCacheTime < SETTINGS_CACHE_TTL) {
    return cachedSettings;
  }

  const defaults: EnrollmentSettings = {
    autoEnrollmentEnabled: true,
    requireEmail: false,
    sendWelcomeNotification: true,
  };

  if (!supabase) {
    return defaults;
  }

  try {
    const { data, error } = await supabase
      .from("portal_enrollment_settings")
      .select("setting_key, setting_value");

    if (error) {
      logger.error("Failed to fetch enrollment settings:", safeErrorLabel(error));
      return defaults;
    }

    const settings: EnrollmentSettings = { ...defaults };

    for (const row of data || []) {
      switch (row.setting_key) {
        case "auto_enrollment_enabled":
          settings.autoEnrollmentEnabled =
            row.setting_value === true || row.setting_value === "true";
          break;
        case "require_email":
          settings.requireEmail =
            row.setting_value === true || row.setting_value === "true";
          break;
        case "send_welcome_notification":
          settings.sendWelcomeNotification =
            row.setting_value === true || row.setting_value === "true";
          break;
      }
    }

    cachedSettings = settings;
    settingsCacheTime = now;
    return settings;
  } catch (error) {
    logger.error("Failed to get enrollment settings:", safeErrorLabel(error));
    return defaults;
  }
}

/**
 * Change an auto-enrolment setting on the server. Needs the "users"
 * permission (administrators), the same rule as the server. False when the
 * server did not change a row (unknown key, refused, offline).
 */
export async function updateEnrollmentSetting(
  key: string,
  value: boolean,
  updatedBy: string,
): Promise<boolean> {
  if (!supabase) {
    logger.warn("Supabase not initialized");
    return false;
  }

  const role = currentRole();
  if (!role || !can(role, "users")) {
    logger.warn("Enrollment setting not changed: this role cannot change portal settings");
    return false;
  }

  try {
    const { data, error } = await supabase
      .from("portal_enrollment_settings")
      .update({
        setting_value: value,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      })
      .eq("setting_key", key)
      .select("setting_key");

    if (error) {
      logger.error("Failed to update enrollment setting:", safeErrorLabel(error));
      return false;
    }
    if (!Array.isArray(data) || data.length === 0) {
      logger.warn("Enrollment setting not changed: the server updated no row");
      return false;
    }

    cachedSettings = null;
    return true;
  } catch (error) {
    logger.error("Failed to update enrollment setting:", safeErrorLabel(error));
    return false;
  }
}

export function isEligibleForAutoEnrollment(
  patient: Patient,
  settings: EnrollmentSettings,
): boolean {
  if (!settings.autoEnrollmentEnabled) {
    return false;
  }

  if (patient.portalEnabled === 1) {
    return false;
  }

  // A change is already waiting for the server, or the record was merged.
  if (patient.portalPending === 1 || patient.mergeInto) {
    return false;
  }

  if (settings.requireEmail) {
    return Boolean(patient.email && patient.email.trim() !== "");
  }

  const hasPhone = Boolean(patient.phone && patient.phone.trim() !== "");
  const hasEmail = Boolean(patient.email && patient.email.trim() !== "");

  return hasPhone || hasEmail;
}

export interface AutoEnrollResult {
  /** The request was saved (on this device, and queued for the server). */
  enrolled: boolean;
  /** Waiting for the server to confirm. */
  pending?: boolean;
  reason?: "not_eligible" | "not_allowed" | "error";
}

/**
 * After the server confirmed access: create the portal account row and the
 * welcome notification (register permission, as on the server). Failures
 * are logged; access itself is already on.
 */
async function afterConfirmedEnable(
  patient: Patient,
  settings: EnrollmentSettings,
): Promise<void> {
  if (!supabase) return;
  const role = currentRole();
  if (!role || !can(role, "register")) return;

  const phoneNumber = patient.phone?.trim() || null;
  const email = patient.email?.trim() || null;

  if (phoneNumber || email) {
    const { data, error: portalUserError } = await supabase
      .from("patient_portal_users")
      .upsert(
        {
          patient_id: patient.id,
          phone_number: phoneNumber,
          email: email,
          account_status: "active",
        },
        {
          onConflict: "patient_id",
        },
      )
      .select("id");

    if (portalUserError || !Array.isArray(data) || data.length === 0) {
      // The raw error can echo the email or phone that clashed.
      logger.error(
        "Portal user not created:",
        portalUserError ? safeErrorLabel(portalUserError) : "no row written",
      );
    }
  }

  if (settings.sendWelcomeNotification) {
    const { data, error: notificationError } = await supabase
      .from("patient_notifications")
      .insert({
        patient_id: patient.id,
        notification_type: "welcome",
        title: "Welcome to the Patient Portal",
        message:
          "Your patient portal account has been activated. You can now view your health records, request appointments, and message your care team.",
        priority: "normal",
      })
      .select("id");
    if (notificationError || !Array.isArray(data) || data.length === 0) {
      logger.error(
        "Welcome notification not saved:",
        notificationError ? safeErrorLabel(notificationError) : "no row written",
      );
    }
  }
}

/**
 * Ask for portal access for an eligible patient. The server decides
 * (source "auto_enrollment": it never overrides a decision the server
 * already holds). The welcome notification goes out only once the server
 * has confirmed access.
 */
export async function checkAndEnrollPatient(
  patient: Patient,
): Promise<AutoEnrollResult> {
  const settings = await getEnrollmentSettings();

  if (!isEligibleForAutoEnrollment(patient, settings)) {
    return { enrolled: false, reason: "not_eligible" };
  }

  const role = currentRole();
  if (!role || !can(role, "portal_manage")) {
    return { enrolled: false, reason: "not_allowed" };
  }

  try {
    const change = await requestPortalAccessChange(patient.id, true, {
      source: "auto_enrollment",
      reason: "auto_enrollment",
    });
    if (!change.ok) {
      logger.warn("Auto-enrollment not saved for a patient");
      return { enrolled: false, reason: "error" };
    }

    if (change.state === "device_only") {
      logger.log("Auto-enrolled a patient on this device (no server set up)");
      return { enrolled: true, pending: false };
    }

    // Try to get the server's answer now; otherwise it arrives at the next sync.
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      await drainServerCommands().catch(() => null);
    }
    const after = await db.patients.get(patient.id);
    const confirmed = after?.portalPending !== 1 && after?.portalEnabled === 1;
    if (confirmed && after) {
      await afterConfirmedEnable(after, settings);
    }

    logger.log(
      confirmed
        ? "Auto-enrolled a patient (confirmed by the server)"
        : "Auto-enrollment queued for the server",
    );
    return { enrolled: true, pending: !confirmed };
  } catch (error) {
    logger.error("Failed to auto-enroll patient:", safeErrorLabel(error));
    return { enrolled: false, reason: "error" };
  }
}

export async function processAutoEnrollmentForNewPatient(
  patient: Patient,
): Promise<void> {
  await checkAndEnrollPatient(patient);
}

export async function bulkAutoEnroll(
  onProgress?: (processed: number, total: number) => void,
): Promise<{ enrolled: number; skipped: number; failed: number; error?: string }> {
  const settings = await getEnrollmentSettings();

  if (!settings.autoEnrollmentEnabled) {
    return { enrolled: 0, skipped: 0, failed: 0 };
  }

  const role = currentRole();
  if (!role || !can(role, "portal_manage")) {
    return {
      enrolled: 0,
      skipped: 0,
      failed: 0,
      error: "Your role cannot change portal access.",
    };
  }

  let enrolled = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const eligiblePatients = await db.patients
      .filter(
        (p) =>
          p.portalEnabled !== 1 &&
          p.portalPending !== 1 &&
          !p.mergeInto &&
          (Boolean(p.phone?.trim()) || Boolean(p.email?.trim())),
      )
      .toArray();

    const total = eligiblePatients.length;

    for (let i = 0; i < eligiblePatients.length; i++) {
      const patient = eligiblePatients[i];

      if (!isEligibleForAutoEnrollment(patient, settings)) {
        skipped++;
        continue;
      }

      const result = await checkAndEnrollPatient(patient);

      if (result.enrolled) {
        enrolled++;
      } else if (result.reason === "error") {
        failed++;
      } else {
        skipped++;
      }

      if (onProgress && (i + 1) % 10 === 0) {
        onProgress(i + 1, total);
      }
    }

    if (onProgress) {
      onProgress(total, total);
    }

    logger.log(
      `Bulk auto-enrollment complete: ${enrolled} requested, ${skipped} skipped, ${failed} failed`,
    );
  } catch (error) {
    logger.error("Bulk auto-enrollment failed:", safeErrorLabel(error));
  }

  return { enrolled, skipped, failed };
}

/**
 * The patient does not want portal access: turn it off (server decides;
 * a disable always applies there and is recorded as an opt-out).
 */
export async function optOutPatient(patientId: string): Promise<boolean> {
  try {
    const change = await requestPortalAccessChange(patientId, false, {
      reason: "opt_out",
    });
    if (!change.ok) {
      logger.warn("Portal opt-out not saved for a patient");
      return false;
    }
    return true;
  } catch (error) {
    logger.error("Failed to opt out patient:", safeErrorLabel(error));
    return false;
  }
}
