-- ============================================================================
-- Lab results: review and release to the patient portal (Wave B, work package 5)
-- ============================================================================
-- Runs after 20260925100000_sync_authority_foundation.sql (lab_release
-- permission, app_portal_patient_ids() that excludes merged-away records)
-- and the 20260924* row-level security migrations (app_has_permission,
-- app_is_staff, the lab_orders / lab_results policies and the
-- app_guard_lab_result_values trigger).
--
-- Owner decision: the results staff enter and the results a patient sees
-- are the SAME records (lab_orders / lab_results). A result reaches the
-- patient portal only after two explicit steps:
--   reviewed  (reviewed_at / reviewed_by, 'lab_review' holders), then
--   released  (released_to_patient_at / released_to_patient_by,
--              'lab_release' holders: doctor, lead_clinician, admin).
-- A 'lab_release' holder may instead withhold a result from the portal, with
-- a reason (withheld_at / withheld_by / withheld_reason).
--
--   1. New columns and checks on lab_results. interpretation loses its
--      DEFAULT 'normal': a writer that leaves it out is refused instead of
--      filing the result as normal.
--   2. Guard trigger: release / withhold columns change only inside the
--      release RPCs; changing a reviewed result's value or interpretation
--      clears its review and release (it must be reviewed again); a review
--      made by a direct API update is credited to the caller, not to an id
--      the device sent.
--   3. RPCs: lab_review_result, lab_release_result, lab_withhold_result
--      (staff) and portal_my_lab_results (the ONLY patient read path).
--   4. lab_result_release_log: append-only server history of review,
--      release and withhold decisions.
--   5. Policies: portal patients can no longer SELECT lab_orders or
--      lab_results directly (before this, a reviewed but unreleased result,
--      including a critical one, was readable by the patient). The unused
--      patient_lab_results table is no longer readable by portal patients.
--
-- Backfill: none. Results already reviewed are NOT released automatically;
-- releasing old results is a clinical decision for the owner (call
-- lab_release_result per result).
--
-- patient_lab_results is kept (not renamed): nothing writes it, but
-- app_merge_child_tables() in 20260925100300 lists it. Export and review
-- any rows it holds before dropping it in a later migration.
--
-- Idempotent: every statement can be re-run.
--
-- Rollback (in this order):
--   DROP FUNCTION public.portal_my_lab_results(integer, text),
--     public.lab_withhold_result(uuid, text),
--     public.lab_release_result(uuid, text),
--     public.lab_review_result(uuid, boolean, text),
--     public.app_lab_release_apply(uuid, text),
--     public.app_lab_result_state(uuid), public.app_lab_release_log(uuid, text, text);
--   DROP TRIGGER lab_results_release_guard ON public.lab_results;
--   DROP FUNCTION public.tg_lab_results_release_guard();
--   DROP TABLE public.lab_result_release_log;
--   re-create lab_orders_select / lab_results_select / patient_lab_results_select
--   from 20260924110100 and 20260924110300 (portal read branches).
--   ALTER TABLE public.lab_results ALTER COLUMN interpretation SET DEFAULT 'normal'
--   is NOT recommended (it is the unsafe default this migration removes).
--   Added columns can stay.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns and checks
-- ----------------------------------------------------------------------------
-- Staff ids are text, like reviewed_by (app_users.id). No foreign keys on the
-- new *_by columns: the release pair check below must not be broken by an
-- ON DELETE SET NULL when a staff row is removed.
ALTER TABLE public.lab_results
  ADD COLUMN IF NOT EXISTS entered_by text DEFAULT (auth.uid())::text,
  ADD COLUMN IF NOT EXISTS released_to_patient_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_to_patient_by text,
  ADD COLUMN IF NOT EXISTS patient_note text,
  ADD COLUMN IF NOT EXISTS withheld_at timestamptz,
  ADD COLUMN IF NOT EXISTS withheld_by text,
  ADD COLUMN IF NOT EXISTS withheld_reason text,
  ADD COLUMN IF NOT EXISTS amended_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid
    REFERENCES public.lab_results(id) ON DELETE SET NULL;

-- An omitted interpretation must never be filed as "normal".
ALTER TABLE public.lab_results ALTER COLUMN interpretation DROP DEFAULT;

DO $$
DECLARE
  v_nulls bigint;
