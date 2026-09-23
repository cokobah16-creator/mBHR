-- ============================================================================
-- RLS reconcile (5/5): verify the PHI lockdown and remove migration helpers
-- ============================================================================
-- Fails the migration (so a deploy or `supabase db reset` stops loudly) if
-- any PHI table below:
--   * has row level security disabled,
--   * has a policy that applies to anon or PUBLIC,
--   * has a permissive policy whose USING or WITH CHECK is literally true
--     for a non-service role, or
--   * still grants any table privilege to anon.
-- Tables that do not exist are skipped.
--
-- Rollback: nothing to roll back except re-creating the two migration
-- helpers (public.app_rls_reset / public.app_rls_policy) from
-- 20260924110000 if a later migration wants to reuse them.
-- ============================================================================

DO $$
DECLARE
  v_tables text[] := ARRAY[
    -- clinical record
    'patients', 'visits', 'vitals', 'consultations', 'dispenses',
    'prescriptions', 'patient_allergies', 'patient_preferences',
    'care_tasks', 'triage_records', 'clinical_alerts', 'patient_merges',
    'immunizations', 'conditions', 'sdoh_observations', 'lab_orders',
    'lab_results', 'procedures', 'document_references', 'care_plans',
    'goals', 'service_requests', 'fhir_resources', 'resource_versions',
    -- flow, scheduling, reminders
    'queue', 'tickets', 'stage_events', 'appointments', 'waitlist',
    'medication_reminders', 'outbound_messages',
    -- staff, audit, conflicts, messaging, org-scoped
    'app_users', 'staff_roles', 'audit_logs', 'conflict_resolutions',
    'conflict_audit_logs', 'conflict_change_deltas',
    'archived_conflict_summaries', 'palaver_messages', 'palaver_broadcasts',
    'palaver_broadcast_reads', 'user_org_sites', 'patient_flags',
    'referrals', 'follow_up_schedules', 'consultation_reviews',
    -- patient portal
    'patient_portal_users', 'patient_portal_sessions',
    'patient_portal_access_logs', 'patient_portal_preferences',
    'patient_secure_messages', 'patient_messages', 'patient_notifications',
    'patient_appointment_requests', 'patient_documents',
    'patient_consent_records', 'patient_data_sharing_preferences',
    'tefca_access_logs', 'patient_submitted_data', 'record_visibility_log',
    'patient_lab_results', 'patient_medical_conditions', 'patient_referrals',
    'otp_rate_limits', 'otp_rate_limit_tracking'
  ];
  v_table text;
  v_problems text[] := ARRAY[]::text[];
  v_row record;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    -- Defence in depth for tables not rewritten by 20260924110100..300
    -- (FHIR tables, otp_rate_limit_tracking): anon holds no privilege.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_table);

    IF NOT (SELECT c.relrowsecurity
              FROM pg_class AS c
             WHERE c.oid = to_regclass(format('public.%I', v_table))) THEN
      v_problems := v_problems || format('%s: RLS disabled', v_table);
    END IF;

    FOR v_row IN
      SELECT pol.policyname, pol.roles, pol.permissive, pol.qual, pol.with_check
        FROM pg_policies AS pol
       WHERE pol.schemaname = 'public'
         AND pol.tablename = v_table
    LOOP
      IF 'anon' = ANY (v_row.roles) OR 'public' = ANY (v_row.roles) THEN
        v_problems := v_problems
          || format('%s: policy "%s" applies to %s', v_table, v_row.policyname,
                    array_to_string(v_row.roles, ','));
      END IF;
      IF v_row.permissive = 'PERMISSIVE'
         AND NOT (v_row.roles = ARRAY['service_role']::name[])
         AND (btrim(COALESCE(v_row.qual, '')) = 'true'
              OR btrim(COALESCE(v_row.with_check, '')) = 'true') THEN
        v_problems := v_problems
          || format('%s: policy "%s" is always true', v_table, v_row.policyname);
      END IF;
    END LOOP;

    IF has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
       OR has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('anon', format('public.%I', v_table), 'DELETE') THEN
      v_problems := v_problems || format('%s: anon still has a table privilege', v_table);
    END IF;
  END LOOP;

  IF array_length(v_problems, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'PHI RLS verification failed: %', array_to_string(v_problems, '; ');
  END IF;
END $$;

-- Migration-only helpers from 20260924110000.
DROP FUNCTION IF EXISTS public.app_rls_policy(text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.app_rls_reset(text);

-- End of migration.
