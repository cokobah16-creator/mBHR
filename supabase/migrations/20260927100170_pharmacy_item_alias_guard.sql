/*
  # Medicine registration cannot re-point another medicine's id

  From the signed-in functions check of 28 Sept 2026
  (/mnt/project-files/hris-transform/secdef-audit-2026-09-28.md, F1).

  ## What was wrong
  rx_register_item maps a device's medicine id to the server's matching
  medicine (same site, name, form and strength) and re-points prescriptions
  that name the device's id. The first registration of an id won for good,
  whatever it said: an inventory holder could register a pending id (one
  prescriptions already name) with another medicine's details, and every
  prescription naming it, for any patient, then named that medicine, even
  dispensed ones. When the real device registered its medicine under that
  id later, the server created the item but kept resolving the id to the
  wrong one, and no app role could undo it. An inventory holder could also
  rename a medicine, or move it to another site, by writing the table
  directly.

  ## Changes
  1. An id already in use keeps its medicine. Registering it again with the
     same medicine returns that medicine as before (and re-points open
     prescriptions that still name the id). With different details it is
     refused ('item_id_conflict'), whether the id is a mapping or a
     medicine the server created under that id. Two registrations of one
     id at the same moment get the same answer. A registration whose
     medicine is itself in dispute is refused ('item_disputed') and no new
     id is mapped to it.
  2. A refused registration puts the id in dispute when a registration made
     it (a mapping, or a medicine created under a device's id): the server
     cannot tell which of the two accounts has the real medicine, so it
     stops using the id until an admin settles it.
     - Commands naming the id are refused ('item_not_found' or
       'unknown_item'), history imports included, instead of moving stock,
       dispensing or closing a prescription against the medicine the first
       registration named.
     - Open prescriptions this mapping re-pointed go back to the device's
       id, and new ones keep it.
     - A medicine created under the id is switched off, so it cannot be
       prescribed; switching it back on is refused while it is in dispute.
     Medicines not made by a registration (the server's own list) are only
     refused, never put in dispute.
  3. Each mapping and each medicine created under a device's id records who
     made it (created_by, registered_by); a mapping also records what the
     device said the medicine was (claimed). A dispute records when, who
     and what they said (disputed_at, disputed_by, disputed_claim).
  4. Only open prescriptions are re-pointed, and only when a line changes;
     dispensed or cancelled ones keep the lines they were dispensed or
     cancelled with. A re-pointed line keeps the device's id in
     deviceItemId, which only the server writes (a deviceItemId in an
     uploaded prescription is dropped).
  5. An id must be non-empty, without outer spaces or ':' and at most 128
     characters ('invalid_request'). Server medicine ids never start with
     'disputed:', the value the id lookup returns for an id in dispute.
  6. A medicine's id, name, form, strength, site, controlled-drug flag and
     on/off state change only through the pharmacy functions: an inventory
     holder's direct update of any of them is refused. The reorder level
     and unit stay editable, as before; the app writes neither directly.
  7. A prescription upload waits for a registration under way of any id its
     lines name, and the other way round, so a prescription uploaded while
     its id is being mapped or put in dispute follows the settled answer.

  ## Settling a dispute (admin, SQL editor)
  - Look: SELECT * FROM pharmacy_item_aliases WHERE disputed_at IS NOT NULL;
    SELECT * FROM pharmacy_items WHERE disputed_at IS NOT NULL;
  - A mapping whose first registration was right: set disputed_at,
    disputed_by and disputed_claim to NULL.
  - A mapping whose disputing registration was right: set item_id to the
    right medicine and the three columns to NULL.
  - A medicine created under a device's id: when the disputing claim's
    medicine is already on that site's list, add a mapping from the id to
    it (INSERT INTO pharmacy_item_aliases (alias_id, item_id, claimed))
    and leave the medicine switched off and in dispute; otherwise correct
    its details, set the three columns to NULL and is_active to true.
  - Every dispute one account raised: the same updates, WHERE disputed_by
    is that account.
  - Then, for each settled id, re-point its open prescriptions:
    UPDATE prescriptions SET lines = app_rx_canonical_lines(lines)
     WHERE status = 'open' AND lines @> '[{"itemId":"<id>"}]';
  The device whose registration was refused keeps showing the refusal; its
  later commands for the id are accepted.

  ## Not changed
  - The server cannot tell which device an id really came from:
    prescription lines carry only the id. An inventory holder who registers
    a pending id first, with another medicine's details, still maps it
    until the real device registers it; from then the id is in dispute and
    not used, and the mapping shows who made it and what they claimed.
  - The reverse is possible: an inventory holder can put a registered id in
    dispute by registering it with other details, every such id at once if
    they like. That stops those medicines being used, visibly and under
    their name, but never records the wrong medicine; the last settling
    step above undoes all of one account's disputes.
  - The controlled-drug flag, unit and reorder level are not part of what
    makes two registrations the same medicine: the first registration's
    are kept (the app shows the flag as a badge only).
  - Stock adjustments name a lot, not a medicine id, and still apply to the
    lots of a medicine in dispute.
  - Grants and every function's signature.

  ## Rollback
    Re-run rx_register_item, app_rx_item_id, app_rx_canonical_lines and
    tg_rx_canonical_lines from 20260925100400_pharmacy_stock_ledger.sql and
    rx_import_history from 20260927100150_staff_role_checks.sql;
    DROP TRIGGER rx_guard_identity ON public.pharmacy_items;
    ALTER TABLE public.pharmacy_items DROP CONSTRAINT pharmacy_items_id_not_disputed;
    The new columns can stay (nullable).
*/

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.pharmacy_item_aliases
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS claimed jsonb,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_by uuid,
  ADD COLUMN IF NOT EXISTS disputed_claim jsonb;

