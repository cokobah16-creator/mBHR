-- ============================================================================
-- Pharmacy stock ledger: prescriptions and stock lots become server-backed
-- (Wave B, item 4)
-- ============================================================================
-- Runs after 20260925100000_sync_authority_foundation.sql, which already
-- gives prescriptions, pharmacy_items and pharmacy_batches a server-stamped
-- updated_at and row_version (trigger zz_server_stamp), the permission
-- helpers and the command receipts (app_command_prior_result /
-- app_command_record).
--
-- Owner decision: prescriptions and stock lots affect medication safety and
-- inventory integrity, so the server owns them.
--
--   1. Balances (pharmacy_items.on_hand_qty, pharmacy_batches.qty_on_hand)
--      can never go below zero (CHECK) and are written only by the RPCs
--      below. An API upload cannot set or change them (guard trigger), so a
--      device can never overwrite another device's decrement.
--   2. stock_movements: an append-only ledger of every change (receipt,
--      opening balance, dispense, adjustment, expiry write-off, reversal).
--      Rows cannot be updated or deleted by anyone. stock_balance_drift and
--      stock_item_balance_drift list any balance that disagrees with it
--      (both must stay empty).
--   3. Command RPCs, each idempotent on its client command id, taking row
--      locks in one order (prescription, then medicines by id, then lots by
--      expiry and id) so concurrent dispensing cannot deadlock or oversell:
--        rx_register_item       add a medicine (returns the id to use when
--                               the same name/form/strength already exists
--                               at the site; the device's id becomes an
--                               alias)
--        rx_set_item_active     deactivate / reactivate (medicines are no
--                               longer deleted: movements reference them)
--        rx_receive_stock       a received lot, or a site's opening balance
--        rx_adjust_stock        a physical count or an expiry write-off;
--                               refused if the lot would go below zero
--        rx_dispense            all lines of a prescription, FEFO from
--                               in-date lots (honouring the device's lot
--                               choice where that lot still has stock).
--                               Online: refused as insufficient_stock with
--                               the available quantity per line. Handed over
--                               offline (p_offline): the covered part is
--                               taken from stock; the rest is still
--                               recorded as dispensed to the patient (no
--                               lot, no movement) and filed in
--                               stock_discrepancies for the pharmacist.
--        rx_void_prescription   cancel an open prescription
--        rx_import_history      prescriptions dispensed from stock that was
--                               only on a device (history only, no stock
--                               movement)
--        rx_resolve_discrepancy mark a discrepancy reconciled
--   4. Prescriptions: inserted by prescribers (consult) as "open"; status,
--      dispensing and voiding change only through the RPCs.
--      Prescription dispenses (dispenses.prescription_id set) are written
--      only by the RPCs; staff can still change their portal visibility.
--   5. Opening stock is explicit, per site: the first device to upload an
--      opening balance for a site claims it (pharmacy_site_onboarding); a
--      second device is refused and must use the server's stock.
--   6. Row-level security: read for dispense, inventory or consult holders;
--      no direct writes to balances, lots, the ledger or discrepancies.
--
-- Backfill: none on the server (devices never uploaded these tables; the
-- old mbhrAdapter.ts was never switched on). Device stock is uploaded
-- through the opening-stock action on one designated device per site.
-- Before relying on the ledger, check that stock_balance_drift is empty:
-- balances that existed before this migration have no movements, so they
-- appear there until an opening balance or count is recorded for them.
--
-- Idempotent: every statement can be re-run.
--
-- Rollback (in this order):
--   DROP FUNCTION public.rx_dispense(uuid, text, jsonb, timestamptz, boolean, boolean, text, jsonb),
--     public.rx_receive_stock(uuid, text, jsonb, integer, text, timestamptz, text, text, text),
--     public.rx_adjust_stock(uuid, text, text, integer, text, text, timestamptz, text),
--     public.rx_register_item(uuid, text, jsonb, text),
--     public.rx_set_item_active(uuid, text, boolean, text),
--     public.rx_void_prescription(uuid, text, text, timestamptz, text),
--     public.rx_import_history(uuid, text, jsonb, jsonb, text),
--     public.rx_resolve_discrepancy(uuid);
--   DROP TRIGGER rx_canonical_lines ON public.prescriptions;
--   DROP FUNCTION public.tg_rx_canonical_lines(), public.app_rx_canonical_lines(jsonb),
--     public.app_rx_item_id(text);
--   DROP VIEW public.stock_balance_drift, public.stock_item_balance_drift;
--   DROP TRIGGER rx_guard_balance ON public.pharmacy_items;
--   DROP TRIGGER rx_guard_balance ON public.pharmacy_batches;
--   DROP TRIGGER rx_guard_prescription ON public.prescriptions;
--   DROP TRIGGER rx_guard_dispense ON public.dispenses;
--   DROP FUNCTION public.tg_rx_guard_balance(), public.tg_rx_guard_prescription(),
--     public.tg_rx_guard_dispense(), public.tg_rx_ledger_immutable();
--   DROP TABLE public.stock_discrepancies, public.pharmacy_site_onboarding,
--     public.pharmacy_item_aliases, public.stock_movements;
--   re-create the pharmacy_items / pharmacy_batches / prescriptions policies
--   from 20260924110100_rls_clinical_core.sql. Added columns and CHECK
--   constraints can stay.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns and constraints
-- ----------------------------------------------------------------------------
ALTER TABLE public.pharmacy_items
  ADD COLUMN IF NOT EXISTS site_key text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS dispensed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispensed_by text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text;

