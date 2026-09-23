-- ============================================================================
-- Sync authority foundation (Wave B, work package 0)
-- ============================================================================
-- Runs after the 20260924* row-level security migrations and builds on their
-- helpers (public.app_has_permission / public.app_role_has_permission). It
-- adds only what every later package needs, so the portal-access, queue
-- ticket, patient-merge, pharmacy-ledger and lab-release migrations do not
-- depend on each other:
--
--   1. The permission matrix gains four keys (mirrored in src/auth/roles.ts,
--      checked by src/auth/roleMatrixParity.test.ts):
--        queue          = station staff who move patients through the queue:
--                         volunteer, nurse, doctor, lead_clinician, admin and
--                         pharmacist (the same list as the queue_transitions
--                         insert rule and app_is_station_staff()).
--        portal_manage  = 'register' holders (they enable portal access at
--                         registration today).
--        merge_patients = 'resolve_conflicts' holders.
--        lab_release    = 'lab_review' holders.
--   2. Server clock and row versions: a trigger stamps updated_at with
--      clock_timestamp() (distinct per row, unlike now()) and bumps
--      row_version on every write to patients, queue, prescriptions,
--      pharmacy_items and pharmacy_batches. Devices compare row_version
--      instead of device clocks to detect edit conflicts, and pull cursors
--      no longer skip rows uploaded late with an old device timestamp.
--      patient_merges gets a server-stamped updated_at so devices can pull
--      the merge history.
--   3. command_receipts: idempotency receipts for command RPCs, written only
--      by SECURITY DEFINER functions through two internal helpers.
--   4. Server-owned patient columns (merged_*, portal_enabled_changed_*),
--      protected by a guard trigger, plus canonical_patient_id().
--   5. app_portal_patient_ids() also excludes merged-away records.
--   6. queue columns the device sync map sends (ticket, site, service day,
--      assignee), so uploads do not fail on unknown columns.
--
-- Idempotent: every statement can be re-run.
--
-- Rollback (in this order):
--   DROP TRIGGER zz_server_stamp ON each table listed in section 2;
--   DROP TRIGGER patients_guard_authoritative ON public.patients;
--   DROP FUNCTION public.tg_server_stamp(), public.tg_server_stamp_time(),
--     public.tg_patients_guard_authoritative(), public.canonical_patient_id(text),
--     public.app_command_prior_result(uuid, text),
--     public.app_command_record(uuid, text, text, jsonb, text, timestamptz);
--   DROP TABLE public.command_receipts;
--   re-run section 1 of 20260924110000 (matrix without the new keys) and
--   the app_portal_patient_ids() definition from the same file.
--   The added columns can stay (nothing reads them without this migration).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Permission matrix (KEEP IN SYNC with ROLE_PERMISSIONS in src/auth/roles.ts)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_role_has_permission(
  p_role text,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    CASE p_role
      WHEN 'admin' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'consult', 'dispense', 'inventory', 'export',
        'users', 'approve_phi_conflicts', 'audit_access', 'resolve_conflicts',
        'lab_review', 'queue', 'portal_manage', 'merge_patients',
        'lab_release'])
      WHEN 'doctor' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'consult', 'resolve_conflicts', 'lab_review',
        'queue', 'portal_manage', 'merge_patients', 'lab_release'])
      WHEN 'nurse' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'resolve_conflicts', 'queue', 'portal_manage',
        'merge_patients'])
      WHEN 'volunteer' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'queue', 'portal_manage'])
      WHEN 'pharmacist' THEN p_permission = ANY (ARRAY[
        'dispense', 'inventory', 'queue'])
      WHEN 'auditor' THEN p_permission = ANY (ARRAY[
        'export', 'approve_phi_conflicts', 'audit_access', 'resolve_conflicts',
        'merge_patients'])
      WHEN 'lead_clinician' THEN p_permission = ANY (ARRAY[
        'register', 'vitals', 'consult', 'export', 'approve_phi_conflicts',
        'audit_access', 'resolve_conflicts', 'lab_review', 'queue',
        'portal_manage', 'merge_patients', 'lab_release'])
      -- 'guest', legacy 'chw', unknown roles and NULL: no permissions.
      ELSE false
    END,
    false
  );
$$;

