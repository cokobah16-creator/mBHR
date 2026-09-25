-- Checks for 20260925160000_hotfix_app_users_public_write.sql.
--
-- The "Database migrations" workflow runs this after a rehearse with "only"
-- set to 20260925160000, on the throwaway local copy of production's schema
-- (no rows). Any failure stops the run. Everything is rolled back.
\set ON_ERROR_STOP 1

BEGIN;

DO $$
DECLARE
  open_policies text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.app_users'::regclass) THEN
    RAISE EXCEPTION 'row-level security is off on app_users';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'app_users'
                AND policyname IN ('service_role_manage_permanent_admins', 'app_users_update_self')) THEN
    RAISE EXCEPTION 'an app_users policy the hotfix drops is still there';
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'app_users'
         AND policyname IN ('app_users_select_staff', 'app_users_admin_write')) <> 2 THEN
    RAISE EXCEPTION 'app_users_select_staff or app_users_admin_write is missing';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE oid IN ('public.is_staff()'::regprocedure, 'public.has_role(text[])'::regprocedure)
                AND NOT prosecdef) THEN
    RAISE EXCEPTION 'is_staff() or has_role() is still SECURITY INVOKER';
  END IF;

  -- SECURITY DEFINER only skips app_users row-level security when the
  -- helpers' owner is exempt from it.
  IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.app_users'::regclass) THEN
    RAISE EXCEPTION 'app_users has FORCE ROW LEVEL SECURITY, so the helpers would still loop';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
              WHERE p.oid IN ('public.is_staff()'::regprocedure, 'public.has_role(text[])'::regprocedure)
                AND p.proowner <> (SELECT relowner FROM pg_class WHERE oid = 'public.app_users'::regclass)
                AND NOT (r.rolsuper OR r.rolbypassrls)) THEN
    RAISE EXCEPTION 'is_staff() or has_role() is owned by a role that app_users row-level security applies to';
  END IF;

  SELECT string_agg(policyname, ', ') INTO open_policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'app_users'
     AND roles && ARRAY['public', 'anon']::name[];
  IF open_policies IS NOT NULL THEN
    RAISE EXCEPTION 'app_users policies still open to anon/public: %', open_policies;
  END IF;
END $$;

-- The anon key cannot add a staff account. (An open policy would let the
-- row through to a NOT NULL error instead of an access refusal.)
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';
DO $$
BEGIN
  INSERT INTO public.app_users DEFAULT VALUES;
  RAISE EXCEPTION 'anon inserted a row into app_users';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    RAISE EXCEPTION 'anon insert into app_users was not refused by access rules: %', SQLERRM;
END $$;
RESET ROLE;

-- Nor can a signed-in account that is not an admin.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f1a5","role":"authenticated"}';
DO $$
BEGIN
  INSERT INTO public.app_users DEFAULT VALUES;
  RAISE EXCEPTION 'a non-admin account inserted a row into app_users';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    RAISE EXCEPTION 'non-admin insert into app_users was not refused by access rules: %', SQLERRM;
END $$;
RESET ROLE;

-- Staff still get through (the copy has no rows, so add some; all rolled
-- back). Before the hotfix a permanent admin failed here with "stack depth
-- limit exceeded", and after dropping the open policy alone every staff
-- member would.
INSERT INTO public.app_users (id, full_name, role, admin_permanent) VALUES
  ('00000000-0000-4000-8000-00000000f1a1', 'Hotfix check nurse', 'nurse', false),
  ('00000000-0000-4000-8000-00000000f1a2', 'Hotfix check permanent admin', 'admin', true);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f1a1","role":"authenticated"}';
DO $$
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'is_staff() is false for a nurse';
  END IF;
  IF (SELECT count(*) FROM public.app_users
       WHERE id::text IN ('00000000-0000-4000-8000-00000000f1a1', '00000000-0000-4000-8000-00000000f1a2')) <> 2 THEN
    RAISE EXCEPTION 'a nurse cannot read the staff directory';
  END IF;
  IF public.has_role('admin') THEN
    RAISE EXCEPTION 'has_role(admin) is true for a nurse';
  END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f1a2","role":"authenticated"}';
DO $$
BEGIN
  IF NOT (public.is_staff() AND public.has_role('admin')) THEN
    RAISE EXCEPTION 'the helpers do not recognise a permanent admin';
  END IF;
  IF (SELECT count(*) FROM public.app_users
       WHERE id::text IN ('00000000-0000-4000-8000-00000000f1a1', '00000000-0000-4000-8000-00000000f1a2')) <> 2 THEN
    RAISE EXCEPTION 'a permanent admin cannot read the staff directory';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;

\echo 'app_users hotfix checks passed'
