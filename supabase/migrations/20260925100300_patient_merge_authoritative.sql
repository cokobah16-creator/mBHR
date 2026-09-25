-- ============================================================================
-- Patient merges: server-authoritative (Wave B, work package 3)
-- ============================================================================
-- Runs after 20260925100000_sync_authority_foundation.sql (merged_* columns
-- on patients, canonical_patient_id(), command receipts, the guard trigger
-- and the merge_patients permission) and the portal-access and queue-ticket
-- packages (20260925100100, 20260925100200), whose tables it uses when they
-- exist.
--
-- Owner decision: a patient merge has one canonical server record and an
-- immutable history (who, when, which records, which field values were
-- chosen), and every device converges on it.
--
--   1. patient_merges becomes the append-only merge history: new columns
--      (command id, actor, field choices, before-snapshots, moved counts,
--      source), no UPDATE / DELETE / TRUNCATE for anyone, readable by
--      merge_patients and audit_access holders only. Its foreign keys to
--      patients are dropped: the history must outlive a deleted record, and
--      a cascading delete could never run against an append-only table.
--   2. merge_patients(...): the only way to merge. Requires merge_patients.
--      Idempotent by p_command_id (command receipts). In one transaction it
--      applies the chosen field values to the kept record, moves the
--      merged-away record's history (child rows) to it, moves a portal
--      sign-in the kept record lacks, marks the merged-away record
--      (merged_into / merged_at / merged_by) and appends the history row.
--   3. Late offline writes: a trigger on every moved child table points a
--      row written for a merged-away patient at the record it now lives on.
--   4. Backfill: merges recorded before this migration are applied.
--
-- Device side: src/services/patientMerge.ts (optimistic local merge plus a
-- queued command in one transaction; a refusal undoes it on the device).
--
-- Idempotent: every statement can be re-run.
--
-- Rollback (in this order):
--   DROP TRIGGER patient_merges_immutable, patient_merges_no_truncate ON public.patient_merges;
--   DROP TRIGGER merge_redirect_patient ON each table in app_merge_child_tables();
--   DROP FUNCTION public.merge_patients(uuid, text, text, jsonb, text, timestamptz, text, text),
--     public.app_merge_reassign_children(text, text),
--     public.tg_redirect_merged_patient(), public.tg_patient_merges_immutable(),
--     public.app_merge_child_tables(), public.app_merge_single_tables(),
--     public.app_merge_excluded_tables();
--   DROP POLICY patient_merges_select_merge_or_audit ON public.patient_merges and
--   recreate the policies of 20260924110100_rls_clinical_core.sql by hand
--   (its app_rls_* helpers were dropped by 20260924110400): SELECT
--   USING app_is_staff(), INSERT WITH CHECK app_has_permission('register').
--   Added columns can stay. Merges already applied are not undone (there is
--   no unmerge yet; patient_merges.kind reserves 'unmerge' for it).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. patient_merges: append-only merge history
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_fk record;
BEGIN
  IF to_regclass('public.patient_merges') IS NULL THEN
    RAISE WARNING 'patient merges: table public.patient_merges does not exist, skipped';
    RETURN;
  END IF;

  ALTER TABLE public.patient_merges
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'merge',
    ADD COLUMN IF NOT EXISTS command_id uuid,
    ADD COLUMN IF NOT EXISTS actor_id uuid,
    -- Device staff user id who asked for the merge.
    ADD COLUMN IF NOT EXISTS requested_by text,
    -- Device clock when the merge was asked for.
    ADD COLUMN IF NOT EXISTS requested_at timestamptz,
    -- Record chosen to keep, before following merge chains (winner_id is
    -- the record actually kept).
    ADD COLUMN IF NOT EXISTS requested_winner_id text,
    -- Values applied to the kept record: {column: {source, value}}.
    ADD COLUMN IF NOT EXISTS field_choices jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS winner_before jsonb,
    ADD COLUMN IF NOT EXISTS loser_before jsonb,
    ADD COLUMN IF NOT EXISTS moved_counts jsonb,
    ADD COLUMN IF NOT EXISTS source text;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.patient_merges'::regclass
                    AND conname = 'patient_merges_kind_check') THEN
    ALTER TABLE public.patient_merges
      ADD CONSTRAINT patient_merges_kind_check CHECK (kind IN ('merge', 'unmerge'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.patient_merges'::regclass
                    AND conname = 'patient_merges_source_check') THEN
    ALTER TABLE public.patient_merges
      ADD CONSTRAINT patient_merges_source_check
      CHECK (source IS NULL OR source IN ('dedupe_modal', 'conflict_review', 'backfill'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.patient_merges'::regclass
                    AND conname = 'patient_merges_command_id_key') THEN
    ALTER TABLE public.patient_merges
      ADD CONSTRAINT patient_merges_command_id_key UNIQUE (command_id);
  END IF;

  -- History outlives the records it names (and an append-only table cannot
  -- take part in ON DELETE CASCADE).
  FOR v_fk IN
    SELECT c.conname
      FROM pg_constraint AS c
     WHERE c.conrelid = 'public.patient_merges'::regclass
       AND c.contype = 'f'
       AND c.confrelid = to_regclass('public.patients')
  LOOP
    EXECUTE format('ALTER TABLE public.patient_merges DROP CONSTRAINT %I', v_fk.conname);
  END LOOP;

  CREATE INDEX IF NOT EXISTS idx_patient_merges_winner_id ON public.patient_merges (winner_id);
  CREATE INDEX IF NOT EXISTS idx_patient_merges_loser_id ON public.patient_merges (loser_id);
END $$;

DO $$
BEGIN
  IF to_regclass('public.patient_merges') IS NOT NULL THEN
    COMMENT ON TABLE public.patient_merges IS
      'Append-only patient merge history. Written only by merge_patients() (and migrations); '
      'never updated or deleted. Readable by merge_patients and audit_access holders.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Which tables a merge moves
-- ----------------------------------------------------------------------------
-- KEEP UP TO DATE when a table with a patient_id column is added: section 7
-- warns about any public table with patient_id that is in none of the lists.

-- Rows that follow the patient to the kept record.
CREATE OR REPLACE FUNCTION public.app_merge_child_tables()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT ARRAY[
    'visits', 'vitals', 'consultations', 'dispenses', 'queue', 'care_tasks',
    'patient_allergies', 'triage_records', 'prescriptions', 'lab_orders',
    'appointments', 'televisits', 'clinical_alerts', 'outbound_messages',
    'medication_reminders', 'waitlist', 'patient_appointment_requests',
    'patient_consent_records', 'patient_documents', 'patient_lab_results',
    'patient_medical_conditions', 'patient_messages', 'patient_notifications',
    'patient_referrals', 'patient_secure_messages', 'patient_submitted_data',
    'care_plans', 'conditions', 'document_references', 'goals',
    'immunizations', 'procedures', 'sdoh_observations', 'service_requests',
    'tickets'
  ]::text[];
$$;

-- At most one row per patient: moved only when the kept record has none
-- (otherwise the merged-away record keeps its own).
CREATE OR REPLACE FUNCTION public.app_merge_single_tables()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT ARRAY[
    'patient_preferences', 'patient_data_sharing_preferences', 'patient_portal_users'
  ]::text[];
$$;

-- Deliberately not moved: history of what happened to the merged-away
-- record (audit trails, access logs, conflict reviews), queue_tickets
-- (handled separately: one ticket per patient, site and day), and tables
-- whose patient_id is not a patients.id (uuid columns).
CREATE OR REPLACE FUNCTION public.app_merge_excluded_tables()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT ARRAY[
    'patient_merges', 'queue_transitions', 'queue_tickets',
    'patient_portal_access_events', 'patient_portal_access_logs',
    'portal_access_backfill_log', 'portal_invitation_events',
    'record_visibility_log', 'tefca_access_logs', 'conflict_resolutions',
    'oauth_authorization_codes', 'fhir_resources', 'command_receipts',
    'consultation_reviews', 'follow_up_schedules', 'patient_flags', 'referrals'
  ]::text[];
$$;

REVOKE ALL ON FUNCTION public.app_merge_child_tables()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_merge_single_tables()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_merge_excluded_tables() FROM PUBLIC, anon, authenticated;

-- Internal: move the merged-away record's rows to the kept record. Returns
-- {table: rows moved}. Tables that do not exist, or whose patient_id is not
-- text, are skipped. Moved rows get a new updated_at so devices download
-- them again (their pull cursors follow updated_at).
CREATE OR REPLACE FUNCTION public.app_merge_reassign_children(p_loser text, p_root text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  t text;
  v_single boolean;
  v_type text;
  v_stamp text;
  v_sql text;
  v_n bigint;
  v_tickets bigint := 0;
  v_counts jsonb := '{}'::jsonb;
  v_ticket record;
  v_root_ticket_id text;
  v_root_label text;
BEGIN
  IF p_loser IS NULL OR p_root IS NULL OR p_loser = p_root THEN
    RETURN v_counts;
  END IF;

  -- Queue tickets: one per patient, site and service day. A ticket the kept
  -- record lacks moves to it; otherwise the kept record's ticket stays and
  -- the merged-away record's queue rows point at it.
  IF to_regclass('public.queue_tickets') IS NOT NULL THEN
    FOR v_ticket IN
      SELECT qt.id, qt.site_key, qt.service_date
        FROM public.queue_tickets AS qt
       WHERE qt.patient_id = p_loser
       ORDER BY qt.id
         FOR UPDATE
    LOOP
      SELECT r.id, r.ticket_number
        INTO v_root_ticket_id, v_root_label
        FROM public.queue_tickets AS r
       WHERE r.site_key = v_ticket.site_key
         AND r.service_date = v_ticket.service_date
         AND r.patient_id = p_root;
      IF v_root_ticket_id IS NULL THEN
        UPDATE public.queue_tickets SET patient_id = p_root WHERE id = v_ticket.id;
        v_tickets := v_tickets + 1;
      ELSIF to_regclass('public.queue') IS NOT NULL THEN
        UPDATE public.queue
           SET ticket_id = v_root_ticket_id,
               ticket_number = v_root_label
         WHERE ticket_id = v_ticket.id;
      END IF;
    END LOOP;
    IF v_tickets > 0 THEN
      v_counts := v_counts || jsonb_build_object('queue_tickets', v_tickets);
    END IF;
  END IF;

  FOR t, v_single IN
    SELECT x, false FROM unnest(public.app_merge_child_tables()) AS x
    UNION ALL
    SELECT x, true FROM unnest(public.app_merge_single_tables()) AS x
  LOOP
    CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;

    SELECT format_type(a.atttypid, a.atttypmod) INTO v_type
      FROM pg_attribute AS a
     WHERE a.attrelid = format('public.%I', t)::regclass
       AND a.attname = 'patient_id' AND a.attnum > 0 AND NOT a.attisdropped;
    CONTINUE WHEN v_type IS NULL
               OR (v_type <> 'text' AND v_type NOT LIKE 'character varying%');

    SELECT CASE WHEN format_type(a.atttypid, a.atttypmod) LIKE 'timestamp%'
                THEN ', updated_at = clock_timestamp()' ELSE '' END
      INTO v_stamp
      FROM pg_attribute AS a
     WHERE a.attrelid = format('public.%I', t)::regclass
       AND a.attname = 'updated_at' AND a.attnum > 0 AND NOT a.attisdropped;

    v_sql := format('UPDATE public.%I AS c SET patient_id = $1%s WHERE c.patient_id = $2',
                    t, COALESCE(v_stamp, ''));
    IF v_single THEN
      v_sql := v_sql || format(
        ' AND NOT EXISTS (SELECT 1 FROM public.%I AS k WHERE k.patient_id = $1)', t);
    END IF;
    EXECUTE v_sql USING p_root, p_loser;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      v_counts := v_counts || jsonb_build_object(t, v_n);
    END IF;
  END LOOP;

  RETURN v_counts;
END;
$$;

REVOKE ALL ON FUNCTION public.app_merge_reassign_children(text, text) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. merge_patients: the only way to merge two patient records
-- ----------------------------------------------------------------------------
-- Parameter names are fixed: the device outbox and its one-off backfill
-- (src/db/migrations/backfillPlans.ts) send p_command_id, p_winner_id,
-- p_loser_id, p_field_choices, p_requested_by, p_requested_at and p_source;
-- the device also sends p_merge_id (its own id for the history row, so the
-- downloaded row replaces the device's pending one).
--
-- Returns jsonb {outcome: applied|rejected, merge_id, winner_id, loser_id,
-- merged_at, already_merged, moved_counts, fields_applied, skipped_fields,
-- reason?}. No patient details are returned or kept in the receipt.
-- Business refusals are RETURNED and recorded (a resend gets the same
-- answer):
--   same_record, invalid_request, cycle (the kept record was merged into the
--   other one), loser_merged_elsewhere.
-- Merging records that are already merged answers "applied" with
-- already_merged = true (every device converges on the same result).
-- Raises only:
--   42501  the caller does not hold merge_patients;
--   PT409  a record is not on the server yet (the device queues the command
--          before it uploads a new record; the outbox retries it).
CREATE OR REPLACE FUNCTION public.merge_patients(
  p_command_id    uuid,
  p_winner_id     text,
  p_loser_id      text,
  p_field_choices jsonb DEFAULT '{}'::jsonb,
  p_requested_by  text DEFAULT NULL,
  p_requested_at  timestamptz DEFAULT NULL,
  p_source        text DEFAULT 'conflict_review',
  p_merge_id      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  c_rpc constant text := 'merge_patients';
  -- Keep in sync with MERGE_FIELD_COLUMNS in src/services/patientMergeRules.ts.
  c_fields constant text[] := ARRAY[
    'given_name', 'family_name', 'sex', 'dob', 'phone', 'email', 'address',
    'state', 'lga', 'photo_url'];
  c_required constant text[] := ARRAY['given_name', 'family_name', 'sex', 'dob'];
  v_prior jsonb;
  v_source text := COALESCE(p_source, 'conflict_review');
  v_root text;
  v_loser_root text;
  v_loser public.patients%ROWTYPE;
  v_root_row public.patients%ROWTYPE;
  v_loser_json jsonb;
  v_root_json jsonb;
  v_existing text;
  v_merge_id text;
  v_key text;
  v_choice jsonb;
  v_value jsonb;
  v_text text;
  v_type text;
  v_choice_source text;
  v_applied jsonb := '{}'::jsonb;
  v_skipped text[] := ARRAY[]::text[];
  v_moved jsonb;
  v_n bigint;
  v_merged_at timestamptz;
  v_portal_moved boolean := false;
  v_result jsonb;
BEGIN
  IF NOT public.app_has_permission('merge_patients') THEN
    RAISE EXCEPTION 'merge_patients permission required' USING ERRCODE = '42501';
  END IF;

  IF p_command_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'missing_command_id');
  END IF;

  v_prior := public.app_command_prior_result(p_command_id, c_rpc);
  IF v_prior IS NOT NULL THEN
    RETURN v_prior;
  END IF;

  IF p_winner_id IS NULL OR p_loser_id IS NULL
     OR v_source NOT IN ('dedupe_modal', 'conflict_review', 'backfill')
     OR (p_field_choices IS NOT NULL AND jsonb_typeof(p_field_choices) <> 'object')
     OR (p_merge_id IS NOT NULL AND char_length(p_merge_id) NOT BETWEEN 1 AND 64) THEN
    RETURN public.app_command_record(
      p_command_id, c_rpc, 'rejected',
      jsonb_build_object('reason', 'invalid_request',
                         'winner_id', p_winner_id, 'loser_id', p_loser_id),
      p_requested_by, p_requested_at);
  END IF;

  IF p_winner_id = p_loser_id THEN
    RETURN public.app_command_record(
      p_command_id, c_rpc, 'rejected',
      jsonb_build_object('reason', 'same_record',
                         'winner_id', p_winner_id, 'loser_id', p_loser_id),
      p_requested_by, p_requested_at);
  END IF;

  -- One merge at a time, so merge chains are read and changed consistently.
  PERFORM pg_advisory_xact_lock(hashtext('mbhr.merge_patients'));

  -- A concurrent resend of the same command waited on the lock above.
  v_prior := public.app_command_prior_result(p_command_id, c_rpc);
  IF v_prior IS NOT NULL THEN
    RETURN v_prior;
  END IF;

  -- Lock both records in id order (no lock-order deadlock between merges
  -- and uploads touching the same pair).
  PERFORM 1
     FROM public.patients AS p
    WHERE p.id::text IN (p_winner_id, p_loser_id)
    ORDER BY p.id::text
      FOR UPDATE;

  SELECT * INTO v_loser FROM public.patients AS p WHERE p.id::text = p_loser_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient_not_on_server' USING ERRCODE = 'PT409';
  END IF;
  PERFORM 1 FROM public.patients AS p WHERE p.id::text = p_winner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient_not_on_server' USING ERRCODE = 'PT409';
  END IF;

  v_root := public.canonical_patient_id(p_winner_id);
  v_loser_root := public.canonical_patient_id(p_loser_id);

  IF v_root = p_loser_id THEN
    RETURN public.app_command_record(
      p_command_id, c_rpc, 'rejected',
      jsonb_build_object('reason', 'cycle',
                         'winner_id', p_winner_id, 'loser_id', p_loser_id),
      p_requested_by, p_requested_at);
  END IF;

  IF v_loser_root = v_root THEN
    -- Already merged (for example by another device): converge.
    SELECT m.id::text INTO v_existing
      FROM public.patient_merges AS m
     WHERE m.loser_id::text = p_loser_id
       AND COALESCE(m.kind, 'merge') = 'merge'
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT 1;
    RETURN public.app_command_record(
      p_command_id, c_rpc, 'applied',
      jsonb_build_object(
        'merge_id', v_existing,
        'winner_id', v_root,
        'loser_id', p_loser_id,
        'merged_at', v_loser.merged_at,
        'already_merged', true,
        'moved_counts', '{}'::jsonb,
        'fields_applied', '[]'::jsonb,
        'skipped_fields', '[]'::jsonb),
      p_requested_by, p_requested_at);
  END IF;

  IF v_loser.merged_into IS NOT NULL THEN
    RETURN public.app_command_record(
      p_command_id, c_rpc, 'rejected',
      jsonb_build_object('reason', 'loser_merged_elsewhere',
                         'winner_id', v_root, 'loser_id', p_loser_id,
                         'canonical_patient_id', v_loser_root),
      p_requested_by, p_requested_at);
  END IF;

  SELECT * INTO v_root_row FROM public.patients AS p WHERE p.id::text = v_root FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'patient_not_on_server' USING ERRCODE = 'PT409';
  END IF;
  v_root_json := to_jsonb(v_root_row);
  v_loser_json := to_jsonb(v_loser);

  -- Chosen values onto the kept record (whitelisted columns only; a value
  -- the column cannot hold is skipped, not fatal). unique_violation is
  -- caught too: patients.email is unique (case-insensitive), and an email
  -- chosen from the merged-away record is still held by that record. An
  -- uncaught 23505 would fail the whole merge, which the device outbox
  -- reads as a refusal (invalid_request) and undoes.
  FOR v_key, v_choice IN
    SELECT e.key, e.value FROM jsonb_each(COALESCE(p_field_choices, '{}'::jsonb)) AS e
  LOOP
    IF NOT (v_key = ANY (c_fields))
       OR jsonb_typeof(v_choice) <> 'object'
       OR NOT (v_choice ? 'value') THEN
      v_skipped := v_skipped || v_key;
      CONTINUE;
    END IF;
    v_value := v_choice -> 'value';
    IF jsonb_typeof(v_value) = 'null' THEN
      IF v_key = ANY (c_required) THEN
        v_skipped := v_skipped || v_key;
        CONTINUE;
      END IF;
      v_text := NULL;
    ELSIF jsonb_typeof(v_value) IN ('string', 'number', 'boolean') THEN
      v_text := v_value #>> '{}';
    ELSE
      v_skipped := v_skipped || v_key;
      CONTINUE;
    END IF;

    SELECT format_type(a.atttypid, a.atttypmod) INTO v_type
      FROM pg_attribute AS a
     WHERE a.attrelid = 'public.patients'::regclass
       AND a.attname = v_key AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_type IS NULL THEN
      v_skipped := v_skipped || v_key;
      CONTINUE;
    END IF;

    v_choice_source := CASE WHEN v_choice ->> 'source' IN ('winner', 'loser', 'custom')
                            THEN v_choice ->> 'source' ELSE 'custom' END;
    BEGIN
      EXECUTE format('UPDATE public.patients SET %I = $1::%s WHERE id::text = $2', v_key, v_type)
        USING v_text, v_root;
      v_applied := v_applied || jsonb_build_object(
        v_key, jsonb_build_object('source', v_choice_source, 'value', v_value));
    EXCEPTION WHEN data_exception OR check_violation OR not_null_violation OR unique_violation THEN
      v_skipped := v_skipped || v_key;
    END;
  END LOOP;

  -- Portal: a sign-in only the merged-away record has moves to the kept
  -- record (auth_uid is unique, so it is cleared on the merged-away record
  -- first). Portal access carries over only when the kept record has no
  -- recorded decision of its own.
  IF (v_loser_json ->> 'auth_uid') IS NOT NULL AND (v_root_json ->> 'auth_uid') IS NULL THEN
    UPDATE public.patients SET auth_uid = NULL WHERE id::text = p_loser_id;
    UPDATE public.patients SET auth_uid = v_loser.auth_uid WHERE id::text = v_root;
    v_portal_moved := true;
  END IF;
  IF COALESCE((v_loser_json ->> 'portal_enabled')::boolean, false)
     AND NOT COALESCE((v_root_json ->> 'portal_enabled')::boolean, false)
     AND (v_root_json ->> 'portal_enabled_changed_at') IS NULL
     AND NOT COALESCE((v_root_json ->> 'portal_opt_out')::boolean, false) THEN
    UPDATE public.patients
       SET portal_enabled = true,
           portal_enabled_changed_at = clock_timestamp(),
           portal_enabled_changed_by = auth.uid()
     WHERE id::text = v_root;
    IF to_regclass('public.patient_portal_access_events') IS NOT NULL THEN
      EXECUTE
        'INSERT INTO public.patient_portal_access_events (command_id, patient_id, enabled, applied, '
        '  outcome, reason, source, actor_id, requested_by, client_recorded_at) '
        'VALUES ($1, $2, true, true, ''applied'', ''merged_record_had_access'', ''merge'', '
        '  auth.uid(), $3, $4)'
        USING p_command_id, v_root, p_requested_by, p_requested_at;
    END IF;
  END IF;

  -- History moves to the kept record.
  v_moved := public.app_merge_reassign_children(p_loser_id, v_root);

  -- Records merged into the merged-away one now point at the kept record
  -- (keeps merge chains short).
  UPDATE public.patients AS p
     SET merged_into = (SELECT r.id FROM public.patients AS r WHERE r.id::text = v_root)
   WHERE p.merged_into::text = p_loser_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    v_moved := v_moved || jsonb_build_object('merged_records', v_n);
  END IF;

  -- Mark the merged-away record. Server-owned columns: written here (as the
  -- function owner the guard trigger lets them through).
  UPDATE public.patients AS p
     SET merged_into = (SELECT r.id FROM public.patients AS r WHERE r.id::text = v_root),
         merged_at = clock_timestamp(),
         merged_by = auth.uid(),
         portal_enabled = false
   WHERE p.id::text = p_loser_id
  RETURNING p.merged_at INTO v_merged_at;

  v_merge_id := COALESCE(NULLIF(p_merge_id, ''), p_command_id::text);
  IF EXISTS (SELECT 1 FROM public.patient_merges AS m WHERE m.id::text = v_merge_id) THEN
    v_merge_id := p_command_id::text;
  END IF;

  INSERT INTO public.patient_merges (
    id, winner_id, loser_id, merged_by, reason, kind, command_id, actor_id,
    requested_by, requested_at, requested_winner_id, field_choices,
    winner_before, loser_before, moved_counts, source)
  VALUES (
    v_merge_id, v_root, p_loser_id,
    COALESCE(p_requested_by, auth.uid()::text, 'unknown'),
    'duplicate_resolution', 'merge', p_command_id, auth.uid(),
    p_requested_by, p_requested_at, p_winner_id, v_applied,
    v_root_json, v_loser_json, v_moved, v_source);

  v_result := jsonb_build_object(
    'merge_id', v_merge_id,
    'winner_id', v_root,
    'loser_id', p_loser_id,
    'merged_at', v_merged_at,
    'already_merged', false,
    'moved_counts', v_moved,
    'fields_applied', to_jsonb(ARRAY(SELECT jsonb_object_keys(v_applied))),
    'skipped_fields', to_jsonb(v_skipped),
    'portal_sign_in_moved', v_portal_moved);

  RETURN public.app_command_record(
    p_command_id, c_rpc, 'applied', v_result, p_requested_by, p_requested_at);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_patients(uuid, text, text, jsonb, text, timestamptz, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_patients(uuid, text, text, jsonb, text, timestamptz, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.merge_patients(uuid, text, text, jsonb, text, timestamptz, text, text) IS
  'Merge two patient records (merge_patients permission). Idempotent by p_command_id. '
  'Moves history to the kept record and appends to patient_merges.';

-- ----------------------------------------------------------------------------
-- 4. Late offline writes land on the kept record
-- ----------------------------------------------------------------------------
-- A device that has not downloaded the merge yet may still upload rows for
-- the merged-away patient; they are pointed at the kept record here and come
-- back to that device at its next download. Named merge_* so it runs before
-- the queue guard (queue_guard_authoritative) and the server stamp (zz_*).
-- Not added to the one-row-per-patient tables (a redirect could collide
-- with the kept record's own row).
--
-- A redirected row also gets the server's clock in updated_at (when the
-- table has a timestamp updated_at): most child tables keep the device's
-- timestamp, so without this the device that uploaded the row (whose pull
-- cursor is already past that time) would never download the corrected
-- patient_id and would keep the row under the merged-away record.
CREATE OR REPLACE FUNCTION public.tg_redirect_merged_patient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_root text;
  v_stamp_type text;
BEGIN
  IF NEW.patient_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_root := public.canonical_patient_id(NEW.patient_id::text);
  IF v_root IS NOT NULL AND v_root <> NEW.patient_id::text THEN
    NEW.patient_id := v_root;
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_stamp_type
      FROM pg_attribute AS a
     WHERE a.attrelid = TG_RELID
       AND a.attname = 'updated_at' AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_stamp_type LIKE 'timestamp%' THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object('updated_at', clock_timestamp()));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_redirect_merged_patient() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
  v_type text;
BEGIN
  FOREACH t IN ARRAY public.app_merge_child_tables() LOOP
    CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_type
      FROM pg_attribute AS a
     WHERE a.attrelid = format('public.%I', t)::regclass
       AND a.attname = 'patient_id' AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_type IS NULL OR (v_type <> 'text' AND v_type NOT LIKE 'character varying%') THEN
      RAISE WARNING 'patient merge: public.%.patient_id is %, redirect trigger skipped', t, v_type;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS merge_redirect_patient ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER merge_redirect_patient BEFORE INSERT OR UPDATE OF patient_id ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.tg_redirect_merged_patient()', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Merges recorded before this migration
-- ----------------------------------------------------------------------------
-- Devices used to insert patient_merges rows without marking the merged-away
-- record or moving its history on the server. Apply them in the order they
-- were made, with the same rules as merge_patients (no merge loops, no
-- second merge of a record). Rows whose records are not on the server are
-- skipped. Devices also resend their own old merges once (source
-- 'backfill'); those answer already_merged.
DO $$
DECLARE
  m record;
  v_loser_merged text;
  v_root text;
BEGIN
  IF to_regclass('public.patient_merges') IS NULL OR to_regclass('public.patients') IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('mbhr.authoritative_write', 'on', true);
  FOR m IN
    SELECT pm.winner_id::text AS winner_id, pm.loser_id::text AS loser_id, pm.created_at
      FROM public.patient_merges AS pm
     WHERE COALESCE(pm.kind, 'merge') = 'merge'
     ORDER BY pm.created_at, pm.id
  LOOP
    CONTINUE WHEN m.winner_id IS NULL OR m.loser_id IS NULL OR m.winner_id = m.loser_id;
    SELECT p.merged_into::text INTO v_loser_merged
      FROM public.patients AS p WHERE p.id::text = m.loser_id;
    CONTINUE WHEN NOT FOUND OR v_loser_merged IS NOT NULL;
    PERFORM 1 FROM public.patients AS p WHERE p.id::text = m.winner_id;
    CONTINUE WHEN NOT FOUND;
    v_root := public.canonical_patient_id(m.winner_id);
    CONTINUE WHEN v_root IS NULL OR v_root = m.loser_id;

    PERFORM public.app_merge_reassign_children(m.loser_id, v_root);
    UPDATE public.patients AS p
       SET merged_into = (SELECT r.id FROM public.patients AS r WHERE r.id::text = v_root)
     WHERE p.merged_into::text = m.loser_id;
    UPDATE public.patients AS p
       SET merged_into = (SELECT r.id FROM public.patients AS r WHERE r.id::text = v_root),
           merged_at = COALESCE(m.created_at, now())
     WHERE p.id::text = m.loser_id;
  END LOOP;
  PERFORM set_config('mbhr.authoritative_write', 'off', true);
END $$;

-- ----------------------------------------------------------------------------
-- 6. Access: read by merge_patients / audit_access holders; never changed
-- ----------------------------------------------------------------------------
-- The history holds snapshots of both records (patient details), so it is
-- narrower than "all staff". Devices of other staff still converge: the
-- merge itself reaches them through patients.merged_into and the moved rows.
--
-- Written out here: the migration-only helpers app_rls_reset() and
-- app_rls_policy() are dropped at the end of
-- 20260924110400_rls_verify_phi_lockdown.sql, so calling them from this
-- migration would fail (and abort the whole migration).
DO $$
DECLARE
  v_policy record;
BEGIN
  IF to_regclass('public.patient_merges') IS NULL THEN
    RETURN;
  END IF;
  -- Every earlier policy goes (patient_merges_select_staff,
  -- patient_merges_insert_register and any legacy ones).
  FOR v_policy IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'patient_merges'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.patient_merges', v_policy.policyname);
  END LOOP;
  ALTER TABLE public.patient_merges ENABLE ROW LEVEL SECURITY;
  CREATE POLICY patient_merges_select_merge_or_audit
    ON public.patient_merges FOR SELECT TO authenticated
    USING ((SELECT public.app_has_any_permission(ARRAY['merge_patients', 'audit_access'])));
  -- No INSERT / UPDATE / DELETE policy: only merge_patients() writes it.
  REVOKE ALL ON public.patient_merges FROM PUBLIC, anon;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.patient_merges FROM authenticated;
  GRANT SELECT ON public.patient_merges TO authenticated;
  GRANT SELECT ON public.patient_merges TO service_role;
END $$;

CREATE OR REPLACE FUNCTION public.tg_patient_merges_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Patient merge history cannot be changed or deleted'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.tg_patient_merges_immutable() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.patient_merges') IS NULL THEN
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS patient_merges_immutable ON public.patient_merges;
  CREATE TRIGGER patient_merges_immutable
    BEFORE UPDATE OR DELETE ON public.patient_merges
    FOR EACH ROW EXECUTE FUNCTION public.tg_patient_merges_immutable();
  DROP TRIGGER IF EXISTS patient_merges_no_truncate ON public.patient_merges;
  CREATE TRIGGER patient_merges_no_truncate
    BEFORE TRUNCATE ON public.patient_merges
    FOR EACH STATEMENT EXECUTE FUNCTION public.tg_patient_merges_immutable();
END $$;

-- ----------------------------------------------------------------------------
-- 7. Coverage check: every table with patient_id is in one of the lists
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_attribute AS a
      JOIN pg_class AS c ON c.oid = a.attrelid
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND a.attname = 'patient_id' AND a.attnum > 0 AND NOT a.attisdropped
       AND NOT (c.relname::text = ANY (
             public.app_merge_child_tables()
             || public.app_merge_single_tables()
             || public.app_merge_excluded_tables()))
     ORDER BY c.relname
  LOOP
    RAISE WARNING 'patient merge: public.% has patient_id but is in no merge list (app_merge_child_tables, app_merge_single_tables or app_merge_excluded_tables); decide whether a merge moves its rows', r.relname;
  END LOOP;
END $$;

-- End of migration.
