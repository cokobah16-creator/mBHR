-- ============================================================================
-- RLS reconcile (3/5): staff accounts, conflict review, staff messaging and
-- organisation-scoped clinical tables
-- ============================================================================
-- Fixes (see docs/security/RLS_MATRIX.md for the full list):
--   * app_users: "service_role_manage_permanent_admins" was FOR ALL TO public
--     with USING/WITH CHECK (... ELSE true): anyone, including the anon key,
--     could insert, edit or delete any non-permanent staff row (for example
--     create themselves an admin row). Now only the 'users' permission
--     writes; a user reads their own row; staff read the directory.
--   * conflict_resolutions: several overlapping policies; any of
--     admin/doctor/nurse/auditor/lead_clinician could approve any conflict.
--     Now read/write needs resolve_conflicts, and decisions and approvals
--     are checked by a trigger (approve_phi_conflicts to decide or approve a
--     high-PHI conflict, the required approver hierarchy that cannot be
--     skipped, auto-resolution only through a matching rule, approver =
--     caller, two different people for dual approval). The conflict's
--     classification (sensitivity, required approver) is locked after it is
--     reported, and new conflicts must start open.
--   * palaver_*: 20251214163828 granted anon and authenticated full access
--     (USING (true)); 20260520000000 never dropped those policies because it
--     used different names. Now: participants only, sender = caller.
--   * user_org_sites: a member could add anyone to their organisation and so
--     grant access to its patient flags/referrals; the policy also referenced
--     its own table (recursion). Now only 'users' holders manage members.
--
-- Rollback: restore the previous policies from a pre-migration schema dump,
-- then DROP TRIGGER app_guard_conflict_approval ON conflict_resolutions,
-- app_guard_conflict_classification ON conflict_resolutions,
-- app_guard_palaver_message ON palaver_messages,
-- app_guard_palaver_broadcast ON palaver_broadcasts,
-- app_guard_user_org_site ON user_org_sites and
-- DROP FUNCTION public.app_conflict_approval_guard().
-- ============================================================================

-- ----------------------------------------------------------------------------
-- app_users
-- ----------------------------------------------------------------------------
SELECT public.app_rls_reset('app_users');

-- Own row always; the staff directory for staff (appointment provider
-- pickers, messaging recipients, sync of staff accounts).
SELECT public.app_rls_policy('app_users', 'app_users_select', 'SELECT',
  $p$id::text = (SELECT auth.uid())::text
     OR (SELECT public.app_is_staff())$p$);

SELECT public.app_rls_policy('app_users', 'app_users_insert_users', 'INSERT',
  NULL, $p$(SELECT public.app_has_permission('users'))$p$);

SELECT public.app_rls_policy('app_users', 'app_users_update_users', 'UPDATE',
  $p$(SELECT public.app_has_permission('users'))$p$,
  $p$(SELECT public.app_has_permission('users'))$p$);