COMMENT ON FUNCTION public.app_role_has_permission(text, text) IS
  'Server copy of ROLE_PERMISSIONS in src/auth/roles.ts. Change both together '
  '(src/auth/roleMatrixParity.test.ts compares them). See docs/security/RLS_MATRIX.md.';

-- ----------------------------------------------------------------------------
-- 2. Server clock and row versions
-- ----------------------------------------------------------------------------
-- updated_at is always the server's clock_timestamp() (never the device
-- clock sent in the upload). row_version starts at 1 and goes up by one on
-- every UPDATE, including the UPDATE half of an upsert.
CREATE OR REPLACE FUNCTION public.tg_server_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  IF TG_OP = 'INSERT' THEN
    NEW.row_version := 1;
  ELSE
    NEW.row_version := COALESCE(OLD.row_version, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;

-- For tables without a row_version (append-only history such as
-- patient_merges): server clock only.
CREATE OR REPLACE FUNCTION public.tg_server_stamp_time()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_server_stamp()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_server_stamp_time() FROM PUBLIC, anon, authenticated;

-- The trigger is named zz_* so it runs after every other BEFORE trigger on
-- the table (PostgreSQL fires them in name order) and has the last word on
-- updated_at.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patients', 'queue', 'prescriptions', 'pharmacy_items', 'pharmacy_batches'
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE WARNING 'sync foundation: table public.% does not exist, skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS row_version bigint NOT NULL DEFAULT 1', t);
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS zz_server_stamp ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER zz_server_stamp BEFORE INSERT OR UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.tg_server_stamp()', t);
  END LOOP;
END $$;

-- patient_merges: a pull cursor needs a distinct, server-set updated_at.
-- Existing rows get their created_at, nudged by a microsecond per row so
-- equal creation times do not tie at a page boundary.
DO $$
BEGIN
  IF to_regclass('public.patient_merges') IS NULL THEN
    RAISE WARNING 'sync foundation: table public.patient_merges does not exist, skipped';
    RETURN;
  END IF;
  ALTER TABLE public.patient_merges ADD COLUMN IF NOT EXISTS updated_at timestamptz;
  WITH ordered AS (
    SELECT id,
           COALESCE(created_at, now())
             + (row_number() OVER (ORDER BY created_at, id)) * interval '1 microsecond' AS ts
      FROM public.patient_merges
     WHERE updated_at IS NULL
  )
  UPDATE public.patient_merges AS m
     SET updated_at = o.ts
    FROM ordered AS o
   WHERE m.id = o.id;
  ALTER TABLE public.patient_merges ALTER COLUMN updated_at SET DEFAULT now();
  ALTER TABLE public.patient_merges ALTER COLUMN updated_at SET NOT NULL;
  DROP TRIGGER IF EXISTS zz_server_stamp ON public.patient_merges;
  CREATE TRIGGER zz_server_stamp BEFORE INSERT ON public.patient_merges
    FOR EACH ROW EXECUTE FUNCTION public.tg_server_stamp_time();
  CREATE INDEX IF NOT EXISTS idx_patient_merges_updated_at
    ON public.patient_merges (updated_at);
END $$;

