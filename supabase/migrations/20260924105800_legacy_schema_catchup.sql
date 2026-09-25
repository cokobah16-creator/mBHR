-- ============================================================================
-- 20260924105800_legacy_schema_catchup.sql
--
-- What this replaces
-- ------------------
-- 26 legacy migrations were never applied on production and now live in
-- supabase/migrations-superseded/ (see its README). Production already has
-- almost everything they were meant to create, under other versions or in
-- other shapes. This file adds only the pieces production still lacks and
-- that something needs: a Wave A/B migration (20260924105900 ..
-- 20260926120100), a pgTAP file in supabase/tests, or a live screen in src/.
-- Each piece below names the superseded file:line it came from and who needs
-- it. Anything nothing needs was left out.
--
-- It is versioned just before 20260924105900 on purpose: Wave A's
-- app_rls_reset / app_rls_policy calls (20260924110200, 20260924110300)
-- create the policies for the new tables, which works only if the tables
-- exist when Wave A runs. The auto-enrolment setting is seeded false here,
-- before 20260925100100 installs the trigger that reads it.
--
-- Rules
-- -----
--   * Idempotent: IF NOT EXISTS, guarded DO blocks, DROP ... IF EXISTS before
--     re-creating a trigger or CHECK, ON CONFLICT DO NOTHING. Safe to run twice.
--   * NO policies at all. Every new table has RLS enabled and no policy (so
--     it is service_role only until Wave A adds its policies), and
--     REVOKE ALL ... FROM anon, PUBLIC.
--   * No function production already has is replaced; no new function is
--     created. updated_at triggers reuse the existing, hardened
--     public.update_updated_at_column().
--   * Ids and actor columns are text where production's related columns are
--     text or the client sends its own ids (ULIDs), as tested on a
--     fingerprint-identical copy of production.
--
-- Tested on copies of the production-schema clone as production's
-- non-superuser postgres: applied twice cleanly, adds zero policies, anon has
-- no privilege on any new table; Wave A/B and the pgTAP suite then run on top.
--
-- Rollback (by hand, only before any app has written to these objects;
-- everything added here is new, so dropping it restores the old shape):
--   DROP TABLE IF EXISTS public.conflict_change_deltas, public.conflict_audit_logs,
--     public.auto_resolution_rules, public.site_conflict_settings,
--     public.record_visibility_log, public.patient_submitted_data,
--     public.portal_enrollment_settings, public.patient_medical_conditions,
--     public.patient_referrals, public.patient_portal_preferences;
--   DROP TRIGGER IF EXISTS update_conflict_resolutions_timestamp ON public.conflict_resolutions;
--   ALTER TABLE public.dispenses DROP CONSTRAINT IF EXISTS dispenses_prescription_id_fkey,
--     DROP CONSTRAINT IF EXISTS dispenses_item_id_fkey, DROP CONSTRAINT IF EXISTS dispenses_batch_id_fkey;
--   then DROP COLUMN for the columns added in sections A, B and C, restore the
--   conflict_resolutions CHECKs (conflict_type IN (duplicate, sync_conflict),
--   status IN (pending, resolved, ignored)), id without default,
--   patient_id SET NOT NULL, candidate_ids without default;
--   DELETE FROM storage.buckets WHERE id = 'patient-documents' (only while empty,
--   through the Storage API).
--   Do not roll back after Wave A/B has run: 20260924110100 (portal_visible),
--   20260925100100 (patients portal columns, settings table) and
--   20260925100400 (dispenses.prescription_id) depend on these objects.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- A. From 20260115072241_add_portal_enhancements_v3 (superseded)
-- ----------------------------------------------------------------------------

-- A1. Portal visibility on vitals / consultations / dispenses.
--     From 20260115072241:259-342 (portal_visible at :259,290,321 and its siblings).
--     Needed by 20260924110100_rls_clinical_core.sql:137,155,173
--     (COALESCE(portal_visible, true) in vitals/consultations/dispenses_select;
--     the migration fails without it), and by src/services/recordVisibility.ts
--     :106-114,366-372, which updates all four columns.
ALTER TABLE public.vitals
  ADD COLUMN IF NOT EXISTS portal_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS visibility_reason text,
  ADD COLUMN IF NOT EXISTS hidden_by text,
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE public.consultations
  ADD COLUMN IF NOT EXISTS portal_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS visibility_reason text,
  ADD COLUMN IF NOT EXISTS hidden_by text,
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE public.dispenses
  ADD COLUMN IF NOT EXISTS portal_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS visibility_reason text,
  ADD COLUMN IF NOT EXISTS hidden_by text,
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

