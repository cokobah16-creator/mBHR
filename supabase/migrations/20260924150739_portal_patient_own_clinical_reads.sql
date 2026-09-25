-- Stopgap: let a patient-portal user read their own visits, vitals,
-- consultations and dispenses, and read/send their own secure messages, until
-- the portal RLS model from 20260924110000..110400
-- (public.app_portal_patient_ids()) is applied.
--
-- Version matches the hosted project's schema_migrations row: applied there by
-- hand on 2026-09-24 alongside 20260924112756_patients_select_own_record.
--
-- When the new model is present this migration only removes its own policies,
-- so the new model's gating (portal access enabled, released results) is not
-- bypassed. On the hosted project app_rls_reset() in 20260924110100 and
-- 20260924110300 drops these policies when that model is applied.

DO $$
DECLARE
  v_own constant text :=
    'patient_id IN (SELECT p.id FROM public.patients p '
    'WHERE p.auth_uid = (SELECT auth.uid())::text)';
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['visits', 'vitals', 'consultations', 'dispenses'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                   v_table || '_select_own_patient', v_table);
  END LOOP;
  DROP POLICY IF EXISTS patient_secure_messages_select_own_patient ON public.patient_secure_messages;
  DROP POLICY IF EXISTS patient_secure_messages_insert_own_patient ON public.patient_secure_messages;

  IF to_regprocedure('public.app_portal_patient_ids()') IS NOT NULL THEN
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY ARRAY['visits', 'vitals', 'consultations', 'dispenses'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
      v_table || '_select_own_patient', v_table, v_own);
  END LOOP;

  EXECUTE format(
    'CREATE POLICY patient_secure_messages_select_own_patient '
    'ON public.patient_secure_messages FOR SELECT TO authenticated USING (%s)',
    v_own);
  EXECUTE format(
    'CREATE POLICY patient_secure_messages_insert_own_patient '
    'ON public.patient_secure_messages FOR INSERT TO authenticated '
    'WITH CHECK (from_patient = true AND %s)',
    v_own);
END $$;
