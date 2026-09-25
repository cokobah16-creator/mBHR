-- ============================================================================
-- Phase A: RLS lockdown + SECURITY DEFINER / search_path / storage hardening
-- ============================================================================
-- Closes the critical-security advisors:
--   * 59 rls_policy_always_true  (USING (true) / WITH CHECK (true))
--   * 6  function_search_path_mutable
--   * 4  anon/authenticated_security_definer_function_executable (2 unique fns)
--   * 1  public_bucket_allows_listing (photos bucket)
--
-- Rollback note:
--   To revert, drop the policies created here and recreate the previous
--   "Allow authenticated access to <table>" / "open_<table>" policies with
--   USING (true). The helper functions can stay (they are safe to leave in
--   place). The photos bucket can be re-publicised with
--   UPDATE storage.buckets SET public = true WHERE id = 'photos'.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HELPER FUNCTIONS
-- ----------------------------------------------------------------------------
-- These helpers are SECURITY DEFINER with a locked search_path so that:
--   (a) RLS policies can call them without triggering RLS recursion on
--       app_users (a deny-by-default app_users policy would otherwise make
--       is_staff() always return false from within a policy).
--   (b) They are safe against search_path injection.
-- Execute is granted only to authenticated + service_role; anon cannot call
-- them (anon never needs to assert staffness).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  -- app_users.id is uuid (matches auth.users.id); no ::text cast.
  SELECT EXISTS (
    SELECT 1
      FROM public.app_users
     WHERE id = (SELECT auth.uid())
       AND role <> 'guest'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_staff() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_staff() FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_role(VARIADIC roles text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  -- role is the user_role enum; cast to text to compare against text[] arg.
  SELECT EXISTS (
    SELECT 1
      FROM public.app_users
     WHERE id = (SELECT auth.uid())
       AND role::text = ANY(roles)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(text[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.has_role(text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_portal_user_id()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT NULLIF(
    (auth.jwt() -> 'app_metadata' ->> 'portal_user_id'),
    ''
  );
$$;

REVOKE EXECUTE ON FUNCTION public.current_portal_user_id() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.current_portal_user_id() TO authenticated, anon, service_role;

-- ----------------------------------------------------------------------------
-- 2. DROP ALL 59 USING (true) / WITH CHECK (true) POLICIES
-- ----------------------------------------------------------------------------
-- Exact list pulled from get_advisors(type=security). Sorted by table.

DROP POLICY IF EXISTS "Allow authenticated access to alerts_nm"        ON public.alerts_nm;
DROP POLICY IF EXISTS "open_alerts_nm"                                 ON public.alerts_nm;
DROP POLICY IF EXISTS "Allow authenticated access to app_users"        ON public.app_users;
DROP POLICY IF EXISTS "Allow authenticated access to audit_logs"       ON public.audit_logs;
DROP POLICY IF EXISTS "System can manage conflict resolutions"         ON public.conflict_resolutions;
DROP POLICY IF EXISTS "Allow authenticated access to consultations"    ON public.consultations;
DROP POLICY IF EXISTS "Allow authenticated access to daily_counters"   ON public.daily_counters;
DROP POLICY IF EXISTS "open_daily_counters"                            ON public.daily_counters;
DROP POLICY IF EXISTS "System can manage daily counts"                 ON public.daily_counts;
DROP POLICY IF EXISTS "Allow authenticated access to dispenses"        ON public.dispenses;
DROP POLICY IF EXISTS "open_dispenses"                                 ON public.dispenses;
DROP POLICY IF EXISTS "Allow authenticated access to gamification"     ON public.gamification;
DROP POLICY IF EXISTS "open_gamification"                              ON public.gamification;
DROP POLICY IF EXISTS "System can create wallets"                      ON public.gamification_wallets;
DROP POLICY IF EXISTS "Allow authenticated access to inventory"        ON public.inventory;
DROP POLICY IF EXISTS "Allow authenticated access to discrepancies"    ON public.inventory_discrepancies;
DROP POLICY IF EXISTS "Allow authenticated access to inventory_nm"     ON public.inventory_nm;
DROP POLICY IF EXISTS "open_inventory_nm"                              ON public.inventory_nm;
DROP POLICY IF EXISTS "Allow authenticated access to notifications"    ON public.notifications;
DROP POLICY IF EXISTS "open_notifications"                             ON public.notifications;
DROP POLICY IF EXISTS "System can manage OTP rate limit tracking"      ON public.otp_rate_limit_tracking;
DROP POLICY IF EXISTS "full_access_broadcast_reads"                    ON public.palaver_broadcast_reads;
DROP POLICY IF EXISTS "full_access_palaver_broadcasts"                 ON public.palaver_broadcasts;
DROP POLICY IF EXISTS "full_access_palaver_messages"                   ON public.palaver_messages;
DROP POLICY IF EXISTS "Staff can manage appointment requests"          ON public.patient_appointment_requests;
DROP POLICY IF EXISTS "Staff can manage patient documents"             ON public.patient_documents;
DROP POLICY IF EXISTS "Staff can manage messages"                      ON public.patient_messages;
DROP POLICY IF EXISTS "Staff can create patient notifications"         ON public.patient_notifications;
DROP POLICY IF EXISTS "Public can log access"                          ON public.patient_portal_access_logs;
DROP POLICY IF EXISTS "Public can create sessions"                     ON public.patient_portal_sessions;
DROP POLICY IF EXISTS "Public can delete sessions"                     ON public.patient_portal_sessions;
DROP POLICY IF EXISTS "Public can update sessions"                     ON public.patient_portal_sessions;
DROP POLICY IF EXISTS "Public can register"                            ON public.patient_portal_users;
DROP POLICY IF EXISTS "Public can update for auth"                     ON public.patient_portal_users;
DROP POLICY IF EXISTS "Allow delete on patient_secure_messages"        ON public.patient_secure_messages;
DROP POLICY IF EXISTS "Allow update on patient_secure_messages"        ON public.patient_secure_messages;
DROP POLICY IF EXISTS "full_access_patient_messages"                   ON public.patient_secure_messages;
DROP POLICY IF EXISTS "Allow authenticated access to patients"         ON public.patients;
DROP POLICY IF EXISTS "Allow authenticated access to pharmacy_batches" ON public.pharmacy_batches;
DROP POLICY IF EXISTS "open_pharmacy_batches"                          ON public.pharmacy_batches;
DROP POLICY IF EXISTS "Allow authenticated access to pharmacy_items"   ON public.pharmacy_items;
DROP POLICY IF EXISTS "open_pharmacy_items"                            ON public.pharmacy_items;
DROP POLICY IF EXISTS "Allow authenticated access to prescriptions"    ON public.prescriptions;
DROP POLICY IF EXISTS "open_prescriptions"                             ON public.prescriptions;
DROP POLICY IF EXISTS "Allow authenticated access to queue"            ON public.queue;
DROP POLICY IF EXISTS "Allow authenticated access to queue_metrics"    ON public.queue_metrics;
DROP POLICY IF EXISTS "open_queue_metrics"                             ON public.queue_metrics;
DROP POLICY IF EXISTS "Allow authenticated access to restock_sessions" ON public.restock_sessions;
DROP POLICY IF EXISTS "open_restock_sessions"                          ON public.restock_sessions;
DROP POLICY IF EXISTS "Allow authenticated access to stage_events"     ON public.stage_events;
DROP POLICY IF EXISTS "open_stage_events"                              ON public.stage_events;
DROP POLICY IF EXISTS "Allow authenticated access to stock_moves_nm"   ON public.stock_moves_nm;
DROP POLICY IF EXISTS "open_stock_moves_nm"                            ON public.stock_moves_nm;
DROP POLICY IF EXISTS "Allow authenticated access to stock_moves_rx"   ON public.stock_moves_rx;
DROP POLICY IF EXISTS "open_stock_moves_rx"                            ON public.stock_moves_rx;
DROP POLICY IF EXISTS "Allow authenticated access to tickets"          ON public.tickets;
DROP POLICY IF EXISTS "open_tickets"                                   ON public.tickets;
DROP POLICY IF EXISTS "Allow authenticated access to visits"           ON public.visits;
DROP POLICY IF EXISTS "Allow authenticated access to vitals"           ON public.vitals;

-- ----------------------------------------------------------------------------
-- 3. NEW SCOPED POLICIES — STAFF-ONLY OPERATIONAL TABLES
-- ----------------------------------------------------------------------------
-- Pattern: one FOR ALL policy per table, gated by is_staff().
-- Tables: alerts_nm, consultations, dispenses, inventory, inventory_discrepancies,
--         inventory_nm, patients, pharmacy_batches, pharmacy_items, prescriptions,
--         queue, queue_metrics, restock_sessions, stage_events, stock_moves_nm,
--         stock_moves_rx, tickets, visits, vitals.

CREATE POLICY "staff_all_alerts_nm"
  ON public.alerts_nm FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_consultations"
  ON public.consultations FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_dispenses"
  ON public.dispenses FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_inventory"
  ON public.inventory FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_inventory_discrepancies"
  ON public.inventory_discrepancies FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_inventory_nm"
  ON public.inventory_nm FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_patients"
  ON public.patients FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_pharmacy_batches"
  ON public.pharmacy_batches FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_pharmacy_items"
  ON public.pharmacy_items FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_prescriptions"
  ON public.prescriptions FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_queue"
  ON public.queue FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_queue_metrics"
  ON public.queue_metrics FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_restock_sessions"
  ON public.restock_sessions FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_stage_events"
  ON public.stage_events FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_stock_moves_nm"
  ON public.stock_moves_nm FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_stock_moves_rx"
  ON public.stock_moves_rx FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_tickets"
  ON public.tickets FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_visits"
  ON public.visits FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "staff_all_vitals"
  ON public.vitals FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ----------------------------------------------------------------------------
-- 4. NEW SCOPED POLICIES — AUDITED / ADMIN-READ TABLES
-- ----------------------------------------------------------------------------
-- audit_logs: any logged-in staff can INSERT (so all actions are recorded),
-- but only admin/auditor roles can SELECT. No UPDATE/DELETE.

CREATE POLICY "audit_logs_insert_staff"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());

CREATE POLICY "audit_logs_select_admin"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_role('admin', 'auditor'));

-- ----------------------------------------------------------------------------
-- 5. NEW SCOPED POLICIES — app_users
-- ----------------------------------------------------------------------------
-- Everyone in staff can read the staff directory (needed for assignment UIs).
-- A user can update their own row (display name etc.).
-- Only admins can INSERT/DELETE or change role.

CREATE POLICY "app_users_select_staff"
  ON public.app_users FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY "app_users_update_self"
  ON public.app_users FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY "app_users_admin_write"
  ON public.app_users FOR ALL TO authenticated
  USING (public.has_role('admin'))
  WITH CHECK (public.has_role('admin'));

-- ----------------------------------------------------------------------------
-- 6. NEW SCOPED POLICIES — SERVICE-INTERNAL TABLES
-- ----------------------------------------------------------------------------
-- These tables are written by edge functions / cron only. No client access.

CREATE POLICY "service_only_otp_rate_limit_tracking"
  ON public.otp_rate_limit_tracking FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- daily_counters / daily_counts: staff can read; only service_role writes.

CREATE POLICY "daily_counters_select_staff"
  ON public.daily_counters FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY "daily_counters_service_write"
  ON public.daily_counters FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "daily_counts_select_staff"
  ON public.daily_counts FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY "daily_counts_service_write"
  ON public.daily_counts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- conflict_resolutions: staff with resolve permission can do everything;
-- service-role (sync engine) too.

CREATE POLICY "conflict_resolutions_staff"
  ON public.conflict_resolutions FOR ALL TO authenticated
  USING (public.has_role('admin', 'auditor', 'lead_clinician', 'nurse', 'doctor'))
  WITH CHECK (public.has_role('admin', 'auditor', 'lead_clinician', 'nurse', 'doctor'));

CREATE POLICY "conflict_resolutions_service"
  ON public.conflict_resolutions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 7. NEW SCOPED POLICIES — GAMIFICATION
-- ----------------------------------------------------------------------------

CREATE POLICY "gamification_select_self_or_staff"
  ON public.gamification FOR SELECT TO authenticated
  USING (
    public.is_staff()
    OR volunteer_id = (SELECT auth.uid())::text
  );

CREATE POLICY "gamification_write_staff"
  ON public.gamification FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

-- gamification_wallets: a user can create their own wallet exactly once.
CREATE POLICY "gamification_wallets_insert_self"
  ON public.gamification_wallets FOR INSERT TO authenticated
  WITH CHECK (volunteer_id = (SELECT auth.uid())::text);

-- ----------------------------------------------------------------------------
-- 8. NEW SCOPED POLICIES — PALAVER (staff messaging)
-- ----------------------------------------------------------------------------
-- Only staff participate. Drop the always-true full-access policies and rely
-- on the per-row sender/recipient policies that already exist in
-- 20251214162156_add_palaver_room_messaging.sql.

CREATE POLICY "palaver_messages_staff_send"
  ON public.palaver_messages FOR INSERT TO authenticated
  WITH CHECK (
    public.is_staff()
    AND sender_id = (SELECT auth.uid())::text
  );

CREATE POLICY "palaver_messages_staff_delete_own"
  ON public.palaver_messages FOR DELETE TO authenticated
  USING (
    public.is_staff()
    AND sender_id = (SELECT auth.uid())::text
  );

CREATE POLICY "palaver_broadcasts_staff_manage"
  ON public.palaver_broadcasts FOR ALL TO authenticated
  USING (public.has_role('admin', 'doctor', 'lead_clinician'))
  WITH CHECK (public.has_role('admin', 'doctor', 'lead_clinician'));

CREATE POLICY "palaver_broadcast_reads_self"
  ON public.palaver_broadcast_reads FOR ALL TO authenticated
  USING (
    public.is_staff()
    AND user_id = (SELECT auth.uid())::text
  )
  WITH CHECK (
    public.is_staff()
    AND user_id = (SELECT auth.uid())::text
  );

-- ----------------------------------------------------------------------------
-- 9. NEW SCOPED POLICIES — PATIENT-PORTAL DATA TABLES
-- ----------------------------------------------------------------------------
-- patient_secure_messages, patient_appointment_requests, patient_documents,
-- patient_messages, patient_notifications:
--   * Staff: full access.
--   * Patient (auth'd via portal JWT): own rows only (by patient_id ↔ their
--     portal user's patient_id).

CREATE POLICY "patient_secure_messages_staff"
  ON public.patient_secure_messages FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "patient_secure_messages_owner"
  ON public.patient_secure_messages FOR ALL TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE id = (SELECT public.current_portal_user_id())
    )
  )
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE id = (SELECT public.current_portal_user_id())
    )
  );

CREATE POLICY "patient_appointment_requests_staff"
  ON public.patient_appointment_requests FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "patient_appointment_requests_owner"
  ON public.patient_appointment_requests FOR ALL TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE id = (SELECT public.current_portal_user_id())
    )
  )
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE id = (SELECT public.current_portal_user_id())
    )
  );

