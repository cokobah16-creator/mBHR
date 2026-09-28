/*
  # Staff role checks: prescriptions, merges and triage

  From the signed-in functions check of 28 Sept 2026
  (/mnt/project-files/hris-transform/secdef-audit-2026-09-28.md, G2-1,
  G2-4, G2-5, G3-2 and G6-1). Each let a staff role do something its permission
  does not allow, by naming someone else or by going through a function
  that skipped the check. None is reachable on production today (one staff
  account; no prescriptions, dispenses, merges or priority changes), but
  all must be closed before more staff are added.

  How offline work reaches the server, which these checks keep working:
  /mnt/project-files/hris-transform/role-fix-sync-paths-2026-09-28.md.
  Commands are sent only under their author's own online sign-in; a device
  uploads unsent prescriptions (when a prescriber signs in) and queue
  changes (whoever signs in) for every staff member who worked on it.

  ## What was wrong
  - rx_dispense: a pharmacist (no 'consult') could create a prescription
    for any patient and medicine, in any prescriber's name or a made-up
    one, and dispense it from stock in the same call. With no prescriber
    named, the sender was taken as the prescriber.
  - rx_import_history: a 'dispense' or 'inventory' holder could create
    prescriptions in any status (open ones could then be dispensed from
    stock) for any prescriber, and cancel an open prescription without the
    record rx_void_prescription keeps (who, when, why). Its history rows
    took the patient from the payload, not the prescription, and were
    added to void or already-dispensed prescriptions in any quantity
    (G2-5).
  - merge_patients: the auditor role holds merge_patients but not
    'register' or 'portal_manage'. A merge let it write any value into a
    patient's name, date of birth, phone, email or address (a 'custom'
    field choice; the identity guards do not run inside the function), move
    a portal sign-in to another record (on the record, or through
    patient_portal_users), switch portal access on, and put another
    patient's history under a portal login by merging it into that record.
  - tg_queue_transition_apply: a queue role without 'consult' (volunteer,
    nurse, pharmacist, registration lead) could lower a patient's triage
    priority by naming a real doctor in the uploaded row, or by deleting
    the queue row and adding it again with a lower priority.

  ## Changes
  1. public.app_staff_may_prescribe(text): true for the id of an active
     staff member whose role holds 'consult' (doctor, lead clinician,
     admin) or is 'nurse' (the app lets nurses prescribe today; whether it
     should is open in docs/clinical/CLINICAL_LOGIC_CHANGES.md 2.4 "Nurse
     prescribing"). Internal: no grant to anon or authenticated.
  2. rx_dispense: a carried prescription the server does not have yet must
     name such a prescriber, or the command is refused
     ('prescriber_not_allowed') and nothing is written. The sender is no
     longer used as the prescriber, and a prescriber uuid is stored in its
     canonical lower-case form. A prescription already on the server is
     used as before (the carried copy is ignored). A dispense refused for
     any other reason still saves the carried prescription as open, as
     before: the app counts on that and does not upload it again.
  3. rx_import_history: only 'dispensed' and 'partial' are accepted
     ('status_not_allowed' otherwise; the app never sends 'open' or
     'void' here). A new prescription must name a prescriber as in 2
     ('prescriber_not_allowed'). An open prescription on the server still
     becomes dispensed or partial. The history rows go on the
     prescription's own patient ('patient_mismatch' if the device names
     another), never on a void prescription ('prescription_void'), and not
     beyond the prescribed quantity of each medicine
     ('dispenses_exceed_prescription'); a prescription the server already
     has as dispensed keeps its own history (the rows sent are not added).
  4. merge_patients: choosing field values needs 'register'. A merge in
     which either record has a portal login (patients.auth_uid or a
     patient_portal_users row), or which would switch portal access on,
     needs 'portal_manage'. Both are 42501 before anything is written, so
     a backfill waits for a holder and an authored command is refused. A
     field value is applied only when it matches the winner's or the
     loser's value on the server (text compared after trimming, other
     columns as their type), whatever source the device names, and the
     server's own copy is written; any other value is skipped and the
     device takes the server's value back. Every current merge path sends
     no choices or the loser's values, so nurses, doctors, lead clinicians
     and admins merge as before; the auditor can still merge two records
     without portal logins when nothing else changes.
  5. tg_queue_transition_apply: a priority downgrade applies only when the
     recorded user is an active clinician on the server (role read from
     app_users, not from the row) AND the uploading account holds
     'consult'. A downgrade synced by a non-clinician is kept with
     applied = false and reject_reason 'uploaded_by_non_clinician'; the
     patient keeps the higher priority until a clinician lowers it again.
     A downgrade with no target priority is refused ('not_a_downgrade').
     For sign-off: docs/clinical/CLINICAL_LOGIC_CHANGES.md 2.4 "Who may
     lower a patient's queue priority".
  6. queue: signed-in staff can no longer delete queue rows (policy
     queue_delete_queue dropped, DELETE revoked from authenticated). The
     app never deletes a queue row on the server (a removal is a 'remove'
     transition), and without a delete a row cannot be added again with a
     lower priority.

  ## Not changed
  - Who is recorded as prescriber, dispenser or merger (dispensed_by and
    merged_by still come from the device) and the device-sent times:
    that is fix 3 of the check (attribution), which keeps the device's
    record and adds the server-verified account beside it. Until then a
    pharmacist can still save or dispense a prescription naming a real
    doctor or nurse; the carrying account is already kept in
    command_receipts.actor_id and stock_movements.actor_id.
  - A prescription naming someone no longer on the active staff list (left,
    deactivated or demoted since writing it), or a device-only staff id
    from a build without online sync, is refused as in 2 and 3. A refused
    hand-over is listed on the device for reconciliation, like any other
    refused hand-over; the triage equivalent keeps the higher priority.
  - A loser's email chosen in a merge is still skipped (unique index: the
    loser still holds it until the merge ends).
  - A consult holder uploading prescriptions directly (row-level security
    prescriptions_insert_consult) is unchanged.
  - Grants: CREATE OR REPLACE keeps each function's owner and grants.

  ## Rollback
    Re-run the four bodies as they were before this file:
    rx_dispense and rx_import_history from
    20260925100400_pharmacy_stock_ledger.sql, merge_patients from
    20260925100300 (as amended by later files; take the body from
    pg_get_functiondef on a copy of production before this file), and
    tg_queue_transition_apply from 20260925100200. Then
    DROP FUNCTION public.app_staff_may_prescribe(text); and, for 6,
    GRANT DELETE ON public.queue TO authenticated; and re-create policy
    queue_delete_queue as in 20260925100200 (not needed by the app).
*/

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Who may be named as a prescriber
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_staff_may_prescribe(p_user_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role text;
BEGIN
  -- Staff ids are uuids; anything else (a device-only id, a name) is not
  -- a staff member on the server.
  IF p_user_id IS NULL
     OR p_user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  v_role := public.app_staff_role_of(p_user_id::uuid);
  RETURN v_role IS NOT NULL
     AND (public.app_role_has_permission(v_role, 'consult') OR v_role = 'nurse');
END;
$$;

COMMENT ON FUNCTION public.app_staff_may_prescribe(text) IS
  'True for an active staff member whose role holds consult or is nurse (the roles the app lets prescribe). A prescription the server did not get from a prescriber''s own upload must name one (20260927100150).';

REVOKE ALL ON FUNCTION public.app_staff_may_prescribe(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_staff_may_prescribe(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. rx_dispense: a carried prescription names a prescriber
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rx_dispense(p_command_id uuid, p_prescription_id text, p_lines jsonb, p_occurred_at timestamp with time zone DEFAULT now(), p_offline boolean DEFAULT false, p_allergy_override boolean DEFAULT false, p_requested_by text DEFAULT NULL::text, p_prescription jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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

  -- A prescription written offline on this device may not be uploaded yet
  -- (a pharmacist's sign-in does not upload prescriptions): the command
  -- carries it (inserted as open, like an upload). It must name a staff
  -- member who may prescribe (20260927100150); the sender is never taken
  -- as the prescriber.
  IF p_prescription IS NOT NULL AND NULLIF(p_prescription ->> 'patient_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.prescriptions WHERE id = p_prescription_id) THEN
    IF NOT public.app_staff_may_prescribe(p_prescription ->> 'prescriber_id') THEN
      RETURN public.app_command_record(p_command_id, 'rx_dispense', 'rejected',
        jsonb_build_object('reason', 'prescriber_not_allowed'), p_requested_by, v_at);
    END IF;
    INSERT INTO public.prescriptions (id, visit_id, patient_id, prescriber_id, lines, created_at, status)
    VALUES (
      p_prescription_id,
      COALESCE(p_prescription ->> 'visit_id', ''),
      p_prescription ->> 'patient_id',
      (p_prescription ->> 'prescriber_id')::uuid::text,
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
$function$;

-- ---------------------------------------------------------------------------
-- 3. rx_import_history: history only, from a prescriber
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. merge_patients: details and portal access need their own permissions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_patients(p_command_id uuid, p_winner_id text, p_loser_id text, p_field_choices jsonb DEFAULT '{}'::jsonb, p_requested_by text DEFAULT NULL::text, p_requested_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_source text DEFAULT 'conflict_review'::text, p_merge_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  v_moves_sign_in boolean;
  v_enables_portal boolean;
  v_has_portal_login boolean;
  v_source_name text;
  v_source_json jsonb;
  v_same boolean;
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

  -- What this merge would change beyond the records' history
  -- (20260927100150). merge_patients alone (the auditor's only right here)
  -- does not let a caller change a patient's details or portal access:
  -- choosing field values needs 'register', and a merge that touches a
  -- record with a portal login, or switches portal access on, needs
  -- 'portal_manage', as they would outside a merge. A portal login is
  -- patients.auth_uid or a patient_portal_users row (both give access,
  -- app_portal_patient_ids); merging into a record with one puts the other
  -- record's history under that login, and a login row on the merged-away
  -- record moves with its history. Refused with 42501 before anything is
  -- written, so a backfill waits for someone who holds them and an
  -- authored command is refused.
  v_moves_sign_in := (v_loser_json ->> 'auth_uid') IS NOT NULL AND (v_root_json ->> 'auth_uid') IS NULL;
  v_enables_portal := COALESCE((v_loser_json ->> 'portal_enabled')::boolean, false)
     AND NOT COALESCE((v_root_json ->> 'portal_enabled')::boolean, false)
     AND (v_root_json ->> 'portal_enabled_changed_at') IS NULL
     AND NOT COALESCE((v_root_json ->> 'portal_opt_out')::boolean, false);
  v_has_portal_login := (v_loser_json ->> 'auth_uid') IS NOT NULL
     OR (v_root_json ->> 'auth_uid') IS NOT NULL;
  IF NOT v_has_portal_login AND to_regclass('public.patient_portal_users') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.patient_portal_users AS u '
            'WHERE u.patient_id::text IN ($1, $2))'
      INTO v_has_portal_login USING v_root, p_loser_id;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_field_choices, '{}'::jsonb)))
     AND NOT public.app_has_permission('register') THEN
    RAISE EXCEPTION 'register permission required to choose field values in a merge'
      USING ERRCODE = '42501';
  END IF;
  IF (v_has_portal_login OR v_enables_portal) AND NOT public.app_has_permission('portal_manage') THEN
    RAISE EXCEPTION 'portal_manage permission required: this merge involves portal access'
      USING ERRCODE = '42501';
  END IF;

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

    -- Only a value one of the two records holds on the server is applied,
    -- whatever source the device names (20260927100150): a merge chooses
    -- between the records, it does not type in new details, and the
    -- identity guards do not run inside this function. The device trims
    -- text and may send a date as a timestamp, so values are compared as
    -- the column's type (text after trimming), and the server's own copy
    -- is written. A device's older copy of a value that has changed since
    -- is skipped, and the device takes the server's value back.
    BEGIN
      v_choice_source := NULL;
      FOR v_source_name, v_source_json IN
        SELECT t.n, t.j FROM (VALUES (1, 'winner', v_root_json), (2, 'loser', v_loser_json)) AS t(o, n, j)
         ORDER BY t.o
      LOOP
        EXECUTE format(
          'SELECT CASE WHEN $3 THEN btrim($1) IS NOT DISTINCT FROM btrim($2) '
          'ELSE $1::%1$s IS NOT DISTINCT FROM $2::%1$s END', v_type)
          INTO v_same
          USING v_text, v_source_json ->> v_key,
                v_type IN ('text', 'character varying') OR v_type LIKE 'character varying(%';
        IF v_same THEN
          v_choice_source := v_source_name;
          v_text := v_source_json ->> v_key;
          v_value := COALESCE(v_source_json -> v_key, 'null'::jsonb);
          EXIT;
        END IF;
      END LOOP;
    EXCEPTION WHEN data_exception THEN
      v_choice_source := NULL;
    END;
    IF v_choice_source IS NULL THEN
      v_skipped := v_skipped || v_key;
      CONTINUE;
    END IF;
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
  IF v_moves_sign_in THEN
    UPDATE public.patients SET auth_uid = NULL WHERE id::text = p_loser_id;
    UPDATE public.patients SET auth_uid = v_loser.auth_uid WHERE id::text = v_root;
    v_portal_moved := true;
  END IF;
  IF v_enables_portal THEN
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
$function$;

-- ---------------------------------------------------------------------------
-- 5. Lowering triage priority: a clinician's own upload
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_queue_transition_apply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_status text;
  v_stage text;
  v_priority text;
  v_ticket text;
  v_recorded_role text;
BEGIN
  -- A resend of a stored row (the upload is INSERT ... ON CONFLICT DO
  -- NOTHING, and BEFORE triggers still fire): never apply it twice.
  IF EXISTS (SELECT 1 FROM public.queue_transitions WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;
  -- The outcome is the server's to record, never the device's.
  NEW.applied := NULL;
  NEW.reject_reason := NULL;

  SELECT q.status::text, q.stage::text, q.priority::text, q.ticket_id
    INTO v_status, v_stage, v_priority, v_ticket
    FROM public.queue AS q
   WHERE q.id::text = NEW.queue_item_id
   FOR UPDATE;
  IF NOT FOUND THEN
    NEW.applied := false;
    NEW.reject_reason := 'queue_row_missing';
    RETURN NEW;
  END IF;
  NEW.ticket_id := v_ticket;

  IF NEW.kind IN ('call', 'send_on', 'end_here', 'remove') THEN
    IF NEW.to_status IS NULL THEN
      NEW.applied := false;
      NEW.reject_reason := 'no_target_status';
    ELSIF v_status IS NOT DISTINCT FROM NEW.to_status THEN
      NEW.applied := false;
      NEW.reject_reason := 'already_in_state';
    ELSIF v_status IS NOT DISTINCT FROM NEW.from_status
          AND (NEW.from_stage IS NULL OR v_stage IS NOT DISTINCT FROM NEW.from_stage) THEN
      UPDATE public.queue SET status = NEW.to_status WHERE id::text = NEW.queue_item_id;
      NEW.applied := true;
    ELSE
      NEW.applied := false;
      NEW.reject_reason := 'stale_from_state';
    END IF;

  ELSIF NEW.kind = 'priority_downgrade' THEN
    -- Only a clinician (consult permission) may lower triage priority
    -- (owner decision 3.3 in docs/clinical/CLINICAL_LOGIC_CHANGES.md). The
    -- recorded user must be an active clinician on the server (their role
    -- is read from app_users, not from the row), AND the account uploading
    -- the row must hold 'consult' itself (20260927100150). A device uploads
    -- every unsent row whoever is signed in, and a row cannot show whether
    -- the named clinician really made the change, so a downgrade synced by
    -- a non-clinician is recorded but not applied: the patient keeps the
    -- higher priority until a clinician lowers it again. The reason is
    -- required by the table's CHECK.
    v_recorded_role := CASE
      WHEN NEW.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.app_staff_role_of(NEW.user_id::uuid) END;
    IF v_recorded_role IS NULL
       OR NOT public.app_role_has_permission(v_recorded_role, 'consult') THEN
      NEW.applied := false;
      NEW.reject_reason := 'not_a_clinician';
    ELSIF NOT public.app_has_permission('consult') THEN
      NEW.applied := false;
      NEW.reject_reason := 'uploaded_by_non_clinician';
    ELSIF public.app_queue_priority_rank(v_priority)
          IS DISTINCT FROM public.app_queue_priority_rank(NEW.from_priority) THEN
      NEW.applied := false;
      NEW.reject_reason := 'stale_from_state';
    ELSIF NEW.to_priority IS NULL
          OR public.app_queue_priority_rank(NEW.to_priority)
             >= public.app_queue_priority_rank(v_priority) THEN
      NEW.applied := false;
      NEW.reject_reason := 'not_a_downgrade';
    ELSE
      UPDATE public.queue SET priority = NEW.to_priority WHERE id::text = NEW.queue_item_id;
      NEW.applied := true;
    END IF;

  ELSIF NEW.kind = 'priority_escalate' THEN
    IF public.app_queue_priority_rank(NEW.to_priority) > public.app_queue_priority_rank(v_priority) THEN
      UPDATE public.queue SET priority = NEW.to_priority WHERE id::text = NEW.queue_item_id;
      NEW.applied := true;
    ELSE
      NEW.applied := false;
      NEW.reject_reason := 'already_in_state';
    END IF;

  ELSE
    -- enqueue, requeue, prioritise: the queue row upload carries the change
    -- (a new row, or its position).
    NEW.applied := true;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. queue: no deletes by signed-in staff
-- ---------------------------------------------------------------------------
-- Deleting a queue row and adding it again was a way round the priority
-- clamp in tg_queue_guard_authoritative (it clamps updates only). The app
-- never deletes a queue row on the server: a removal is a 'remove'
-- transition, and the row stays as the record of the visit.
DO $$
BEGIN
  IF to_regclass('public.queue') IS NULL THEN
    RETURN;
  END IF;
  DROP POLICY IF EXISTS queue_delete_queue ON public.queue;
  REVOKE DELETE ON public.queue FROM anon, authenticated;
END $$;