ALTER TABLE public.pharmacy_items
  ADD COLUMN IF NOT EXISTS registered_by uuid,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_by uuid,
  ADD COLUMN IF NOT EXISTS disputed_claim jsonb;

COMMENT ON COLUMN public.pharmacy_item_aliases.created_by IS 'Account whose registration made this mapping (20260927100170).';
COMMENT ON COLUMN public.pharmacy_item_aliases.claimed IS 'What that registration said the medicine was: med_name, form, strength, site_key.';
COMMENT ON COLUMN public.pharmacy_item_aliases.disputed_at IS 'Set when a later registration said this id is another medicine; the id is not used until an admin clears it (20260927100170).';
COMMENT ON COLUMN public.pharmacy_item_aliases.disputed_by IS 'Account whose registration disputed this mapping.';
COMMENT ON COLUMN public.pharmacy_item_aliases.disputed_claim IS 'What the disputing registration said the medicine was.';
COMMENT ON COLUMN public.pharmacy_items.registered_by IS 'Account whose registration created this medicine under its device id (20260927100170); NULL for the server''s own list.';
COMMENT ON COLUMN public.pharmacy_items.disputed_at IS 'Set when a later registration said this id is another medicine; the id is not used until an admin clears it (20260927100170).';
COMMENT ON COLUMN public.pharmacy_items.disputed_by IS 'Account whose registration disputed this medicine.';
COMMENT ON COLUMN public.pharmacy_items.disputed_claim IS 'What the disputing registration said the medicine was.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.pharmacy_items'::regclass
                    AND conname = 'pharmacy_items_id_not_disputed') THEN
    ALTER TABLE public.pharmacy_items
      ADD CONSTRAINT pharmacy_items_id_not_disputed CHECK (id NOT LIKE 'disputed:%');
  END IF;
END;
$$;

-- What a medicine is changes only through the pharmacy functions; the
-- reorder level and unit stay editable by inventory holders.
DROP TRIGGER IF EXISTS rx_guard_identity ON public.pharmacy_items;
CREATE TRIGGER rx_guard_identity BEFORE UPDATE ON public.pharmacy_items
  FOR EACH ROW EXECUTE FUNCTION public.app_guard_immutable_columns(
    '', 'id', 'med_name', 'form', 'strength', 'site_key', 'is_controlled', 'is_active',
    'registered_by', 'disputed_at', 'disputed_by', 'disputed_claim');

