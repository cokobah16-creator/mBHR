-- ============================================================================
-- Conflict review: which records a conflict may name, and who may act on
-- staff-account and stock conflicts (audit finding 4.9)
-- ============================================================================
-- Before: conflict_resolutions_insert (20260924110200) checks only
-- resolve_conflicts and that a new conflict starts open. A resolver could
-- file a conflict naming any record type, and could file, edit or decide a
-- conflict about a staff account or stock without the users or inventory
-- permission that governs those records.
--
-- After:
--   * A separate RESTRICTIVE INSERT policy,
--     conflict_resolutions_insert_record_type, is ANDed with the unchanged
--     permissive conflict_resolutions_insert:
--       - entity_type must be one of the record types the app reports: the
--         ten tables the sync adapter checks for conflicts
--         (src/sync/adapter.ts, tables minus APPEND_ONLY and PULL_ONLY) and
--         'server_command', the notice filed when the server refuses a
--         queued change (commandDeps().onRejected, src/sync/adapter.ts).
--         NULL is refused.
--       - an 'app_users' conflict needs users; an 'inventory' conflict needs
--         inventory.
--   * app_conflict_approval_guard() (BEFORE UPDATE, trigger
--     app_guard_conflict_approval) refuses any update of an 'app_users'
--     conflict without users and of an 'inventory' conflict without
--     inventory. The rest of the function is 20260924110200 lines 126-236,
--     unchanged.
--
-- The policy is written out rather than made with public.app_rls_policy(),
-- which 20260924110400 drops.
--
-- App impact: none for admins (the only role with resolve_conflicts and
-- users or inventory). A doctor, nurse, lead clinician or auditor whose
-- sync meets an inventory or staff-account conflict can no longer file it;
-- the app counts it as not queued, as it already does for anyone without
-- resolve_conflicts (src/sync/queueConflicts.ts). Existing conflicts are
-- not changed; old rows with other entity types can still be updated.
--
-- Depends on: 20260924110000 (app_has_permission, app_has_any_permission,
-- app_current_role, app_role_can_approve), 20260924110200 (the conflict
-- policies and both guard triggers), 20260925100600 (the permission
-- matrix: only admin holds resolve_conflicts together with users or
-- inventory). The DO block below stops the migration if they are missing.
--
-- Rollback (safe at any time; nothing else depends on this file):
--   DROP POLICY IF EXISTS conflict_resolutions_insert_record_type
--     ON public.conflict_resolutions;
--   then re-run the CREATE OR REPLACE FUNCTION
--   public.app_conflict_approval_guard() block from 20260924110200
--   (lines 126-236). Both parts are independent; either can be rolled back
--   alone.
-- Note: anything that later resets the conflict_resolutions policies (as
-- 20260924110200 did with app_rls_reset, which 20260924110400 drops) or
-- redefines app_conflict_approval_guard() must keep this policy and the
-- block marked 20260927100100 below.
-- ============================================================================

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.app_has_permission(text)') IS NULL
     OR to_regprocedure('public.app_has_any_permission(text[])') IS NULL
     OR to_regprocedure('public.app_current_role()') IS NULL
     OR to_regprocedure('public.app_role_can_approve(text,text)') IS NULL THEN
    RAISE EXCEPTION '20260927100100 needs the permission helpers from 20260924110000';
  END IF;
  IF to_regclass('public.conflict_resolutions') IS NULL THEN
    RAISE EXCEPTION '20260927100100: table public.conflict_resolutions does not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.conflict_resolutions'::regclass
       AND attname = 'entity_type' AND NOT attisdropped
       AND atttypid = 'text'::regtype
  ) THEN
    RAISE EXCEPTION '20260927100100: conflict_resolutions.entity_type (text) is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.conflict_resolutions'::regclass
       AND tgname = 'app_guard_conflict_approval' AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.conflict_resolutions'::regclass
       AND tgname = 'app_guard_conflict_classification' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '20260927100100 needs the conflict guard triggers from 20260924110200';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- INSERT: record types, and the record-type permission
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS conflict_resolutions_insert_record_type
  ON public.conflict_resolutions;

CREATE POLICY conflict_resolutions_insert_record_type
  ON public.conflict_resolutions
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    entity_type IN (
      'app_users', 'patients', 'visits', 'vitals', 'consultations',
      'dispenses', 'inventory', 'queue', 'patient_allergies',
      'patient_preferences', 'server_command')
    AND (entity_type <> 'app_users'
         OR (SELECT public.app_has_permission('users')))
    AND (entity_type <> 'inventory'
         OR (SELECT public.app_has_permission('inventory')))
  );

COMMENT ON POLICY conflict_resolutions_insert_record_type
  ON public.conflict_resolutions IS
  'Audit 4.9 (20260927100100): a new conflict names a record type the app reports; staff-account conflicts need users, stock conflicts need inventory. ANDed with conflict_resolutions_insert.';

-- ----------------------------------------------------------------------------
-- UPDATE: the decision and approval guard, with the record-type check first
-- (20260924110200 lines 126-236 plus the block marked 20260927100100)
-- ----------------------------------------------------------------------------
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
  v_entity text := v_old ->> 'entity_type';
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- Staff-account and stock conflicts: any change needs the permission that
  -- governs those records, not only resolve_conflicts. Checked before the
  -- early return below, so it covers every update, not only decisions. It
  -- reads the stored entity_type (OLD), which
  -- app_guard_conflict_classification keeps fixed, so changing entity_type
  -- in the same update cannot get round it. (20260927100100)
  IF v_entity = 'app_users' AND NOT public.app_has_permission('users') THEN
    RAISE EXCEPTION 'Staff account conflicts need the users permission'
      USING ERRCODE = '42501';
  END IF;
  IF v_entity = 'inventory' AND NOT public.app_has_permission('inventory') THEN
    RAISE EXCEPTION 'Stock conflicts need the inventory permission'
      USING ERRCODE = '42501';
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
