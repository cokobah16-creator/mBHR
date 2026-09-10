/*
  # Wrap JWT claim reads in the televisit RLS policies

  The policies created by 20260910161049_add_televisits read the portal phone
  claim with current_setting('request.jwt.claims', true) directly, which
  Postgres re-evaluates for every row (advisor: auth_rls_initplan). Recreate
  the four policies with the read wrapped in a scalar subquery, matching the
  (SELECT auth.uid()) convention from 20260520000006, so it is evaluated once
  per statement. Semantics are unchanged.

  Applied to production via the Supabase connector as version 20260910164515.

  ## Rollback
    Re-run section 3 and section 4 of 20260910161049_add_televisits.sql.
*/

DROP POLICY IF EXISTS "appointments_select_staff_or_owner" ON public.appointments;
CREATE POLICY "appointments_select_staff_or_owner"
  ON public.appointments FOR SELECT TO authenticated
  USING (
    public.is_staff()
    OR patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE id = (SELECT public.current_portal_user_id())
    )
    OR patient_id IN (
      SELECT id FROM public.patients
       WHERE auth_uid = (SELECT auth.uid())::text
    )
    OR patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE phone_number = (SELECT current_setting('request.jwt.claims', true)::json->>'phone')
    )
  );

DROP POLICY IF EXISTS "patient_appointment_requests_owner_auth_select"
  ON public.patient_appointment_requests;
CREATE POLICY "patient_appointment_requests_owner_auth_select"
  ON public.patient_appointment_requests FOR SELECT TO authenticated
  USING (
    patient_id IN (
      SELECT id FROM public.patients
       WHERE auth_uid = (SELECT auth.uid())::text
    )
    OR patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE phone_number = (SELECT current_setting('request.jwt.claims', true)::json->>'phone')
    )
  );

DROP POLICY IF EXISTS "patient_appointment_requests_owner_auth_insert"
  ON public.patient_appointment_requests;
CREATE POLICY "patient_appointment_requests_owner_auth_insert"
  ON public.patient_appointment_requests FOR INSERT TO authenticated
  WITH CHECK (
    patient_id IN (
      SELECT id FROM public.patients
       WHERE auth_uid = (SELECT auth.uid())::text
    )
    OR patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE phone_number = (SELECT current_setting('request.jwt.claims', true)::json->>'phone')
    )
  );

DROP POLICY IF EXISTS "patient_appointment_requests_owner_cancel"
  ON public.patient_appointment_requests;
CREATE POLICY "patient_appointment_requests_owner_cancel"
  ON public.patient_appointment_requests FOR UPDATE TO authenticated
  USING (
    status = 'pending'
    AND (
      patient_id IN (
        SELECT id FROM public.patients
         WHERE auth_uid = (SELECT auth.uid())::text
      )
      OR patient_id IN (
        SELECT patient_id FROM public.patient_portal_users
         WHERE phone_number = (SELECT current_setting('request.jwt.claims', true)::json->>'phone')
      )
    )
  )
  WITH CHECK (
    status = 'cancelled'
    AND (
      patient_id IN (
        SELECT id FROM public.patients
         WHERE auth_uid = (SELECT auth.uid())::text
      )
      OR patient_id IN (
        SELECT patient_id FROM public.patient_portal_users
         WHERE phone_number = (SELECT current_setting('request.jwt.claims', true)::json->>'phone')
      )
    )
  );
