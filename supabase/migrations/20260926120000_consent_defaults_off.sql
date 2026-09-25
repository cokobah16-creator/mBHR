/*
  # Consent defaults off

  Legal readiness checklist item 9 (docs/legal/LEGAL_READINESS_CHECKLIST.md).
  Portal access and record sharing should start from the patient's clear
  yes, not from a default. This migration changes only what happens from
  now on. It does not change any existing patient's portal access or any
  sharing choice a patient has saved.

  Portal access is decided by the server
  (20260925100100_portal_access_authoritative.sql). Staff ask for a change
  with set_patient_portal_access, queued on the device and sent under their
  online sign-in, and the patients guard trigger puts back portal_enabled
  when an API write tries to change it. The auto-enrolment trigger
  (trigger_auto_enrollment, check_auto_enrollment()) runs on INSERT only. It
  never touches an existing record, a record with a recorded decision, a
  patient who opted out or whose access was turned off before, and it turns
  portal access on only while the auto_enrollment_enabled setting is true.
  So this migration keeps the trigger (supabase/tests/portal_access.test.sql
  expects it) and switches auto-enrolment off with that setting.

  ## Changes
  1. portal_enrollment_settings (setting_value is jsonb)
     - auto_enrollment_enabled and send_welcome_notification are set to
       'false'::jsonb, and inserted with that value if missing. With
       auto_enrollment_enabled false, check_auto_enrollment() leaves a new
       patient's portal access off until staff ask for it. Both settings are
       also read by src/services/autoEnrollment.ts.
  2. patient_data_sharing_preferences
     - allow_treatment_access defaults to false for rows created from now
       on. Stored rows keep the value the patient saved.
     - allow_ias_access is not changed: whether it stays on by default is a
       separate decision (checklist item 9).

  ## Not changed
  - trigger_auto_enrollment, trigger_auto_enrollment_log and their
    functions (20260925100100).
  - portal_enabled, auto_enrolled and auto_enrolled_at on existing patients.
    Whether patients who were enrolled automatically keep access is a
    decision for the Foundation (checklist item 9).
  - Any existing patient_data_sharing_preferences row.

  Every statement can be run again: the upsert only writes a setting that
  differs, and setting a column default twice gives the same default.

  ## Rollback
    ALTER TABLE public.patient_data_sharing_preferences
      ALTER COLUMN allow_treatment_access SET DEFAULT true;
    UPDATE public.portal_enrollment_settings
       SET setting_value = 'true'::jsonb, updated_at = now()
     WHERE setting_key IN ('auto_enrollment_enabled', 'send_welcome_notification');
*/

-- 1. Turn the auto-enrolment and welcome-message settings off.
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

-- 2. Sharing with other treating providers starts off for new rows only.
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