-- A2. patients.auto_enrolled / auto_enrolled_at / portal_opt_out.
--     From 20260115072241:363,370,377.
--     Needed by 20260925100100_portal_access_authoritative.sql:553-557 (the
--     section-6 stamping query fails without portal_opt_out), and at run time
--     by its check_auto_enrollment() / log_auto_enrollment() /
--     set_patient_portal_access() (L209, 241-242, 263, 365, 425-434);
--     supabase/tests/portal_access_backfill.test.sql:45.
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS auto_enrolled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_enrolled_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_opt_out boolean DEFAULT false;

-- A3. portal_enrollment_settings, seeded OFF.
--     From 20260115072241:433-440 (the original seed at L442-447 was
--     auto_enrollment_enabled = true; it is false here, and its USING (true)
--     policies at L451-459 are not copied).
--     Needed at run time by 20260925100100:227-236 (check_auto_enrollment()
--     reads it on every patients INSERT; without the table every new-patient
--     registration fails). UNIQUE (setting_key) is needed by the
--     ON CONFLICT (setting_key) in 20260926120000:58-68 and in
--     supabase/tests/portal_access.test.sql:19-22 and
--     portal_access_backfill.test.sql:19-21. Policies come from
--     20260924110300:410-419. Also read by src/services/autoEnrollment.ts:44,103.
--     Seeding false here closes the auto-enrolment window between
--     20260925100100 (trigger installed) and 20260926120000 (switch off).
CREATE TABLE IF NOT EXISTS public.portal_enrollment_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL UNIQUE,
  setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.portal_enrollment_settings (setting_key, setting_value, description) VALUES
  ('auto_enrollment_enabled', 'false'::jsonb, 'Enable automatic portal enrollment for eligible patients'),
  ('require_email', 'false'::jsonb, 'Require email for auto-enrollment'),
  ('send_welcome_notification', 'false'::jsonb, 'Send welcome notification to newly enrolled patients')
ON CONFLICT (setting_key) DO NOTHING;

-- A4. patient_submitted_data.
--     From 20260115072241:392-410, with id and
--     portal_user_id TEXT: the client inserts its own ULID id
--     (src/db/index.ts generateId(), src/services/patientSubmissions.ts:60,77)
--     and production's patient_portal_users.id is text ('ppu_...').
--     Needed by src/services/patientSubmissions.ts:76-86,127-131,186-196,277-291;
--     policies from 20260924110300:372-395.
CREATE TABLE IF NOT EXISTS public.patient_submitted_data (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  patient_id text NOT NULL,
  portal_user_id text,
  submission_type text NOT NULL
    CHECK (submission_type IN ('symptoms', 'medications', 'allergies', 'lifestyle', 'vitals', 'other')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'merged')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,
  merged_to_record_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_submitted_data_patient ON public.patient_submitted_data (patient_id);
CREATE INDEX IF NOT EXISTS idx_submitted_data_status  ON public.patient_submitted_data (status);
CREATE INDEX IF NOT EXISTS idx_submitted_data_created ON public.patient_submitted_data (created_at DESC);
DROP TRIGGER IF EXISTS update_patient_submitted_data_updated_at ON public.patient_submitted_data;
CREATE TRIGGER update_patient_submitted_data_updated_at
  BEFORE UPDATE ON public.patient_submitted_data
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- A5. record_visibility_log.
--     From 20260115072241:465-474.
--     Needed by src/services/recordVisibility.ts:125-135,236; policies from
--     20260924110300:399-407.
CREATE TABLE IF NOT EXISTS public.record_visibility_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type text NOT NULL CHECK (record_type IN ('vitals', 'consultations', 'dispenses', 'lab_results')),
  record_id text NOT NULL,
  patient_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('hidden', 'shown')),
  reason text,
  performed_by text NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visibility_log_patient ON public.record_visibility_log (patient_id);
CREATE INDEX IF NOT EXISTS idx_visibility_log_record  ON public.record_visibility_log (record_type, record_id);


