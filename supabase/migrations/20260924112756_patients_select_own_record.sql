-- Stopgap: let a patient-portal user read the one patients row linked to
-- their login, until the portal RLS model from 20260924110000..110400
-- (public.app_portal_patient_ids()) is applied.
--
-- Version matches the hosted project's schema_migrations row: this was
-- applied there by hand on 2026-09-24 to restore portal sign-in, which had
-- failed for every patient since 20260520000000_lockdown_rls_and_definer
-- left public.patients with staff-only access.
--
-- When the new model is present this migration only removes its own policy.
-- In a fresh database the 1100xx migrations run first, so nothing is created
-- here; on the hosted project app_rls_reset('patients') in
-- 20260924110100_rls_clinical_core drops it when that model is applied. Either
-- way the new model's gating (portal access enabled) is not bypassed.

DO $$
BEGIN
  DROP POLICY IF EXISTS patients_select_own ON public.patients;

  IF to_regprocedure('public.app_portal_patient_ids()') IS NULL THEN
    EXECUTE $p$
      CREATE POLICY patients_select_own ON public.patients
        FOR SELECT TO authenticated
        USING (auth_uid IS NOT NULL AND auth_uid = (SELECT auth.uid())::text)
    $p$;
  END IF;
END $$;