SELECT public.app_rls_policy('app_users', 'app_users_delete_users', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

-- Permanent admin rows can only be created, changed or removed with the
-- service role (the intent of the old policy, without its "ELSE true").
SELECT public.app_rls_policy('app_users', 'app_users_permanent_admin_insert', 'INSERT',
  NULL, $p$NOT COALESCE(admin_permanent, false)$p$, true);

SELECT public.app_rls_policy('app_users', 'app_users_permanent_admin_update', 'UPDATE',
  $p$NOT COALESCE(admin_permanent, false)$p$,
  $p$NOT COALESCE(admin_permanent, false)$p$, true);

SELECT public.app_rls_policy('app_users', 'app_users_permanent_admin_delete', 'DELETE',
  $p$NOT COALESCE(admin_permanent, false)$p$, NULL, true);

-- staff_roles is legacy (the app reads it once when a new device signs in);
-- access decisions use app_users only. Own row, read-only.
SELECT public.app_rls_reset('staff_roles');
SELECT public.app_rls_policy('staff_roles', 'staff_roles_select_self', 'SELECT',
  $p$auth_user_id::text = (SELECT auth.uid())::text$p$);

-- ----------------------------------------------------------------------------
-- Conflict review
-- ----------------------------------------------------------------------------
SELECT public.app_rls_reset('conflict_resolutions');

SELECT public.app_rls_policy('conflict_resolutions', 'conflict_resolutions_select', 'SELECT',
  $p$(SELECT public.app_has_any_permission(
       ARRAY['resolve_conflicts', 'approve_phi_conflicts']))$p$);

-- New conflicts start open: pending or waiting for approval, with no
-- decision, resolver or approver recorded. (Optional columns are read through
-- to_jsonb: older schemas created this table without some of them.)
SELECT public.app_rls_policy('conflict_resolutions', 'conflict_resolutions_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('resolve_conflicts'))
     AND COALESCE(to_jsonb(conflict_resolutions) ->> 'status', 'pending')
           IN ('pending', 'needs_approval')
     AND (to_jsonb(conflict_resolutions) ->> 'resolution_strategy') IS NULL
     AND (to_jsonb(conflict_resolutions) ->> 'resolved_by') IS NULL
     AND (to_jsonb(conflict_resolutions) ->> 'approved_by') IS NULL
     AND (to_jsonb(conflict_resolutions) ->> 'second_approver_id') IS NULL$p$);

SELECT public.app_rls_policy('conflict_resolutions', 'conflict_resolutions_update', 'UPDATE',
  $p$(SELECT public.app_has_any_permission(
       ARRAY['resolve_conflicts', 'approve_phi_conflicts']))$p$,
  $p$(SELECT public.app_has_any_permission(
       ARRAY['resolve_conflicts', 'approve_phi_conflicts']))$p$);
-- No DELETE policy: conflicts are kept (archiving uses the service role).

-- Decision and approval rules RLS cannot express (it cannot compare old and
-- new rows). Mirrors canResolveConflict()/canApproveDecision()/
-- roleCanApprove()/decisionNeedsApproval() in
-- src/features/conflicts/conflictPermissions.ts, applyAutoResolution() and
-- the dual-approval check in src/services/conflictQueue.ts.
--
--   * Deciding (recording a strategy, or closing the conflict as resolved,
--     ignored or auto_resolved) needs approve_phi_conflicts for a
--     high-sensitivity conflict, otherwise resolve_conflicts.
--   * auto_resolved is accepted only with an active auto_resolution_rules
--     row that matches the conflict and allows high PHI when the conflict is
--     high-sensitivity (the rule, not the caller, decides).
--   * A conflict that names a required approver cannot be closed as
--     resolved (other than with the 'ignore' strategy) by someone outside
--     the approver hierarchy: the approval step cannot be skipped.
--   * Approving or rejecting a proposed decision (leaving needs_approval,
--     setting approved_by or second_approver_id) needs the same permission
--     plus the approver hierarchy; approvers are recorded as the signed-in
--     user; the second approval must come from a different person.
-- The classification columns (phi_sensitivity, required_approver_role, ...)
-- are locked by app_guard_conflict_classification below, so they cannot be
-- lowered first to get round these checks.
CREATE OR REPLACE FUNCTION public.app_conflict_approval_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  v_uid text := (SELECT auth.uid())::text;
  v_old_status text := v_old ->> 'status';
  v_new_status text := v_new ->> 'status';
  v_high boolean := COALESCE(v_old ->> 'phi_sensitivity', 'none') = 'high';
  v_required text := v_old ->> 'required_approver_role';
  v_new_strategy text := v_new ->> 'resolution_strategy';
  v_closing boolean;
  v_deciding boolean;
  v_is_approval boolean;
  v_rule_ok boolean;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  v_closing := v_new_status IN ('resolved', 'ignored', 'auto_resolved')
               AND v_new_status IS DISTINCT FROM v_old_status;
  v_deciding := v_new_strategy IS NOT NULL
                AND (v_new -> 'resolution_strategy')
                    IS DISTINCT FROM (v_old -> 'resolution_strategy');

  -- Leaving needs_approval is an approval or a rejection, except when no
  -- decision had been proposed and the conflict is simply ignored.
  v_is_approval :=
       (v_old_status = 'needs_approval'
        AND v_new_status IS DISTINCT FROM 'needs_approval'
        AND NOT ((v_old ->> 'resolution_strategy') IS NULL
                 AND v_new_strategy = 'ignore'
                 AND v_new_status = 'resolved'))
    OR ((v_new ->> 'approved_by') IS NOT NULL
        AND (v_new -> 'approved_by') IS DISTINCT FROM (v_old -> 'approved_by'))
    OR ((v_new ->> 'second_approver_id') IS NOT NULL
        AND (v_new -> 'second_approver_id') IS DISTINCT FROM (v_old -> 'second_approver_id'));

  IF NOT (v_closing OR v_deciding OR v_is_approval) THEN
    RETURN NEW;
  END IF;

  -- Automatic resolution: the matching rule decides.
  IF v_new_status = 'auto_resolved' AND NOT v_is_approval THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.auto_resolution_rules AS r
       WHERE r.id::text = v_new ->> 'auto_rule_id'
         AND COALESCE(r.is_active, true)
         AND r.entity_type = v_old ->> 'entity_type'
         AND r.conflict_type = v_old ->> 'conflict_type'
         AND r.resolution_strategy = v_new_strategy
         AND (NOT v_high OR COALESCE(r.phi_allowed, false))
    ) INTO v_rule_ok;
    IF NOT COALESCE(v_rule_ok, false) THEN
      RAISE EXCEPTION 'An automatic resolution needs an active rule that matches this conflict'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Deciding, closing, approving or rejecting: the sensitivity permission.
  IF v_high THEN
    IF NOT public.app_has_permission('approve_phi_conflicts') THEN
      RAISE EXCEPTION 'Deciding a high-sensitivity conflict needs the approve_phi_conflicts permission'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.app_has_any_permission(
          ARRAY['resolve_conflicts', 'approve_phi_conflicts']) THEN
    RAISE EXCEPTION 'Deciding a conflict needs the resolve_conflicts permission'
      USING ERRCODE = '42501';
  END IF;

  -- The approval step cannot be skipped: closing a conflict that names a
  -- required approver (other than ignoring it) needs that approver.
  IF (v_is_approval
      OR (v_new_status = 'resolved'
          AND v_required IS NOT NULL
          AND v_new_strategy IS DISTINCT FROM 'ignore'))
     AND NOT public.app_role_can_approve(public.app_current_role(), v_required) THEN
    RAISE EXCEPTION 'This role cannot approve a conflict that requires %', v_required
      USING ERRCODE = '42501';
  END IF;

  -- An approval is recorded under the signed-in person only.
  IF (v_new ->> 'approved_by') IS NOT NULL
     AND (v_new -> 'approved_by') IS DISTINCT FROM (v_old -> 'approved_by')
     AND (v_new ->> 'approved_by') IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'approved_by must be the signed-in user'
      USING ERRCODE = '42501';
  END IF;
  IF (v_new ->> 'second_approver_id') IS NOT NULL
     AND (v_new -> 'second_approver_id') IS DISTINCT FROM (v_old -> 'second_approver_id') THEN
    IF (v_new ->> 'second_approver_id') IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'second_approver_id must be the signed-in user'
        USING ERRCODE = '42501';
    END IF;
    IF (v_new ->> 'second_approver_id') = (v_new ->> 'approved_by') THEN
      RAISE EXCEPTION 'The second approval must come from a different person'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.app_conflict_approval_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_conflict_approval_guard() TO authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('public.conflict_resolutions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS app_guard_conflict_approval ON public.conflict_resolutions;
    CREATE TRIGGER app_guard_conflict_approval
      BEFORE UPDATE ON public.conflict_resolutions
      FOR EACH ROW EXECUTE FUNCTION public.app_conflict_approval_guard();
  END IF;
END $$;


-- What a conflict is about, and how sensitive it is, is fixed when it is
-- reported: no API caller may change it afterwards (the app never does).
-- Without this a resolver could lower phi_sensitivity or clear
-- required_approver_role and then decide the conflict themselves.
DO $$
BEGIN
  IF to_regclass('public.conflict_resolutions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS app_guard_conflict_classification ON public.conflict_resolutions;
    CREATE TRIGGER app_guard_conflict_classification
      BEFORE UPDATE ON public.conflict_resolutions
      FOR EACH ROW EXECUTE FUNCTION public.app_guard_immutable_columns(
        '', 'id', 'patient_id', 'conflict_type', 'entity_type', 'entity_id',
        'candidate_ids', 'phi_sensitivity', 'required_approver_role',
        'conflict_details', 'site_id', 'created_at');
  END IF;
END $$;

-- Append-only conflict history: resolvers/approvers write, and auditors
-- (audit_access) read as well. No UPDATE or DELETE.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conflict_audit_logs', 'conflict_change_deltas'] LOOP
    PERFORM public.app_rls_reset(t);
    PERFORM public.app_rls_policy(t, t || '_select', 'SELECT',
      $p$(SELECT public.app_has_any_permission(
           ARRAY['resolve_conflicts', 'approve_phi_conflicts', 'audit_access']))$p$);
    PERFORM public.app_rls_policy(t, t || '_insert', 'INSERT',
      NULL,
      $p$(SELECT public.app_has_any_permission(
           ARRAY['resolve_conflicts', 'approve_phi_conflicts']))$p$);
  END LOOP;
END $$;

-- Archived summaries are written by the retention job (service role).
SELECT public.app_rls_reset('archived_conflict_summaries');
SELECT public.app_rls_policy('archived_conflict_summaries',
  'archived_conflict_summaries_select_audit', 'SELECT',
  $p$(SELECT public.app_has_permission('audit_access'))$p$);

-- Auto-resolution rules are configuration: staff read, admin writes.
SELECT public.app_rls_reset('auto_resolution_rules');
SELECT public.app_rls_policy('auto_resolution_rules', 'auto_resolution_rules_select_staff', 'SELECT',
  $p$(SELECT public.app_is_staff())$p$);
SELECT public.app_rls_policy('auto_resolution_rules', 'auto_resolution_rules_insert_users', 'INSERT',
  NULL, $p$(SELECT public.app_has_permission('users'))$p$);
SELECT public.app_rls_policy('auto_resolution_rules', 'auto_resolution_rules_update_users', 'UPDATE',
  $p$(SELECT public.app_has_permission('users'))$p$,
  $p$(SELECT public.app_has_permission('users'))$p$);
SELECT public.app_rls_policy('auto_resolution_rules', 'auto_resolution_rules_delete_users', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))$p$);

