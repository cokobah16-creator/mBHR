import { supabase } from "@/lib/supabase";
import { db, Patient } from "@/db";
import * as logger from "@/lib/logger";

interface EnrollmentSettings {
  autoEnrollmentEnabled: boolean;
  requireEmail: boolean;
  sendWelcomeNotification: boolean;
}

let cachedSettings: EnrollmentSettings | null = null;
let settingsCacheTime: number = 0;
const SETTINGS_CACHE_TTL = 60000;

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
      logger.error("Failed to fetch enrollment settings:", error);
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
    logger.error("Failed to get enrollment settings:", error);
    return defaults;
  }
}

export async function updateEnrollmentSetting(
  key: string,
  value: boolean,
  updatedBy: string,
): Promise<boolean> {
  if (!supabase) {
    logger.warn("Supabase not initialized");
    return false;
  }

  try {
    const { error } = await supabase
      .from("portal_enrollment_settings")
      .update({
        setting_value: value,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      })
      .eq("setting_key", key);

    if (error) {
      logger.error("Failed to update enrollment setting:", error);
      return false;
    }

    cachedSettings = null;
    return true;
  } catch (error) {
    logger.error("Failed to update enrollment setting:", error);
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

  if (settings.requireEmail) {
    return Boolean(patient.email && patient.email.trim() !== "");
  }

  const hasPhone = Boolean(patient.phone && patient.phone.trim() !== "");
  const hasEmail = Boolean(patient.email && patient.email.trim() !== "");

  return hasPhone || hasEmail;
}

export async function checkAndEnrollPatient(
  patient: Patient,
): Promise<{ enrolled: boolean; reason?: string }> {
  const settings = await getEnrollmentSettings();

  if (!isEligibleForAutoEnrollment(patient, settings)) {
    return { enrolled: false, reason: "not_eligible" };
  }

  try {
    const now = new Date();

    await db.patients.update(patient.id, {
      portalEnabled: 1,
      updatedAt: now,
      _dirty: 1,
    });

    if (supabase) {
      const { error: patientError } = await supabase
        .from("patients")
        .update({
          portal_enabled: true,
          auto_enrolled: true,
          auto_enrolled_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", patient.id);

      if (patientError) {
        logger.error("Failed to update patient in Supabase:", patientError);
      }

      const phoneNumber = patient.phone?.trim() || null;
      const email = patient.email?.trim() || null;

      if (phoneNumber || email) {
        const { error: portalUserError } = await supabase
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
          );

        if (portalUserError) {
          logger.error("Failed to create portal user:", portalUserError);
        }
      }

      if (settings.sendWelcomeNotification) {
        await supabase.from("patient_notifications").insert({
          patient_id: patient.id,
          notification_type: "welcome",
          title: "Welcome to the Patient Portal",
          message:
            "Your patient portal account has been activated. You can now view your health records, request appointments, and message your care team.",
          priority: "normal",
        });
      }
    }

    logger.log(`Auto-enrolled patient ${patient.id} in portal`);
    return { enrolled: true };
  } catch (error) {
    logger.error("Failed to auto-enroll patient:", error);
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
): Promise<{ enrolled: number; skipped: number; failed: number }> {
  const settings = await getEnrollmentSettings();

  if (!settings.autoEnrollmentEnabled) {
    return { enrolled: 0, skipped: 0, failed: 0 };
  }

  let enrolled = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const eligiblePatients = await db.patients
      .filter(
        (p) =>
          p.portalEnabled !== 1 &&
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
      `Bulk auto-enrollment complete: ${enrolled} enrolled, ${skipped} skipped, ${failed} failed`,
    );
  } catch (error) {
    logger.error("Bulk auto-enrollment failed:", error);
  }

  return { enrolled, skipped, failed };
}

export async function optOutPatient(patientId: string): Promise<boolean> {
  try {
    await db.patients.update(patientId, {
      portalEnabled: 0,
      updatedAt: new Date(),
      _dirty: 1,
    });

    if (supabase) {
      await supabase
        .from("patients")
        .update({
          portal_enabled: false,
          portal_opt_out: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", patientId);
    }

    return true;
  } catch (error) {
    logger.error("Failed to opt out patient:", error);
    return false;
  }
}
