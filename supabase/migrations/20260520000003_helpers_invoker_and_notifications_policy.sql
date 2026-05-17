-- ============================================================================
-- Phase A follow-up #2:
--   1) Drop SECURITY DEFINER from is_staff()/has_role(). They were DEFINER so
--      they could read app_users from inside an RLS policy. By adding a
--      self-read policy on app_users, we can make them SECURITY INVOKER and
--      avoid the authenticated_security_definer_function_executable warning.
--   2) Add the missing staff_all_notifications policy (the previous migration
--      dropped the two USING(true) policies on `notifications` and forgot
--      to recreate a scoped one, leaving the table RLS-enabled-with-no-policy).
-- ============================================================================

-- (1a) Add a self-read policy so an authenticated user can read their own
--      app_users row. is_staff()/has_role() only check this row, so this is
--      enough to let them work as SECURITY INVOKER.
CREATE POLICY "app_users_select_self"
  ON public.app_users FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

-- (1b) Recreate helpers as SECURITY INVOKER.

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
     WHERE id = (SELECT auth.uid()) AND role <> 'guest'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(VARIADIC roles text[])
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
     WHERE id = (SELECT auth.uid()) AND role::text = ANY(roles)
  );
$$;

-- Permissions: authenticated can call; anon cannot.
REVOKE EXECUTE ON FUNCTION public.is_staff()        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(text[])  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_staff()        TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.has_role(text[])  TO authenticated, service_role;

-- (2) notifications table needs a scoped policy. It was previously open via
--     "Allow authenticated access to notifications" + "open_notifications"
--     (both dropped). Add staff-only access.
CREATE POLICY "staff_all_notifications"
  ON public.notifications FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "notifications_service"
  ON public.notifications FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- End.