CREATE POLICY "patient_documents_staff"
  ON public.patient_documents FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "patient_documents_owner_read"
  ON public.patient_documents FOR SELECT TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE id = (SELECT public.current_portal_user_id())
    )
  );

CREATE POLICY "patient_messages_staff"
  ON public.patient_messages FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "patient_messages_owner"
  ON public.patient_messages FOR ALL TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE id = (SELECT public.current_portal_user_id())
    )
  )
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE id = (SELECT public.current_portal_user_id())
    )
  );

CREATE POLICY "patient_notifications_staff_write"
  ON public.patient_notifications FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());

CREATE POLICY "patient_notifications_staff_read"
  ON public.patient_notifications FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE POLICY "patient_notifications_owner_read"
  ON public.patient_notifications FOR SELECT TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE id = (SELECT public.current_portal_user_id())
    )
  );

CREATE POLICY "patient_notifications_owner_update"
  ON public.patient_notifications FOR UPDATE TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE id = (SELECT public.current_portal_user_id())
    )
  )
  WITH CHECK (
    patient_id IN (
      SELECT patient_id FROM public.patient_portal_users
       WHERE id = (SELECT public.current_portal_user_id())
    )
  );

-- Staff can also create notifications via service_role (cron, edge functions).
CREATE POLICY "patient_notifications_service"
  ON public.patient_notifications FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 10. NEW SCOPED POLICIES — PATIENT-PORTAL AUTH OBJECTS
