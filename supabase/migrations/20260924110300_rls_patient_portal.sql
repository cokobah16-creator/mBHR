-- ============================================================================
-- RLS reconcile (4/5): patient portal tables, storage buckets and portal RPCs
-- ============================================================================
-- Portal ownership is resolved in ONE place: public.app_portal_patient_ids()
-- (20260924110000). The old policies used four different, inconsistent
-- identities (auth.uid() = patient_portal_users.id, app_metadata
-- portal_user_id, a phone claim, and - on patient_data_sharing_preferences,
-- immunizations, conditions, sdoh_observations - patient_id = auth.uid(),
-- which compares a patient record id with a login id and never matched).
--
-- Removed anonymous access (the anon key alone could previously):
--   * read every portal session token ("Anyone can validate session by
--     token", "Sessions viewable") and every portal account ("Portal users
--     can view own data" USING (true));
--   * insert a portal account for ANY patient_id and flip it to 'active'
--     ("patient_portal_users_register"/"_verify"), which, with the phone
--     claim path, handed that patient's records to whoever controlled the
--     phone number;
--   * read/write patient_messages, patient_notifications,
--     patient_submitted_data, record_visibility_log and
--     portal_enrollment_settings (USING (true) policies with no role);
--   * insert tefca_access_logs and portal access logs.
-- Replacements for the flows that needed anon are the SECURITY DEFINER
-- functions at the end of this file (portal_session_check,
-- portal_session_end, portal_link_patient_record) and the existing edge
-- functions (service role).
--
-- patient_documents decision (owner question): the product lets a patient
-- delete their own uploads (DocumentUpload.tsx has a delete action), so a
-- portal patient may delete rows for their own patient record; staff with
-- consult or users may delete any. There is no reliable "uploaded by
-- patient" column in every schema version, so staff-uploaded documents in
-- the patient's folder are deletable by the patient too; see
-- docs/security/RLS_MATRIX.md follow-ups.
--
-- Rollback: restore the previous policies from a pre-migration schema dump
-- and DROP FUNCTION public.portal_session_check(text, timestamptz),
-- public.portal_session_end(text), public.portal_link_patient_record(date,
-- text, text, text).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Portal accounts and sessions
-- ----------------------------------------------------------------------------
SELECT public.app_rls_reset('patient_portal_users');

-- Own account (by any of the portal identities, even while suspended so the
-- portal can explain why), or staff.
SELECT public.app_rls_policy('patient_portal_users', 'patient_portal_users_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR id::text = (SELECT auth.uid())::text
     OR id::text = (SELECT public.current_portal_user_id())
     OR id::text IN (SELECT public.app_portal_user_ids())$p$);

-- Enrolment is staff work (portalEnrollment.ts, autoEnrollment.ts).
SELECT public.app_rls_policy('patient_portal_users', 'patient_portal_users_insert_staff', 'INSERT',
  NULL, $p$(SELECT public.app_has_permission('register'))$p$);

SELECT public.app_rls_policy('patient_portal_users', 'patient_portal_users_update_staff', 'UPDATE',
  $p$(SELECT public.app_has_permission('register'))$p$,
  $p$(SELECT public.app_has_permission('register'))$p$);

-- A patient may change their own settings (language, notification
-- preferences). Identity and verification columns are protected below.
SELECT public.app_rls_policy('patient_portal_users', 'patient_portal_users_update_self', 'UPDATE',
  $p$id::text = (SELECT auth.uid())::text
     OR id::text = (SELECT public.current_portal_user_id())$p$,
  $p$id::text = (SELECT auth.uid())::text
     OR id::text = (SELECT public.current_portal_user_id())$p$);

SELECT public.app_rls_policy('patient_portal_users', 'patient_portal_users_delete_admin', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

DO $$
BEGIN
  IF to_regclass('public.patient_portal_users') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS app_guard_portal_user_identity ON public.patient_portal_users;
    CREATE TRIGGER app_guard_portal_user_identity
      BEFORE UPDATE ON public.patient_portal_users
      FOR EACH ROW EXECUTE FUNCTION public.app_guard_immutable_columns(
        'register',
        'id', 'patient_id', 'account_status', 'phone_number', 'email',
        'phone_verified', 'email_verified', 'otp_secret', 'otp_expires_at',
        'otp_attempts', 'failed_login_attempts', 'locked_until');
  END IF;
END $$;

SELECT public.app_rls_reset('patient_portal_sessions');

SELECT public.app_rls_policy('patient_portal_sessions', 'patient_portal_sessions_select', 'SELECT',
  $p$portal_user_id::text = (SELECT public.current_portal_user_id())
     OR portal_user_id::text = (SELECT auth.uid())::text
     OR portal_user_id::text IN (SELECT public.app_portal_user_ids())
     OR (SELECT public.app_has_permission('users'))$p$);

SELECT public.app_rls_policy('patient_portal_sessions', 'patient_portal_sessions_insert_own', 'INSERT',
  NULL,
  $p$portal_user_id::text = (SELECT public.current_portal_user_id())
     OR portal_user_id::text = (SELECT auth.uid())::text
     OR portal_user_id::text IN (SELECT public.app_portal_user_ids())$p$);

SELECT public.app_rls_policy('patient_portal_sessions', 'patient_portal_sessions_update', 'UPDATE',
  $p$portal_user_id::text = (SELECT public.current_portal_user_id())
     OR portal_user_id::text = (SELECT auth.uid())::text
     OR portal_user_id::text IN (SELECT public.app_portal_user_ids())
     OR (SELECT public.app_has_permission('users'))$p$,
  $p$portal_user_id::text = (SELECT public.current_portal_user_id())
     OR portal_user_id::text = (SELECT auth.uid())::text
     OR portal_user_id::text IN (SELECT public.app_portal_user_ids())
     OR (SELECT public.app_has_permission('users'))$p$);

SELECT public.app_rls_policy('patient_portal_sessions', 'patient_portal_sessions_delete', 'DELETE',
  $p$portal_user_id::text = (SELECT public.current_portal_user_id())
     OR portal_user_id::text = (SELECT auth.uid())::text
     OR portal_user_id::text IN (SELECT public.app_portal_user_ids())
     OR (SELECT public.app_has_permission('users'))$p$);

SELECT public.app_rls_reset('patient_portal_access_logs');

SELECT public.app_rls_policy('patient_portal_access_logs', 'patient_portal_access_logs_select', 'SELECT',
  $p$(SELECT public.app_has_permission('audit_access'))
     OR portal_user_id::text = (SELECT public.current_portal_user_id())
     OR portal_user_id::text IN (SELECT public.app_portal_user_ids())$p$);

SELECT public.app_rls_policy('patient_portal_access_logs', 'patient_portal_access_logs_insert_own', 'INSERT',
  NULL,
  $p$portal_user_id::text = (SELECT public.current_portal_user_id())
     OR portal_user_id::text IN (SELECT public.app_portal_user_ids())$p$);

SELECT public.app_rls_reset('patient_portal_preferences');

SELECT public.app_rls_policy('patient_portal_preferences', 'patient_portal_preferences_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR portal_user_id::text = (SELECT public.current_portal_user_id())
     OR portal_user_id::text = (SELECT auth.uid())::text
     OR portal_user_id::text IN (SELECT public.app_portal_user_ids())$p$);

SELECT public.app_rls_policy('patient_portal_preferences', 'patient_portal_preferences_write_own', 'ALL',
  $p$portal_user_id::text = (SELECT public.current_portal_user_id())
     OR portal_user_id::text = (SELECT auth.uid())::text
     OR portal_user_id::text IN (SELECT public.app_portal_user_ids())$p$,
  $p$portal_user_id::text = (SELECT public.current_portal_user_id())
     OR portal_user_id::text = (SELECT auth.uid())::text
     OR portal_user_id::text IN (SELECT public.app_portal_user_ids())$p$);

-- ----------------------------------------------------------------------------
-- Portal <-> staff messaging (canMessagePatients(): consult)
-- ----------------------------------------------------------------------------
SELECT public.app_rls_reset('patient_secure_messages');

SELECT public.app_rls_policy('patient_secure_messages', 'patient_secure_messages_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_secure_messages', 'patient_secure_messages_insert_staff', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('consult'))
     AND NOT COALESCE(from_patient, false)$p$);

SELECT public.app_rls_policy('patient_secure_messages', 'patient_secure_messages_insert_patient', 'INSERT',
  NULL,
  $p$COALESCE(from_patient, false)
     AND patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_secure_messages', 'patient_secure_messages_update_staff', 'UPDATE',
  $p$(SELECT public.app_has_permission('consult'))$p$,
  $p$(SELECT public.app_has_permission('consult'))$p$);

-- The patient marks messages read / archives; content is protected below.
SELECT public.app_rls_policy('patient_secure_messages', 'patient_secure_messages_update_patient', 'UPDATE',
  $p$patient_id::text IN (SELECT public.app_portal_patient_ids())$p$,
  $p$patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_secure_messages', 'patient_secure_messages_delete_staff', 'DELETE',
  $p$(SELECT public.app_has_permission('consult'))$p$);

DO $$
BEGIN
  IF to_regclass('public.patient_secure_messages') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS app_guard_secure_message ON public.patient_secure_messages;
    CREATE TRIGGER app_guard_secure_message
      BEFORE UPDATE ON public.patient_secure_messages
      FOR EACH ROW EXECUTE FUNCTION public.app_guard_immutable_columns(
        'consult',
        'id', 'patient_id', 'staff_id', 'subject', 'body', 'from_patient',
        'from_name', 'created_at');
  END IF;
END $$;

-- Legacy message table (no current client code); same rules.
SELECT public.app_rls_reset('patient_messages');

SELECT public.app_rls_policy('patient_messages', 'patient_messages_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_messages', 'patient_messages_insert_staff', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('consult'))
     AND sender_type = 'staff'$p$);

