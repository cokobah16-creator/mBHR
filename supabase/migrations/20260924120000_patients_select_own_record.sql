-- Let a patient-portal user read the one patients row linked to their login.
--
-- 20260520000000_lockdown_rls_and_definer dropped the old
-- "Allow authenticated access to patients" policy (USING (true)), which let any
-- signed-in user read every patient. Only staff_all_patients (is_staff()) was
-- left, so a portal patient, who signs in through Supabase Auth and has no
-- app_users row, could no longer read their own record. Portal sign-in then
-- fails with "we couldn't find your patient profile", and every owner policy
-- that looks the patient up through patients.auth_uid (appointments,
-- patient_appointment_requests, ...) silently matches nothing, because that
-- subquery runs under the same RLS.
--
-- Read-only and scoped to the caller's own row. auth_uid is written only by
-- staff (staff_all_patients); patients have no INSERT or UPDATE policy here.

DROP POLICY IF EXISTS patients_select_own ON public.patients;

CREATE POLICY patients_select_own ON public.patients
  FOR SELECT
  TO authenticated
  USING (auth_uid IS NOT NULL AND auth_uid = (SELECT auth.uid())::text);