-- ----------------------------------------------------------------------------
-- B. From 20260420000000_add_inventory_nm_and_tickets:174-229 (superseded)
--    dispenses.prescription_id / item_id / batch_id and their FKs.
--    Needed by 20260925100400_pharmacy_stock_ledger.sql:155-156 (partial index
--    WHERE prescription_id IS NOT NULL; the migration fails without it) and its
--    dispense triggers (:269, :316-341, :950); supabase/tests/
--    pharmacy_ledger.test.sql:175-180; src/sync/pharmacySync.ts.
--    The columns are new (all NULL), so the FKs validate at once.
--    Deviation: the prescription FK is ON DELETE RESTRICT (the file had
--    CASCADE), so deleting a prescription can never silently delete dispense
--    rows (PHI and stock-ledger links).
-- ----------------------------------------------------------------------------
ALTER TABLE public.dispenses
  ADD COLUMN IF NOT EXISTS prescription_id text,
  ADD COLUMN IF NOT EXISTS item_id text,
  ADD COLUMN IF NOT EXISTS batch_id text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.dispenses'::regclass
                    AND conname = 'dispenses_prescription_id_fkey') THEN
    ALTER TABLE public.dispenses ADD CONSTRAINT dispenses_prescription_id_fkey
      FOREIGN KEY (prescription_id) REFERENCES public.prescriptions (id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.dispenses'::regclass
                    AND conname = 'dispenses_item_id_fkey') THEN
    ALTER TABLE public.dispenses ADD CONSTRAINT dispenses_item_id_fkey
      FOREIGN KEY (item_id) REFERENCES public.pharmacy_items (id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.dispenses'::regclass
                    AND conname = 'dispenses_batch_id_fkey') THEN
    ALTER TABLE public.dispenses ADD CONSTRAINT dispenses_batch_id_fkey
      FOREIGN KEY (batch_id) REFERENCES public.pharmacy_batches (id) ON DELETE RESTRICT;
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- C. The live conflict queue. From 20260125094038_add_conflict_resolution_system,
--    20260125095031_add_enhanced_conflict_roles_and_site_settings and
--    20260125095109_add_conflict_delta_retention_and_archiving (superseded).
--    Needed by src/services/conflictQueue.ts: createConflict (:293-309, sends
--    no id and no patient_id, types include data_quality, status
--    needs_approval), list ordering (:447-448), resolve (:602-612), approve
--    (:818-823, :858-871), reject (:965-975), auto-resolve (:1214-1222), site
--    settings (:336-343, :361-375, :387), deltas (:731, :746), audit log
--    (:1308, :1337-1345), rules (:1174). Today every conflict INSERT fails on
--    production. Policies come from 20260924110200 (:78 conflict_resolutions,
--    :269-285 audit logs and deltas, :294 rules, :308-320 site settings).
--    Actor columns are text with no FK (production's resolved_by is text).
-- ----------------------------------------------------------------------------

-- C1. conflict_resolutions: id default, relaxed patient_id, the app's columns.
--     From 20260125094038:58-78,110-125 and 20260125095031:98-140 (actor
--     column second_approver_id is text here, not a uuid FK to auth.users).
ALTER TABLE public.conflict_resolutions
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN patient_id DROP NOT NULL,
  ALTER COLUMN candidate_ids SET DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id text,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS phi_sensitivity text NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS conflict_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS resolution_strategy text,  -- no CHECK: auto rules use keep_newer / keep_more_complete
  ADD COLUMN IF NOT EXISTS resolution_details jsonb,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_rule_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS required_approver_role text,
  ADD COLUMN IF NOT EXISTS escalation_reason text,
  ADD COLUMN IF NOT EXISTS second_approver_id text,
  ADD COLUMN IF NOT EXISTS second_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS site_id text,
  ADD COLUMN IF NOT EXISTS resolution_policy_reference text;

-- C2. Widened CHECKs (production allows only duplicate/sync_conflict and
--     pending/resolved/ignored; the app writes data_quality and needs_approval).
ALTER TABLE public.conflict_resolutions DROP CONSTRAINT IF EXISTS conflict_resolutions_conflict_type_check;
ALTER TABLE public.conflict_resolutions ADD CONSTRAINT conflict_resolutions_conflict_type_check
  CHECK (conflict_type IN ('duplicate', 'sync_conflict', 'data_quality'));
ALTER TABLE public.conflict_resolutions DROP CONSTRAINT IF EXISTS conflict_resolutions_status_check;
ALTER TABLE public.conflict_resolutions ADD CONSTRAINT conflict_resolutions_status_check
  CHECK (status IN ('pending', 'resolved', 'ignored', 'auto_resolved', 'needs_approval'));
ALTER TABLE public.conflict_resolutions DROP CONSTRAINT IF EXISTS conflict_resolutions_priority_check;
ALTER TABLE public.conflict_resolutions ADD CONSTRAINT conflict_resolutions_priority_check
  CHECK (priority IN ('low', 'medium', 'high', 'critical'));
ALTER TABLE public.conflict_resolutions DROP CONSTRAINT IF EXISTS conflict_resolutions_phi_sensitivity_check;
ALTER TABLE public.conflict_resolutions ADD CONSTRAINT conflict_resolutions_phi_sensitivity_check
  CHECK (phi_sensitivity IN ('none', 'low', 'medium', 'high'));
ALTER TABLE public.conflict_resolutions DROP CONSTRAINT IF EXISTS conflict_resolutions_required_approver_role_check;
ALTER TABLE public.conflict_resolutions ADD CONSTRAINT conflict_resolutions_required_approver_role_check
  CHECK (required_approver_role IS NULL OR required_approver_role IN ('admin', 'auditor', 'lead_clinician'));

CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_entity   ON public.conflict_resolutions (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_priority ON public.conflict_resolutions (priority, status);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_created  ON public.conflict_resolutions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_site_id  ON public.conflict_resolutions (site_id)
  WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_required_approver ON public.conflict_resolutions (required_approver_role)
  WHERE required_approver_role IS NOT NULL;

-- The file's own update_conflict_resolution_timestamp() (no search_path) is
-- not created; the existing hardened function stamps updated_at instead.
DROP TRIGGER IF EXISTS update_conflict_resolutions_timestamp ON public.conflict_resolutions;
CREATE TRIGGER update_conflict_resolutions_timestamp
  BEFORE UPDATE ON public.conflict_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- C3. conflict_audit_logs. From 20260125094038:80-91 (conflict_id text, to
--     match text conflict_resolutions.id; RESTRICT, not CASCADE, on an audit log).
CREATE TABLE IF NOT EXISTS public.conflict_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_id text NOT NULL REFERENCES public.conflict_resolutions (id) ON DELETE RESTRICT,
  action text NOT NULL
    CHECK (action IN ('created', 'viewed', 'resolved', 'approved', 'rejected', 'appealed', 'auto_resolved')),
  actor_id text,
  actor_role text,
  field_changes jsonb DEFAULT '{}'::jsonb,
  justification text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conflict_audit_logs_conflict ON public.conflict_audit_logs (conflict_id);
CREATE INDEX IF NOT EXISTS idx_conflict_audit_logs_actor    ON public.conflict_audit_logs (actor_id);

-- C4. auto_resolution_rules. From 20260125094038:93-108; no seed rows
--     (L248-253 seeds two; applyAutoResolution has no caller; owner decision).
CREATE TABLE IF NOT EXISTS public.auto_resolution_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  entity_type text NOT NULL,
  conflict_type text NOT NULL CHECK (conflict_type IN ('sync_conflict', 'duplicate', 'data_quality')),
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_strategy text NOT NULL
    CHECK (resolution_strategy IN ('keep_local', 'keep_remote', 'keep_newer', 'keep_more_complete')),
  phi_allowed boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  priority_order int NOT NULL DEFAULT 100,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auto_resolution_rules_active ON public.auto_resolution_rules (is_active, entity_type);
DROP TRIGGER IF EXISTS update_auto_resolution_rules_timestamp ON public.auto_resolution_rules;
CREATE TRIGGER update_auto_resolution_rules_timestamp
  BEFORE UPDATE ON public.auto_resolution_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- C5. site_conflict_settings. From 20260125095031:46-62; UNIQUE (site_id) for
--     the app's upsert; no example seed rows (L163-174).
--     Note: Wave A 110200 adds only a staff SELECT policy, so site-settings
--     writes stay denied until a later migration adds an admin write policy.
CREATE TABLE IF NOT EXISTS public.site_conflict_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id text NOT NULL UNIQUE,
  site_name text,
  name_match_threshold numeric DEFAULT 0.8 CHECK (name_match_threshold >= 0 AND name_match_threshold <= 1),
  phone_match_weight numeric DEFAULT 0.9 CHECK (phone_match_weight >= 0 AND phone_match_weight <= 1),
  dob_match_weight numeric DEFAULT 0.95 CHECK (dob_match_weight >= 0 AND dob_match_weight <= 1),
  auto_resolution_enabled boolean DEFAULT true,
  high_phi_approval_required boolean DEFAULT true,
  approved_auto_rules uuid[] DEFAULT '{}',
  linguistic_region text DEFAULT 'default',
  require_dual_approval_for_patient_merge boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by text
);

-- C6. conflict_change_deltas. From 20260125095109:36-47 (conflict_id and
--     changed_by text, no FK to auth.users).
--     The file's other 3 tables (archived_conflict_summaries,
--     data_retention_policies, retention_policy_executions) have no user.
CREATE TABLE IF NOT EXISTS public.conflict_change_deltas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_id text NOT NULL REFERENCES public.conflict_resolutions (id) ON DELETE RESTRICT,
  field_name text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  change_type text NOT NULL CHECK (change_type IN ('merge', 'override', 'correction', 'auto_resolve')),
  changed_by text,
  changed_by_role text,
  phi_field boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conflict_change_deltas_conflict_id ON public.conflict_change_deltas (conflict_id);
