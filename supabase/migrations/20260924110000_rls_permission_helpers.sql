-- ============================================================================
-- RLS reconcile (1/5): permission helpers that mirror src/auth/roles.ts
-- ============================================================================
-- Release blocker (owner decision #4): the database access rules must follow
-- the same role -> permission matrix as the app.
--
-- This file only creates helpers. Policies are rewritten in the next four
-- migrations (20260924110100 .. 20260924110400).
--
-- *** KEEP IN SYNC ***
--   public.app_role_has_permission() below is the ONE place the matrix lives
--   on the server. It must change in the same pull request as
--   ROLE_PERMISSIONS in src/auth/roles.ts. See docs/security/RLS_MATRIX.md.
--   'lab_review' is new (owner decision #2): doctor, lead_clinician, admin.
--
-- Identity model (established from the existing migrations and
-- supabase/functions/_shared/security/staffAuth.ts):
--   * Staff: public.app_users.id is the Supabase auth user id
--     (auth.uid()). The role lives in app_users.role (a user_role enum in
--     production, text in the oldest migrations; compared as text here).
--     public.staff_roles is a legacy table and is NOT used for access.
--   * Portal patients: linked to a clinical record by
--       - patients.auth_uid = auth.uid()                   (email sign-up), or
--       - patient_portal_users.id = auth.uid()             (legacy), or
--       - patient_portal_users.id = app_metadata.portal_user_id, or
--       - patient_portal_users.phone_number = verified phone claim
--     and only while the patient's portal access is enabled
--     (patients.portal_enabled, owner decision #5) and the portal account is
--     active.
--   * Anonymous callers (anon key, no user) and device-only PIN sessions have
--     no auth.uid(): every helper returns false / nothing for them.
--
-- Column types drifted between migrations and production (uuid vs text ids),
-- so every id comparison below casts both sides to text.
--
-- Rollback: DROP FUNCTION for each helper created here after rolling back
-- 20260924110100..400 (their policies depend on these functions), then
-- re-run 20260520000003 to restore the previous is_staff()/has_role().
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The permission matrix (mirror of src/auth/roles.ts ROLE_PERMISSIONS)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_role_has_permission(
  p_role text,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    CASE p_role
      WHEN 'admin' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'consult', 'dispense', 'inventory', 'export',
        'users', 'approve_phi_conflicts', 'audit_access', 'resolve_conflicts',
        'lab_review'])
      WHEN 'doctor' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'consult', 'resolve_conflicts', 'lab_review'])
      WHEN 'nurse' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'resolve_conflicts'])
      WHEN 'volunteer' THEN p_permission = ANY (ARRAY[
        'register', 'vitals'])
      WHEN 'pharmacist' THEN p_permission = ANY (ARRAY[
        'dispense', 'inventory'])
      WHEN 'auditor' THEN p_permission = ANY (ARRAY[
        'export', 'approve_phi_conflicts', 'audit_access', 'resolve_conflicts'])
      WHEN 'lead_clinician' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'consult', 'export', 'approve_phi_conflicts',
        'audit_access', 'resolve_conflicts', 'lab_review'])
      -- 'guest', legacy 'chw', unknown roles and NULL: no permissions.
      ELSE false
    END,
    false
  );
$$;

COMMENT ON FUNCTION public.app_role_has_permission(text, text) IS
  'Server copy of ROLE_PERMISSIONS in src/auth/roles.ts (plus lab_review). '
  'Change both together. See docs/security/RLS_MATRIX.md.';

-- ----------------------------------------------------------------------------
-- 2. Caller identity helpers (SECURITY DEFINER so they can read app_users /
--    patients / patient_portal_users without RLS recursion; each only ever
--    reveals facts about the caller)
-- ----------------------------------------------------------------------------

-- The caller's app role, or NULL (anon, PIN-only, portal patient, unknown,
-- or a deactivated staff row). Deactivation flags are read through to_jsonb
-- so a missing column never breaks the function.
CREATE OR REPLACE FUNCTION public.app_current_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT au.role::text
    FROM public.app_users AS au
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND au.id::text = (SELECT auth.uid())::text
     AND COALESCE(to_jsonb(au) ->> 'is_active', 'true') NOT IN ('false', '0')
     AND COALESCE(to_jsonb(au) ->> 'active', 'true') <> 'false'
     AND COALESCE(to_jsonb(au) ->> 'disabled', 'false') <> 'true'
     AND COALESCE(to_jsonb(au) ->> 'deactivated', 'false') <> 'true'
     AND (to_jsonb(au) ->> 'deactivated_at') IS NULL
     AND (to_jsonb(au) ->> 'disabled_at') IS NULL
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.app_has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT public.app_role_has_permission(public.app_current_role(), p_permission);
$$;