BEGIN
  SELECT count(*) INTO v_nulls FROM public.lab_results WHERE interpretation IS NULL;
  IF v_nulls = 0 THEN
    ALTER TABLE public.lab_results ALTER COLUMN interpretation SET NOT NULL;
  ELSE
    -- Do not guess a value for old rows. They stay NULL (shown to staff as
    -- "interpretation missing, check result") and the app and the RPCs
    -- below require a value for every new write.
    RAISE WARNING 'lab_results: % row(s) have no interpretation; NOT NULL not added. Review them.', v_nulls;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'lab_results_release_requires_review'
                    AND conrelid = 'public.lab_results'::regclass) THEN
    ALTER TABLE public.lab_results
      ADD CONSTRAINT lab_results_release_requires_review
      CHECK (released_to_patient_at IS NULL OR reviewed_at IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'lab_results_release_pair'
                    AND conrelid = 'public.lab_results'::regclass) THEN
    ALTER TABLE public.lab_results
      ADD CONSTRAINT lab_results_release_pair
      CHECK ((released_to_patient_at IS NULL) = (released_to_patient_by IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'lab_results_release_or_withheld'
                    AND conrelid = 'public.lab_results'::regclass) THEN
    ALTER TABLE public.lab_results
      ADD CONSTRAINT lab_results_release_or_withheld
      CHECK (released_to_patient_at IS NULL OR withheld_at IS NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'lab_results_withheld_reason'
                    AND conrelid = 'public.lab_results'::regclass) THEN
    ALTER TABLE public.lab_results
      ADD CONSTRAINT lab_results_withheld_reason
      CHECK (withheld_at IS NULL
             OR (withheld_reason IS NOT NULL AND length(btrim(withheld_reason)) > 0));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'lab_results_text_lengths'
                    AND conrelid = 'public.lab_results'::regclass) THEN
    ALTER TABLE public.lab_results
      ADD CONSTRAINT lab_results_text_lengths
      CHECK (length(COALESCE(patient_note, '')) <= 1000
             AND length(COALESCE(withheld_reason, '')) <= 500);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'lab_results_not_self_superseded'
                    AND conrelid = 'public.lab_results'::regclass) THEN
    ALTER TABLE public.lab_results
      ADD CONSTRAINT lab_results_not_self_superseded
      CHECK (superseded_by IS NULL OR superseded_by <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lab_results_unreviewed
  ON public.lab_results (result_date) WHERE reviewed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lab_results_released
  ON public.lab_results (order_id) WHERE released_to_patient_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lab_results_superseded_by
  ON public.lab_results (superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lab_orders_patient_id
  ON public.lab_orders (patient_id);

COMMENT ON COLUMN public.lab_results.released_to_patient_at IS
  'When a lab_release holder released this reviewed result to the patient portal. Set only by lab_release_result().';
COMMENT ON COLUMN public.lab_results.withheld_reason IS
  'Why a lab_release holder kept this result off the patient portal. Set only by lab_withhold_result().';
COMMENT ON COLUMN public.lab_results.patient_note IS
  'Plain-language note shown to the patient with a released result. Set only by the release RPCs.';

-- ----------------------------------------------------------------------------
-- 2. Guard trigger
-- ----------------------------------------------------------------------------
-- The release RPCs turn on the transaction-local setting mbhr.lab_release;
-- every other write keeps the release / withhold / patient-note columns as
-- they were (INSERT: empty). Runs for every caller, service_role included:
-- a backfill that releases results must set the flag deliberately.
CREATE OR REPLACE FUNCTION public.tg_lab_results_release_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_release_ok boolean :=
    COALESCE(current_setting('mbhr.lab_release', true), '') = 'on';
  v_api_caller boolean := current_user IN ('authenticated', 'anon');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_release_ok THEN
      NEW.released_to_patient_at := NULL;
      NEW.released_to_patient_by := NULL;
      NEW.withheld_at := NULL;
      NEW.withheld_by := NULL;
      NEW.withheld_reason := NULL;
      NEW.patient_note := NULL;
    END IF;
    IF v_api_caller THEN
      NEW.entered_by := (SELECT auth.uid())::text;
      NEW.amended_at := NULL;
      IF NEW.reviewed_at IS NOT NULL THEN
        -- Only lab_review holders get here (insert policy); credit the caller.
        -- (No ::text: reviewed_by is uuid on production; assignment casts
        -- auth.uid() to either uuid or text.)
        NEW.reviewed_by := (SELECT auth.uid());
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NOT v_release_ok THEN
    NEW.released_to_patient_at := OLD.released_to_patient_at;
    NEW.released_to_patient_by := OLD.released_to_patient_by;
    NEW.withheld_at := OLD.withheld_at;
    NEW.withheld_by := OLD.withheld_by;
    NEW.withheld_reason := OLD.withheld_reason;
    NEW.patient_note := OLD.patient_note;
  END IF;

  IF v_api_caller THEN
    NEW.entered_by := OLD.entered_by;
    NEW.amended_at := OLD.amended_at;
    -- A review made by a direct update (older app versions) is credited to
    -- the signed-in caller and stamped with the server clock.
    IF NEW.reviewed_at IS NOT NULL AND OLD.reviewed_at IS NULL THEN
      NEW.reviewed_at := clock_timestamp();
      NEW.reviewed_by := (SELECT auth.uid());  -- no ::text: uuid on production
    ELSIF NEW.reviewed_at IS NOT NULL THEN
      NEW.reviewed_at := OLD.reviewed_at;
      NEW.reviewed_by := OLD.reviewed_by;
    END IF;
  END IF;

  -- A reviewed result whose recorded value or interpretation changes must be
  -- reviewed (and released) again.
  IF (NEW.result_value, NEW.result_unit, NEW.reference_range, NEW.interpretation)
     IS DISTINCT FROM
     (OLD.result_value, OLD.result_unit, OLD.reference_range, OLD.interpretation) THEN
    NEW.amended_at := clock_timestamp();
    IF OLD.reviewed_at IS NOT NULL THEN
      NEW.reviewed_at := NULL;
      NEW.reviewed_by := NULL;
    END IF;
    NEW.released_to_patient_at := NULL;
    NEW.released_to_patient_by := NULL;
  END IF;

  -- Never released without a review (the check constraint would refuse it;
  -- clearing a review therefore also takes the result off the portal).
  IF NEW.reviewed_at IS NULL THEN
    NEW.released_to_patient_at := NULL;
    NEW.released_to_patient_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lab_results_release_guard ON public.lab_results;
CREATE TRIGGER lab_results_release_guard
  BEFORE INSERT OR UPDATE ON public.lab_results
  FOR EACH ROW EXECUTE FUNCTION public.tg_lab_results_release_guard();

-- ----------------------------------------------------------------------------
-- 3. Release history (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lab_result_release_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id  uuid NOT NULL REFERENCES public.lab_results(id) ON DELETE CASCADE,
  action     text NOT NULL CHECK (action IN ('reviewed', 'released', 'withheld')),
  actor_id   text,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_lab_result_release_log_result
  ON public.lab_result_release_log (result_id, created_at);

ALTER TABLE public.lab_result_release_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_result_release_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lab_result_release_log TO authenticated;
GRANT ALL ON public.lab_result_release_log TO service_role;

DROP POLICY IF EXISTS lab_result_release_log_select ON public.lab_result_release_log;
CREATE POLICY lab_result_release_log_select
  ON public.lab_result_release_log FOR SELECT TO authenticated
  USING (
    (SELECT public.app_has_permission('lab_review'))
    OR (SELECT public.app_has_permission('audit_access'))
  );
-- No INSERT / UPDATE / DELETE policy: only the RPCs below write it.

CREATE OR REPLACE FUNCTION public.app_lab_release_log(
  p_result_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  INSERT INTO public.lab_result_release_log (result_id, action, actor_id, reason)
  VALUES (p_result_id, p_action, (SELECT auth.uid())::text, p_reason);
$$;

-- The review / release state of one result, as the RPCs return it.
CREATE OR REPLACE FUNCTION public.app_lab_result_state(p_result_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
           'result_id', r.id,
           'reviewed_at', r.reviewed_at,
           'reviewed_by', r.reviewed_by,
           'released_to_patient_at', r.released_to_patient_at,
           'released_to_patient_by', r.released_to_patient_by,
           'withheld_at', r.withheld_at,
           'withheld_by', r.withheld_by,
           'withheld_reason', r.withheld_reason,
           'patient_note', r.patient_note)
    FROM public.lab_results AS r
   WHERE r.id = p_result_id;
$$;

REVOKE ALL ON FUNCTION public.app_lab_release_log(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_lab_result_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_lab_release_log(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_lab_result_state(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Staff RPCs
-- ----------------------------------------------------------------------------
-- Business refusals are RETURNED as {"outcome": "rejected", "reason": ...};
-- a missing permission RAISEs 42501. Success returns {"outcome": "applied"}
-- plus the result's review / release state.

-- Release (internal body shared by lab_release_result and lab_review_result).
CREATE OR REPLACE FUNCTION public.app_lab_release_apply(
  p_result_id uuid,
  p_patient_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  r public.lab_results%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_patient_note, '')), '');
BEGIN
  SELECT * INTO r FROM public.lab_results WHERE id = p_result_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'not_found');
  END IF;
  IF r.reviewed_at IS NULL THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'not_reviewed');
  END IF;
  IF r.superseded_by IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'superseded');
  END IF;
  IF r.interpretation IS NULL THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'no_interpretation');
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'note_too_long');
  END IF;

  -- Already released and nothing new to say: idempotent success.
  IF r.released_to_patient_at IS NOT NULL
     AND (v_note IS NULL OR v_note IS NOT DISTINCT FROM r.patient_note) THEN
    RETURN public.app_lab_result_state(p_result_id)
           || jsonb_build_object('outcome', 'applied', 'already_released', true);
  END IF;

  PERFORM set_config('mbhr.lab_release', 'on', true);
  UPDATE public.lab_results
     SET released_to_patient_at = COALESCE(released_to_patient_at, clock_timestamp()),
         released_to_patient_by = COALESCE(released_to_patient_by, (SELECT auth.uid())::text),
         patient_note = COALESCE(v_note, patient_note),
         withheld_at = NULL,
         withheld_by = NULL,
         withheld_reason = NULL
   WHERE id = p_result_id;
  PERFORM set_config('mbhr.lab_release', 'off', true);

  PERFORM public.app_lab_release_log(p_result_id, 'released', NULL);
  RETURN public.app_lab_result_state(p_result_id)
         || jsonb_build_object('outcome', 'applied', 'already_released', false);