-- Configuration tables that were readable by every signed-in account
-- (USING (true)), including portal patients. Their admin write policies are
-- unchanged. On production site_conflict_settings comes from the catch-up
-- 20260924105800 with no policies at all, so it also gets a write policy for
-- the users permission (conflictQueue.ts updateSiteSettings; admin only, so
-- an auditor cannot switch off dual approval).
DO $$
BEGIN
  IF to_regclass('public.site_conflict_settings') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Authenticated users can view site conflict settings"
      ON public.site_conflict_settings;
    DROP POLICY IF EXISTS site_conflict_settings_select_staff
      ON public.site_conflict_settings;
    CREATE POLICY site_conflict_settings_select_staff
      ON public.site_conflict_settings FOR SELECT TO authenticated
      USING ((SELECT public.app_is_staff()));
    DROP POLICY IF EXISTS site_conflict_settings_write_users
      ON public.site_conflict_settings;
    CREATE POLICY site_conflict_settings_write_users
      ON public.site_conflict_settings FOR ALL TO authenticated
      USING ((SELECT public.app_has_permission('users')))
      WITH CHECK ((SELECT public.app_has_permission('users')));
  END IF;
  IF to_regclass('public.data_retention_policies') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Authenticated users can view retention policies"
      ON public.data_retention_policies;
    DROP POLICY IF EXISTS data_retention_policies_select_staff
      ON public.data_retention_policies;
    CREATE POLICY data_retention_policies_select_staff
      ON public.data_retention_policies FOR SELECT TO authenticated
      USING ((SELECT public.app_is_staff()));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Palaver (staff messaging). Needs an online staff sign-in: sender_id and