-- The medicine an id stands for. An id in dispute (its mapping, or the
-- medicine it names) comes back as 'disputed:<id>', which names no
-- medicine, so commands naming it are refused (20260927100170).
CREATE OR REPLACE FUNCTION public.app_rx_item_id(p_id text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT CASE
           WHEN a.disputed_at IS NOT NULL OR i.disputed_at IS NOT NULL THEN 'disputed:' || p_id
           ELSE COALESCE(a.item_id, p_id)
         END
    FROM (SELECT 1) AS one
    LEFT JOIN public.pharmacy_item_aliases AS a ON a.alias_id = p_id
    LEFT JOIN public.pharmacy_items AS i ON i.id = COALESCE(a.item_id, p_id);
$function$;

-- Prescription lines with each device id replaced by the server's medicine
-- id. A replaced line keeps the device's id in deviceItemId; an id in
-- dispute is left as it is (20260927100170).
CREATE OR REPLACE FUNCTION public.app_rx_canonical_lines(p_lines jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT CASE
           WHEN jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN p_lines
           ELSE COALESCE((
             SELECT jsonb_agg(
                      CASE
                        WHEN m.item_id IS NULL
                          OR m.item_id = e ->> 'itemId'
                          OR m.item_id LIKE 'disputed:%'
                          THEN e
                        ELSE e || jsonb_build_object(
                                    'itemId', m.item_id,
                                    'deviceItemId', COALESCE(e ->> 'deviceItemId', e ->> 'itemId'))
                      END
                      ORDER BY ord)
               FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(e, ord)
               CROSS JOIN LATERAL (
                 SELECT CASE WHEN jsonb_typeof(e) = 'object'
                             THEN public.app_rx_item_id(e ->> 'itemId') END AS item_id) AS m), '[]'::jsonb)
         END;
$function$;

CREATE OR REPLACE FUNCTION public.rx_register_item(p_command_id uuid, p_item_id text, p_item jsonb, p_requested_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_prior jsonb;
  v_id text;
  v_mapped text;
  v_alias public.pharmacy_item_aliases%ROWTYPE;
  v_item public.pharmacy_items%ROWTYPE;
  v_site text := NULLIF(p_item ->> 'site_key', '');
  v_name text := btrim(COALESCE(p_item ->> 'med_name', ''));
  v_form text := btrim(COALESCE(p_item ->> 'form', ''));
  v_strength text := btrim(COALESCE(p_item ->> 'strength', ''));
  v_claim jsonb;
  v_qty integer;
BEGIN
  IF NOT public.app_has_permission('inventory') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  v_prior := public.app_command_prior_result(p_command_id, 'rx_register_item');
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_item_id IS NULL OR p_item_id = '' OR p_item_id <> btrim(p_item_id)
     OR length(p_item_id) > 128 OR position(':' IN p_item_id) > 0
     OR v_name = '' THEN
    RETURN public.app_command_record(p_command_id, 'rx_register_item', 'rejected',
      jsonb_build_object('reason', 'invalid_request'), p_requested_by, now());
  END IF;
  v_claim := jsonb_build_object('med_name', v_name, 'form', v_form, 'strength', v_strength, 'site_key', v_site);

  -- One registration of an id at a time (the mapping below is decided once).
  PERFORM pg_advisory_xact_lock(hashtextextended('rx_register_item:' || p_item_id, 0));

  -- An id already mapped to a medicine stays mapped (20260927100170): the
  -- same medicine gets the same answer; different details are refused and
  -- put the mapping in dispute.
  SELECT * INTO v_alias FROM public.pharmacy_item_aliases AS a WHERE a.alias_id = p_item_id;
  IF FOUND THEN
    IF v_alias.disputed_at IS NULL
       AND EXISTS (SELECT 1 FROM public.pharmacy_items AS i
                    WHERE i.id = v_alias.item_id
                      AND COALESCE(i.site_key, '') = COALESCE(v_site, '')
                      AND lower(i.med_name) = lower(v_name)
                      AND lower(i.form) = lower(v_form)
                      AND lower(i.strength) = lower(v_strength)) THEN
      IF EXISTS (SELECT 1 FROM public.pharmacy_items AS i
                  WHERE i.id = v_alias.item_id AND i.disputed_at IS NOT NULL) THEN
        RETURN public.app_command_record(p_command_id, 'rx_register_item', 'rejected',
          jsonb_build_object('reason', 'item_disputed'), p_requested_by, now());
      END IF;
      -- Open prescriptions uploaded with the device's id after the mapping
      -- was made now name the kept medicine too.
      UPDATE public.prescriptions
         SET lines = public.app_rx_canonical_lines(lines)
       WHERE status = 'open'
         AND jsonb_typeof(lines) = 'array'
         AND lines @> jsonb_build_array(jsonb_build_object('itemId', p_item_id))
         AND public.app_rx_canonical_lines(lines) IS DISTINCT FROM lines;
      SELECT on_hand_qty INTO v_qty FROM public.pharmacy_items WHERE id = v_alias.item_id;
      RETURN public.app_command_record(p_command_id, 'rx_register_item', 'applied',
        jsonb_build_object('item_id', v_alias.item_id, 'on_hand_qty', v_qty), p_requested_by, now());
    END IF;
    IF v_alias.disputed_at IS NULL THEN
      UPDATE public.pharmacy_item_aliases
         SET disputed_at = now(), disputed_by = auth.uid(), disputed_claim = v_claim
       WHERE alias_id = p_item_id;
      -- Open prescriptions this mapping re-pointed go back to the device's
      -- id (new ones keep it: app_rx_canonical_lines leaves an id in
      -- dispute as it is).
      UPDATE public.prescriptions
         SET lines = (SELECT jsonb_agg(
                               CASE WHEN jsonb_typeof(e) = 'object' AND e ->> 'deviceItemId' = p_item_id
                                    THEN (e - 'deviceItemId') || jsonb_build_object('itemId', p_item_id)
                                    ELSE e END
                               ORDER BY ord)
                        FROM jsonb_array_elements(lines) WITH ORDINALITY AS t(e, ord))
       WHERE status = 'open'
         AND jsonb_typeof(lines) = 'array'
         AND lines @> jsonb_build_array(jsonb_build_object('deviceItemId', p_item_id));
    END IF;
    RETURN public.app_command_record(p_command_id, 'rx_register_item', 'rejected',
      jsonb_build_object('reason', 'item_id_conflict'), p_requested_by, now());
  END IF;

  -- An id that is already a medicine's own id: the same medicine gets the
  -- same answer; different details are refused, and put the medicine in
  -- dispute when a registration created it (20260927100170).
  SELECT * INTO v_item FROM public.pharmacy_items WHERE id = p_item_id;
  IF FOUND THEN
    IF v_item.disputed_at IS NULL
       AND COALESCE(v_item.site_key, '') = COALESCE(v_site, '')
       AND lower(v_item.med_name) = lower(v_name)
       AND lower(v_item.form) = lower(v_form)
       AND lower(v_item.strength) = lower(v_strength) THEN
      RETURN public.app_command_record(p_command_id, 'rx_register_item', 'applied',
        jsonb_build_object('item_id', v_item.id, 'on_hand_qty', v_item.on_hand_qty), p_requested_by, now());
    END IF;
    IF v_item.disputed_at IS NULL AND v_item.registered_by IS NOT NULL THEN
      UPDATE public.pharmacy_items
         SET disputed_at = now(), disputed_by = auth.uid(), disputed_claim = v_claim, is_active = false
       WHERE id = p_item_id;
    END IF;
    RETURN public.app_command_record(p_command_id, 'rx_register_item', 'rejected',
      jsonb_build_object('reason', 'item_id_conflict'), p_requested_by, now());
  END IF;

  SELECT id INTO v_id
    FROM public.pharmacy_items
   WHERE COALESCE(site_key, '') = COALESCE(v_site, '')
     AND lower(med_name) = lower(v_name)
     AND lower(form) = lower(v_form)
     AND lower(strength) = lower(v_strength)
   ORDER BY id
   LIMIT 1;
  IF v_id IS NULL THEN
    BEGIN
      INSERT INTO public.pharmacy_items (
        id, med_name, form, strength, unit, on_hand_qty, reorder_threshold,
        is_controlled, is_active, site_key, registered_by)
      VALUES (
        p_item_id, v_name, v_form, v_strength, COALESCE(p_item ->> 'unit', ''), 0,
        GREATEST(COALESCE((p_item ->> 'reorder_threshold')::integer, 0), 0),
        COALESCE((p_item ->> 'is_controlled')::boolean, false), true, v_site, auth.uid());
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
  -- The matching medicine is in dispute: no new id is mapped to it until an
  -- admin settles it (20260927100170).
  IF v_id <> p_item_id
     AND EXISTS (SELECT 1 FROM public.pharmacy_items AS i WHERE i.id = v_id AND i.disputed_at IS NOT NULL) THEN
    RETURN public.app_command_record(p_command_id, 'rx_register_item', 'rejected',
      jsonb_build_object('reason', 'item_disputed'), p_requested_by, now());
  END IF;
  IF v_id <> p_item_id THEN
    INSERT INTO public.pharmacy_item_aliases (alias_id, item_id, created_by, claimed)
    VALUES (p_item_id, v_id, auth.uid(), v_claim)
    ON CONFLICT (alias_id) DO NOTHING;
    SELECT a.item_id INTO v_mapped FROM public.pharmacy_item_aliases AS a WHERE a.alias_id = p_item_id;
    IF v_mapped IS DISTINCT FROM v_id THEN
      RETURN public.app_command_record(p_command_id, 'rx_register_item', 'rejected',
        jsonb_build_object('reason', 'item_id_conflict'), p_requested_by, now());
    END IF;
    -- Open prescriptions already uploaded with the device's id now name the
    -- kept medicine (their new updated_at makes devices download them).
    -- Dispensed and cancelled ones keep their lines (20260927100170).
    UPDATE public.prescriptions
       SET lines = public.app_rx_canonical_lines(lines)
     WHERE status = 'open'
       AND jsonb_typeof(lines) = 'array'
       AND lines @> jsonb_build_array(jsonb_build_object('itemId', p_item_id))
       AND public.app_rx_canonical_lines(lines) IS DISTINCT FROM lines;
  END IF;
  SELECT on_hand_qty INTO v_qty FROM public.pharmacy_items WHERE id = v_id;
  RETURN public.app_command_record(p_command_id, 'rx_register_item', 'applied',
    jsonb_build_object('item_id', v_id, 'on_hand_qty', v_qty), p_requested_by, now());
END;
$function$;

-- A prescription's lines are read under the same per-id lock a registration
-- takes, so a prescription uploaded while its id is being mapped or put in
-- dispute gets the answer that registration settles on. Only the server
-- writes deviceItemId (20260927100170).
CREATE OR REPLACE FUNCTION public.tg_rx_canonical_lines()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF jsonb_typeof(NEW.lines) = 'array' THEN
    NEW.lines := (SELECT COALESCE(jsonb_agg(CASE WHEN jsonb_typeof(e) = 'object' THEN e - 'deviceItemId' ELSE e END
                                            ORDER BY ord), '[]'::jsonb)
                    FROM jsonb_array_elements(NEW.lines) WITH ORDINALITY AS t(e, ord));
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('rx_register_item:' || ids.item_id, 0))
       FROM (SELECT DISTINCT e ->> 'itemId' AS item_id
               FROM jsonb_array_elements(NEW.lines) AS e
              WHERE jsonb_typeof(e) = 'object' AND (e ->> 'itemId') IS NOT NULL
              ORDER BY 1) AS ids;
  END IF;
  NEW.lines := public.app_rx_canonical_lines(NEW.lines);
  RETURN NEW;
END;
$function$;

-- History for a medicine id in dispute is refused (20260927100170); the
-- rest is as in 20260927100150_staff_role_checks.sql.
CREATE OR REPLACE FUNCTION public.rx_import_history(p_command_id uuid, p_prescription_id text, p_prescription jsonb, p_dispenses jsonb DEFAULT '[]'::jsonb, p_requested_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_prior jsonb;
  v_status text := COALESCE(p_prescription ->> 'status', 'dispensed');
  v_existing text;
  v_existing_patient text;
  v_existing_lines jsonb;
  v_patient text;
  v_was_dispensed boolean := false;
  v_given jsonb;
  v_prescribed jsonb;
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

  SELECT status, patient_id, lines INTO v_existing, v_existing_patient, v_existing_lines
    FROM public.prescriptions WHERE id = p_prescription_id FOR UPDATE;

  -- History is imported as dispensed or partial only (20260927100150): an
  -- open prescription is uploaded by a prescriber (or carried by
  -- rx_dispense), and a cancellation goes through rx_void_prescription,
  -- which records who cancelled it and why. A new prescription must name
  -- a staff member who may prescribe.
  IF v_status NOT IN ('dispensed', 'partial') THEN
    PERFORM set_config('mbhr.stock_write', 'off', true);
    RETURN public.app_command_record(p_command_id, 'rx_import_history', 'rejected',
      jsonb_build_object('reason', 'status_not_allowed', 'status', v_status), p_requested_by, now());
  END IF;
  IF v_existing IS NULL AND NOT public.app_staff_may_prescribe(p_prescription ->> 'prescriber_id') THEN
    PERFORM set_config('mbhr.stock_write', 'off', true);
    RETURN public.app_command_record(p_command_id, 'rx_import_history', 'rejected',
      jsonb_build_object('reason', 'prescriber_not_allowed'), p_requested_by, now());
  END IF;
  -- History belongs to the prescription it names (20260927100150): the
  -- dispense rows go on the prescription's own patient, never on a void
  -- prescription, and not beyond what it prescribes. A prescription the
  -- server already has as dispensed keeps its own history.
  IF v_existing = 'void' THEN
    PERFORM set_config('mbhr.stock_write', 'off', true);
    RETURN public.app_command_record(p_command_id, 'rx_import_history', 'rejected',
      jsonb_build_object('reason', 'prescription_void'), p_requested_by, now());
  END IF;
  IF v_existing IS NOT NULL
     AND public.canonical_patient_id(v_existing_patient) IS DISTINCT FROM v_patient THEN
    PERFORM set_config('mbhr.stock_write', 'off', true);
    RETURN public.app_command_record(p_command_id, 'rx_import_history', 'rejected',
      jsonb_build_object('reason', 'patient_mismatch'), p_requested_by, now());
  END IF;
  IF v_existing IS NULL OR v_existing = 'open' THEN
    SELECT COALESCE(jsonb_object_agg(item_id, qty), '{}'::jsonb) INTO v_given
      FROM (SELECT COALESCE(public.app_rx_item_id(d ->> 'item_id'), '') AS item_id,
                   SUM(GREATEST(COALESCE((d ->> 'qty')::integer, 0), 0)) AS qty
              FROM jsonb_array_elements(COALESCE(p_dispenses, '[]'::jsonb)) AS d
             WHERE NULLIF(d ->> 'id', '') IS NOT NULL
             GROUP BY 1) AS s;
    SELECT COALESCE(jsonb_object_agg(item_id, qty), '{}'::jsonb) INTO v_prescribed
      FROM (SELECT COALESCE(public.app_rx_item_id(e ->> 'itemId'), '') AS item_id,
                   SUM(COALESCE((e ->> 'qty')::integer, 0)) AS qty
              FROM jsonb_array_elements(
                     CASE WHEN v_existing IS NOT NULL AND jsonb_typeof(v_existing_lines) = 'array' THEN v_existing_lines
                          WHEN v_existing IS NULL AND jsonb_typeof(p_prescription -> 'lines') = 'array' THEN p_prescription -> 'lines'
                          ELSE '[]'::jsonb END) AS e
             GROUP BY 1) AS s;
    -- A medicine id in dispute names no medicine: its history waits until
    -- an admin settles the dispute, and an open prescription naming it is
    -- not closed (20260927100170).
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_given) AS k WHERE k LIKE 'disputed:%')
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_prescribed) AS k WHERE k LIKE 'disputed:%') THEN
      PERFORM set_config('mbhr.stock_write', 'off', true);
      RETURN public.app_command_record(p_command_id, 'rx_import_history', 'rejected',
        jsonb_build_object('reason', 'unknown_item'), p_requested_by, now());
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each_text(v_given) AS g
                WHERE g.key = ''
                   OR (v_prescribed ->> g.key) IS NULL
                   OR g.value::integer > (v_prescribed ->> g.key)::integer) THEN
      PERFORM set_config('mbhr.stock_write', 'off', true);
      RETURN public.app_command_record(p_command_id, 'rx_import_history', 'rejected',
        jsonb_build_object('reason', 'dispenses_exceed_prescription'), p_requested_by, now());
    END IF;
  END IF;

  IF v_existing IS NULL THEN
    INSERT INTO public.prescriptions (
      id, visit_id, patient_id, prescriber_id, lines, created_at, status, dispensed_at, dispensed_by)
    VALUES (
      p_prescription_id,
      COALESCE(p_prescription ->> 'visit_id', ''),
      p_prescription ->> 'patient_id',
      (p_prescription ->> 'prescriber_id')::uuid::text,
      COALESCE(p_prescription -> 'lines', '[]'::jsonb),
      COALESCE((p_prescription ->> 'created_at')::timestamptz, now()),
      v_status,
      CASE WHEN v_status IN ('dispensed', 'partial')
           THEN COALESCE((p_prescription ->> 'dispensed_at')::timestamptz, now()) END,
      CASE WHEN v_status IN ('dispensed', 'partial') THEN p_requested_by END);
  ELSIF v_existing = 'open' THEN
    UPDATE public.prescriptions
       SET status = v_status,
           dispensed_at = COALESCE((p_prescription ->> 'dispensed_at')::timestamptz, now()),
           dispensed_by = p_requested_by
     WHERE id = p_prescription_id;
  ELSIF v_existing IN ('dispensed', 'partial') THEN
    v_was_dispensed := true;
  END IF;

  -- History only: no stock movement (the site's opening count already
  -- reflects what was given from stock that was only on a device).
  IF NOT v_was_dispensed THEN
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
  END IF;

  PERFORM set_config('mbhr.stock_write', 'off', true);
  RETURN public.app_command_record(p_command_id, 'rx_import_history', 'applied',
    jsonb_build_object('prescription_id', p_prescription_id, 'already_dispensed', v_was_dispensed),
    p_requested_by, now());
END;
$function$;