END;
$$;

REVOKE ALL ON FUNCTION public.app_lab_release_apply(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_lab_release_apply(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.lab_review_result(
  p_result_id uuid,
  p_release boolean DEFAULT false,
  p_patient_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  r public.lab_results%ROWTYPE;
BEGIN
  IF NOT public.app_has_permission('lab_review') THEN
    RAISE EXCEPTION 'This account cannot review lab results' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_release, false) AND NOT public.app_has_permission('lab_release') THEN
    RAISE EXCEPTION 'This account cannot release lab results' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.lab_results WHERE id = p_result_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'not_found');
  END IF;
  IF r.interpretation IS NULL THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'no_interpretation');
  END IF;
  -- Review and release is one decision: refuse it before recording the
  -- review, so a refused release never leaves a review the caller was told
  -- did not happen. (The row is locked, so app_lab_release_apply cannot
  -- refuse for another reason after this.)
  IF COALESCE(p_release, false) THEN
    IF r.superseded_by IS NOT NULL THEN
      RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'superseded');
    END IF;
    IF length(btrim(COALESCE(p_patient_note, ''))) > 1000 THEN
      RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'note_too_long');
    END IF;
  END IF;

  IF r.reviewed_at IS NULL THEN
    UPDATE public.lab_results
       SET reviewed_at = clock_timestamp(),
           -- No ::text: lab_results.reviewed_by is uuid on production (text
           -- in older shapes); the assignment cast handles both, while a text
           -- expression into a uuid column fails.
           reviewed_by = (SELECT auth.uid())
     WHERE id = p_result_id;
    PERFORM public.app_lab_release_log(p_result_id, 'reviewed', NULL);
  END IF;

  IF COALESCE(p_release, false) THEN
    RETURN public.app_lab_release_apply(p_result_id, p_patient_note);
  END IF;

  RETURN public.app_lab_result_state(p_result_id)
         || jsonb_build_object('outcome', 'applied', 'already_reviewed', r.reviewed_at IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.lab_release_result(
  p_result_id uuid,
  p_patient_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT public.app_has_permission('lab_release') THEN
    RAISE EXCEPTION 'This account cannot release lab results' USING ERRCODE = '42501';
  END IF;
  RETURN public.app_lab_release_apply(p_result_id, p_patient_note);
END;
$$;

-- Keeps a result off the portal (and takes it off if it was released).
-- Allowed before or after review: withholding is always the safe direction.
CREATE OR REPLACE FUNCTION public.lab_withhold_result(
  p_result_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  r public.lab_results%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF NOT public.app_has_permission('lab_release') THEN
    RAISE EXCEPTION 'This account cannot withhold lab results' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'reason_required');
  END IF;
  IF length(v_reason) > 500 THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'reason_too_long');
  END IF;

  SELECT * INTO r FROM public.lab_results WHERE id = p_result_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'not_found');
  END IF;

  IF r.withheld_at IS NOT NULL AND r.withheld_reason IS NOT DISTINCT FROM v_reason
     AND r.released_to_patient_at IS NULL THEN
    RETURN public.app_lab_result_state(p_result_id)
           || jsonb_build_object('outcome', 'applied', 'already_withheld', true);
  END IF;

  PERFORM set_config('mbhr.lab_release', 'on', true);
  UPDATE public.lab_results
     SET released_to_patient_at = NULL,
         released_to_patient_by = NULL,
         withheld_at = clock_timestamp(),
         withheld_by = (SELECT auth.uid())::text,
         withheld_reason = v_reason
   WHERE id = p_result_id;
  PERFORM set_config('mbhr.lab_release', 'off', true);

  PERFORM public.app_lab_release_log(p_result_id, 'withheld', v_reason);
  RETURN public.app_lab_result_state(p_result_id)
         || jsonb_build_object('outcome', 'applied', 'already_withheld', false);