-- ----------------------------------------------------------------------------
-- 3. Command receipts (idempotency for every command RPC)
-- ----------------------------------------------------------------------------
-- A device sends each server-authoritative action (portal access change,
-- merge, dispense, ...) as an RPC call with a client UUID (command_id). The
-- RPC records its outcome here; a resend of the same command_id returns the
-- stored result instead of applying twice.
--
-- Business rejections must be RETURNED ({"outcome": "rejected", "reason":
-- "..."}) so they are recorded and stay idempotent. RAISE only for
-- permission (ERRCODE 42501): a raise rolls back the receipt too.
CREATE TABLE IF NOT EXISTS public.command_receipts (
  command_id   uuid PRIMARY KEY,
  rpc          text NOT NULL,
  actor_id     uuid NOT NULL DEFAULT auth.uid(),
  requested_by text,           -- device user id that authored the command
  requested_at timestamptz,    -- device clock when it was authored
  outcome      text NOT NULL CHECK (outcome IN ('applied', 'rejected')),
  result       jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_command_receipts_actor_created
  ON public.command_receipts (actor_id, created_at);

COMMENT ON TABLE public.command_receipts IS
  'Outcome of each command RPC by client command_id (idempotency). Written only by SECURITY DEFINER RPCs.';

ALTER TABLE public.command_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.command_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.command_receipts TO authenticated;
GRANT ALL ON public.command_receipts TO service_role;

DROP POLICY IF EXISTS command_receipts_select_own ON public.command_receipts;
CREATE POLICY command_receipts_select_own
  ON public.command_receipts FOR SELECT TO authenticated
  USING (
    actor_id = (SELECT auth.uid())
    OR (SELECT public.app_has_permission('audit_access'))
  );
-- No INSERT / UPDATE / DELETE policy: only the helpers below write it.

-- The stored result for a command already processed, or NULL. A command id
-- reused for a different RPC is answered with a rejection, never applied.
CREATE OR REPLACE FUNCTION public.app_command_prior_result(
  p_command_id uuid,
  p_rpc text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
           WHEN r.rpc = p_rpc THEN r.result
           ELSE jsonb_build_object('outcome', 'rejected', 'reason', 'command_id_reused')
         END
    FROM public.command_receipts AS r
   WHERE r.command_id = p_command_id;
$$;

-- Record a command's outcome and return the result as stored (with its
-- "outcome" key set). A concurrent duplicate keeps the first receipt.
CREATE OR REPLACE FUNCTION public.app_command_record(
  p_command_id uuid,
  p_rpc text,
  p_outcome text,
  p_result jsonb,
  p_requested_by text DEFAULT NULL,
  p_requested_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_result jsonb := COALESCE(p_result, '{}'::jsonb)
                    || jsonb_build_object('outcome', p_outcome);
  v_stored jsonb;
BEGIN
  INSERT INTO public.command_receipts (
    command_id, rpc, requested_by, requested_at, outcome, result)
  VALUES (p_command_id, p_rpc, p_requested_by, p_requested_at, p_outcome, v_result)
  ON CONFLICT (command_id) DO NOTHING
  RETURNING result INTO v_stored;
  IF v_stored IS NULL THEN
    v_stored := public.app_command_prior_result(p_command_id, p_rpc);
  END IF;
  RETURN v_stored;
END;
$$;

-- Internal: called from other SECURITY DEFINER functions only.
REVOKE ALL ON FUNCTION public.app_command_prior_result(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_command_record(uuid, text, text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_command_prior_result(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_command_record(uuid, text, text, jsonb, text, timestamptz)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Server-owned patient columns
-- ----------------------------------------------------------------------------
-- merged_into takes the type of patients.id (text in the migrations; kept
-- generic because column types drifted between migrations and production).
-- ON DELETE SET NULL: deleting a surviving record (staff can delete a
-- patient from the patient page) must not be blocked by the records merged
-- into it. The referential action runs as the table owner, so the guard
-- trigger below does not undo it.
DO $$
DECLARE
  v_id_type text;
BEGIN
  IF to_regclass('public.patients') IS NULL THEN
    RAISE WARNING 'sync foundation: table public.patients does not exist, skipped';
    RETURN;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_id_type
    FROM pg_attribute AS a
   WHERE a.attrelid = 'public.patients'::regclass
     AND a.attname = 'id'
     AND NOT a.attisdropped;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'patients'
       AND column_name = 'merged_into'
  ) THEN
    EXECUTE format(
      'ALTER TABLE public.patients ADD COLUMN merged_into %s '
      'REFERENCES public.patients(id) ON DELETE SET NULL',
      v_id_type);
  END IF;

  ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS merged_at timestamptz,
    ADD COLUMN IF NOT EXISTS merged_by uuid,
    ADD COLUMN IF NOT EXISTS portal_enabled_changed_at timestamptz,
    ADD COLUMN IF NOT EXISTS portal_enabled_changed_by uuid;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.patients'::regclass
       AND conname = 'patients_not_self_merged'
  ) THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_not_self_merged
      CHECK (merged_into IS NULL OR merged_into <> id);
  END IF;

  CREATE INDEX IF NOT EXISTS idx_patients_merged_into
    ON public.patients (merged_into) WHERE merged_into IS NOT NULL;
END $$;

-- Only server-side code (the portal-access and merge RPCs, migrations) may
-- set these columns. A client write keeps the stored values silently, so an
-- upload that carries an old copy of the row cannot undo a merge or a
-- portal decision. Callers other than the API roles (SECURITY DEFINER
-- functions, service_role, migrations) are not restricted; code that runs
-- as the caller can opt in with set_config('mbhr.authoritative_write', 'on', true).
--
-- The portal-access package extends this function (CREATE OR REPLACE) to
-- also protect portal_enabled and auth_uid; keep the columns below in it.
CREATE OR REPLACE FUNCTION public.tg_patients_guard_authoritative()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon')
     OR current_setting('mbhr.authoritative_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.merged_into := NULL;
    NEW.merged_at := NULL;
    NEW.merged_by := NULL;
    NEW.portal_enabled_changed_at := NULL;
    NEW.portal_enabled_changed_by := NULL;
  ELSE
    NEW.merged_into := OLD.merged_into;
    NEW.merged_at := OLD.merged_at;
    NEW.merged_by := OLD.merged_by;
    NEW.portal_enabled_changed_at := OLD.portal_enabled_changed_at;
    NEW.portal_enabled_changed_by := OLD.portal_enabled_changed_by;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_patients_guard_authoritative() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.patients') IS NULL THEN
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS patients_guard_authoritative ON public.patients;
  CREATE TRIGGER patients_guard_authoritative
    BEFORE INSERT OR UPDATE ON public.patients
    FOR EACH ROW EXECUTE FUNCTION public.tg_patients_guard_authoritative();
END $$;

-- The record a patient id now lives on: follows merged_into (at most 10
-- steps, so a damaged chain cannot loop). Unknown ids come back unchanged.
CREATE OR REPLACE FUNCTION public.canonical_patient_id(p_id text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_cur text := p_id;
  v_next text;
  i integer := 0;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;
  LOOP
    SELECT p.merged_into::text INTO v_next
      FROM public.patients AS p
     WHERE p.id::text = v_cur;
    EXIT WHEN v_next IS NULL OR i >= 10;
    v_cur := v_next;
    i := i + 1;
  END LOOP;
  RETURN v_cur;
END;
$$;

REVOKE ALL ON FUNCTION public.canonical_patient_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canonical_patient_id(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Portal patients: never a merged-away record
-- ----------------------------------------------------------------------------
-- Same as 20260924110000 plus "merged_into IS NULL": after a merge the
-- portal (and every policy built on this helper) sees the surviving record
-- only. Use this helper; there is no separate portal_patient_ids().
CREATE OR REPLACE FUNCTION public.app_portal_patient_ids()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT p.id::text
    FROM public.patients AS p
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND p.auth_uid::text = (SELECT auth.uid())::text
     AND COALESCE(p.portal_enabled, false)
     AND p.merged_into IS NULL
  UNION
  SELECT ppu.patient_id::text
    FROM public.patient_portal_users AS ppu
    JOIN public.patients AS p ON p.id::text = ppu.patient_id::text
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND COALESCE(ppu.account_status, 'active') = 'active'
     AND COALESCE(p.portal_enabled, false)
     AND p.merged_into IS NULL
     AND (
          ppu.id::text = (SELECT auth.uid())::text
       OR ppu.id::text = (SELECT public.current_portal_user_id())
       OR (
            ppu.phone_number IS NOT NULL
        AND ppu.phone_number = NULLIF((SELECT auth.jwt()) ->> 'phone', '')
       )
     );
$$;

-- ----------------------------------------------------------------------------
-- 6. queue columns sent by the device sync (src/sync/adapter.ts mapToDB.queue)
-- ----------------------------------------------------------------------------
-- ticket_id gets its foreign key to queue_tickets in the queue-ticket
-- package, which creates that table.
DO $$
BEGIN
  IF to_regclass('public.queue') IS NULL THEN
    RAISE WARNING 'sync foundation: table public.queue does not exist, skipped';
    RETURN;
  END IF;
  ALTER TABLE public.queue
    ADD COLUMN IF NOT EXISTS priority text,
    ADD COLUMN IF NOT EXISTS created_by text,
    ADD COLUMN IF NOT EXISTS queued_at timestamptz,
    ADD COLUMN IF NOT EXISTS ticket_id text,
    ADD COLUMN IF NOT EXISTS ticket_number text,
    ADD COLUMN IF NOT EXISTS site_key text,
    ADD COLUMN IF NOT EXISTS service_date date,
    ADD COLUMN IF NOT EXISTS assigned_to text,
    ADD COLUMN IF NOT EXISTS assigned_name text,
    ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
  CREATE INDEX IF NOT EXISTS idx_queue_site_day_stage
    ON public.queue (site_key, service_date, stage, status);
END $$;

-- End of migration.