SELECT public.app_rls_policy('patient_messages', 'patient_messages_insert_patient', 'INSERT',
  NULL,
  $p$sender_type = 'patient'
     AND patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_messages', 'patient_messages_update_staff', 'UPDATE',
  $p$(SELECT public.app_has_permission('consult'))$p$,
  $p$(SELECT public.app_has_permission('consult'))$p$);

SELECT public.app_rls_policy('patient_messages', 'patient_messages_update_patient', 'UPDATE',
  $p$patient_id::text IN (SELECT public.app_portal_patient_ids())$p$,
  $p$patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_messages', 'patient_messages_delete_staff', 'DELETE',
  $p$(SELECT public.app_has_permission('consult'))$p$);

DO $$
BEGIN
  IF to_regclass('public.patient_messages') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS app_guard_patient_message ON public.patient_messages;
    CREATE TRIGGER app_guard_patient_message
      BEFORE UPDATE ON public.patient_messages
      FOR EACH ROW EXECUTE FUNCTION public.app_guard_immutable_columns(
        'consult',
        'id', 'patient_id', 'sender_type', 'sender_id', 'subject',
        'message_body', 'parent_message_id', 'created_at');
  END IF;
END $$;

-- Notifications to patients (autoEnrollment.ts inserts them).
SELECT public.app_rls_reset('patient_notifications');

