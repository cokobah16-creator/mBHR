-- ============================================================================
-- Phase D WS10 (part 2): wrap auth.<fn>() in (SELECT auth.<fn>()) on every
-- offending RLS policy.
-- ============================================================================
-- Closes the `auth_rls_initplan` advisor entries. Per the Supabase docs:
--   USING (col = auth.uid())            -- bad: re-evaluates per row (initplan)
--   USING (col = (SELECT auth.uid()))   -- good: evaluates once per query
--
-- Each DROP + CREATE pair below mirrors the existing policy's behaviour
-- exactly — the only change is wrapping every bare auth.uid()/auth.jwt()/
-- auth.role() in (SELECT ...). Role assignments, command (ALL/SELECT/...),
-- and target tables are unchanged.
--
-- Rollback: revert this migration; the prior definitions still live in their
-- creating migrations (this is a behaviour-preserving rewrite).
-- ============================================================================

-- --- app_users -----------------------------------------------------------
DROP POLICY IF EXISTS "service_role_manage_permanent_admins" ON public.app_users;
CREATE POLICY "service_role_manage_permanent_admins" ON public.app_users
  FOR ALL TO public
  USING (CASE WHEN admin_permanent THEN ((SELECT auth.role()) = 'service_role'::text) ELSE true END)
  WITH CHECK (CASE WHEN admin_permanent THEN ((SELECT auth.role()) = 'service_role'::text) ELSE true END);

-- --- appointments --------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can manage appointments" ON public.appointments;
CREATE POLICY "Authenticated users can manage appointments" ON public.appointments
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Staff can create appointments" ON public.appointments;
CREATE POLICY "Staff can create appointments" ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['guest'::user_role, 'nurse'::user_role, 'doctor'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Staff can update appointments" ON public.appointments;
CREATE POLICY "Staff can update appointments" ON public.appointments
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['guest'::user_role, 'nurse'::user_role, 'doctor'::user_role, 'admin'::user_role])));

-- --- care_tasks ----------------------------------------------------------
DROP POLICY IF EXISTS "Clinical staff can manage care tasks" ON public.care_tasks;
CREATE POLICY "Clinical staff can manage care tasks" ON public.care_tasks
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = ANY (ARRAY['admin'::user_role, 'doctor'::user_role, 'nurse'::user_role])));

DROP POLICY IF EXISTS "Staff can create care tasks" ON public.care_tasks;
CREATE POLICY "Staff can create care tasks" ON public.care_tasks
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['volunteer'::user_role, 'nurse'::user_role, 'doctor'::user_role, 'pharmacist'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Staff can update care tasks" ON public.care_tasks;
CREATE POLICY "Staff can update care tasks" ON public.care_tasks
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['volunteer'::user_role, 'nurse'::user_role, 'doctor'::user_role, 'pharmacist'::user_role, 'admin'::user_role])));

-- --- conflict_resolutions ------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage conflict resolutions" ON public.conflict_resolutions;
CREATE POLICY "Admins can manage conflict resolutions" ON public.conflict_resolutions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = 'admin'::user_role));

-- --- consultation_reviews ------------------------------------------------
DROP POLICY IF EXISTS "Staff can view consultation reviews" ON public.consultation_reviews;
CREATE POLICY "Staff can view consultation reviews" ON public.consultation_reviews
  FOR SELECT TO authenticated
  USING (
       org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid()))
    OR reviewed_doctor_id = (SELECT auth.uid())
    OR reviewing_doctor_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "Supervising doctors can manage reviews" ON public.consultation_reviews;
CREATE POLICY "Supervising doctors can manage reviews" ON public.consultation_reviews
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

-- --- daily_counts --------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can read daily counts" ON public.daily_counts;
CREATE POLICY "Authenticated users can read daily counts" ON public.daily_counts
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

-- --- doctor_analytics ----------------------------------------------------
DROP POLICY IF EXISTS "Staff can view doctor analytics" ON public.doctor_analytics;
CREATE POLICY "Staff can view doctor analytics" ON public.doctor_analytics
  FOR SELECT TO authenticated
  USING (
       org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid()))
    OR doctor_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "System can manage doctor analytics" ON public.doctor_analytics;
CREATE POLICY "System can manage doctor analytics" ON public.doctor_analytics
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

