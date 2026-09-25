-- Defense-in-depth: anon UPDATE on patient_portal_sessions must keep the
-- session active and bound to a real portal user. Anything else (logout,
-- session theft, expiry extension) must go through service_role.

DROP POLICY IF EXISTS "patient_portal_sessions_anon_update" ON public.patient_portal_sessions;

CREATE POLICY "patient_portal_sessions_anon_update"
  ON public.patient_portal_sessions FOR UPDATE TO anon
  USING (is_active = true)
  WITH CHECK (
    is_active = true
    AND portal_user_id IN (SELECT id FROM public.patient_portal_users)
  );

-- End.