-- Non-negative balances. Added NOT VALID and then validated, so a database
-- that somehow holds a negative balance still migrates (with a warning) and
-- every new write is checked.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pharmacy_items_qty_nonneg') THEN
    ALTER TABLE public.pharmacy_items
      ADD CONSTRAINT pharmacy_items_qty_nonneg CHECK (on_hand_qty >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pharmacy_batches_qty_nonneg') THEN
    ALTER TABLE public.pharmacy_batches
      ADD CONSTRAINT pharmacy_batches_qty_nonneg CHECK (qty_on_hand >= 0) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.pharmacy_items VALIDATE CONSTRAINT pharmacy_items_qty_nonneg;
  EXCEPTION WHEN check_violation THEN
    RAISE WARNING 'pharmacy ledger: some pharmacy_items have a negative on_hand_qty; count them';
  END;
  BEGIN
    ALTER TABLE public.pharmacy_batches VALIDATE CONSTRAINT pharmacy_batches_qty_nonneg;
  EXCEPTION WHEN check_violation THEN
    RAISE WARNING 'pharmacy ledger: some pharmacy_batches have a negative qty_on_hand; count them';
  END;
END $$;

-- One medicine per site, name, form and strength. Skipped (with a warning)
-- if duplicates already exist; rx_register_item still matches by identity.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.pharmacy_items
     GROUP BY site_key, lower(med_name), lower(form), lower(strength)
    HAVING count(*) > 1
  ) THEN
    RAISE WARNING 'pharmacy ledger: duplicate pharmacy_items exist; unique identity index not created';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_items_identity
      ON public.pharmacy_items (COALESCE(site_key, ''), lower(med_name), lower(form), lower(strength));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pharmacy_batches_item_expiry
  ON public.pharmacy_batches (item_id, expiry_date) WHERE qty_on_hand > 0;
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_updated_at ON public.pharmacy_items (updated_at);
CREATE INDEX IF NOT EXISTS idx_pharmacy_batches_updated_at ON public.pharmacy_batches (updated_at);
CREATE INDEX IF NOT EXISTS idx_prescriptions_updated_at ON public.prescriptions (updated_at);
CREATE INDEX IF NOT EXISTS idx_dispenses_prescription_updated
  ON public.dispenses (updated_at) WHERE prescription_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Ledger, aliases, site onboarding, discrepancies
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id              text PRIMARY KEY,               -- client id = idempotency key
  item_id         text NOT NULL REFERENCES public.pharmacy_items (id),
  batch_id        text REFERENCES public.pharmacy_batches (id),
  qty_delta       integer NOT NULL CHECK (qty_delta <> 0),
  reason          text NOT NULL CHECK (reason IN (
                    'receipt', 'dispense', 'adjust', 'expire', 'reversal', 'opening_balance')),
  prescription_id text REFERENCES public.prescriptions (id),
  dispense_id     text,
  reverses_id     text UNIQUE REFERENCES public.stock_movements (id),
  command_id      uuid,
  actor_id        uuid DEFAULT auth.uid(),
  requested_by    text,                           -- device user id
  occurred_at     timestamptz NOT NULL,           -- device clock
  recorded_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  note            text CHECK (note IS NULL OR char_length(note) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_batch ON public.stock_movements (batch_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_recorded ON public.stock_movements (item_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_recorded ON public.stock_movements (recorded_at);

COMMENT ON TABLE public.stock_movements IS
  'Append-only pharmacy stock ledger. Written only by the rx_* RPCs; never updated or deleted.';

-- Device item ids that were matched to an existing medicine (rx_register_item).
CREATE TABLE IF NOT EXISTS public.pharmacy_item_aliases (
  alias_id   text PRIMARY KEY,
  item_id    text NOT NULL REFERENCES public.pharmacy_items (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Which device uploaded a site's opening stock (one per site).
CREATE TABLE IF NOT EXISTS public.pharmacy_site_onboarding (
  site_key   text PRIMARY KEY CHECK (char_length(site_key) BETWEEN 1 AND 64),
  device_id  text NOT NULL,
  claimed_by uuid DEFAULT auth.uid(),
  claimed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stock_discrepancies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         text NOT NULL,
  batch_id        text,
  qty_uncovered   integer NOT NULL CHECK (qty_uncovered > 0),
  dispense_id     text,
  prescription_id text,
  command_id      uuid,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by     uuid,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_discrepancies_updated ON public.stock_discrepancies (updated_at);

DROP TRIGGER IF EXISTS zz_server_stamp ON public.stock_discrepancies;
CREATE TRIGGER zz_server_stamp BEFORE INSERT OR UPDATE ON public.stock_discrepancies
  FOR EACH ROW EXECUTE FUNCTION public.tg_server_stamp_time();

-- The ledger is immutable for everyone.
CREATE OR REPLACE FUNCTION public.tg_rx_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only; record a reversal instead'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS rx_ledger_immutable ON public.stock_movements;
CREATE TRIGGER rx_ledger_immutable BEFORE UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.tg_rx_ledger_immutable();
DROP TRIGGER IF EXISTS rx_ledger_no_truncate ON public.stock_movements;
CREATE TRIGGER rx_ledger_no_truncate BEFORE TRUNCATE ON public.stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_rx_ledger_immutable();

-- ----------------------------------------------------------------------------
-- 3. Guards: balances, prescriptions and prescription dispenses
-- ----------------------------------------------------------------------------
-- API callers (authenticated / anon) cannot set or change a balance, move a
-- lot to another medicine, or change a prescription's status. The RPCs run
-- as the owner (SECURITY DEFINER) and are not restricted; code that runs as
-- the caller could opt in with set_config('mbhr.stock_write', 'on', true).
CREATE OR REPLACE FUNCTION public.tg_rx_guard_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon')
     OR current_setting('mbhr.stock_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'pharmacy_items' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.on_hand_qty := 0;
    ELSE
      NEW.on_hand_qty := OLD.on_hand_qty;
    END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN
      NEW.qty_on_hand := 0;
    ELSE
      NEW.qty_on_hand := OLD.qty_on_hand;
      NEW.item_id := OLD.item_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_rx_guard_prescription()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon')
     OR current_setting('mbhr.stock_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'open';
    NEW.dispensed_at := NULL;
    NEW.dispensed_by := NULL;
    NEW.voided_at := NULL;
    NEW.voided_by := NULL;
    NEW.void_reason := NULL;
  ELSE
    -- Content and status are fixed after insert (only the RPCs change them).
    NEW.status := OLD.status;
    NEW.lines := OLD.lines;
    NEW.patient_id := OLD.patient_id;
    NEW.visit_id := OLD.visit_id;
    NEW.prescriber_id := OLD.prescriber_id;
    NEW.created_at := OLD.created_at;
    NEW.dispensed_at := OLD.dispensed_at;
    NEW.dispensed_by := OLD.dispensed_by;
    NEW.voided_at := OLD.voided_at;
    NEW.voided_by := OLD.voided_by;
    NEW.void_reason := OLD.void_reason;
  END IF;
  RETURN NEW;
END;
$$;

-- Prescription dispenses are the ledger's patient-facing side: an upload
-- cannot create one or change what was given. Other dispense rows (visit
-- dispensing) and portal visibility are unaffected.
CREATE OR REPLACE FUNCTION public.tg_rx_guard_dispense()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon')
     OR current_setting('mbhr.stock_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.prescription_id IS NOT NULL OR NEW.batch_id IS NOT NULL THEN
      RAISE EXCEPTION 'prescription dispenses are recorded by rx_dispense'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  NEW.prescription_id := OLD.prescription_id;
  NEW.item_id := OLD.item_id;
  NEW.batch_id := OLD.batch_id;
  IF OLD.prescription_id IS NOT NULL THEN
    NEW.qty := OLD.qty;
    NEW.patient_id := OLD.patient_id;
    NEW.item_name := OLD.item_name;
    NEW.dispensed_at := OLD.dispensed_at;
    NEW.dispensed_by := OLD.dispensed_by;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_rx_guard_balance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_rx_guard_prescription() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_rx_guard_dispense() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_rx_ledger_immutable() FROM PUBLIC, anon, authenticated;

-- Named rx_* so they run before zz_server_stamp (triggers fire in name order).
DROP TRIGGER IF EXISTS rx_guard_balance ON public.pharmacy_items;
CREATE TRIGGER rx_guard_balance BEFORE INSERT OR UPDATE ON public.pharmacy_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_rx_guard_balance();
DROP TRIGGER IF EXISTS rx_guard_balance ON public.pharmacy_batches;
CREATE TRIGGER rx_guard_balance BEFORE INSERT OR UPDATE ON public.pharmacy_batches
  FOR EACH ROW EXECUTE FUNCTION public.tg_rx_guard_balance();
DROP TRIGGER IF EXISTS rx_guard_prescription ON public.prescriptions;
CREATE TRIGGER rx_guard_prescription BEFORE INSERT OR UPDATE ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_rx_guard_prescription();
DROP TRIGGER IF EXISTS rx_guard_dispense ON public.dispenses;
CREATE TRIGGER rx_guard_dispense BEFORE INSERT OR UPDATE ON public.dispenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_rx_guard_dispense();

-- ----------------------------------------------------------------------------
-- 4. Drift views (must stay empty)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.stock_balance_drift WITH (security_invoker = true) AS
  SELECT b.id AS batch_id, b.item_id, b.qty_on_hand, COALESCE(SUM(m.qty_delta), 0) AS ledger_qty
    FROM public.pharmacy_batches AS b
    LEFT JOIN public.stock_movements AS m ON m.batch_id = b.id
   GROUP BY b.id, b.item_id, b.qty_on_hand
  HAVING b.qty_on_hand <> COALESCE(SUM(m.qty_delta), 0);

CREATE OR REPLACE VIEW public.stock_item_balance_drift WITH (security_invoker = true) AS
  SELECT i.id AS item_id, i.on_hand_qty, COALESCE(SUM(m.qty_delta), 0) AS ledger_qty
    FROM public.pharmacy_items AS i
    LEFT JOIN public.stock_movements AS m ON m.item_id = i.id
   GROUP BY i.id, i.on_hand_qty
  HAVING i.on_hand_qty <> COALESCE(SUM(m.qty_delta), 0);

-- ----------------------------------------------------------------------------
-- 5. Helpers
-- ----------------------------------------------------------------------------
-- The medicine id to use for a device id (follows rx_register_item aliases).
CREATE OR REPLACE FUNCTION public.app_rx_item_id(p_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE((SELECT a.item_id FROM public.pharmacy_item_aliases AS a WHERE a.alias_id = p_id), p_id);
$$;

REVOKE ALL ON FUNCTION public.app_rx_item_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_rx_item_id(text) TO authenticated, service_role;

-- Prescription lines with every medicine id replaced by the id to use
-- (aliases followed). Prescriptions on the server always name the kept
-- medicine, so every device can match them to its stock list.
CREATE OR REPLACE FUNCTION public.app_rx_canonical_lines(p_lines jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
           WHEN jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN p_lines
           ELSE COALESCE((
             SELECT jsonb_agg(
                      CASE
                        WHEN jsonb_typeof(e) = 'object' AND (e ->> 'itemId') IS NOT NULL
                          THEN jsonb_set(e, '{itemId}', to_jsonb(public.app_rx_item_id(e ->> 'itemId')))
                        ELSE e
                      END
                      ORDER BY ord)
               FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(e, ord)), '[]'::jsonb)
         END;
$$;

REVOKE ALL ON FUNCTION public.app_rx_canonical_lines(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_rx_canonical_lines(jsonb) TO authenticated, service_role;

-- Every new prescription (upload or RPC) names kept medicines. Named so it
-- runs before rx_guard_prescription and zz_server_stamp.
CREATE OR REPLACE FUNCTION public.tg_rx_canonical_lines()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.lines := public.app_rx_canonical_lines(NEW.lines);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_rx_canonical_lines() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rx_canonical_lines ON public.prescriptions;
CREATE TRIGGER rx_canonical_lines BEFORE INSERT ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_rx_canonical_lines();

-- ----------------------------------------------------------------------------
-- 6. RPCs
-- ----------------------------------------------------------------------------
-- Business refusals are RETURNED ({"outcome":"rejected","reason":...}) and
-- recorded, so a resend returns the same answer. RAISE only for permission
-- (42501) and for "patient not on the server yet" (MBR01, which the device
-- retries after uploading the patient).

CREATE OR REPLACE FUNCTION public.rx_register_item(
  p_command_id uuid,
  p_item_id text,
  p_item jsonb,
  p_requested_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prior jsonb;
  v_id text;
  v_site text := NULLIF(p_item ->> 'site_key', '');
  v_name text := btrim(COALESCE(p_item ->> 'med_name', ''));
  v_form text := btrim(COALESCE(p_item ->> 'form', ''));
  v_strength text := btrim(COALESCE(p_item ->> 'strength', ''));
  v_qty integer;
BEGIN
  IF NOT public.app_has_permission('inventory') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  v_prior := public.app_command_prior_result(p_command_id, 'rx_register_item');
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_item_id IS NULL OR v_name = '' THEN
    RETURN public.app_command_record(p_command_id, 'rx_register_item', 'rejected',
      jsonb_build_object('reason', 'invalid_request'), p_requested_by, now());
  END IF;

  SELECT id INTO v_id FROM public.pharmacy_items WHERE id = p_item_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM public.pharmacy_items
     WHERE COALESCE(site_key, '') = COALESCE(v_site, '')
       AND lower(med_name) = lower(v_name)
       AND lower(form) = lower(v_form)
       AND lower(strength) = lower(v_strength)
     ORDER BY id
     LIMIT 1;
  END IF;
  IF v_id IS NULL THEN
    BEGIN
      INSERT INTO public.pharmacy_items (
        id, med_name, form, strength, unit, on_hand_qty, reorder_threshold,
        is_controlled, is_active, site_key)
      VALUES (
        p_item_id, v_name, v_form, v_strength, COALESCE(p_item ->> 'unit', ''), 0,
        GREATEST(COALESCE((p_item ->> 'reorder_threshold')::integer, 0), 0),
        COALESCE((p_item ->> 'is_controlled')::boolean, false), true, v_site);
      v_id := p_item_id;
    EXCEPTION WHEN unique_violation THEN
      -- Another device registered the same medicine at the same moment.
      SELECT id INTO v_id
        FROM public.pharmacy_items
       WHERE COALESCE(site_key, '') = COALESCE(v_site, '')
         AND lower(med_name) = lower(v_name)
         AND lower(form) = lower(v_form)
         AND lower(strength) = lower(v_strength)
       ORDER BY id
       LIMIT 1;
    END;
  END IF;
  IF v_id IS NULL THEN
    RETURN public.app_command_record(p_command_id, 'rx_register_item', 'rejected',
      jsonb_build_object('reason', 'invalid_request'), p_requested_by, now());
  END IF;
  IF v_id <> p_item_id THEN
    INSERT INTO public.pharmacy_item_aliases (alias_id, item_id)
    VALUES (p_item_id, v_id)
    ON CONFLICT (alias_id) DO NOTHING;
    -- Prescriptions already uploaded with the device's id now name the
    -- kept medicine (their new updated_at makes devices download them).
    UPDATE public.prescriptions
       SET lines = public.app_rx_canonical_lines(lines)
     WHERE jsonb_typeof(lines) = 'array'
       AND lines @> jsonb_build_array(jsonb_build_object('itemId', p_item_id));
  END IF;
  SELECT on_hand_qty INTO v_qty FROM public.pharmacy_items WHERE id = v_id;
  RETURN public.app_command_record(p_command_id, 'rx_register_item', 'applied',
    jsonb_build_object('item_id', v_id, 'on_hand_qty', v_qty), p_requested_by, now());
END;
$$;

CREATE OR REPLACE FUNCTION public.rx_set_item_active(
  p_command_id uuid,
  p_item_id text,
  p_active boolean,
  p_requested_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prior jsonb;
  v_id text := public.app_rx_item_id(p_item_id);
BEGIN
  IF NOT public.app_has_permission('inventory') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  v_prior := public.app_command_prior_result(p_command_id, 'rx_set_item_active');
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  UPDATE public.pharmacy_items SET is_active = COALESCE(p_active, true) WHERE id = v_id;
  IF NOT FOUND THEN
    RETURN public.app_command_record(p_command_id, 'rx_set_item_active', 'rejected',
      jsonb_build_object('reason', 'item_not_found'), p_requested_by, now());
  END IF;
  RETURN public.app_command_record(p_command_id, 'rx_set_item_active', 'applied',
    jsonb_build_object('item_id', v_id, 'is_active', COALESCE(p_active, true)), p_requested_by, now());
END;
$$;

CREATE OR REPLACE FUNCTION public.rx_receive_stock(
  p_command_id uuid,
  p_movement_id text,
  p_batch jsonb,
  p_qty integer,
  p_reason text DEFAULT 'receipt',
  p_occurred_at timestamptz DEFAULT now(),
  p_requested_by text DEFAULT NULL,
  p_site_key text DEFAULT NULL,
  p_device_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prior jsonb;
  v_item text := public.app_rx_item_id(p_batch ->> 'item_id');
  v_batch_id text := p_batch ->> 'id';
  v_claim text;
  v_batch public.pharmacy_batches%ROWTYPE;
  v_item_row public.pharmacy_items%ROWTYPE;
BEGIN
  IF NOT public.app_has_permission('inventory') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  v_prior := public.app_command_prior_result(p_command_id, 'rx_receive_stock');
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;

  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
      jsonb_build_object('reason', 'invalid_quantity'), p_requested_by, p_occurred_at);
  END IF;
  IF p_reason NOT IN ('receipt', 'opening_balance') OR v_batch_id IS NULL OR p_movement_id IS NULL THEN
    RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
      jsonb_build_object('reason', 'invalid_request'), p_requested_by, p_occurred_at);
  END IF;

  -- Lock order: medicine, then lot.
  SELECT * INTO v_item_row FROM public.pharmacy_items WHERE id = v_item FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
      jsonb_build_object('reason', 'item_not_found'), p_requested_by, p_occurred_at);
  END IF;

  IF p_reason = 'opening_balance' THEN
    IF NULLIF(p_site_key, '') IS NULL OR NULLIF(p_device_id, '') IS NULL THEN
      RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
        jsonb_build_object('reason', 'invalid_request'), p_requested_by, p_occurred_at);
    END IF;
    INSERT INTO public.pharmacy_site_onboarding (site_key, device_id)
    VALUES (p_site_key, p_device_id)
    ON CONFLICT (site_key) DO NOTHING;
    SELECT device_id INTO v_claim FROM public.pharmacy_site_onboarding WHERE site_key = p_site_key;
    IF v_claim IS DISTINCT FROM p_device_id THEN
      RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
        jsonb_build_object('reason', 'opening_stock_already_uploaded'), p_requested_by, p_occurred_at);
    END IF;
  END IF;

  INSERT INTO public.pharmacy_batches (id, item_id, lot_number, expiry_date, qty_on_hand, received_at, supplier)
  VALUES (
    v_batch_id, v_item, COALESCE(p_batch ->> 'lot_number', ''),
    (p_batch ->> 'expiry_date')::date, 0,
    COALESCE(((p_batch ->> 'received_at')::timestamptz AT TIME ZONE 'Africa/Lagos')::date,
             (now() AT TIME ZONE 'Africa/Lagos')::date),
    NULLIF(p_batch ->> 'supplier', ''))
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_batch FROM public.pharmacy_batches WHERE id = v_batch_id FOR UPDATE;
  IF v_batch.item_id <> v_item THEN
    RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'rejected',
      jsonb_build_object('reason', 'batch_item_mismatch'), p_requested_by, p_occurred_at);
  END IF;

  INSERT INTO public.stock_movements (
    id, item_id, batch_id, qty_delta, reason, command_id, requested_by, occurred_at)
  VALUES (p_movement_id, v_item, v_batch_id, p_qty, p_reason, p_command_id, p_requested_by,
          COALESCE(p_occurred_at, now()));
  UPDATE public.pharmacy_batches SET qty_on_hand = qty_on_hand + p_qty WHERE id = v_batch_id;
  UPDATE public.pharmacy_items SET on_hand_qty = on_hand_qty + p_qty WHERE id = v_item;

  RETURN public.app_command_record(p_command_id, 'rx_receive_stock', 'applied',
    jsonb_build_object(
      'batch_id', v_batch_id,
      'items', (SELECT jsonb_agg(jsonb_build_object('id', id, 'on_hand_qty', on_hand_qty, 'row_version', row_version))
                  FROM public.pharmacy_items WHERE id = v_item),
      'batches', (SELECT jsonb_agg(jsonb_build_object('id', id, 'qty_on_hand', qty_on_hand, 'row_version', row_version))
                    FROM public.pharmacy_batches WHERE id = v_batch_id)),
    p_requested_by, p_occurred_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.rx_adjust_stock(
  p_command_id uuid,
  p_movement_id text,
  p_batch_id text,
  p_qty_delta integer,
  p_reason text DEFAULT 'adjust',
  p_note text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_requested_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prior jsonb;
  v_item text;
  v_item_qty integer;
  v_batch_qty integer;
BEGIN
  IF NOT public.app_has_permission('inventory') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  v_prior := public.app_command_prior_result(p_command_id, 'rx_adjust_stock');
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_qty_delta IS NULL OR p_qty_delta = 0 OR p_reason NOT IN ('adjust', 'expire') OR p_movement_id IS NULL THEN
    RETURN public.app_command_record(p_command_id, 'rx_adjust_stock', 'rejected',
      jsonb_build_object('reason', 'invalid_request'), p_requested_by, p_occurred_at);
  END IF;

  SELECT item_id INTO v_item FROM public.pharmacy_batches WHERE id = p_batch_id;
  IF v_item IS NULL THEN
    RETURN public.app_command_record(p_command_id, 'rx_adjust_stock', 'rejected',
      jsonb_build_object('reason', 'batch_not_found'), p_requested_by, p_occurred_at);
  END IF;
  -- Lock order: medicine, then lot.
  SELECT on_hand_qty INTO v_item_qty FROM public.pharmacy_items WHERE id = v_item FOR UPDATE;
  SELECT qty_on_hand INTO v_batch_qty FROM public.pharmacy_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch_qty + p_qty_delta < 0 OR v_item_qty + p_qty_delta < 0 THEN
    RETURN public.app_command_record(p_command_id, 'rx_adjust_stock', 'rejected',
      jsonb_build_object(
        'reason', 'insufficient_stock',
        'available', v_batch_qty,
        'items', jsonb_build_array(jsonb_build_object('id', v_item, 'on_hand_qty', v_item_qty)),
        'batches', jsonb_build_array(jsonb_build_object('id', p_batch_id, 'qty_on_hand', v_batch_qty))),
      p_requested_by, p_occurred_at);
  END IF;

  INSERT INTO public.stock_movements (
    id, item_id, batch_id, qty_delta, reason, command_id, requested_by, occurred_at, note)
  VALUES (p_movement_id, v_item, p_batch_id, p_qty_delta, p_reason, p_command_id, p_requested_by,
          COALESCE(p_occurred_at, now()), left(p_note, 200));
  UPDATE public.pharmacy_batches SET qty_on_hand = qty_on_hand + p_qty_delta WHERE id = p_batch_id;
  UPDATE public.pharmacy_items SET on_hand_qty = on_hand_qty + p_qty_delta WHERE id = v_item;

  RETURN public.app_command_record(p_command_id, 'rx_adjust_stock', 'applied',
    jsonb_build_object(
      'items', (SELECT jsonb_agg(jsonb_build_object('id', id, 'on_hand_qty', on_hand_qty, 'row_version', row_version))
                  FROM public.pharmacy_items WHERE id = v_item),
      'batches', (SELECT jsonb_agg(jsonb_build_object('id', id, 'qty_on_hand', qty_on_hand, 'row_version', row_version))
                    FROM public.pharmacy_batches WHERE id = p_batch_id)),
    p_requested_by, p_occurred_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.rx_dispense(
  p_command_id uuid,
  p_prescription_id text,
  p_lines jsonb,
  p_occurred_at timestamptz DEFAULT now(),
  p_offline boolean DEFAULT false,
  p_allergy_override boolean DEFAULT false,
  p_requested_by text DEFAULT NULL,
  p_prescription jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prior jsonb;
  v_rx public.prescriptions%ROWTYPE;
  v_patient text;
  v_visit text;
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_at timestamptz := COALESCE(p_occurred_at, now());
  v_item_ids text[];
  v_found integer;
  v_line record;
  v_ids text[];
  v_avail integer[];
  v_n integer;
  v_i integer;
  v_k integer;
  v_take integer;
  v_remaining integer;
  v_hint jsonb;
  v_taken jsonb := '{}'::jsonb;     -- batch id -> units this command takes
  v_allocs jsonb := '[]'::jsonb;    -- allocations to write
  v_short jsonb := '[]'::jsonb;     -- lines the in-date stock cannot cover
  v_alloc jsonb;
  v_dispense_id text;
  v_rx_line jsonb;
  v_item_name text;
  v_requested jsonb;
  v_expected jsonb;
BEGIN
  IF NOT public.app_has_permission('dispense') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  v_prior := public.app_command_prior_result(p_command_id, 'rx_dispense');
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;

  IF p_prescription_id IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) AS e
                 WHERE NULLIF(e ->> 'item_id', '') IS NULL
                    OR COALESCE((e ->> 'qty')::integer, 0) <= 0) THEN
    RETURN public.app_command_record(p_command_id, 'rx_dispense', 'rejected',
      jsonb_build_object('reason', 'invalid_request'), p_requested_by, v_at);
  END IF;

  -- A prescription written offline on another device may not be uploaded
  -- yet: the command carries it (inserted as open, like an upload).
  IF p_prescription IS NOT NULL AND NULLIF(p_prescription ->> 'patient_id', '') IS NOT NULL THEN
    INSERT INTO public.prescriptions (id, visit_id, patient_id, prescriber_id, lines, created_at, status)
    VALUES (
      p_prescription_id,
      COALESCE(p_prescription ->> 'visit_id', ''),
      p_prescription ->> 'patient_id',
      COALESCE(NULLIF(p_prescription ->> 'prescriber_id', ''), p_requested_by, ''),
      COALESCE(p_prescription -> 'lines', '[]'::jsonb),
      COALESCE((p_prescription ->> 'created_at')::timestamptz, now()),
      'open')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Lock order: prescription, medicines by id, lots by expiry and id.
  SELECT * INTO v_rx FROM public.prescriptions WHERE id = p_prescription_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.app_command_record(p_command_id, 'rx_dispense', 'rejected',
      jsonb_build_object('reason', 'prescription_not_found'), p_requested_by, v_at);
  END IF;
  IF v_rx.status = 'void' THEN
    RETURN public.app_command_record(p_command_id, 'rx_dispense', 'rejected',
      jsonb_build_object('reason', 'prescription_void'), p_requested_by, v_at);
  END IF;
  IF v_rx.status <> 'open' THEN
    RETURN public.app_command_record(p_command_id, 'rx_dispense', 'rejected',
      jsonb_build_object('reason', 'already_dispensed', 'status', v_rx.status), p_requested_by, v_at);
  END IF;

  -- Every line of the prescription, in full (no partial dispensing).
  SELECT COALESCE(jsonb_object_agg(item_id, qty), '{}'::jsonb) INTO v_requested
    FROM (SELECT public.app_rx_item_id(e ->> 'item_id') AS item_id, SUM((e ->> 'qty')::integer) AS qty
            FROM jsonb_array_elements(p_lines) AS e GROUP BY 1) AS s;
  SELECT COALESCE(jsonb_object_agg(item_id, qty), '{}'::jsonb) INTO v_expected
    FROM (SELECT public.app_rx_item_id(e ->> 'itemId') AS item_id, SUM((e ->> 'qty')::integer) AS qty
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_rx.lines) = 'array' THEN v_rx.lines ELSE '[]'::jsonb END) AS e
           GROUP BY 1) AS s;
  IF v_requested <> v_expected THEN
    RETURN public.app_command_record(p_command_id, 'rx_dispense', 'rejected',
      jsonb_build_object('reason', 'lines_mismatch'), p_requested_by, v_at);
  END IF;

  v_patient := public.canonical_patient_id(v_rx.patient_id);
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id::text = v_patient) THEN
    -- The patient record has not reached the server yet; the device retries.
    RAISE EXCEPTION 'patient_not_synced' USING ERRCODE = 'MBR01';
  END IF;
  v_visit := CASE WHEN EXISTS (SELECT 1 FROM public.visits WHERE id::text = v_rx.visit_id)
                  THEN v_rx.visit_id ELSE NULL END;

  SELECT array_agg(DISTINCT public.app_rx_item_id(e ->> 'item_id'))
    INTO v_item_ids FROM jsonb_array_elements(p_lines) AS e;
  SELECT count(*) INTO v_found FROM (
    SELECT id FROM public.pharmacy_items WHERE id = ANY (v_item_ids) ORDER BY id FOR UPDATE
  ) AS locked;
  IF v_found <> COALESCE(array_length(v_item_ids, 1), 0) THEN
    RETURN public.app_command_record(p_command_id, 'rx_dispense', 'rejected',
      jsonb_build_object('reason', 'unknown_item'), p_requested_by, v_at);
  END IF;

  -- Allocate (nothing is written until every line is known to be covered).
  FOR v_line IN
    SELECT public.app_rx_item_id(e ->> 'item_id') AS item_id,
           (e ->> 'qty')::integer AS qty,
           COALESCE(e -> 'hint', '[]'::jsonb) AS hint,
           COALESCE(e -> 'dispense_ids', '[]'::jsonb) AS dispense_ids,
           ord
      FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(e, ord)
     ORDER BY 1, ord
  LOOP
    SELECT array_agg(id ORDER BY expiry_date, id), array_agg(qty_on_hand ORDER BY expiry_date, id)
      INTO v_ids, v_avail
      FROM (SELECT id, expiry_date, qty_on_hand
              FROM public.pharmacy_batches
             WHERE item_id = v_line.item_id
               AND qty_on_hand > 0
               AND expiry_date >= v_today
             ORDER BY expiry_date, id
               FOR UPDATE) AS lots;
    v_n := COALESCE(array_length(v_ids, 1), 0);
    FOR v_i IN 1 .. v_n LOOP
      v_avail[v_i] := v_avail[v_i] - COALESCE((v_taken ->> v_ids[v_i])::integer, 0);
    END LOOP;
    v_remaining := v_line.qty;
    v_k := 0;

    -- The device's lot choice first, where that lot still has in-date stock.
    FOR v_hint IN SELECT value FROM jsonb_array_elements(v_line.hint) LOOP
      EXIT WHEN v_remaining = 0;
      v_i := array_position(v_ids, v_hint ->> 'batch_id');
      CONTINUE WHEN v_i IS NULL;
      v_take := LEAST(v_avail[v_i], GREATEST(COALESCE((v_hint ->> 'qty')::integer, 0), 0), v_remaining);
      CONTINUE WHEN v_take <= 0;
      v_allocs := v_allocs || jsonb_build_object(
        'line', v_line.ord, 'k', v_k, 'item_id', v_line.item_id, 'batch_id', v_ids[v_i],
        'qty', v_take, 'dispense_ids', v_line.dispense_ids);
      v_k := v_k + 1;
      v_avail[v_i] := v_avail[v_i] - v_take;
      v_taken := jsonb_set(v_taken, ARRAY[v_ids[v_i]],
        to_jsonb(COALESCE((v_taken ->> v_ids[v_i])::integer, 0) + v_take));
      v_remaining := v_remaining - v_take;
    END LOOP;

    -- Then first-expired-first-out.
    FOR v_i IN 1 .. v_n LOOP
      EXIT WHEN v_remaining = 0;
      v_take := LEAST(v_avail[v_i], v_remaining);
      CONTINUE WHEN v_take <= 0;
      v_allocs := v_allocs || jsonb_build_object(
        'line', v_line.ord, 'k', v_k, 'item_id', v_line.item_id, 'batch_id', v_ids[v_i],
        'qty', v_take, 'dispense_ids', v_line.dispense_ids);
      v_k := v_k + 1;
      v_avail[v_i] := v_avail[v_i] - v_take;
      v_taken := jsonb_set(v_taken, ARRAY[v_ids[v_i]],
        to_jsonb(COALESCE((v_taken ->> v_ids[v_i])::integer, 0) + v_take));
      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      v_short := v_short || jsonb_build_object(
        'line', v_line.ord, 'item_id', v_line.item_id, 'requested', v_line.qty,
        'available', v_line.qty - v_remaining, 'uncovered', v_remaining);
      -- Handed over offline: the uncovered units were still given to the
      -- patient, so they are recorded as a dispense with no lot (and no
      -- stock movement) and filed as a discrepancy below. Not written when
      -- the dispense is refused (online).
      v_allocs := v_allocs || jsonb_build_object(
        'line', v_line.ord, 'k', v_k, 'item_id', v_line.item_id, 'batch_id', NULL,
        'qty', v_remaining, 'dispense_ids', v_line.dispense_ids);
      v_k := v_k + 1;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_short) > 0 AND NOT COALESCE(p_offline, false) THEN
    -- Online: nothing handed over yet, so refuse the whole dispense. The
    -- current balances of every lot of these medicines go back with the
    -- refusal so the device can correct the stock it shows.
    RETURN public.app_command_record(p_command_id, 'rx_dispense', 'rejected',
      jsonb_build_object(
        'reason', 'insufficient_stock',
        'lines', v_short,
        'items', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'on_hand_qty', on_hand_qty, 'row_version', row_version)), '[]'::jsonb)
            FROM public.pharmacy_items WHERE id = ANY (v_item_ids)),
        'batches', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'qty_on_hand', qty_on_hand, 'row_version', row_version)), '[]'::jsonb)
            FROM public.pharmacy_batches WHERE item_id = ANY (v_item_ids))),
      p_requested_by, v_at);
  END IF;

  PERFORM set_config('mbhr.stock_write', 'on', true);

  FOR v_alloc IN SELECT value FROM jsonb_array_elements(v_allocs) LOOP
    v_dispense_id := COALESCE(
      NULLIF(v_alloc -> 'dispense_ids' ->> ((v_alloc ->> 'k')::integer), ''),
      p_command_id::text || ':' || (v_alloc ->> 'line') || ':' || (v_alloc ->> 'k'));
    SELECT e INTO v_rx_line
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_rx.lines) = 'array' THEN v_rx.lines ELSE '[]'::jsonb END) AS e
     WHERE public.app_rx_item_id(e ->> 'itemId') = v_alloc ->> 'item_id'
     LIMIT 1;
    SELECT btrim(med_name || ' ' || strength) INTO v_item_name
      FROM public.pharmacy_items WHERE id = v_alloc ->> 'item_id';

    INSERT INTO public.dispenses (
      id, patient_id, visit_id, item_name, qty, dosage, directions, dispensed_by,
      dispensed_at, updated_at, prescription_id, item_id, batch_id)
    VALUES (
      v_dispense_id, v_patient, v_visit, v_item_name, (v_alloc ->> 'qty')::integer,
      v_rx_line ->> 'dosage',
      NULLIF(concat_ws(' · ', v_rx_line ->> 'frequency',
        CASE WHEN v_rx_line ? 'durationDays' THEN (v_rx_line ->> 'durationDays') || ' days' END,
        v_rx_line ->> 'notes'), ''),
      p_requested_by, v_at, clock_timestamp(), v_rx.id, v_alloc ->> 'item_id', v_alloc ->> 'batch_id');

    IF v_alloc ->> 'batch_id' IS NULL THEN
      -- Handed over offline beyond what the server holds: record it for the
      -- pharmacist to reconcile. No movement: balances never go below zero.
      INSERT INTO public.stock_discrepancies (
        item_id, qty_uncovered, dispense_id, prescription_id, command_id)
      VALUES (
        v_alloc ->> 'item_id', (v_alloc ->> 'qty')::integer, v_dispense_id, v_rx.id, p_command_id);
      CONTINUE;
    END IF;

    INSERT INTO public.stock_movements (
      id, item_id, batch_id, qty_delta, reason, prescription_id, dispense_id,
      command_id, requested_by, occurred_at)
    VALUES (
      'm:' || v_dispense_id, v_alloc ->> 'item_id', v_alloc ->> 'batch_id',
      -((v_alloc ->> 'qty')::integer), 'dispense', v_rx.id, v_dispense_id,
      p_command_id, p_requested_by, v_at);

    UPDATE public.pharmacy_batches
       SET qty_on_hand = qty_on_hand - (v_alloc ->> 'qty')::integer
     WHERE id = v_alloc ->> 'batch_id';
    UPDATE public.pharmacy_items
       SET on_hand_qty = on_hand_qty - (v_alloc ->> 'qty')::integer
     WHERE id = v_alloc ->> 'item_id';
  END LOOP;

  UPDATE public.prescriptions
     SET status = 'dispensed', dispensed_at = v_at, dispensed_by = p_requested_by
   WHERE id = v_rx.id;

  -- The bypass is transaction-local; turn it off so a later statement in
  -- the same transaction cannot write stock or prescriptions directly.
  PERFORM set_config('mbhr.stock_write', 'off', true);
  RETURN public.app_command_record(p_command_id, 'rx_dispense', 'applied',
    jsonb_build_object(
      'prescription_id', v_rx.id,
      'status', 'dispensed',
      'dispensed_at', v_at,
      'offline', COALESCE(p_offline, false),
      'allergy_override', COALESCE(p_allergy_override, false),
      'allocations', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'dispense_id', COALESCE(
                   NULLIF(a -> 'dispense_ids' ->> ((a ->> 'k')::integer), ''),
                   p_command_id::text || ':' || (a ->> 'line') || ':' || (a ->> 'k')),
                 'item_id', a ->> 'item_id',
                 'batch_id', a ->> 'batch_id',
                 'qty', (a ->> 'qty')::integer)), '[]'::jsonb)
          FROM jsonb_array_elements(v_allocs) AS a),
      'uncovered', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id', s ->> 'item_id', 'qty', (s ->> 'uncovered')::integer)), '[]'::jsonb)
          FROM jsonb_array_elements(v_short) AS s),
      'items', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'on_hand_qty', on_hand_qty, 'row_version', row_version)), '[]'::jsonb)
          FROM public.pharmacy_items WHERE id = ANY (v_item_ids)),
      'batches', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'qty_on_hand', qty_on_hand, 'row_version', row_version)), '[]'::jsonb)
          FROM public.pharmacy_batches
         WHERE id IN (SELECT a ->> 'batch_id' FROM jsonb_array_elements(v_allocs) AS a))),
    p_requested_by, v_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.rx_void_prescription(
  p_command_id uuid,
  p_prescription_id text,
  p_reason text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_requested_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prior jsonb;
  v_status text;
BEGIN
  IF NOT public.app_has_any_permission(ARRAY['consult', 'dispense']) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  v_prior := public.app_command_prior_result(p_command_id, 'rx_void_prescription');
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  SELECT status INTO v_status FROM public.prescriptions WHERE id = p_prescription_id FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN public.app_command_record(p_command_id, 'rx_void_prescription', 'rejected',
      jsonb_build_object('reason', 'prescription_not_found'), p_requested_by, p_occurred_at);
  END IF;
  IF v_status = 'void' THEN
    RETURN public.app_command_record(p_command_id, 'rx_void_prescription', 'applied',
      jsonb_build_object('status', 'void'), p_requested_by, p_occurred_at);
  END IF;
  IF v_status <> 'open' THEN
    RETURN public.app_command_record(p_command_id, 'rx_void_prescription', 'rejected',
      jsonb_build_object('reason', 'already_dispensed'), p_requested_by, p_occurred_at);
  END IF;
  UPDATE public.prescriptions
     SET status = 'void', voided_at = COALESCE(p_occurred_at, now()), voided_by = auth.uid(),
         void_reason = left(p_reason, 200)
   WHERE id = p_prescription_id;
  RETURN public.app_command_record(p_command_id, 'rx_void_prescription', 'applied',
    jsonb_build_object('status', 'void'), p_requested_by, p_occurred_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.rx_import_history(
  p_command_id uuid,
  p_prescription_id text,
  p_prescription jsonb,
  p_dispenses jsonb DEFAULT '[]'::jsonb,
  p_requested_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prior jsonb;
  v_status text := COALESCE(p_prescription ->> 'status', 'dispensed');
  v_existing text;
  v_patient text;
  v_was_dispensed boolean := false;
BEGIN
  IF NOT public.app_has_any_permission(ARRAY['dispense', 'inventory']) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  v_prior := public.app_command_prior_result(p_command_id, 'rx_import_history');
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_prescription_id IS NULL OR NULLIF(p_prescription ->> 'patient_id', '') IS NULL
     OR v_status NOT IN ('open', 'dispensed', 'partial', 'void') THEN
    RETURN public.app_command_record(p_command_id, 'rx_import_history', 'rejected',
      jsonb_build_object('reason', 'invalid_request'), p_requested_by, now());
  END IF;
  v_patient := public.canonical_patient_id(p_prescription ->> 'patient_id');
  IF jsonb_array_length(COALESCE(p_dispenses, '[]'::jsonb)) > 0
     AND NOT EXISTS (SELECT 1 FROM public.patients WHERE id::text = v_patient) THEN
    RAISE EXCEPTION 'patient_not_synced' USING ERRCODE = 'MBR01';
  END IF;

  PERFORM set_config('mbhr.stock_write', 'on', true);

  SELECT status INTO v_existing FROM public.prescriptions WHERE id = p_prescription_id FOR UPDATE;
  IF v_existing IS NULL THEN
    INSERT INTO public.prescriptions (
      id, visit_id, patient_id, prescriber_id, lines, created_at, status, dispensed_at, dispensed_by)
    VALUES (
      p_prescription_id,
      COALESCE(p_prescription ->> 'visit_id', ''),
      p_prescription ->> 'patient_id',
      COALESCE(NULLIF(p_prescription ->> 'prescriber_id', ''), ''),
      COALESCE(p_prescription -> 'lines', '[]'::jsonb),
      COALESCE((p_prescription ->> 'created_at')::timestamptz, now()),
      v_status,
      CASE WHEN v_status IN ('dispensed', 'partial')
           THEN COALESCE((p_prescription ->> 'dispensed_at')::timestamptz, now()) END,
      CASE WHEN v_status IN ('dispensed', 'partial') THEN p_requested_by END);
  ELSIF v_existing = 'open' AND v_status IN ('dispensed', 'partial', 'void') THEN
    UPDATE public.prescriptions
       SET status = v_status,
           dispensed_at = CASE WHEN v_status <> 'void'
                               THEN COALESCE((p_prescription ->> 'dispensed_at')::timestamptz, now()) END,
           dispensed_by = CASE WHEN v_status <> 'void' THEN p_requested_by END
     WHERE id = p_prescription_id;
  ELSIF v_existing IN ('dispensed', 'partial') AND v_status IN ('dispensed', 'partial') THEN
    v_was_dispensed := true;
  END IF;

  -- History only: no stock movement (the site's opening count already
  -- reflects what was given from stock that was only on a device).
  INSERT INTO public.dispenses (
    id, patient_id, visit_id, item_name, qty, dispensed_by, dispensed_at, updated_at,
    prescription_id, item_id, batch_id)
  SELECT
    d ->> 'id',
    v_patient,
    (SELECT v.id FROM public.visits AS v WHERE v.id::text = p_prescription ->> 'visit_id'),
    COALESCE(NULLIF(d ->> 'item_name', ''),
             (SELECT btrim(i.med_name || ' ' || i.strength) FROM public.pharmacy_items AS i
               WHERE i.id = public.app_rx_item_id(d ->> 'item_id'))),
    GREATEST(COALESCE((d ->> 'qty')::integer, 0), 0),
    d ->> 'dispensed_by',
    COALESCE((d ->> 'dispensed_at')::timestamptz, now()),
    clock_timestamp(),
    p_prescription_id,
    (SELECT i.id FROM public.pharmacy_items AS i WHERE i.id = public.app_rx_item_id(d ->> 'item_id')),
    (SELECT b.id FROM public.pharmacy_batches AS b WHERE b.id = d ->> 'batch_id')
  FROM jsonb_array_elements(COALESCE(p_dispenses, '[]'::jsonb)) AS d
  WHERE NULLIF(d ->> 'id', '') IS NOT NULL
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('mbhr.stock_write', 'off', true);
  RETURN public.app_command_record(p_command_id, 'rx_import_history', 'applied',
    jsonb_build_object('prescription_id', p_prescription_id, 'already_dispensed', v_was_dispensed),
    p_requested_by, now());
END;
$$;

CREATE OR REPLACE FUNCTION public.rx_resolve_discrepancy(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT public.app_has_permission('inventory') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  UPDATE public.stock_discrepancies
     SET status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
   WHERE id = p_id AND status = 'open';
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.stock_discrepancies WHERE id = p_id) THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'not_found');
  END IF;
  RETURN jsonb_build_object('outcome', 'applied');
END;
$$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.rx_register_item(uuid, text, jsonb, text)',
    'public.rx_set_item_active(uuid, text, boolean, text)',
    'public.rx_receive_stock(uuid, text, jsonb, integer, text, timestamptz, text, text, text)',
    'public.rx_adjust_stock(uuid, text, text, integer, text, text, timestamptz, text)',
    'public.rx_dispense(uuid, text, jsonb, timestamptz, boolean, boolean, text, jsonb)',
    'public.rx_void_prescription(uuid, text, text, timestamptz, text)',
    'public.rx_import_history(uuid, text, jsonb, jsonb, text)',
    'public.rx_resolve_discrepancy(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Row-level security
-- ----------------------------------------------------------------------------
-- Every existing policy on these tables is dropped and replaced. No table
-- here takes direct writes of balances: the RPCs above are the only path.
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pharmacy_items', 'pharmacy_batches', 'prescriptions', 'stock_movements',
    'stock_discrepancies', 'pharmacy_site_onboarding', 'pharmacy_item_aliases'
  ] LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
  END LOOP;
END $$;

-- Medicines: read by prescribers and pharmacy; metadata (reorder level,
-- name) editable with inventory. Created and deactivated through the RPCs;
-- never deleted (movements reference them).
CREATE POLICY pharmacy_items_select ON public.pharmacy_items FOR SELECT TO authenticated
  USING ((SELECT public.app_has_any_permission(ARRAY['dispense', 'inventory', 'consult'])));
CREATE POLICY pharmacy_items_update_inventory ON public.pharmacy_items FOR UPDATE TO authenticated
  USING ((SELECT public.app_has_permission('inventory')))
  WITH CHECK ((SELECT public.app_has_permission('inventory')));

CREATE POLICY pharmacy_batches_select ON public.pharmacy_batches FOR SELECT TO authenticated
  USING ((SELECT public.app_has_any_permission(ARRAY['dispense', 'inventory', 'consult'])));

CREATE POLICY pharmacy_item_aliases_select ON public.pharmacy_item_aliases FOR SELECT TO authenticated
  USING ((SELECT public.app_has_any_permission(ARRAY['dispense', 'inventory', 'consult'])));

-- Prescriptions: any staff reads (patient record); prescribers insert
-- (status forced to open by the guard); no direct update; admin deletes.
CREATE POLICY prescriptions_select_staff ON public.prescriptions FOR SELECT TO authenticated
  USING ((SELECT public.app_is_staff()));
CREATE POLICY prescriptions_insert_consult ON public.prescriptions FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.app_has_permission('consult')));
CREATE POLICY prescriptions_delete_admin ON public.prescriptions FOR DELETE TO authenticated
  USING ((SELECT public.app_has_permission('users')));