END;
$$;

REVOKE ALL ON FUNCTION public.lab_review_result(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lab_release_result(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lab_withhold_result(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lab_review_result(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lab_release_result(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lab_withhold_result(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Patient read path
-- ----------------------------------------------------------------------------
-- The only way a portal patient reads lab results: reviewed, released, not
-- withheld, not superseded, for the caller's own records (portal enabled and
-- not merged away, via app_portal_patient_ids()). p_patient_id narrows the
-- list to one of the caller's own records (a caregiver's managed profile);
-- any other id returns nothing. Orders without a released result, clinical
-- notes and staff ids are never returned.
CREATE OR REPLACE FUNCTION public.portal_my_lab_results(
  p_limit integer DEFAULT 100,
  p_patient_id text DEFAULT NULL
)
RETURNS TABLE (
  result_id uuid,
  order_id uuid,
  patient_id text,
  test_name text,
  test_code text,
  specimen_type text,
  ordered_at timestamptz,
  result_value text,
  result_unit text,
  reference_range text,
  interpretation text,
  result_date timestamptz,
  released_at timestamptz,
  patient_note text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT r.id, o.id, o.patient_id::text, o.test_name, o.test_code,
         o.specimen_type, o.ordered_at, r.result_value, r.result_unit,
         r.reference_range, r.interpretation, r.result_date,
         r.released_to_patient_at, r.patient_note
    FROM public.lab_results AS r
    JOIN public.lab_orders AS o ON o.id = r.order_id
   WHERE o.patient_id::text IN (SELECT public.app_portal_patient_ids())
     AND (p_patient_id IS NULL OR o.patient_id::text = p_patient_id)
     AND r.reviewed_at IS NOT NULL
     AND r.released_to_patient_at IS NOT NULL
     AND r.withheld_at IS NULL
     AND r.superseded_by IS NULL
   ORDER BY r.result_date DESC, r.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$$;

REVOKE ALL ON FUNCTION public.portal_my_lab_results(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_my_lab_results(integer, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Policies: no direct patient reads
-- ----------------------------------------------------------------------------
-- Staff read as before (app_is_staff). The portal branches from
-- 20260924110100 are removed: they exposed reviewed-but-unreleased results
-- and every order's clinical notes to the patient. The insert / update
-- policies from 20260924110100 are unchanged.
DO $$
BEGIN
  IF to_regclass('public.lab_orders') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Patients can view own lab orders" ON public.lab_orders;
    DROP POLICY IF EXISTS lab_orders_select ON public.lab_orders;
    CREATE POLICY lab_orders_select ON public.lab_orders
      FOR SELECT TO authenticated
      USING ((SELECT public.app_is_staff()));
  END IF;

  IF to_regclass('public.lab_results') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Patients can view own lab results" ON public.lab_results;
    DROP POLICY IF EXISTS lab_results_select ON public.lab_results;
    CREATE POLICY lab_results_select ON public.lab_results
      FOR SELECT TO authenticated
      USING ((SELECT public.app_is_staff()));
  END IF;

  -- Legacy copy table: nothing writes it and the portal no longer reads it.
  IF to_regclass('public.patient_lab_results') IS NOT NULL THEN
    DROP POLICY IF EXISTS patient_lab_results_select ON public.patient_lab_results;
    CREATE POLICY patient_lab_results_select ON public.patient_lab_results
      FOR SELECT TO authenticated
      USING ((SELECT public.app_is_staff()));
    REVOKE ALL ON public.patient_lab_results FROM anon;
    COMMENT ON TABLE public.patient_lab_results IS
      'Legacy, unused. Patients see lab results through portal_my_lab_results() (lab_results released by staff).';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Checks (fail loudly if the patient path is wider than intended)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(format('%s.%s', tablename, policyname), ', ') INTO v_bad
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('lab_orders', 'lab_results')
     AND cmd IN ('SELECT', 'ALL')
     AND (qual ILIKE '%app_portal_patient_ids%' OR qual ILIKE '%patient_portal_users%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'lab release: portal read policies still present: %', v_bad;
  END IF;
END $$;

-- End of migration.