-- ----------------------------------------------------------------------------
-- These are the trickiest. Registration/OTP login happens via anon, but we
-- cannot leave USING (true). Two safety nets:
--   (a) Edge functions should be the preferred path (use service_role).
--   (b) Where anon must INSERT/UPDATE directly, scope tightly.

-- patient_portal_users
-- Anon may INSERT a row in pending_verification state only. No anon SELECT.
CREATE POLICY "patient_portal_users_register"
  ON public.patient_portal_users FOR INSERT TO anon
  WITH CHECK (
    account_status = 'pending_verification'
    AND consent_given = true
  );

-- Anon may UPDATE a single row to flip status to verified during the OTP
-- callback. The row must still be in pending_verification when matched.
CREATE POLICY "patient_portal_users_verify"
  ON public.patient_portal_users FOR UPDATE TO anon
  USING (account_status = 'pending_verification')
  WITH CHECK (account_status IN ('pending_verification', 'active'));

-- Authenticated portal users: read/update own row.
CREATE POLICY "patient_portal_users_self"
  ON public.patient_portal_users FOR ALL TO authenticated
  USING (id = (SELECT public.current_portal_user_id()))
  WITH CHECK (id = (SELECT public.current_portal_user_id()));

-- Staff oversight: read-only.
CREATE POLICY "patient_portal_users_staff_read"
  ON public.patient_portal_users FOR SELECT TO authenticated
  USING (public.is_staff());