-- recipient_id must be Supabase auth user ids (app_users.id).
-- ----------------------------------------------------------------------------
SELECT public.app_rls_reset('palaver_messages');

SELECT public.app_rls_policy('palaver_messages', 'palaver_messages_select_participant', 'SELECT',
  $p$(SELECT public.app_is_staff())
     AND (sender_id::text = (SELECT auth.uid())::text
          OR recipient_id::text = (SELECT auth.uid())::text)$p$);

-- canMessageStaff() in src/features/doctor/messagingModel.ts.
SELECT public.app_rls_policy('palaver_messages', 'palaver_messages_insert_sender', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_any_permission(
       ARRAY['register', 'vitals', 'consult', 'dispense', 'inventory', 'users']))
     AND sender_id::text = (SELECT auth.uid())::text$p$);

-- Mark read / archive. Message content is protected by the trigger below.
SELECT public.app_rls_policy('palaver_messages', 'palaver_messages_update_participant', 'UPDATE',
  $p$(SELECT public.app_is_staff())
     AND (sender_id::text = (SELECT auth.uid())::text
          OR recipient_id::text = (SELECT auth.uid())::text)$p$,
  $p$(SELECT public.app_is_staff())
     AND (sender_id::text = (SELECT auth.uid())::text
          OR recipient_id::text = (SELECT auth.uid())::text)$p$);