CREATE POLICY stock_movements_select ON public.stock_movements FOR SELECT TO authenticated
  USING ((SELECT public.app_has_any_permission(ARRAY['dispense', 'inventory'])));
CREATE POLICY stock_discrepancies_select ON public.stock_discrepancies FOR SELECT TO authenticated
  USING ((SELECT public.app_has_any_permission(ARRAY['dispense', 'inventory'])));
CREATE POLICY pharmacy_site_onboarding_select ON public.pharmacy_site_onboarding FOR SELECT TO authenticated
  USING ((SELECT public.app_has_permission('inventory')));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stock_movements FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stock_discrepancies FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pharmacy_site_onboarding FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pharmacy_item_aliases FROM authenticated;
REVOKE ALL ON public.stock_movements, public.stock_discrepancies,
  public.pharmacy_site_onboarding, public.pharmacy_item_aliases,
  public.stock_balance_drift, public.stock_item_balance_drift FROM anon;
GRANT SELECT ON public.stock_movements, public.stock_discrepancies,
  public.pharmacy_site_onboarding, public.pharmacy_item_aliases TO authenticated;
GRANT SELECT ON public.stock_balance_drift, public.stock_item_balance_drift TO authenticated;
GRANT ALL ON public.stock_movements, public.stock_discrepancies,
  public.pharmacy_site_onboarding, public.pharmacy_item_aliases TO service_role;

-- End of migration.
