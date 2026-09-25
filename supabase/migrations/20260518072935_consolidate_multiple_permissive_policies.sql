-- ============================================================================
-- Phase D WS10 (part 3): consolidate multiple_permissive_policies
-- ============================================================================
-- Postgres OR's permissive policies on the same (table, role, command). Each
-- one is evaluated per row, so reducing the count is a direct query-perf win.
--
-- This migration drops only policies where the consolidation is BEHAVIOUR-
-- PRESERVING:
--   1. Pure duplicates (identical predicate, same table+role+action).
--   2. A FOR ALL policy whose role set equals or is a superset of a sibling
--      per-command policy — the FOR ALL covers it.
--   3. Broad "Authenticated users can manage/read X" policies (USING auth.uid()
--      IS NOT NULL) that are superseded by my Phase A scoped staff policies.
--      Dropping these makes RLS *more* restrictive on tables that should not
--      have been readable by every authenticated user (incl. patient-portal
--      users) — which is the intended security posture.
--
-- Explicitly NOT touched here:
--   * The "Patients can …" legacy policies on patient_appointment_requests,
--     patient_documents, patient_messages, patient_notifications,
--     patient_consent_records. They use a phone-claim JWT path that my
--     portal_user_id-based *_owner policies do not cover — they're load-
--     bearing for actual patient sessions. Leave both in place.
--
-- Rollback: re-CREATE each dropped policy from the migration that introduced
-- it. The verbatim text is preserved in pg_policies via this migration's
-- predecessor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Pure-duplicate read policies on reference data
-- ----------------------------------------------------------------------------
-- Two policies with identical USING (true) FOR SELECT TO authenticated — keep
-- one, drop the other.

DROP POLICY IF EXISTS "Authenticated users can view quiz questions"  ON public.quiz_questions;
DROP POLICY IF EXISTS "Authenticated users can view vitals ranges"   ON public.vitals_ranges;
DROP POLICY IF EXISTS "Authenticated users can view triage samples"  ON public.triage_samples;
DROP POLICY IF EXISTS "Authenticated users can view message templates" ON public.message_templates;

-- ----------------------------------------------------------------------------
-- 2. FOR ALL subsumes per-command (same/broader role set)
-- ----------------------------------------------------------------------------

-- lab_orders: "Clinical staff can manage" (FOR ALL, admin+doctor+nurse) ==
-- per-command policies for the same role set.
DROP POLICY IF EXISTS "Doctors and nurses can create lab orders" ON public.lab_orders;
DROP POLICY IF EXISTS "Doctors and nurses can update lab orders" ON public.lab_orders;

-- lab_results: same pattern.
DROP POLICY IF EXISTS "Authorized staff can create lab results"  ON public.lab_results;
DROP POLICY IF EXISTS "Authorized staff can update lab results"  ON public.lab_results;

-- medication_reminders: "Clinical staff can manage" (admin/doctor/nurse/pharmacist)
-- ⊇ per-command policies (pharmacist/admin only).
DROP POLICY IF EXISTS "Pharmacists and admins can create reminders" ON public.medication_reminders;
DROP POLICY IF EXISTS "Pharmacists and admins can update reminders" ON public.medication_reminders;
DROP POLICY IF EXISTS "Pharmacists and admins can view reminders"   ON public.medication_reminders;

-- stock_batches: "Pharmacists can manage" (admin/pharmacist) FOR ALL ==
-- per-command policies (pharmacist/admin).
DROP POLICY IF EXISTS "Staff can create stock batches" ON public.stock_batches;
DROP POLICY IF EXISTS "Staff can update stock batches" ON public.stock_batches;
DROP POLICY IF EXISTS "Staff can view stock batches"   ON public.stock_batches;

-- inventory_discrepancies: Phase A's `staff_all_inventory_discrepancies`
-- (is_staff() — any non-guest) ⊇ per-command (pharmacist/admin only).
DROP POLICY IF EXISTS "Staff can create inventory discrepancies" ON public.inventory_discrepancies;
DROP POLICY IF EXISTS "Staff can update inventory discrepancies" ON public.inventory_discrepancies;
DROP POLICY IF EXISTS "Staff can view inventory discrepancies"   ON public.inventory_discrepancies;

-- ----------------------------------------------------------------------------
-- 3. Drop "Authenticated users can manage/read X" — broad auth.uid() IS NOT
--    NULL policies that conflict with Phase A's scoped staff policies.
-- ----------------------------------------------------------------------------
-- These policies effectively granted full access to every authenticated
-- session (including patient-portal sessions). With Phase A's scoped staff
-- policies in place, these are both redundant AND insecure — dropping them
-- correctly restricts access to actual staff.

DROP POLICY IF EXISTS "Authenticated users can manage appointments"      ON public.appointments;
DROP POLICY IF EXISTS "Authenticated users can manage waitlist"          ON public.waitlist;
DROP POLICY IF EXISTS "Authenticated users can read daily counts"        ON public.daily_counts;
-- outbound_messages: keep — patient-portal flows may write outbound via this
-- path. Re-evaluate in a follow-up.

-- ----------------------------------------------------------------------------
-- 4. Care/triage records: keep both (different role sets — volunteer is in
--    "Staff can create/update X" but NOT in "Clinical staff can manage X").
--    Consolidation here would require enumerating roles in a CASE; skip for
--    safety.
-- ----------------------------------------------------------------------------
-- No-op for care_tasks, triage_records here. Documented as a Phase D
-- follow-up if performance is an issue.

-- End.
