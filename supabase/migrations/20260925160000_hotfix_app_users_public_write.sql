-- ============================================================================
-- Hotfix: close public access to staff accounts (app_users)
-- ============================================================================
-- "service_role_manage_permanent_admins" (20260520000006, applied on
-- production as 20260517211155) is
--
--   FOR ALL TO public
--   USING / WITH CHECK (CASE WHEN admin_permanent THEN <service role>
--                       ELSE true END)
--
-- Policies are permissive (OR-ed together), so for every row that is not a
-- permanent admin it lets anyone, including the public anon key, read,
-- insert, edit or delete staff accounts: for example insert an admin row for
-- their own login. The service role bypasses RLS, so the policy never did
-- anything for it.
--
-- "app_users_update_self" (20260520000000) lets any signed-in user update
-- every column of their own row, role and admin_access included, so any
-- staff member can make themselves an admin.
--
-- The open policy is also what keeps staff sign-in working today.
-- 20260520000003 made is_staff() and has_role() SECURITY INVOKER, so each
-- call reads app_users under row-level security, whose policies call
-- is_staff() and has_role() again. Postgres stops that loop only when the
-- open policy (checked first) returns true for the row. Dropping it alone
-- makes every staff query that uses these helpers fail with "stack depth
-- limit exceeded" (it already does for permanent admin rows). So both
-- helpers go back to SECURITY DEFINER, as 20260520000000 had them and as
-- Wave A (20260924110000) redefines them: they read app_users as its owner,
-- without row-level security, and only reveal facts about the caller. Their
-- bodies are left as production has them.
--
-- This drops both policies and, before Wave A, makes sure the lockdown's other two scoped
-- policies (20260520000000) are there:
--   app_users_select_staff  staff (any non-guest role) read the directory
--   app_users_admin_write   admins insert, update and delete
-- The app only writes staff rows for people holding the "users" permission,
-- which only admins hold (src/sync/adapter.ts mayUploadStaffAccounts,
-- src/auth/roles.ts), so no screen needs either dropped policy.
-- 20260924110200 (Wave A) later replaces every app_users policy with
-- permission-based ones, also without a self-update policy.
--
-- Runs on its own, ahead of the older pending migrations: Actions > Database
-- migrations, with "only" set to 20260925160000. Safe to re-run.
--
-- Rollback (reopens the holes; only if staff access breaks): re-create the
-- policies exactly as in 20260520000006 L19-23 and 20260520000000 L260-263,
-- then ALTER FUNCTION public.is_staff() SECURITY INVOKER and the same for
-- public.has_role(text[]).
-- ============================================================================

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

ALTER FUNCTION public.is_staff()        SECURITY DEFINER SET search_path = public, pg_catalog;
ALTER FUNCTION public.has_role(text[])  SECURITY DEFINER SET search_path = public, pg_catalog;
REVOKE EXECUTE ON FUNCTION public.is_staff()       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_staff()       TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.has_role(text[]) TO authenticated, service_role;

-- Only before Wave A: once 20260924110000 has run (app_current_role()
-- exists), 20260924110200 owns every app_users policy, so a database rebuilt
-- in filename order must not get these back.
DO $$
BEGIN
  IF to_regprocedure('public.app_current_role()') IS NOT NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'app_users'
                    AND policyname = 'app_users_select_staff') THEN
    CREATE POLICY "app_users_select_staff"
      ON public.app_users FOR SELECT TO authenticated
      USING (public.is_staff());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'app_users'
                    AND policyname = 'app_users_admin_write') THEN
    CREATE POLICY "app_users_admin_write"
      ON public.app_users FOR ALL TO authenticated
      USING (public.has_role('admin'))
      WITH CHECK (public.has_role('admin'));
  END IF;
END $$;

DROP POLICY IF EXISTS "service_role_manage_permanent_admins" ON public.app_users;
DROP POLICY IF EXISTS "app_users_update_self"                ON public.app_users;

-- Name (never the SQL of) any other app_users policy still open to anon or
-- public, so the run's log shows whether anything else needs closing.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname, cmd
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'app_users'
       AND roles && ARRAY['public', 'anon']::name[]
  LOOP
    RAISE WARNING 'app_users policy still open to anon/public: % (%)', p.policyname, p.cmd;
  END LOOP;
END $$;