CREATE OR REPLACE FUNCTION public.app_has_any_permission(p_permissions text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(bool_or(public.app_role_has_permission(cr.role, p.perm)), false)
    FROM (SELECT public.app_current_role() AS role) AS cr
   CROSS JOIN unnest(p_permissions) AS p(perm);
$$;

-- Staff = a known, non-guest app role (auditors included: they read for
-- audit but hold no clinical write permission).
CREATE OR REPLACE FUNCTION public.app_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    public.app_current_role() = ANY (ARRAY[
      'admin', 'doctor', 'nurse', 'pharmacist', 'volunteer', 'auditor',
      'lead_clinician']),
    false
  );
$$;

-- Staff who see patients at a station (registration, vitals, consultation,
-- pharmacy). Used for operational work: queue moves (owner decision #1),
-- allergies/preferences (AllergyManager / PreferenceManager), care tasks.
CREATE OR REPLACE FUNCTION public.app_is_station_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT public.app_has_any_permission(
    ARRAY['register', 'vitals', 'consult', 'dispense']);
$$;

-- Patient record ids the caller may see as a portal patient. Empty for staff
-- accounts that are not also linked patients, for anon and for PIN-only use.
CREATE OR REPLACE FUNCTION public.app_portal_patient_ids()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT p.id::text
    FROM public.patients AS p
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND p.auth_uid::text = (SELECT auth.uid())::text
     AND COALESCE(p.portal_enabled, false)
  UNION
  SELECT ppu.patient_id::text
    FROM public.patient_portal_users AS ppu
    JOIN public.patients AS p ON p.id::text = ppu.patient_id::text
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND COALESCE(ppu.account_status, 'active') = 'active'
     AND COALESCE(p.portal_enabled, false)
     AND (
          ppu.id::text = (SELECT auth.uid())::text
       OR ppu.id::text = (SELECT public.current_portal_user_id())
       OR (
            ppu.phone_number IS NOT NULL
        AND ppu.phone_number = NULLIF((SELECT auth.jwt()) ->> 'phone', '')
       )
     );
$$;

-- patient_portal_users ids that belong to the caller's own patient records.
CREATE OR REPLACE FUNCTION public.app_portal_user_ids()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT ppu.id::text
    FROM public.patient_portal_users AS ppu
   WHERE ppu.patient_id::text IN (SELECT public.app_portal_patient_ids());
$$;

-- Organisation ids the caller is assigned to (user_org_sites). DEFINER so
-- the user_org_sites policies no longer reference their own table.
CREATE OR REPLACE FUNCTION public.app_org_ids()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT uos.org_id::text
    FROM public.user_org_sites AS uos
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND uos.user_id::text = (SELECT auth.uid())::text;
$$;

-- Conflict approval hierarchy. Mirror of roleCanApprove() in
-- src/features/conflicts/conflictPermissions.ts: change both together.
CREATE OR REPLACE FUNCTION public.app_role_can_approve(
  p_approver_role text,
  p_required_role text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_required_role IS NULL THEN true
    WHEN p_approver_role = 'admin' THEN true
    WHEN p_required_role = 'lead_clinician'
      THEN p_approver_role IN ('lead_clinician', 'auditor')
    WHEN p_required_role = 'auditor' THEN p_approver_role = 'auditor'
    ELSE false
  END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Existing helpers delegate to the new ones
-- ----------------------------------------------------------------------------
-- is_staff()/has_role() became SECURITY INVOKER in 20260520000003, which
-- makes the app_users policy "app_users_select_staff" (USING is_staff())
-- re-enter app_users RLS on every evaluation. They now delegate to the
-- DEFINER helpers above; signatures and results are unchanged except that a
-- deactivated app_users row no longer counts as staff.

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT public.app_current_role() IS NOT NULL
     AND public.app_current_role() <> 'guest';
$$;

CREATE OR REPLACE FUNCTION public.has_role(VARIADIC roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(public.app_current_role() = ANY (roles), false);
$$;

-- ----------------------------------------------------------------------------
-- 4. Trigger helper: columns a caller may not change
-- ----------------------------------------------------------------------------
-- Usage: CREATE TRIGGER ... BEFORE UPDATE ... FOR EACH ROW EXECUTE FUNCTION
--   public.app_guard_immutable_columns('<exempt permission or empty>', 'col1', 'col2', ...);
-- Runs only for API callers (authenticated / anon). service_role, postgres
-- and SECURITY DEFINER functions are not restricted. Columns are compared
-- through to_jsonb, so a column that does not exist is simply ignored.
CREATE OR REPLACE FUNCTION public.app_guard_immutable_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_exempt text := NULLIF(TG_ARGV[0], '');
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  v_col text;
  i integer;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF v_exempt IS NOT NULL AND public.app_has_permission(v_exempt) THEN
    RETURN NEW;
  END IF;
  FOR i IN 1 .. TG_NARGS - 1 LOOP
    v_col := TG_ARGV[i];
    IF (v_new -> v_col) IS DISTINCT FROM (v_old -> v_col) THEN
      RAISE EXCEPTION 'This account cannot change %.%', TG_TABLE_NAME, v_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Grants
-- ----------------------------------------------------------------------------
-- Callable by signed-in users (policies run as the caller). anon never needs
-- them: every new policy is TO authenticated only.
REVOKE ALL ON FUNCTION public.app_role_has_permission(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_current_role()                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_has_permission(text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_has_any_permission(text[])      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_is_staff()                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_is_station_staff()              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_portal_patient_ids()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_portal_user_ids()               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_org_ids()                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_role_can_approve(text, text)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_guard_immutable_columns()       FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.app_role_has_permission(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_current_role()                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_has_permission(text)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_has_any_permission(text[])      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_is_staff()                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_is_station_staff()              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_portal_patient_ids()            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_portal_user_ids()               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_org_ids()                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_role_can_approve(text, text)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_guard_immutable_columns()       TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_staff()       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_staff()       TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.has_role(text[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Migration-only helpers (dropped again in 20260924110400)
-- ----------------------------------------------------------------------------
-- app_rls_reset(table): drops EVERY policy on public.<table> (whatever its
-- name: earlier migrations left duplicates and USING (true) policies under
-- many names), enables RLS and revokes all table privileges from anon.
-- A missing table is skipped with a warning.
CREATE OR REPLACE FUNCTION public.app_rls_reset(p_table text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_policy record;
BEGIN
  IF to_regclass(format('public.%I', p_table)) IS NULL THEN
    RAISE WARNING 'app_rls_reset: table public.% does not exist, skipped', p_table;
    RETURN;
  END IF;
  FOR v_policy IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = p_table
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, p_table);
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', p_table);
END;
$$;

-- app_rls_policy(table, name, command, using, check): CREATE POLICY ... TO
-- authenticated. Skips (with a warning) when the table does not exist; any
-- other error (unknown column, bad expression) aborts the migration so a
-- table is never left half-configured.
CREATE OR REPLACE FUNCTION public.app_rls_policy(
  p_table text,
  p_name text,
  p_command text,
  p_using text,
  p_check text DEFAULT NULL,
  p_restrictive boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_sql text;
BEGIN
  IF to_regclass(format('public.%I', p_table)) IS NULL THEN
    RAISE WARNING 'app_rls_policy: table public.% does not exist, policy % skipped',
      p_table, p_name;
    RETURN;
  END IF;
  IF p_command NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL') THEN
    RAISE EXCEPTION 'app_rls_policy: bad command %', p_command;
  END IF;
  IF p_command = 'INSERT' AND p_using IS NOT NULL THEN
    RAISE EXCEPTION 'app_rls_policy: INSERT policy % takes no USING', p_name;
  END IF;
  IF p_command IN ('SELECT', 'DELETE') AND p_check IS NOT NULL THEN
    RAISE EXCEPTION 'app_rls_policy: % policy % takes no WITH CHECK', p_command, p_name;
  END IF;

  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_name, p_table);

  v_sql := format(
    'CREATE POLICY %I ON public.%I AS %s FOR %s TO authenticated',
    p_name, p_table,
    CASE WHEN p_restrictive THEN 'RESTRICTIVE' ELSE 'PERMISSIVE' END,
    p_command);
  IF p_using IS NOT NULL THEN
    v_sql := v_sql || format(' USING (%s)', p_using);
  END IF;
  IF p_check IS NOT NULL THEN
    v_sql := v_sql || format(' WITH CHECK (%s)', p_check);
  END IF;
  EXECUTE v_sql;
END;
$$;

REVOKE ALL ON FUNCTION public.app_rls_reset(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_rls_policy(text, text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;

-- End of migration.