SELECT public.app_rls_policy('palaver_messages', 'palaver_messages_delete_sender', 'DELETE',
  $p$(SELECT public.app_is_staff())
     AND sender_id::text = (SELECT auth.uid())::text$p$);

DO $$
BEGIN
  IF to_regclass('public.palaver_messages') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS app_guard_palaver_message ON public.palaver_messages;
    CREATE TRIGGER app_guard_palaver_message
      BEFORE UPDATE ON public.palaver_messages
      FOR EACH ROW EXECUTE FUNCTION public.app_guard_immutable_columns(
        '', 'id', 'sender_id', 'sender_name', 'recipient_id', 'recipient_name',
        'subject', 'body', 'priority', 'parent_id', 'created_at');
  END IF;
END $$;

-- Announcements: posted and hidden by canPostAnnouncements() roles
-- (consult or users); read by the audience getRoleTargets() in
-- src/services/palaverRoom.ts computes, by the sender and by posters.
SELECT public.app_rls_reset('palaver_broadcasts');

SELECT public.app_rls_policy('palaver_broadcasts', 'palaver_broadcasts_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     AND (
          target_role = 'all_staff'
       OR (target_role = 'all_clinical'
           AND (SELECT public.app_current_role()) IN ('doctor', 'nurse', 'pharmacist'))
       OR target_role = (SELECT public.app_current_role())
       OR sender_id::text = (SELECT auth.uid())::text
       OR (SELECT public.app_has_any_permission(ARRAY['consult', 'users']))
     )$p$);

SELECT public.app_rls_policy('palaver_broadcasts', 'palaver_broadcasts_insert_poster', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_any_permission(ARRAY['consult', 'users']))
     AND sender_id::text = (SELECT auth.uid())::text$p$);

SELECT public.app_rls_policy('palaver_broadcasts', 'palaver_broadcasts_update_poster', 'UPDATE',
  $p$(SELECT public.app_has_any_permission(ARRAY['consult', 'users']))$p$,
  $p$(SELECT public.app_has_any_permission(ARRAY['consult', 'users']))$p$);

SELECT public.app_rls_policy('palaver_broadcasts', 'palaver_broadcasts_delete_poster', 'DELETE',
  $p$(SELECT public.app_has_any_permission(ARRAY['consult', 'users']))$p$);

DO $$
BEGIN
  IF to_regclass('public.palaver_broadcasts') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS app_guard_palaver_broadcast ON public.palaver_broadcasts;
    CREATE TRIGGER app_guard_palaver_broadcast
      BEFORE UPDATE ON public.palaver_broadcasts
      FOR EACH ROW EXECUTE FUNCTION public.app_guard_immutable_columns(
        '', 'id', 'sender_id', 'sender_name', 'target_role', 'subject', 'body',
        'priority', 'created_at');
  END IF;
END $$;

SELECT public.app_rls_reset('palaver_broadcast_reads');
SELECT public.app_rls_policy('palaver_broadcast_reads', 'palaver_broadcast_reads_self', 'ALL',
  $p$(SELECT public.app_is_staff())
     AND user_id::text = (SELECT auth.uid())::text$p$,
  $p$(SELECT public.app_is_staff())
     AND user_id::text = (SELECT auth.uid())::text$p$);

-- ----------------------------------------------------------------------------
-- Organisation membership and organisation-scoped clinical tables
-- ----------------------------------------------------------------------------
SELECT public.app_rls_reset('user_org_sites');

SELECT public.app_rls_policy('user_org_sites', 'user_org_sites_select', 'SELECT',
  $p$user_id::text = (SELECT auth.uid())::text
     OR ((SELECT public.app_has_permission('users'))
         AND org_id::text IN (SELECT public.app_org_ids()))$p$);

SELECT public.app_rls_policy('user_org_sites', 'user_org_sites_insert_users', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('users'))
     AND org_id::text IN (SELECT public.app_org_ids())$p$);

-- A member may change their own default site (outreachService
-- setDefaultOrgSite); membership columns are protected by the trigger.
SELECT public.app_rls_policy('user_org_sites', 'user_org_sites_update', 'UPDATE',
  $p$user_id::text = (SELECT auth.uid())::text
     OR ((SELECT public.app_has_permission('users'))
         AND org_id::text IN (SELECT public.app_org_ids()))$p$,
  $p$user_id::text = (SELECT auth.uid())::text
     OR ((SELECT public.app_has_permission('users'))
         AND org_id::text IN (SELECT public.app_org_ids()))$p$);

