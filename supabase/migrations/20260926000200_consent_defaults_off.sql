/*
  # Consent defaults off

  Legal readiness checklist item 9 (docs/legal/LEGAL_READINESS_CHECKLIST.md).
  Portal access and record sharing should start from the patient's clear
  yes, not from a default. This migration changes only what happens from
  now on. It does not change any existing patient's portal access or any
  sharing choice a patient has saved.

  ## Changes
  1. patients
     - Drops trigger_auto_enrollment and its function check_auto_enrollment()
       (20260115072241_add_portal_enhancements_v3). On every insert or update
       of a patient with a phone or email, the trigger set portal_enabled,
       auto_enrolled and auto_enrolled_at unless portal_opt_out was set.
       After this, a new patient's portal_enabled stays false (the column
       default) until something sets it. From the app that is:
       - enablePortalAccess (src/services/portalEnrollment.ts), used by the
         record page switch (PortalStatusCard) and the PortalMigration
         admin page. It saves on the device, then updates portal_enabled
         here only when the device is online, this row already exists (the
         record has been uploaded) and the online sign-in holds 'register'
         (app_guard_patient_identity). Otherwise only the device changes,
         and nothing retries it. disablePortalAccess works the same way.
       - enrollPatientInPortal (src/services/unifiedPortalEnrollment.ts),
         used by PatientForm and BulkPortalMigration. It sets portal_enabled
         only after inserting a patient_portal_users row. That insert also
         sends given_name, family_name, dob and sex, which the table does
         not have in these migrations, so on a server built from them it
         fails and sets nothing (checklist item 2, step 9).
       - portal_link_patient_record sets it for a record it creates for a
         self-registered account, but nothing in src calls it yet.
       The planned set_patient_portal_access command is meant to replace
       these direct writes (checklist item 9).
  2. portal_enrollment_settings (setting_value is jsonb)
     - auto_enrollment_enabled and send_welcome_notification are set to
       'false'::jsonb, and inserted with that value if missing. Both are
       also read by src/services/autoEnrollment.ts.
  3. patient_data_sharing_preferences
     - allow_treatment_access defaults to false for rows created from now
       on. Stored rows keep the value the patient saved.
     - allow_ias_access is not changed: whether it stays on by default is a
       separate decision (checklist item 9).

  ## Not changed
  - portal_enabled, auto_enrolled and auto_enrolled_at on existing patients.
    Whether patients who were enrolled automatically keep access is a
    decision for the Foundation (checklist item 9).
  - Any existing patient_data_sharing_preferences row.

  ## Rollback
    ALTER TABLE public.patient_data_sharing_preferences
      ALTER COLUMN allow_treatment_access SET DEFAULT true;
    UPDATE public.portal_enrollment_settings
       SET setting_value = 'true'::jsonb, updated_at = now()
     WHERE setting_key IN ('auto_enrollment_enabled', 'send_welcome_notification');
    -- Then re-run the "AUTO-ENROLLMENT TRIGGER" section of
    -- 20260115072241_add_portal_enhancements_v3.sql: CREATE OR REPLACE
    -- FUNCTION check_auto_enrollment() and CREATE TRIGGER
    -- trigger_auto_enrollment BEFORE INSERT OR UPDATE ON patients.
*/

-- 1. Stop enrolling patients in the portal automatically.
DO $$
BEGIN
  IF to_regclass('public.patients') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trigger_auto_enrollment ON public.patients;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.check_auto_enrollment();

-- 2. Turn the auto-enrolment and welcome-message settings off.
DO $$
BEGIN
  IF to_regclass('public.portal_enrollment_settings') IS NOT NULL THEN
    INSERT INTO public.portal_enrollment_settings (setting_key, setting_value, description)
    VALUES
      ('auto_enrollment_enabled', 'false'::jsonb,
       'Enable automatic portal enrollment for eligible patients'),
      ('send_welcome_notification', 'false'::jsonb,
       'Send welcome notification to newly enrolled patients')
    ON CONFLICT (setting_key) DO UPDATE
      SET setting_value = EXCLUDED.setting_value,
          updated_at = now()
      WHERE public.portal_enrollment_settings.setting_value
            IS DISTINCT FROM EXCLUDED.setting_value;
  END IF;
END $$;

-- 3. Sharing with other treating providers starts off for new rows only.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'patient_data_sharing_preferences'
       AND column_name = 'allow_treatment_access'
  ) THEN
    ALTER TABLE public.patient_data_sharing_preferences
      ALTER COLUMN allow_treatment_access SET DEFAULT false;
  END IF;
END $$;

-- End of migration.