SELECT public.app_rls_policy('patient_notifications', 'patient_notifications_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_notifications', 'patient_notifications_insert_staff', 'INSERT',
  NULL, $p$(SELECT public.app_has_permission('register'))$p$);

SELECT public.app_rls_policy('patient_notifications', 'patient_notifications_update_staff', 'UPDATE',
  $p$(SELECT public.app_has_permission('register'))$p$,
  $p$(SELECT public.app_has_permission('register'))$p$);

SELECT public.app_rls_policy('patient_notifications', 'patient_notifications_update_patient', 'UPDATE',
  $p$patient_id::text IN (SELECT public.app_portal_patient_ids())$p$,
  $p$patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

DO $$
BEGIN
  IF to_regclass('public.patient_notifications') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS app_guard_patient_notification ON public.patient_notifications;
    CREATE TRIGGER app_guard_patient_notification
      BEFORE UPDATE ON public.patient_notifications
      FOR EACH ROW EXECUTE FUNCTION public.app_guard_immutable_columns(
        'register',
        'id', 'patient_id', 'notification_type', 'title', 'message',
        'priority', 'action_url', 'action_label', 'metadata', 'created_at');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Appointment requests (patient asks; front desk schedules)
-- ----------------------------------------------------------------------------
SELECT public.app_rls_reset('patient_appointment_requests');

SELECT public.app_rls_policy('patient_appointment_requests', 'patient_appointment_requests_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_appointment_requests', 'patient_appointment_requests_insert_patient', 'INSERT',
  NULL,
  $p$status = 'pending'
     AND reviewed_by IS NULL
     AND patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_appointment_requests', 'patient_appointment_requests_update_staff', 'UPDATE',
  $p$(SELECT public.app_has_permission('register'))$p$,
  $p$(SELECT public.app_has_permission('register'))$p$);

-- A patient may only cancel a pending request (unchanged rule).
SELECT public.app_rls_policy('patient_appointment_requests', 'patient_appointment_requests_cancel_patient', 'UPDATE',
  $p$status = 'pending'
     AND patient_id::text IN (SELECT public.app_portal_patient_ids())$p$,
  $p$status = 'cancelled'
     AND patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

DO $$
BEGIN
  IF to_regclass('public.patient_appointment_requests') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS app_guard_appointment_request ON public.patient_appointment_requests;
    CREATE TRIGGER app_guard_appointment_request
      BEFORE UPDATE ON public.patient_appointment_requests
      FOR EACH ROW EXECUTE FUNCTION public.app_guard_immutable_columns(
        'register',
        'id', 'patient_id', 'reviewed_by', 'reviewed_at', 'review_notes',
        'scheduled_appointment_id', 'created_at');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Documents, consent, sharing preferences, submissions
-- ----------------------------------------------------------------------------
SELECT public.app_rls_reset('patient_documents');

SELECT public.app_rls_policy('patient_documents', 'patient_documents_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_documents', 'patient_documents_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_any_permission(ARRAY['register', 'vitals', 'consult']))
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_documents', 'patient_documents_update_staff', 'UPDATE',
  $p$(SELECT public.app_has_any_permission(ARRAY['register', 'vitals', 'consult']))$p$,
  $p$(SELECT public.app_has_any_permission(ARRAY['register', 'vitals', 'consult']))$p$);

SELECT public.app_rls_policy('patient_documents', 'patient_documents_delete', 'DELETE',
  $p$(SELECT public.app_has_any_permission(ARRAY['consult', 'users']))
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

-- Consent is append-only apart from staff recording a revocation.
SELECT public.app_rls_reset('patient_consent_records');

SELECT public.app_rls_policy('patient_consent_records', 'patient_consent_records_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_consent_records', 'patient_consent_records_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('register'))
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_consent_records', 'patient_consent_records_update_staff', 'UPDATE',
  $p$(SELECT public.app_has_permission('register'))$p$,
  $p$(SELECT public.app_has_permission('register'))$p$);

-- Data sharing preferences (DataSharingPreferences.tsx). The old policies
-- compared patient_id with auth.uid(), so patients could never save them.
SELECT public.app_rls_reset('patient_data_sharing_preferences');

SELECT public.app_rls_policy('patient_data_sharing_preferences', 'patient_data_sharing_preferences_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_data_sharing_preferences', 'patient_data_sharing_preferences_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('register'))
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_data_sharing_preferences', 'patient_data_sharing_preferences_update', 'UPDATE',
  $p$(SELECT public.app_has_permission('register'))
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$,
  $p$(SELECT public.app_has_permission('register'))
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

-- TEFCA access log: audit readers and the patient it concerns (shown in
-- DataSharingPreferences.tsx) read; staff append. Edge functions use the
-- service role. The old anon INSERT WITH CHECK (true) is gone.
SELECT public.app_rls_reset('tefca_access_logs');

SELECT public.app_rls_policy('tefca_access_logs', 'tefca_access_logs_select', 'SELECT',
  $p$(SELECT public.app_has_permission('audit_access'))
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('tefca_access_logs', 'tefca_access_logs_insert_staff', 'INSERT',
  NULL, $p$(SELECT public.app_is_staff())$p$);

-- Patient-submitted data: the patient submits and may edit while pending;
-- clinicians (consult) review and merge.
SELECT public.app_rls_reset('patient_submitted_data');

SELECT public.app_rls_policy('patient_submitted_data', 'patient_submitted_data_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_submitted_data', 'patient_submitted_data_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('consult'))
     OR (status = 'pending'
         AND reviewed_by IS NULL
         AND reviewed_at IS NULL
         AND patient_id::text IN (SELECT public.app_portal_patient_ids()))$p$);

SELECT public.app_rls_policy('patient_submitted_data', 'patient_submitted_data_update_staff', 'UPDATE',
  $p$(SELECT public.app_has_permission('consult'))$p$,
  $p$(SELECT public.app_has_permission('consult'))$p$);

SELECT public.app_rls_policy('patient_submitted_data', 'patient_submitted_data_update_patient', 'UPDATE',
  $p$status = 'pending'
     AND patient_id::text IN (SELECT public.app_portal_patient_ids())$p$,
  $p$status = 'pending'
     AND reviewed_by IS NULL
     AND reviewed_at IS NULL
     AND patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

-- Who hid/showed a record in the portal: staff append, staff read.
SELECT public.app_rls_reset('record_visibility_log');

SELECT public.app_rls_policy('record_visibility_log', 'record_visibility_log_select_staff', 'SELECT',
  $p$(SELECT public.app_is_staff())$p$);

SELECT public.app_rls_policy('record_visibility_log', 'record_visibility_log_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_any_permission(ARRAY['vitals', 'consult', 'dispense']))$p$);

-- Portal enrolment settings: staff read; admin (users) changes. Previously
-- anyone, including anon, could update them.
SELECT public.app_rls_reset('portal_enrollment_settings');

SELECT public.app_rls_policy('portal_enrollment_settings', 'portal_enrollment_settings_select_staff', 'SELECT',
  $p$(SELECT public.app_is_staff())$p$);

SELECT public.app_rls_policy('portal_enrollment_settings', 'portal_enrollment_settings_insert_users', 'INSERT',
  NULL, $p$(SELECT public.app_has_permission('users'))$p$);

SELECT public.app_rls_policy('portal_enrollment_settings', 'portal_enrollment_settings_update_users', 'UPDATE',
  $p$(SELECT public.app_has_permission('users'))$p$,
  $p$(SELECT public.app_has_permission('users'))$p$);

-- ----------------------------------------------------------------------------
-- Portal-only clinical tables (20251030000000). Their staff policies used
-- auth.jwt() ->> 'role' IN ('admin','doctor','nurse'); that claim is always
-- 'authenticated', so staff never had access.
-- ----------------------------------------------------------------------------
-- patient_lab_results is the patient-visible copy of results. Only lab
-- reviewers may publish to it (owner decision #2 / #5).
SELECT public.app_rls_reset('patient_lab_results');

SELECT public.app_rls_policy('patient_lab_results', 'patient_lab_results_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_lab_results', 'patient_lab_results_insert_review', 'INSERT',
  NULL, $p$(SELECT public.app_has_permission('lab_review'))$p$);

SELECT public.app_rls_policy('patient_lab_results', 'patient_lab_results_update_review', 'UPDATE',
  $p$(SELECT public.app_has_permission('lab_review'))$p$,
  $p$(SELECT public.app_has_permission('lab_review'))$p$);

SELECT public.app_rls_policy('patient_lab_results', 'patient_lab_results_delete_admin', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

-- Conditions a patient reports themselves (MedicalConditions.tsx).
SELECT public.app_rls_reset('patient_medical_conditions');

SELECT public.app_rls_policy('patient_medical_conditions', 'patient_medical_conditions_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_medical_conditions', 'patient_medical_conditions_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('consult'))
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_medical_conditions', 'patient_medical_conditions_update_consult', 'UPDATE',
  $p$(SELECT public.app_has_permission('consult'))$p$,
  $p$(SELECT public.app_has_permission('consult'))$p$);

SELECT public.app_rls_policy('patient_medical_conditions', 'patient_medical_conditions_delete_consult', 'DELETE',
  $p$(SELECT public.app_has_permission('consult'))$p$);

SELECT public.app_rls_reset('patient_referrals');

SELECT public.app_rls_policy('patient_referrals', 'patient_referrals_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     OR patient_id::text IN (SELECT public.app_portal_patient_ids())$p$);

SELECT public.app_rls_policy('patient_referrals', 'patient_referrals_insert_consult', 'INSERT',
  NULL, $p$(SELECT public.app_has_permission('consult'))$p$);

SELECT public.app_rls_policy('patient_referrals', 'patient_referrals_update_consult', 'UPDATE',
  $p$(SELECT public.app_has_permission('consult'))$p$,
  $p$(SELECT public.app_has_permission('consult'))$p$);

-- OTP rate-limit rows: "Service role can manage OTP rate limits" was
-- actually granted TO authenticated USING (true), so any signed-in account
-- could read phone identifiers and reset its own OTP limits. Service role
-- only (no client policy).
SELECT public.app_rls_reset('otp_rate_limits');

-- ----------------------------------------------------------------------------
-- Storage
-- ----------------------------------------------------------------------------
-- photos: "Public can view photos" (TO public) was still live - the
-- 20260520000000 lockdown dropped a policy name that never existed
-- ("photos_public_read") - and any signed-in account (portal patients
-- included) could upload, replace or delete patient photos.
DROP POLICY IF EXISTS "Public can view photos"                ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their photos"         ON storage.objects;
DROP POLICY IF EXISTS "Users can delete photos"               ON storage.objects;
DROP POLICY IF EXISTS "photos_public_read"                    ON storage.objects;
DROP POLICY IF EXISTS "photos_staff_all"                      ON storage.objects;
DROP POLICY IF EXISTS "photos_select_staff"                   ON storage.objects;
DROP POLICY IF EXISTS "photos_insert_station"                 ON storage.objects;
DROP POLICY IF EXISTS "photos_update_station"                 ON storage.objects;
DROP POLICY IF EXISTS "photos_delete_station"                 ON storage.objects;

CREATE POLICY "photos_select_staff" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'photos' AND (SELECT public.app_is_staff()));

CREATE POLICY "photos_insert_station" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos'
    AND (SELECT public.app_has_any_permission(ARRAY['register', 'vitals', 'consult'])));

CREATE POLICY "photos_update_station" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'photos'
    AND (SELECT public.app_has_any_permission(ARRAY['register', 'vitals', 'consult'])))
  WITH CHECK (bucket_id = 'photos'
    AND (SELECT public.app_has_any_permission(ARRAY['register', 'vitals', 'consult'])));

CREATE POLICY "photos_delete_station" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'photos'
    AND (SELECT public.app_has_any_permission(ARRAY['register', 'users'])));

-- patient-documents: files live under "<patient_id>/...". The old patient
-- policies only understood the app_metadata portal identity and the staff
-- policy used the always-'authenticated' JWT role claim.
DROP POLICY IF EXISTS "Patients can upload own documents"     ON storage.objects;
DROP POLICY IF EXISTS "Patients can view own documents"       ON storage.objects;
DROP POLICY IF EXISTS "Staff can view all patient documents"  ON storage.objects;
DROP POLICY IF EXISTS "patient_documents_objects_select"      ON storage.objects;
DROP POLICY IF EXISTS "patient_documents_objects_insert"      ON storage.objects;
DROP POLICY IF EXISTS "patient_documents_objects_delete"      ON storage.objects;

CREATE POLICY "patient_documents_objects_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'patient-documents'
    AND ((SELECT public.app_is_staff())
         OR (storage.foldername(name))[1] IN (SELECT public.app_portal_patient_ids())));

CREATE POLICY "patient_documents_objects_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'patient-documents'
    AND ((SELECT public.app_has_any_permission(ARRAY['register', 'vitals', 'consult']))
         OR (storage.foldername(name))[1] IN (SELECT public.app_portal_patient_ids())));

CREATE POLICY "patient_documents_objects_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'patient-documents'
    AND ((SELECT public.app_has_any_permission(ARRAY['consult', 'users']))
         OR (storage.foldername(name))[1] IN (SELECT public.app_portal_patient_ids())));

-- ----------------------------------------------------------------------------
-- Legacy SECURITY DEFINER helpers that anyone (anon included) could call:
-- create a notification for any patient, write fake access logs, test
-- whether a patient has a portal account, read any patient's dashboard
-- counts. None is called by the app; keep them for the service role only.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'log_patient_portal_access',
         'create_patient_notification',
         'patient_has_portal_account',
         'get_patient_dashboard_counts'
       )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
                   f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.signature);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Portal RPCs replacing the anonymous table access
-- ----------------------------------------------------------------------------

-- Validate / refresh a portal session by its token (sessionManager.ts used
-- to SELECT/UPDATE patient_portal_sessions with the anon key, which required
-- every session to be readable by anyone). Returns no row when the token is
-- unknown or inactive. A session more than 5 minutes past expiry is
-- deactivated and returned with session_active = false. p_extend_until
-- extends the session, capped at 24 hours from now.
CREATE OR REPLACE FUNCTION public.portal_session_check(
  p_session_token text,
  p_extend_until timestamptz DEFAULT NULL
)
RETURNS TABLE (
  session_id text,
  session_expires_at timestamptz,
  session_active boolean,
  session_last_activity_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id text;
  v_expires timestamptz;
BEGIN
  IF p_session_token IS NULL OR length(p_session_token) < 16 THEN
    RETURN;
  END IF;

  SELECT s.id::text, s.expires_at
    INTO v_id, v_expires
    FROM public.patient_portal_sessions AS s
   WHERE s.session_token = p_session_token
     AND s.is_active = true
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  IF v_expires IS NOT NULL AND v_expires < now() - interval '5 minutes' THEN
    UPDATE public.patient_portal_sessions AS s
       SET is_active = false
     WHERE s.session_token = p_session_token
       AND s.id::text = v_id;
  ELSIF p_extend_until IS NOT NULL THEN
    UPDATE public.patient_portal_sessions AS s
       SET expires_at = LEAST(p_extend_until, now() + interval '24 hours'),
           last_activity_at = now()
     WHERE s.session_token = p_session_token
       AND s.id::text = v_id;
  ELSE
    UPDATE public.patient_portal_sessions AS s
       SET last_activity_at = now()
     WHERE s.session_token = p_session_token
       AND s.id::text = v_id;
  END IF;

  RETURN QUERY
    SELECT s.id::text, s.expires_at, s.is_active, s.last_activity_at
      FROM public.patient_portal_sessions AS s
     WHERE s.session_token = p_session_token
       AND s.id::text = v_id;
END;
$$;

-- End a portal session by its token (logout). True when a session ended.
CREATE OR REPLACE FUNCTION public.portal_session_end(p_session_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_session_token IS NULL OR length(p_session_token) < 16 THEN
    RETURN false;
  END IF;
  UPDATE public.patient_portal_sessions AS s
     SET is_active = false
   WHERE s.session_token = p_session_token
     AND s.is_active = true;
  RETURN FOUND;
END;
$$;

-- Link the signed-in portal account to its clinic record, or create a
-- self-registered record (replaces the anon patients SELECT/INSERT and the
-- client-side UPDATE in src/hooks/useAuth.ts signup()).
--
-- Matching uses only contact details Supabase Auth has VERIFIED for this
-- account (confirmed email, or confirmed phone compared on its last 10
-- digits), never values typed into the request. A match is linked only when
--   * exactly one unlinked record matches and none is linked to someone else,
--   * staff have enabled portal access for it (patients.portal_enabled), and
--   * p_dob equals the record's date of birth.
-- Otherwise nothing is changed and the status says why, so the portal can
-- ask the patient to see clinic staff. With no match at all, a new record
-- is created for the account (portal enabled, sex 'other', empty address)
-- as the app did before, but only when the account has a verified email or
-- phone, and only the verified phone is stored.
--
-- Returns jsonb {status, patient_id?}; status is one of:
--   already_linked | linked | created | staff_account | linked_elsewhere |
--   ambiguous | portal_not_enabled | needs_staff_verification |
--   contact_not_verified | missing_details
CREATE OR REPLACE FUNCTION public.portal_link_patient_record(
  p_dob date,
  p_given_name text DEFAULT NULL,
  p_family_name text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_email_verified text;
  v_phone10 text;
  v_free integer;
  v_taken integer;
  v_id text;
  v_enabled boolean;
  v_dob date;
  v_rows integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to the patient portal first' USING ERRCODE = '42501';
  END IF;

  IF public.app_current_role() IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'staff_account');
  END IF;

  SELECT p.id::text INTO v_id
    FROM public.patients AS p
   WHERE p.auth_uid::text = v_uid::text
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_linked', 'patient_id', v_id);
  END IF;

  SELECT u.email,
         CASE WHEN u.email_confirmed_at IS NOT NULL
              THEN lower(trim(u.email)) END,
         CASE WHEN u.phone_confirmed_at IS NOT NULL
              THEN right(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g'), 10) END
    INTO v_email, v_email_verified, v_phone10
    FROM auth.users AS u
   WHERE u.id = v_uid;

  IF v_phone10 IS NOT NULL AND length(v_phone10) <> 10 THEN
    v_phone10 := NULL;
  END IF;

  SELECT count(*) FILTER (WHERE c.auth_uid IS NULL),
         count(*) FILTER (WHERE c.auth_uid IS NOT NULL)
    INTO v_free, v_taken
    FROM public.patients AS c
   WHERE (v_email_verified IS NOT NULL
          AND lower(trim(c.email)) = v_email_verified)
      OR (v_phone10 IS NOT NULL
          AND right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10) = v_phone10);

  IF v_taken > 0 THEN
    RETURN jsonb_build_object('status', 'linked_elsewhere');
  END IF;
  IF v_free > 1 THEN
    RETURN jsonb_build_object('status', 'ambiguous');
  END IF;

  IF v_free = 1 THEN
    SELECT c.id::text, COALESCE(c.portal_enabled, false), c.dob
      INTO v_id, v_enabled, v_dob
      FROM public.patients AS c
     WHERE c.auth_uid IS NULL
       AND ((v_email_verified IS NOT NULL
             AND lower(trim(c.email)) = v_email_verified)
         OR (v_phone10 IS NOT NULL
             AND right(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10) = v_phone10))
     LIMIT 1;

    IF NOT v_enabled THEN
      RETURN jsonb_build_object('status', 'portal_not_enabled');
    END IF;
    IF p_dob IS NULL OR v_dob IS NULL OR v_dob <> p_dob THEN
      RETURN jsonb_build_object('status', 'needs_staff_verification');
    END IF;

    UPDATE public.patients AS c
       SET auth_uid = v_uid::text
     WHERE c.id::text = v_id
       AND c.auth_uid IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RETURN jsonb_build_object('status', 'linked_elsewhere');
    END IF;

    BEGIN
      INSERT INTO public.audit_logs (id, actor_role, action, entity, entity_id, at)
      VALUES (gen_random_uuid()::text, 'patient', 'portal_link_patient_record',
              'patient', v_id, now());
    EXCEPTION WHEN undefined_column OR undefined_table THEN
      RAISE WARNING 'portal_link_patient_record: audit_logs schema differs; link not audited';
    END;

    RETURN jsonb_build_object('status', 'linked', 'patient_id', v_id);
  END IF;

  -- No clinic record matches: create a self-registered one, but only for an
  -- account with a verified email or phone. An unverified account could
  -- otherwise fill the patient register with records carrying someone
  -- else's phone number (duplicate-record and wrong-patient risk, and it
  -- would block that person's own link later as linked_elsewhere).
  IF v_email_verified IS NULL AND v_phone10 IS NULL THEN
    RETURN jsonb_build_object('status', 'contact_not_verified');
  END IF;

  IF COALESCE(trim(p_given_name), '') = ''
     OR COALESCE(trim(p_family_name), '') = ''
     OR p_dob IS NULL THEN
    RETURN jsonb_build_object('status', 'missing_details');
  END IF;

  -- Only a verified phone is stored: the typed p_phone is kept when it is
  -- the account's verified number, otherwise the verified number is used.
  v_id := gen_random_uuid()::text;
  INSERT INTO public.patients (
    id, auth_uid, given_name, family_name, email, phone, dob, sex,
    address, state, lga, portal_enabled
  ) VALUES (
    v_id, v_uid::text, trim(p_given_name), trim(p_family_name),
    CASE WHEN v_email_verified IS NOT NULL THEN trim(v_email) END,
    CASE
      WHEN v_phone10 IS NULL THEN NULL
      WHEN right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 10) = v_phone10
        THEN trim(p_phone)
      ELSE (SELECT u.phone FROM auth.users AS u WHERE u.id = v_uid)
    END,
    p_dob, 'other', '', '', '', true
  );

  BEGIN
    INSERT INTO public.audit_logs (id, actor_role, action, entity, entity_id, at)
    VALUES (gen_random_uuid()::text, 'patient', 'portal_self_register',
            'patient', v_id, now());
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    RAISE WARNING 'portal_link_patient_record: audit_logs schema differs; registration not audited';
  END;

  RETURN jsonb_build_object('status', 'created', 'patient_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_session_check(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_session_end(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_link_patient_record(date, text, text, text) FROM PUBLIC, anon;

-- The session token itself is the credential, so the session RPCs stay
-- callable before a Supabase sign-in (the local PIN portal login).
GRANT EXECUTE ON FUNCTION public.portal_session_check(text, timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_session_end(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_link_patient_record(date, text, text, text) TO authenticated, service_role;

-- End of migration.