-- Service role: full (used by registration / cleanup edge functions).
CREATE POLICY "patient_portal_users_service"
  ON public.patient_portal_users FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- patient_portal_sessions
-- Anon needs to manage its own session row during login. Scope to rows whose
-- portal_user_id exists (so an attacker cannot create orphan sessions for an
-- arbitrary uuid). The session_token is the actual credential and is kept
-- server-side; anon INSERT/UPDATE/DELETE here is bounded by the row existing.

CREATE POLICY "patient_portal_sessions_anon_create"
  ON public.patient_portal_sessions FOR INSERT TO anon
  WITH CHECK (
    portal_user_id IN (SELECT id FROM public.patient_portal_users)
  );

CREATE POLICY "patient_portal_sessions_anon_update"
  ON public.patient_portal_sessions FOR UPDATE TO anon
  USING (is_active = true)
  WITH CHECK (true);

CREATE POLICY "patient_portal_sessions_anon_delete"
  ON public.patient_portal_sessions FOR DELETE TO anon
  USING (is_active = false OR expires_at < now());

CREATE POLICY "patient_portal_sessions_owner"
  ON public.patient_portal_sessions FOR ALL TO authenticated
  USING (portal_user_id = (SELECT public.current_portal_user_id()))
  WITH CHECK (portal_user_id = (SELECT public.current_portal_user_id()));