-- --- event_staff_assignments ---------------------------------------------
DROP POLICY IF EXISTS "Staff can manage event assignments in their organizations" ON public.event_staff_assignments;
CREATE POLICY "Staff can manage event assignments in their organizations" ON public.event_staff_assignments
  FOR ALL TO authenticated
  USING (event_id IN (SELECT id FROM public.outreach_events WHERE org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid()))))
  WITH CHECK (event_id IN (SELECT id FROM public.outreach_events WHERE org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid()))));

DROP POLICY IF EXISTS "Users can view their event assignments" ON public.event_staff_assignments;
CREATE POLICY "Users can view their event assignments" ON public.event_staff_assignments
  FOR SELECT TO authenticated
  USING (
       user_id = (SELECT auth.uid())
    OR event_id IN (SELECT id FROM public.outreach_events WHERE org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())))
  );

-- --- follow_up_schedules -------------------------------------------------
DROP POLICY IF EXISTS "Clinical staff can manage follow-ups" ON public.follow_up_schedules;
CREATE POLICY "Clinical staff can manage follow-ups" ON public.follow_up_schedules
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Staff can view follow-ups in their organizations" ON public.follow_up_schedules;
CREATE POLICY "Staff can view follow-ups in their organizations" ON public.follow_up_schedules
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

-- --- game_sessions -------------------------------------------------------
DROP POLICY IF EXISTS "Admins can approve sessions" ON public.game_sessions;
CREATE POLICY "Admins can approve sessions" ON public.game_sessions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND (admin_access = true OR role = 'admin'::user_role)));

DROP POLICY IF EXISTS "Users can create own game sessions" ON public.game_sessions;
CREATE POLICY "Users can create own game sessions" ON public.game_sessions
  FOR INSERT TO authenticated
  WITH CHECK (volunteer_id = ((SELECT auth.uid()))::text);

DROP POLICY IF EXISTS "Users can read own sessions" ON public.game_sessions;
CREATE POLICY "Users can read own sessions" ON public.game_sessions
  FOR SELECT TO authenticated
  USING (
       ((SELECT auth.uid()))::text = volunteer_id
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND (admin_access = true OR role = ANY (ARRAY['admin'::user_role, 'doctor'::user_role, 'nurse'::user_role])))
  );

DROP POLICY IF EXISTS "Users can update own game sessions" ON public.game_sessions;
CREATE POLICY "Users can update own game sessions" ON public.game_sessions
  FOR UPDATE TO authenticated
  USING (volunteer_id = ((SELECT auth.uid()))::text);

DROP POLICY IF EXISTS "Users can view own game sessions" ON public.game_sessions;
CREATE POLICY "Users can view own game sessions" ON public.game_sessions
  FOR SELECT TO authenticated
  USING (
       volunteer_id = ((SELECT auth.uid()))::text
    OR (SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = 'admin'::user_role)
  );

DROP POLICY IF EXISTS "Volunteers can create own sessions" ON public.game_sessions;
CREATE POLICY "Volunteers can create own sessions" ON public.game_sessions
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.uid()))::text = volunteer_id);

-- --- gamification_wallets ------------------------------------------------
DROP POLICY IF EXISTS "Admins can read all wallets" ON public.gamification_wallets;
CREATE POLICY "Admins can read all wallets" ON public.gamification_wallets
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND (admin_access = true OR role = 'admin'::user_role)));

DROP POLICY IF EXISTS "Users can read own wallet" ON public.gamification_wallets;
CREATE POLICY "Users can read own wallet" ON public.gamification_wallets
  FOR SELECT TO authenticated
  USING (((SELECT auth.uid()))::text = volunteer_id);

DROP POLICY IF EXISTS "Users can update own wallet" ON public.gamification_wallets;
CREATE POLICY "Users can update own wallet" ON public.gamification_wallets
  FOR ALL TO authenticated
  USING (((SELECT auth.uid()))::text = volunteer_id);

DROP POLICY IF EXISTS "Users can view own wallet" ON public.gamification_wallets;
CREATE POLICY "Users can view own wallet" ON public.gamification_wallets
  FOR SELECT TO authenticated
  USING (
       volunteer_id = ((SELECT auth.uid()))::text
    OR (SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = 'admin'::user_role)
  );

