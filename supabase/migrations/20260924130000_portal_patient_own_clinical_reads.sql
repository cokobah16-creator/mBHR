-- Let a patient-portal user read their own clinical record and use secure
-- messages.
--
-- After 20260520000000_lockdown_rls_and_definer, visits, vitals,
-- consultations, dispenses and patient_secure_messages kept only staff
-- policies (and, for messages, owner policies keyed on the OTP portal's
-- current_portal_user_id(), which is NULL for patients who sign in through
-- Supabase Auth). The portal dashboard, medical history, visit detail and
-- messages therefore came back empty or failed for every patient.
--
-- Every policy here is scoped to the caller's own patient through
-- patients.auth_uid, which is unique (idx_patients_auth_uid) and readable by
-- the caller via patients_select_own (20260924120000). Clinical tables are
-- read-only for patients; only patient-authored messages can be inserted, and
-- only as from_patient = true for the caller's own patient.

-- visits
DROP POLICY IF EXISTS visits_select_own_patient ON public.visits;
CREATE POLICY visits_select_own_patient ON public.visits
  FOR SELECT TO authenticated
  USING (patient_id IN (
    SELECT p.id FROM public.patients p
    WHERE p.auth_uid = (SELECT auth.uid())::text
  ));

-- vitals
DROP POLICY IF EXISTS vitals_select_own_patient ON public.vitals;
CREATE POLICY vitals_select_own_patient ON public.vitals
  FOR SELECT TO authenticated
  USING (patient_id IN (
    SELECT p.id FROM public.patients p
    WHERE p.auth_uid = (SELECT auth.uid())::text
  ));

-- consultations
DROP POLICY IF EXISTS consultations_select_own_patient ON public.consultations;
CREATE POLICY consultations_select_own_patient ON public.consultations
  FOR SELECT TO authenticated
  USING (patient_id IN (
    SELECT p.id FROM public.patients p
    WHERE p.auth_uid = (SELECT auth.uid())::text
  ));

-- dispenses
DROP POLICY IF EXISTS dispenses_select_own_patient ON public.dispenses;
CREATE POLICY dispenses_select_own_patient ON public.dispenses
  FOR SELECT TO authenticated
  USING (patient_id IN (
    SELECT p.id FROM public.patients p
    WHERE p.auth_uid = (SELECT auth.uid())::text
  ));

-- patient_secure_messages: read the thread, and send as the patient only
DROP POLICY IF EXISTS patient_secure_messages_select_own_patient ON public.patient_secure_messages;
CREATE POLICY patient_secure_messages_select_own_patient ON public.patient_secure_messages
  FOR SELECT TO authenticated
  USING (patient_id IN (
    SELECT p.id FROM public.patients p
    WHERE p.auth_uid = (SELECT auth.uid())::text
  ));

DROP POLICY IF EXISTS patient_secure_messages_insert_own_patient ON public.patient_secure_messages;
CREATE POLICY patient_secure_messages_insert_own_patient ON public.patient_secure_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    from_patient = true
    AND patient_id IN (
      SELECT p.id FROM public.patients p
      WHERE p.auth_uid = (SELECT auth.uid())::text
    )
  );