CREATE INDEX IF NOT EXISTS idx_conflict_change_deltas_created_at  ON public.conflict_change_deltas (created_at);


-- ----------------------------------------------------------------------------
-- D. From 20251030000000_add_patient_portal_features (superseded)
-- ----------------------------------------------------------------------------

-- D1. patient_medical_conditions. From 20251030000000:94-106.
--     Needed by src/features/patient-portal/MedicalConditions.tsx:82,169;
--     policies from 20260924110300:446-462.
CREATE TABLE IF NOT EXISTS public.patient_medical_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  condition_name text NOT NULL,
  diagnosed_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'managed')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medical_conditions_patient ON public.patient_medical_conditions (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_medical_conditions_status  ON public.patient_medical_conditions (patient_id, status);

-- D2. patient_referrals. From 20251030000000:127-146.
--     Needed by src/features/patient-portal/Referrals.tsx:64; policies from
--     20260924110300:464-476. created_by has no FK to the legacy users table,
--     and the index names are prefixed (idx_referrals_status already exists
--     on public.referrals).
CREATE TABLE IF NOT EXISTS public.patient_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL REFERENCES public.patients (id) ON DELETE CASCADE,
  referring_provider text NOT NULL,
  specialist_name text,
  specialty text NOT NULL,
  reason text NOT NULL,
  referral_date date NOT NULL DEFAULT CURRENT_DATE,
  appointment_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled')),
  priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'emergency')),
  notes text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patient_referrals_patient  ON public.patient_referrals (patient_id, referral_date DESC);