-- --- inventory_discrepancies ---------------------------------------------
DROP POLICY IF EXISTS "Staff can create inventory discrepancies" ON public.inventory_discrepancies;
CREATE POLICY "Staff can create inventory discrepancies" ON public.inventory_discrepancies
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['pharmacist'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Staff can update inventory discrepancies" ON public.inventory_discrepancies;
CREATE POLICY "Staff can update inventory discrepancies" ON public.inventory_discrepancies
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['pharmacist'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Staff can view inventory discrepancies" ON public.inventory_discrepancies;
CREATE POLICY "Staff can view inventory discrepancies" ON public.inventory_discrepancies
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['pharmacist'::user_role, 'admin'::user_role])));

-- --- lab_orders ----------------------------------------------------------
DROP POLICY IF EXISTS "Clinical staff can manage lab orders" ON public.lab_orders;
CREATE POLICY "Clinical staff can manage lab orders" ON public.lab_orders
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = ANY (ARRAY['admin'::user_role, 'doctor'::user_role, 'nurse'::user_role])));

DROP POLICY IF EXISTS "Doctors and nurses can create lab orders" ON public.lab_orders;
CREATE POLICY "Doctors and nurses can create lab orders" ON public.lab_orders
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['doctor'::user_role, 'nurse'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Doctors and nurses can update lab orders" ON public.lab_orders;
CREATE POLICY "Doctors and nurses can update lab orders" ON public.lab_orders
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['doctor'::user_role, 'nurse'::user_role, 'admin'::user_role])));

-- --- lab_results ---------------------------------------------------------
DROP POLICY IF EXISTS "Authorized staff can create lab results" ON public.lab_results;
CREATE POLICY "Authorized staff can create lab results" ON public.lab_results
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['doctor'::user_role, 'nurse'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Authorized staff can update lab results" ON public.lab_results;
CREATE POLICY "Authorized staff can update lab results" ON public.lab_results
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['doctor'::user_role, 'nurse'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Clinical staff can manage lab results" ON public.lab_results;
CREATE POLICY "Clinical staff can manage lab results" ON public.lab_results
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = ANY (ARRAY['admin'::user_role, 'doctor'::user_role, 'nurse'::user_role])));

-- --- medication_reminders ------------------------------------------------
DROP POLICY IF EXISTS "Clinical staff can manage medication reminders" ON public.medication_reminders;
CREATE POLICY "Clinical staff can manage medication reminders" ON public.medication_reminders
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = ANY (ARRAY['admin'::user_role, 'doctor'::user_role, 'nurse'::user_role, 'pharmacist'::user_role])));

DROP POLICY IF EXISTS "Pharmacists and admins can create reminders" ON public.medication_reminders;
CREATE POLICY "Pharmacists and admins can create reminders" ON public.medication_reminders
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['pharmacist'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Pharmacists and admins can update reminders" ON public.medication_reminders;
CREATE POLICY "Pharmacists and admins can update reminders" ON public.medication_reminders
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['pharmacist'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Pharmacists and admins can view reminders" ON public.medication_reminders;
CREATE POLICY "Pharmacists and admins can view reminders" ON public.medication_reminders
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['pharmacist'::user_role, 'admin'::user_role])));

-- --- message_templates ---------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage message templates" ON public.message_templates;
CREATE POLICY "Admins can manage message templates" ON public.message_templates
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = 'admin'::user_role))
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = 'admin'::user_role));

DROP POLICY IF EXISTS "Authenticated users can read message templates" ON public.message_templates;
CREATE POLICY "Authenticated users can read message templates" ON public.message_templates
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

-- --- organizations -------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage their organizations" ON public.organizations;
CREATE POLICY "Admins can manage their organizations" ON public.organizations
  FOR ALL TO authenticated
  USING (id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can view their organizations" ON public.organizations;
CREATE POLICY "Users can view their organizations" ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

-- --- otp_rate_limit_tracking ---------------------------------------------
DROP POLICY IF EXISTS "Admins can view OTP rate limit tracking" ON public.otp_rate_limit_tracking;
CREATE POLICY "Admins can view OTP rate limit tracking" ON public.otp_rate_limit_tracking
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = 'admin'::user_role));

-- --- outbound_messages ---------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can manage outbound messages" ON public.outbound_messages;
CREATE POLICY "Authenticated users can manage outbound messages" ON public.outbound_messages
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