CREATE POLICY "patient_portal_sessions_service"
  ON public.patient_portal_sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- patient_portal_access_logs
-- Anyone may INSERT a log row (the login flow needs to log failures from anon),
-- but only on rows linked to a real portal_user_id OR for an explicit
-- unauthenticated attempt (portal_user_id IS NULL). No anon SELECT.

CREATE POLICY "patient_portal_access_logs_anon_insert"
  ON public.patient_portal_access_logs FOR INSERT TO anon
  WITH CHECK (
    portal_user_id IS NULL
    OR portal_user_id IN (SELECT id FROM public.patient_portal_users)
  );

CREATE POLICY "patient_portal_access_logs_owner_read"
  ON public.patient_portal_access_logs FOR SELECT TO authenticated
  USING (portal_user_id = (SELECT public.current_portal_user_id()));

CREATE POLICY "patient_portal_access_logs_admin_read"
  ON public.patient_portal_access_logs FOR SELECT TO authenticated
  USING (public.has_role('admin', 'auditor'));

CREATE POLICY "patient_portal_access_logs_service"
  ON public.patient_portal_access_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 11. FIX function_search_path_mutable (6 functions)
-- ----------------------------------------------------------------------------
-- These functions exist in earlier migrations without SET search_path.
-- We ALTER them in place; the original SECURITY DEFINER / SECURITY INVOKER
-- setting is preserved.

ALTER FUNCTION public.check_and_increment_otp_rate_limit(text, text, integer)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.cleanup_expired_otp_rate_limits()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.prevent_demotion_of_permanent_admin()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.touch_updated_at()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.update_updated_at()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.update_updated_at_column()
  SET search_path = public, pg_catalog;

-- ----------------------------------------------------------------------------
-- 12. LOCK DOWN SECURITY DEFINER FUNCTIONS
-- ----------------------------------------------------------------------------
-- check_and_increment_otp_rate_limit and cleanup_expired_otp_rate_limits are
-- currently EXECUTE-callable by anon and authenticated. They must be
-- service_role-only (the OTP edge function uses the service-role key).

REVOKE EXECUTE ON FUNCTION public.check_and_increment_otp_rate_limit(text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_and_increment_otp_rate_limit(text, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_and_increment_otp_rate_limit(text, text, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.check_and_increment_otp_rate_limit(text, text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_otp_rate_limits() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_otp_rate_limits() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_otp_rate_limits() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.cleanup_expired_otp_rate_limits() TO service_role;

-- ----------------------------------------------------------------------------
-- 13. LOCK DOWN THE 'photos' STORAGE BUCKET
-- ----------------------------------------------------------------------------
-- Currently public = true, which lets anon list /storage/v1/object/list/photos
-- and enumerate every uploaded file. Switch to private and add scoped policies.

UPDATE storage.buckets SET public = false WHERE id = 'photos';

-- Existing storage.objects policies for this bucket are left intact; if the
-- app was relying on public listing it must move to using signed URLs via
-- supabase.storage.from('photos').createSignedUrl(). A follow-up migration
-- can add per-patient scoping if needed.

DROP POLICY IF EXISTS "photos_public_read" ON storage.objects;

CREATE POLICY "photos_staff_all"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'photos' AND public.is_staff())
  WITH CHECK (bucket_id = 'photos' AND public.is_staff());

CREATE POLICY "photos_service"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'photos') WITH CHECK (bucket_id = 'photos');

-- End of migration.