CREATE INDEX IF NOT EXISTS idx_patient_referrals_status   ON public.patient_referrals (patient_id, status);
CREATE INDEX IF NOT EXISTS idx_patient_referrals_priority ON public.patient_referrals (patient_id, priority);

-- D3. patient_portal_preferences. From 20251030000000:149-159.
--     Needed by src/features/patient-portal/ManageAccount.tsx:114,148-157
--     (upsert onConflict portal_user_id, so the UNIQUE is required); policies
--     from 20260924110300:130-144. portal_user_id is TEXT with no FK: the app
--     writes a patient_portal_users.id ('ppu_...') or a Supabase auth uid.
CREATE TABLE IF NOT EXISTS public.patient_portal_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id text NOT NULL,
  email_reminders boolean DEFAULT true,
  sms_reminders boolean DEFAULT true,
  appointment_alerts boolean DEFAULT true,
  lab_results_alerts boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT patient_portal_preferences_portal_user_id_key UNIQUE (portal_user_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient_medical_conditions', 'patient_referrals', 'patient_portal_preferences'] LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'update_' || t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW '
                   'EXECUTE FUNCTION public.update_updated_at_column()',
                   'update_' || t || '_updated_at', t);
  END LOOP;
END $$;

-- D4. The private patient-documents bucket. From 20251030000000:325-327.
--     Needed by src/features/patient-portal/DocumentUpload.tsx:148,174 and
--     supabase/tests/patient_document_ownership.test.sql:51-56. Its
--     storage.objects policies come from 20260924110300 / 20260925100700.
--     Private (public = false); an existing row is left untouched.
INSERT INTO storage.buckets (id, name, public)
VALUES ('patient-documents', 'patient-documents', false)
ON CONFLICT (id) DO NOTHING;


-- ----------------------------------------------------------------------------
-- E. Every new table: RLS on, no policies, nothing for anon or PUBLIC.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'portal_enrollment_settings', 'patient_submitted_data', 'record_visibility_log',
    'conflict_audit_logs', 'auto_resolution_rules', 'site_conflict_settings', 'conflict_change_deltas',
    'patient_medical_conditions', 'patient_referrals', 'patient_portal_preferences'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, PUBLIC', t);
  END LOOP;
END $$;