-- --- outreach_events -----------------------------------------------------
DROP POLICY IF EXISTS "Staff can manage events in their organizations" ON public.outreach_events;
CREATE POLICY "Staff can manage events in their organizations" ON public.outreach_events
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can view events in their organizations" ON public.outreach_events;
CREATE POLICY "Users can view events in their organizations" ON public.outreach_events
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

-- --- patient_allergies ---------------------------------------------------
DROP POLICY IF EXISTS "Clinical staff can manage allergies" ON public.patient_allergies;
CREATE POLICY "Clinical staff can manage allergies" ON public.patient_allergies
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = ANY (ARRAY['admin'::user_role, 'doctor'::user_role, 'nurse'::user_role])));

DROP POLICY IF EXISTS "Clinical staff can update allergies" ON public.patient_allergies;
CREATE POLICY "Clinical staff can update allergies" ON public.patient_allergies
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = ANY (ARRAY['admin'::user_role, 'doctor'::user_role, 'nurse'::user_role])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = ANY (ARRAY['admin'::user_role, 'doctor'::user_role, 'nurse'::user_role])));

DROP POLICY IF EXISTS "Clinical staff can view allergies" ON public.patient_allergies;
CREATE POLICY "Clinical staff can view allergies" ON public.patient_allergies
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = ANY (ARRAY['admin'::user_role, 'doctor'::user_role, 'nurse'::user_role, 'pharmacist'::user_role])));

-- --- patient_flags -------------------------------------------------------
DROP POLICY IF EXISTS "Staff can create flags in their organizations" ON public.patient_flags;
CREATE POLICY "Staff can create flags in their organizations" ON public.patient_flags
  FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Staff can update flags in their organizations" ON public.patient_flags;
CREATE POLICY "Staff can update flags in their organizations" ON public.patient_flags
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Staff can view flags in their organizations" ON public.patient_flags;
CREATE POLICY "Staff can view flags in their organizations" ON public.patient_flags
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

-- --- patient_merges ------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view patient merges" ON public.patient_merges;
CREATE POLICY "Admins can view patient merges" ON public.patient_merges
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = 'admin'::user_role));

DROP POLICY IF EXISTS "Authorized staff can create patient merges" ON public.patient_merges;
CREATE POLICY "Authorized staff can create patient merges" ON public.patient_merges
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['nurse'::user_role, 'doctor'::user_role, 'admin'::user_role])));

-- --- patient_preferences -------------------------------------------------
DROP POLICY IF EXISTS "Staff can manage patient preferences" ON public.patient_preferences;
CREATE POLICY "Staff can manage patient preferences" ON public.patient_preferences
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid())));

-- --- prescription_templates ----------------------------------------------
DROP POLICY IF EXISTS "Doctors can manage prescription templates" ON public.prescription_templates;
CREATE POLICY "Doctors can manage prescription templates" ON public.prescription_templates
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Staff can view prescription templates" ON public.prescription_templates;
CREATE POLICY "Staff can view prescription templates" ON public.prescription_templates
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

-- --- protocol_library ----------------------------------------------------
DROP POLICY IF EXISTS "Doctors can manage protocols" ON public.protocol_library;
CREATE POLICY "Doctors can manage protocols" ON public.protocol_library
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Staff can view protocols" ON public.protocol_library;
CREATE POLICY "Staff can view protocols" ON public.protocol_library
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

-- --- quiz_questions ------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage quiz questions" ON public.quiz_questions;
CREATE POLICY "Admins can manage quiz questions" ON public.quiz_questions
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = 'admin'::user_role))
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = 'admin'::user_role));

-- --- referrals -----------------------------------------------------------
DROP POLICY IF EXISTS "Doctors can manage referrals in their organizations" ON public.referrals;
CREATE POLICY "Doctors can manage referrals in their organizations" ON public.referrals
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Staff can view referrals in their organizations" ON public.referrals;
CREATE POLICY "Staff can view referrals in their organizations" ON public.referrals
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

-- --- site_formulary ------------------------------------------------------
DROP POLICY IF EXISTS "Pharmacists can manage site formulary" ON public.site_formulary;
CREATE POLICY "Pharmacists can manage site formulary" ON public.site_formulary
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Staff can view site formulary" ON public.site_formulary;
CREATE POLICY "Staff can view site formulary" ON public.site_formulary
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

