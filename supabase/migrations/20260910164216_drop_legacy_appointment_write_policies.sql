/*
  # Retire legacy appointment write policies

  20260910161049_add_televisits added is_staff()-scoped
  appointments_staff_insert / appointments_staff_update. The older role-list
  policies "Staff can create appointments" / "Staff can update appointments"
  overlapped them (advisor: multiple_permissive_policies for INSERT and
  UPDATE), so retire the legacy pair. Net effect: the guest role, which the
  legacy list allowed, can no longer write appointments; every other staff
  role is unchanged.

  Applied to production via the Supabase connector as version 20260910164216.

  ## Rollback
    CREATE POLICY "Staff can create appointments" ON public.appointments
      FOR INSERT TO authenticated
      WITH CHECK ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['guest'::user_role, 'nurse'::user_role, 'doctor'::user_role, 'admin'::user_role])));
    CREATE POLICY "Staff can update appointments" ON public.appointments
      FOR UPDATE TO authenticated
      USING ((SELECT auth.uid()) IN (SELECT id FROM public.app_users WHERE role = ANY (ARRAY['guest'::user_role, 'nurse'::user_role, 'doctor'::user_role, 'admin'::user_role])));
*/

DROP POLICY IF EXISTS "Staff can create appointments" ON public.appointments;
DROP POLICY IF EXISTS "Staff can update appointments" ON public.appointments;