SELECT public.app_rls_policy('user_org_sites', 'user_org_sites_delete_users', 'DELETE',
  $p$(SELECT public.app_has_permission('users'))
     AND org_id::text IN (SELECT public.app_org_ids())$p$);

DO $$
BEGIN
  IF to_regclass('public.user_org_sites') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS app_guard_user_org_site ON public.user_org_sites;
    CREATE TRIGGER app_guard_user_org_site
      BEFORE UPDATE ON public.user_org_sites
      FOR EACH ROW EXECUTE FUNCTION public.app_guard_immutable_columns(
        'users', 'user_id', 'org_id', 'site_id');
  END IF;
END $$;

-- Patient flags (hand-offs between stations; PatientFlagsPanel: register).
SELECT public.app_rls_reset('patient_flags');
SELECT public.app_rls_policy('patient_flags', 'patient_flags_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     AND org_id::text IN (SELECT public.app_org_ids())$p$);
SELECT public.app_rls_policy('patient_flags', 'patient_flags_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('register'))
     AND org_id::text IN (SELECT public.app_org_ids())$p$);
SELECT public.app_rls_policy('patient_flags', 'patient_flags_update', 'UPDATE',
  $p$(SELECT public.app_has_permission('register'))
     AND org_id::text IN (SELECT public.app_org_ids())$p$,
  $p$(SELECT public.app_has_permission('register'))
     AND org_id::text IN (SELECT public.app_org_ids())$p$);

SELECT public.app_rls_reset('referrals');
SELECT public.app_rls_policy('referrals', 'referrals_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     AND org_id::text IN (SELECT public.app_org_ids())$p$);
SELECT public.app_rls_policy('referrals', 'referrals_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('consult'))
     AND org_id::text IN (SELECT public.app_org_ids())$p$);
SELECT public.app_rls_policy('referrals', 'referrals_update', 'UPDATE',
  $p$(SELECT public.app_has_permission('consult'))
     AND org_id::text IN (SELECT public.app_org_ids())$p$,
  $p$(SELECT public.app_has_permission('consult'))
     AND org_id::text IN (SELECT public.app_org_ids())$p$);

SELECT public.app_rls_reset('follow_up_schedules');
SELECT public.app_rls_policy('follow_up_schedules', 'follow_up_schedules_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     AND org_id::text IN (SELECT public.app_org_ids())$p$);
SELECT public.app_rls_policy('follow_up_schedules', 'follow_up_schedules_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_any_permission(ARRAY['vitals', 'consult']))
     AND org_id::text IN (SELECT public.app_org_ids())$p$);
SELECT public.app_rls_policy('follow_up_schedules', 'follow_up_schedules_update', 'UPDATE',
  $p$(SELECT public.app_has_any_permission(ARRAY['vitals', 'consult']))
     AND org_id::text IN (SELECT public.app_org_ids())$p$,
  $p$(SELECT public.app_has_any_permission(ARRAY['vitals', 'consult']))
     AND org_id::text IN (SELECT public.app_org_ids())$p$);

SELECT public.app_rls_reset('consultation_reviews');
SELECT public.app_rls_policy('consultation_reviews', 'consultation_reviews_select', 'SELECT',
  $p$(SELECT public.app_is_staff())
     AND (org_id::text IN (SELECT public.app_org_ids())
          OR reviewed_doctor_id::text = (SELECT auth.uid())::text
          OR reviewing_doctor_id::text = (SELECT auth.uid())::text)$p$);
SELECT public.app_rls_policy('consultation_reviews', 'consultation_reviews_insert', 'INSERT',
  NULL,
  $p$(SELECT public.app_has_permission('consult'))
     AND org_id::text IN (SELECT public.app_org_ids())$p$);
SELECT public.app_rls_policy('consultation_reviews', 'consultation_reviews_update', 'UPDATE',
  $p$(SELECT public.app_has_permission('consult'))
     AND org_id::text IN (SELECT public.app_org_ids())$p$,
  $p$(SELECT public.app_has_permission('consult'))
     AND org_id::text IN (SELECT public.app_org_ids())$p$);

-- End of migration.