-- --- sites ---------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage sites in their organizations" ON public.sites;
CREATE POLICY "Admins can manage sites in their organizations" ON public.sites
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can view sites in their organizations" ON public.sites;
CREATE POLICY "Users can view sites in their organizations" ON public.sites
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.user_org_sites WHERE user_id = (SELECT auth.uid())));

-- --- stock_batches -------------------------------------------------------
DROP POLICY IF EXISTS "Pharmacists can manage stock batches" ON public.stock_batches;
CREATE POLICY "Pharmacists can manage stock batches" ON public.stock_batches
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = ANY (ARRAY['admin'::user_role, 'pharmacist'::user_role])));

DROP POLICY IF EXISTS "Staff can create stock batches" ON public.stock_batches;
CREATE POLICY "Staff can create stock batches" ON public.stock_batches
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['pharmacist'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Staff can update stock batches" ON public.stock_batches;
CREATE POLICY "Staff can update stock batches" ON public.stock_batches
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['pharmacist'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Staff can view stock batches" ON public.stock_batches;
CREATE POLICY "Staff can view stock batches" ON public.stock_batches
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['pharmacist'::user_role, 'admin'::user_role])));

-- --- triage_records ------------------------------------------------------
DROP POLICY IF EXISTS "Clinical staff can manage triage records" ON public.triage_records;
CREATE POLICY "Clinical staff can manage triage records" ON public.triage_records
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = ANY (ARRAY['admin'::user_role, 'doctor'::user_role, 'nurse'::user_role])));

DROP POLICY IF EXISTS "Staff can create triage records" ON public.triage_records;
CREATE POLICY "Staff can create triage records" ON public.triage_records
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['volunteer'::user_role, 'nurse'::user_role, 'doctor'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Staff can update triage records" ON public.triage_records;
CREATE POLICY "Staff can update triage records" ON public.triage_records
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['volunteer'::user_role, 'nurse'::user_role, 'doctor'::user_role, 'admin'::user_role])));

-- --- triage_samples ------------------------------------------------------
DROP POLICY IF EXISTS "Doctors can create triage samples" ON public.triage_samples;
CREATE POLICY "Doctors can create triage samples" ON public.triage_samples
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = ANY (ARRAY['doctor'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Staff can create triage samples" ON public.triage_samples;
CREATE POLICY "Staff can create triage samples" ON public.triage_samples
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['nurse'::user_role, 'doctor'::user_role, 'admin'::user_role])));

-- --- user_org_sites ------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage user org assignments" ON public.user_org_sites;
CREATE POLICY "Admins can manage user org assignments" ON public.user_org_sites
  FOR ALL TO authenticated
  USING (org_id IN (SELECT user_org_sites_1.org_id FROM public.user_org_sites user_org_sites_1 WHERE user_org_sites_1.user_id = (SELECT auth.uid())))
  WITH CHECK (org_id IN (SELECT user_org_sites_1.org_id FROM public.user_org_sites user_org_sites_1 WHERE user_org_sites_1.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can view their own org assignments" ON public.user_org_sites;
CREATE POLICY "Users can view their own org assignments" ON public.user_org_sites
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- --- users ---------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage users" ON public.users;
CREATE POLICY "Admins can manage users" ON public.users
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users WHERE id = (SELECT auth.uid()) AND role = 'admin'::user_role));

-- --- vitals_ranges -------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage vitals ranges" ON public.vitals_ranges;
CREATE POLICY "Admins can manage vitals ranges" ON public.vitals_ranges
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = 'admin'::user_role))
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = 'admin'::user_role));

-- --- waitlist ------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can manage waitlist" ON public.waitlist;
CREATE POLICY "Authenticated users can manage waitlist" ON public.waitlist
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Staff can create waitlist entries" ON public.waitlist;
CREATE POLICY "Staff can create waitlist entries" ON public.waitlist
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['guest'::user_role, 'nurse'::user_role, 'doctor'::user_role, 'admin'::user_role])));

DROP POLICY IF EXISTS "Staff can update waitlist entries" ON public.waitlist;
CREATE POLICY "Staff can update waitlist entries" ON public.waitlist
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['guest'::user_role, 'nurse'::user_role, 'doctor'::user_role, 'admin'::user_role])));

-- End.
