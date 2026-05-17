-- ============================================================================
-- Phase A follow-up: tighten 13 legacy SELECT-true policies
-- ============================================================================
-- The previous migration handled the 59 advisor-flagged USING(true) policies.
-- A subsequent inventory found 13 additional pre-existing `qual = 'true'`
-- SELECT-only policies that the advisor did not flag but still leak PII:
--
--   CRITICAL (anon-exposed):
--     patient_portal_sessions / "Public can read sessions"
--       — leaks session_token, ip_address, device_fingerprint to anon
--     patient_portal_users / "Public can read for auth"
--       — leaks phone/email/dob/name to anon
--     app_users / "select_app_users_any" (role public)
--       — leaks staff identity + role to unauthenticated
--
--   STAFF SCOPING (authenticated SELECT true):
--     appointments, care_tasks, conflict_resolutions, daily_counts, lab_orders,
--     lab_results, patient_consent_records, patient_merges, triage_records,
--     waitlist
--       — any authenticated session (including patient-portal JWT) can read
--         these. Should be is_staff()-only.
--
-- Rollback: re-create these policies with USING (true) on the same roles.
-- ============================================================================

-- ---- CRITICAL ANON-EXPOSED ----

DROP POLICY IF EXISTS "Public can read sessions"  ON public.patient_portal_sessions;
DROP POLICY IF EXISTS "Public can read for auth"  ON public.patient_portal_users;
DROP POLICY IF EXISTS "select_app_users_any"      ON public.app_users;

-- patient_portal_sessions: only owner (authenticated portal JWT) and service_role.
-- Edge functions must run the login lookup with service_role.
-- (patient_portal_sessions_owner + patient_portal_sessions_service already exist
--  from the previous migration, so no new policies needed.)

-- patient_portal_users: same story. Anon login lookups MUST go through an edge
-- function (service_role). The owner-self and staff-read policies from the
-- previous migration cover authenticated access.

-- app_users: the previous migration's app_users_select_staff (is_staff()) +
-- app_users_admin_write cover what's needed.

-- ---- STAFF SCOPING ON SELECT-TRUE TABLES ----

-- appointments
DROP POLICY IF EXISTS "Authenticated users can view appointments" ON public.appointments;
CREATE POLICY "appointments_staff_select"
  ON public.appointments FOR SELECT TO authenticated
  USING (public.is_staff());

-- care_tasks
DROP POLICY IF EXISTS "Staff can view care tasks" ON public.care_tasks;
CREATE POLICY "care_tasks_staff_select"
  ON public.care_tasks FOR SELECT TO authenticated
  USING (public.is_staff());

-- conflict_resolutions (a SELECT-true policy in addition to the staff write
-- policy from the previous migration; tighten the SELECT too)
DROP POLICY IF EXISTS "Staff can view conflict resolutions" ON public.conflict_resolutions;
-- conflict_resolutions_staff already gives staff full access; no separate SELECT needed.

-- daily_counts (SELECT-true) — staff-only read.
DROP POLICY IF EXISTS "Authenticated users can view daily counts" ON public.daily_counts;
-- daily_counts_select_staff was already created — covered.

-- lab_orders
DROP POLICY IF EXISTS "Authenticated users can view lab orders" ON public.lab_orders;
CREATE POLICY "lab_orders_staff_select"
  ON public.lab_orders FOR SELECT TO authenticated
  USING (public.is_staff());

-- lab_results
DROP POLICY IF EXISTS "Authenticated users can view lab results" ON public.lab_results;
CREATE POLICY "lab_results_staff_select"
  ON public.lab_results FOR SELECT TO authenticated
  USING (public.is_staff());

-- patient_consent_records
DROP POLICY IF EXISTS "Staff can view consent records" ON public.patient_consent_records;
CREATE POLICY "patient_consent_records_staff_select"
  ON public.patient_consent_records FOR SELECT TO authenticated
  USING (public.is_staff());

-- patient_merges
DROP POLICY IF EXISTS "Staff can view patient merges" ON public.patient_merges;
CREATE POLICY "patient_merges_staff_select"
  ON public.patient_merges FOR SELECT TO authenticated
  USING (public.has_role('admin', 'auditor', 'lead_clinician'));

-- triage_records
DROP POLICY IF EXISTS "Authenticated users can view triage records" ON public.triage_records;
CREATE POLICY "triage_records_staff_select"
  ON public.triage_records FOR SELECT TO authenticated
  USING (public.is_staff());

-- waitlist
DROP POLICY IF EXISTS "Authenticated users can view waitlist" ON public.waitlist;
CREATE POLICY "waitlist_staff_select"
  ON public.waitlist FOR SELECT TO authenticated
  USING (public.is_staff());

-- End of migration.
