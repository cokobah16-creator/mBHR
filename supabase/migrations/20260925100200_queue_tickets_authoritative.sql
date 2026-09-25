-- ============================================================================
-- Queue tickets and queue state become server-authoritative (Wave B, item 2)
-- ============================================================================
-- Runs after 20260924120000_add_queue_transitions_audit.sql (queue_transitions)
-- and 20260925100000_sync_authority_foundation.sql (queue ticket columns,
-- tg_server_stamp(), canonical_patient_id(), the 'queue' permission).
--
-- Owner decision: ticket numbers sync, so a second queue screen and the
-- waiting-room display on another device show the same numbers, and two
-- devices never issue the same number.
--
--   1. queue_tickets: one ticket per patient, site and service day (the
--      Africa/Lagos calendar day). Labels are unique per site and day.
--      queue_ticket_counters holds the next number per site and day, and
--      queue_ticket_leases records blocks of numbers handed to a device so
--      it can issue real numbers offline (src/services/queueTicketStore.ts).
--   2. issue_queue_ticket(): confirms a ticket issued on a device. Idempotent
--      on the ticket id, converges to one ticket per patient/site/day, keeps
--      a device's leased or temporary label when it is free.
--      lease_ticket_block(): hands a device the next block of numbers.
--   3. Guard on queue: an upload cannot change status or stage (they change
--      only through queue_transitions), cannot lower the priority (only an
--      audited priority_downgrade transition by a clinician can), and the
--      ticket link and label always come from queue_tickets.
--   4. queue_transitions: each row is applied to its queue row as it
--      arrives, with a compare-and-set on the recorded "from" state; the
--      outcome is kept on the row (applied, reject_reason). Its insert and
--      select policies now use the permission helpers ('queue' to insert,
--      'audit_access' to read).
--   5. Row-level security for the new tables; queue writes need 'queue'.
--   6. Realtime: queue and queue_tickets are published so the waiting-room
--      display updates within seconds.
--   7. Backfill: service_date for existing queue rows (Lagos day of
--      queued_at).
--
-- Idempotent: every statement can be re-run.
--
-- Rollback (in this order):
--   DROP TRIGGER queue_transitions_apply ON public.queue_transitions;
--   DROP TRIGGER queue_guard_authoritative ON public.queue;
--   ALTER TABLE public.queue DROP CONSTRAINT queue_ticket_id_fkey;
--   DROP FUNCTION public.tg_queue_transition_apply(), public.tg_queue_guard_authoritative(),
--     public.issue_queue_ticket(text, text, date, text, integer, text, text),
--     public.lease_ticket_block(text, date, text, integer),
--     public.app_queue_allocate_seq(text, date, integer),
--     public.app_queue_ticket_label(integer), public.app_queue_priority_rank(text);
--   DROP TABLE public.queue_ticket_leases, public.queue_ticket_counters, public.queue_tickets;
--   re-create the two queue_transitions policies from 20260924120000 and the
--   queue policies from 20260924110100. The added queue_transitions columns
--   can stay.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.queue_tickets (
  id            text PRIMARY KEY,                 -- client ULID
  site_key      text NOT NULL CHECK (char_length(site_key) BETWEEN 1 AND 64),
  service_date  date NOT NULL,                    -- Africa/Lagos day
  seq           integer CHECK (seq IS NULL OR seq > 0),  -- null: temporary label
  ticket_number text NOT NULL CHECK (char_length(ticket_number) BETWEEN 1 AND 32),
  provisional   boolean NOT NULL DEFAULT false,
  patient_id    text NOT NULL,
  issued_by     uuid NOT NULL DEFAULT auth.uid(),
  device_id     text CHECK (device_id IS NULL OR char_length(device_id) <= 128),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  row_version   bigint NOT NULL DEFAULT 1,
  CONSTRAINT queue_tickets_number_per_day UNIQUE (site_key, service_date, ticket_number),
  CONSTRAINT queue_tickets_patient_per_day UNIQUE (site_key, service_date, patient_id)
);

COMMENT ON TABLE public.queue_tickets IS
  'One queue ticket per patient, site and Africa/Lagos service day. Written only by issue_queue_ticket().';

CREATE INDEX IF NOT EXISTS idx_queue_tickets_updated_at ON public.queue_tickets (updated_at);
CREATE INDEX IF NOT EXISTS idx_queue_tickets_patient ON public.queue_tickets (patient_id);

-- patient_id references patients(id) when the id types match (they drifted
-- between environments; the foundation migration handles the same case).
DO $$
DECLARE
  v_id_type text;
BEGIN
  IF to_regclass('public.patients') IS NULL THEN
    RAISE WARNING 'queue tickets: table public.patients does not exist, foreign key skipped';
    RETURN;
  END IF;
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_id_type
    FROM pg_attribute AS a
   WHERE a.attrelid = 'public.patients'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
  IF v_id_type <> 'text' THEN
    RAISE WARNING 'queue tickets: patients.id is %, foreign key on queue_tickets.patient_id skipped', v_id_type;
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.queue_tickets'::regclass AND conname = 'queue_tickets_patient_id_fkey'
  ) THEN
    ALTER TABLE public.queue_tickets
      ADD CONSTRAINT queue_tickets_patient_id_fkey
      FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
  END IF;
END $$;

DROP TRIGGER IF EXISTS zz_server_stamp ON public.queue_tickets;
CREATE TRIGGER zz_server_stamp BEFORE INSERT OR UPDATE ON public.queue_tickets
  FOR EACH ROW EXECUTE FUNCTION public.tg_server_stamp();

CREATE TABLE IF NOT EXISTS public.queue_ticket_counters (
  site_key     text NOT NULL,
  service_date date NOT NULL,
  next_seq     integer NOT NULL DEFAULT 1 CHECK (next_seq > 0),
  PRIMARY KEY (site_key, service_date)
);

COMMENT ON TABLE public.queue_ticket_counters IS
  'Next queue ticket number per site and service day. Written only by the ticket RPCs (row lock = no duplicates).';

CREATE TABLE IF NOT EXISTS public.queue_ticket_leases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_key     text NOT NULL,
  service_date date NOT NULL,
  device_id    text NOT NULL CHECK (char_length(device_id) BETWEEN 1 AND 128),
  start_seq    integer NOT NULL CHECK (start_seq > 0),
  end_seq      integer NOT NULL,
  leased_by    uuid NOT NULL DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT queue_ticket_leases_range CHECK (end_seq >= start_seq)
);

COMMENT ON TABLE public.queue_ticket_leases IS
  'Blocks of ticket numbers handed to one device for one site and day, so it can issue real numbers offline.';

CREATE INDEX IF NOT EXISTS idx_queue_ticket_leases_device
  ON public.queue_ticket_leases (site_key, service_date, device_id);

-- ----------------------------------------------------------------------------
-- 2. queue: ticket foreign key; queue_transitions: outcome columns
-- ----------------------------------------------------------------------------
-- Devices may already have uploaded their own (unconfirmed) ticket ids into
-- queue.ticket_id. Clear the ones with no server ticket before adding the
-- foreign key; the next confirmation links the rows again.
DO $$
BEGIN
  IF to_regclass('public.queue') IS NULL THEN
    RAISE WARNING 'queue tickets: table public.queue does not exist, skipped';
    RETURN;
  END IF;
  UPDATE public.queue AS q
     SET ticket_id = NULL
   WHERE q.ticket_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.queue_tickets AS t WHERE t.id = q.ticket_id);
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.queue'::regclass AND conname = 'queue_ticket_id_fkey'
  ) THEN
    ALTER TABLE public.queue
      ADD CONSTRAINT queue_ticket_id_fkey
      FOREIGN KEY (ticket_id) REFERENCES public.queue_tickets(id) ON DELETE SET NULL;
  END IF;
  CREATE INDEX IF NOT EXISTS idx_queue_ticket_id ON public.queue (ticket_id);
END $$;

ALTER TABLE public.queue_transitions
  ADD COLUMN IF NOT EXISTS ticket_id text,
  ADD COLUMN IF NOT EXISTS applied boolean,
  ADD COLUMN IF NOT EXISTS reject_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.queue_transitions'::regclass
       AND conname = 'queue_transitions_reject_reason_len'
  ) THEN
    ALTER TABLE public.queue_transitions
      ADD CONSTRAINT queue_transitions_reject_reason_len
      CHECK (reject_reason IS NULL OR char_length(reject_reason) <= 64);
  END IF;
END $$;

COMMENT ON COLUMN public.queue_transitions.applied IS
  'Set by the server on arrival: true when the change was applied to the queue row, false when refused (see reject_reason). NULL for rows uploaded before 20260925100200.';

-- ----------------------------------------------------------------------------
-- 3. Helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_queue_priority_rank(p_priority text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE p_priority WHEN 'urgent' THEN 2 WHEN 'low' THEN 0 ELSE 1 END;
$$;

-- 7 -> 'Q-007'; 1204 -> 'Q-1204' (never truncated). Same as the app's
-- formatTicketNumber().
CREATE OR REPLACE FUNCTION public.app_queue_ticket_label(p_seq integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT 'Q-' || CASE WHEN p_seq < 1000 THEN lpad(p_seq::text, 3, '0') ELSE p_seq::text END;
$$;

-- Reserve p_count consecutive numbers for a site and day and return the
-- first. The counter row is locked by the upsert, so concurrent callers get
-- distinct numbers.
CREATE OR REPLACE FUNCTION public.app_queue_allocate_seq(
  p_site_key text,
  p_service_date date,
  p_count integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO public.queue_ticket_counters AS c (site_key, service_date, next_seq)
  VALUES (p_site_key, p_service_date, 1 + p_count)
  ON CONFLICT (site_key, service_date)
  DO UPDATE SET next_seq = c.next_seq + p_count
  RETURNING c.next_seq INTO v_next;
  RETURN v_next - p_count;
END;
$$;

REVOKE ALL ON FUNCTION public.app_queue_allocate_seq(text, date, integer)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Ticket RPCs
-- ----------------------------------------------------------------------------
-- Hand a device the next block of numbers for a site and day.
CREATE OR REPLACE FUNCTION public.lease_ticket_block(
  p_site_key text,
  p_service_date date,
  p_device_id text,
  p_size integer DEFAULT 20
)
RETURNS TABLE (lease_id uuid, start_seq integer, end_seq integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_size integer := LEAST(GREATEST(COALESCE(p_size, 20), 1), 100);
  v_start integer;
  v_id uuid;
BEGIN
  IF NOT public.app_has_permission('queue') THEN
    RAISE EXCEPTION 'This account cannot issue queue tickets.' USING ERRCODE = '42501';
  END IF;
  IF p_site_key IS NULL OR btrim(p_site_key) = '' OR char_length(p_site_key) > 64
     OR p_service_date IS NULL
     OR p_device_id IS NULL OR btrim(p_device_id) = '' OR char_length(p_device_id) > 128 THEN
    RAISE EXCEPTION 'lease_ticket_block: site, day and device are required'
      USING ERRCODE = '22023';
  END IF;
  -- Only today or tomorrow (Lagos): a wrong device clock must not burn
  -- numbers for other days.
  IF p_service_date NOT BETWEEN (now() AT TIME ZONE 'Africa/Lagos')::date - 1
                            AND (now() AT TIME ZONE 'Africa/Lagos')::date + 1 THEN
    RAISE EXCEPTION 'lease_ticket_block: service day out of range' USING ERRCODE = '22023';
  END IF;

  v_start := public.app_queue_allocate_seq(p_site_key, p_service_date, v_size);
  INSERT INTO public.queue_ticket_leases (site_key, service_date, device_id, start_seq, end_seq)
  VALUES (p_site_key, p_service_date, p_device_id, v_start, v_start + v_size - 1)
  RETURNING id INTO v_id;

  lease_id := v_id;
  start_seq := v_start;
  end_seq := v_start + v_size - 1;
  RETURN NEXT;
END;
$$;

-- Confirm a ticket issued on a device. Answers
--   {outcome: 'applied', ticket_id, ticket_number, provisional, seq, relabelled}
-- or {outcome: 'rejected', reason}. Business refusals are returned (the
-- device retries 'patient_not_found' after the patient record uploads);
-- only a missing permission raises (42501).
--
-- Rules, in order:
--   - the same ticket id again: the stored ticket (idempotent resend);
--   - the patient (after merges) already has a ticket for this site and
--     day: that ticket (two desks issued one each: both converge on it);
--   - p_leased_seq inside one of this device's leases for the site and
--     day, label free: that number;
--   - otherwise the device's temporary label ("K7-003") if it is free,
--     kept as provisional, because the patient may already have been
--     called by it. A "Q-" label is kept only with a verified lease: any
--     other Q- number could belong to another device's block;
--   - otherwise the next number from the counter (the device relabels and
--     tells staff).
CREATE OR REPLACE FUNCTION public.issue_queue_ticket(
  p_ticket_id text,
  p_site_key text,
  p_service_date date,
  p_patient_id text,
  p_leased_seq integer DEFAULT NULL,
  p_provisional_label text DEFAULT NULL,
  p_device_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_patient text;
  v_ticket public.queue_tickets%ROWTYPE;
  v_label text;
  v_seq integer;
  v_provisional boolean;
  v_wanted text;
  v_tries integer := 0;
BEGIN
  IF NOT public.app_has_permission('queue') THEN
    RAISE EXCEPTION 'This account cannot issue queue tickets.' USING ERRCODE = '42501';
  END IF;
  IF p_ticket_id IS NULL OR btrim(p_ticket_id) = '' OR char_length(p_ticket_id) > 64
     OR p_site_key IS NULL OR btrim(p_site_key) = '' OR char_length(p_site_key) > 64
     OR p_service_date IS NULL
     OR p_patient_id IS NULL OR btrim(p_patient_id) = ''
     OR (p_provisional_label IS NOT NULL AND char_length(p_provisional_label) > 32) THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_input');
  END IF;

  -- Same ticket again (a resend after a lost reply).
  SELECT * INTO v_ticket FROM public.queue_tickets WHERE id = p_ticket_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'applied', 'ticket_id', v_ticket.id, 'ticket_number', v_ticket.ticket_number,
      'provisional', v_ticket.provisional, 'seq', v_ticket.seq, 'relabelled', false);
  END IF;

  v_patient := public.canonical_patient_id(p_patient_id);
  IF NOT EXISTS (SELECT 1 FROM public.patients WHERE id::text = v_patient) THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'patient_not_found');
  END IF;

  -- Serialise issuing for this site and day: the upsert locks the counter
  -- row until this transaction ends, so two desks confirming the same
  -- patient at once converge on one ticket.
  PERFORM public.app_queue_allocate_seq(p_site_key, p_service_date, 0);

  SELECT * INTO v_ticket FROM public.queue_tickets
   WHERE site_key = p_site_key AND service_date = p_service_date AND patient_id = v_patient;
  IF NOT FOUND THEN
    v_label := NULL;
    v_seq := NULL;
    v_provisional := true;

    IF p_leased_seq IS NOT NULL AND p_device_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.queue_ticket_leases AS l
          WHERE l.site_key = p_site_key AND l.service_date = p_service_date
            AND l.device_id = p_device_id
            AND p_leased_seq BETWEEN l.start_seq AND l.end_seq) THEN
      v_wanted := public.app_queue_ticket_label(p_leased_seq);
      IF NOT EXISTS (SELECT 1 FROM public.queue_tickets
                      WHERE site_key = p_site_key AND service_date = p_service_date
                        AND ticket_number = v_wanted) THEN
        v_label := v_wanted;
        v_seq := p_leased_seq;
        v_provisional := false;
      END IF;
    END IF;

    IF v_label IS NULL THEN
      v_wanted := COALESCE(
        NULLIF(btrim(p_provisional_label), ''),
        CASE WHEN p_leased_seq IS NOT NULL THEN public.app_queue_ticket_label(p_leased_seq) END);
      -- A made-up label that looks like a server number is only kept when
      -- it came from a verified lease (above); anything else in the Q-
      -- range could clash with a number another device holds.
      IF v_wanted IS NOT NULL AND v_wanted !~ '^Q-[0-9]+$' AND NOT EXISTS (
           SELECT 1 FROM public.queue_tickets
            WHERE site_key = p_site_key AND service_date = p_service_date
              AND ticket_number = v_wanted) THEN
        v_label := v_wanted;
        v_provisional := true;
      END IF;
    END IF;

    WHILE v_label IS NULL LOOP
      v_tries := v_tries + 1;
      IF v_tries > 50 THEN
        RAISE EXCEPTION 'issue_queue_ticket: no free ticket number' USING ERRCODE = 'P0001';
      END IF;
      v_seq := public.app_queue_allocate_seq(p_site_key, p_service_date, 1);
      v_wanted := public.app_queue_ticket_label(v_seq);
      IF NOT EXISTS (SELECT 1 FROM public.queue_tickets
                      WHERE site_key = p_site_key AND service_date = p_service_date
                        AND ticket_number = v_wanted) THEN
        v_label := v_wanted;
        v_provisional := false;
      END IF;
    END LOOP;

    INSERT INTO public.queue_tickets (
      id, site_key, service_date, seq, ticket_number, provisional, patient_id, device_id)
    VALUES (
      p_ticket_id, p_site_key, p_service_date, v_seq, v_label, v_provisional, v_patient, p_device_id)
    RETURNING * INTO v_ticket;
  END IF;

  -- Link this patient's queue rows for the site and day to the ticket (the
  -- server stamp bumps them, so every device downloads the label).
  UPDATE public.queue AS q
     SET ticket_id = v_ticket.id,
         ticket_number = v_ticket.ticket_number
   WHERE q.site_key = p_site_key
     AND q.service_date = p_service_date
     AND q.patient_id::text IN (p_patient_id, v_patient)
     AND (q.ticket_id IS DISTINCT FROM v_ticket.id
          OR q.ticket_number IS DISTINCT FROM v_ticket.ticket_number);

  RETURN jsonb_build_object(
    'outcome', 'applied', 'ticket_id', v_ticket.id, 'ticket_number', v_ticket.ticket_number,
    'provisional', v_ticket.provisional, 'seq', v_ticket.seq,
    'relabelled', v_ticket.id <> p_ticket_id);
END;
$$;

REVOKE ALL ON FUNCTION public.lease_ticket_block(text, date, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_queue_ticket(text, text, date, text, integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lease_ticket_block(text, date, text, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_queue_ticket(text, text, date, text, integer, text, text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Guard on queue uploads
-- ----------------------------------------------------------------------------
-- For the API roles only (SECURITY DEFINER functions, service_role and
-- migrations are not restricted):
--   * UPDATE keeps status and stage: they change only through
--     queue_transitions (section 6). A new row is taken as sent.
--   * UPDATE never lowers the priority: urgent stays urgent until a
--     clinician's priority_downgrade transition arrives. Raising is allowed.
--   * site_key and service_date are set once.
--   * The ticket link and label always come from queue_tickets: the
--     patient's ticket for the site and day when there is one; an id the
--     server does not know (a device ticket not confirmed yet) is not linked.
CREATE OR REPLACE FUNCTION public.tg_queue_guard_authoritative()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_ticket_id text;
  v_label text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon')
     OR current_setting('mbhr.queue_transition', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.status := OLD.status;
    NEW.stage := OLD.stage;
    IF public.app_queue_priority_rank(NEW.priority) < public.app_queue_priority_rank(OLD.priority) THEN
      NEW.priority := OLD.priority;
    END IF;
    NEW.site_key := COALESCE(OLD.site_key, NEW.site_key);
    NEW.service_date := COALESCE(OLD.service_date, NEW.service_date);
  END IF;

  IF NEW.site_key IS NOT NULL AND NEW.service_date IS NOT NULL AND NEW.patient_id IS NOT NULL THEN
    SELECT t.id, t.ticket_number INTO v_ticket_id, v_label
      FROM public.queue_tickets AS t
     WHERE t.site_key = NEW.site_key
       AND t.service_date = NEW.service_date
       AND t.patient_id = public.canonical_patient_id(NEW.patient_id::text);
    IF v_ticket_id IS NOT NULL THEN
      NEW.ticket_id := v_ticket_id;
      NEW.ticket_number := v_label;
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.ticket_id IS NOT NULL THEN
    SELECT t.ticket_number INTO v_label FROM public.queue_tickets AS t WHERE t.id = NEW.ticket_id;
    IF v_label IS NOT NULL THEN
      NEW.ticket_number := v_label;
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.ticket_id := OLD.ticket_id;
    ELSE
      NEW.ticket_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_queue_guard_authoritative() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.queue') IS NULL THEN
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS queue_guard_authoritative ON public.queue;
  CREATE TRIGGER queue_guard_authoritative
    BEFORE INSERT OR UPDATE ON public.queue
    FOR EACH ROW EXECUTE FUNCTION public.tg_queue_guard_authoritative();
END $$;

-- ----------------------------------------------------------------------------
-- 6. queue_transitions: apply each change as it arrives
-- ----------------------------------------------------------------------------
-- Runs as the function owner, so its queue UPDATE passes the guard above.
-- Compare-and-set: the change applies only when the queue row is still in
-- the state the device saw (from_status / from_stage / from_priority).
-- Otherwise the row is kept as audit with applied = false and a reason; the
-- device downloads the server's state on its next sync.
CREATE OR REPLACE FUNCTION public.tg_queue_transition_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_status text;
  v_stage text;
  v_priority text;
  v_ticket text;
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
    -- Only a clinician (consult permission) may lower triage priority. The
    -- device checked the signed-in role; user_id and user_role are what it
    -- recorded, so they are not trusted on their own: the recorded role
    -- must hold 'consult' AND either the account uploading it holds
    -- 'consult' or the recorded user is a known clinician in app_users (a
    -- clinician's change synced later by a colleague on the same device).
    -- The reason is required by the table's CHECK.
    IF NOT public.app_role_has_permission(NEW.user_role, 'consult')
       OR NOT (
         public.app_has_permission('consult')
         OR EXISTS (
           SELECT 1 FROM public.app_users AS au
            WHERE au.id::text = NEW.user_id
              AND public.app_role_has_permission(au.role::text, 'consult'))
       ) THEN
      NEW.applied := false;
      NEW.reject_reason := 'not_a_clinician';
    ELSIF public.app_queue_priority_rank(v_priority)
          IS DISTINCT FROM public.app_queue_priority_rank(NEW.from_priority) THEN
      NEW.applied := false;
      NEW.reject_reason := 'stale_from_state';
    ELSIF public.app_queue_priority_rank(NEW.to_priority)
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
$$;

REVOKE ALL ON FUNCTION public.tg_queue_transition_apply() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS queue_transitions_apply ON public.queue_transitions;
CREATE TRIGGER queue_transitions_apply
  BEFORE INSERT ON public.queue_transitions
  FOR EACH ROW EXECUTE FUNCTION public.tg_queue_transition_apply();

-- ----------------------------------------------------------------------------
-- 7. Row-level security
-- ----------------------------------------------------------------------------
-- queue_transitions: the permission helpers replace the role lists.
DROP POLICY IF EXISTS "queue_transitions_insert_queue_staff" ON public.queue_transitions;
CREATE POLICY "queue_transitions_insert_queue_staff"
  ON public.queue_transitions FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND (SELECT public.app_has_permission('queue'))
  );

DROP POLICY IF EXISTS "queue_transitions_select_audit_roles" ON public.queue_transitions;
CREATE POLICY "queue_transitions_select_audit_roles"
  ON public.queue_transitions FOR SELECT TO authenticated
  USING ((SELECT public.app_has_permission('audit_access')));

-- queue: every staff member reads (clinical screens, the display); writes
-- need 'queue' (the same people as app_is_station_staff()).
-- The migration-only helpers app_rls_reset()/app_rls_policy() were dropped
-- in 20260924110400, so the same steps are written out here: drop every
-- policy on queue (whatever its name), enable RLS, revoke anon, recreate.
DO $$
DECLARE
  v_policy record;
BEGIN
  IF to_regclass('public.queue') IS NULL THEN
    RAISE WARNING 'queue tickets: table public.queue does not exist, policies skipped';
    RETURN;
  END IF;
  FOR v_policy IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'queue'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.queue', v_policy.policyname);
  END LOOP;
  ALTER TABLE public.queue ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.queue FROM anon;

  CREATE POLICY queue_select_staff ON public.queue
    AS PERMISSIVE FOR SELECT TO authenticated
    USING ((SELECT public.app_is_staff()));
  CREATE POLICY queue_insert_queue ON public.queue
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.app_has_permission('queue')));
  CREATE POLICY queue_update_queue ON public.queue
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING ((SELECT public.app_has_permission('queue')))
    WITH CHECK ((SELECT public.app_has_permission('queue')));
  CREATE POLICY queue_delete_queue ON public.queue
    AS PERMISSIVE FOR DELETE TO authenticated
    USING ((SELECT public.app_has_permission('queue')));
END $$;

-- queue_tickets: read by staff; written only by issue_queue_ticket().
ALTER TABLE public.queue_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.queue_tickets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.queue_tickets TO authenticated;
GRANT ALL ON public.queue_tickets TO service_role;
DROP POLICY IF EXISTS queue_tickets_select_staff ON public.queue_tickets;
CREATE POLICY queue_tickets_select_staff
  ON public.queue_tickets FOR SELECT TO authenticated
  USING ((SELECT public.app_is_staff()));

-- Leases: readable by queue staff; written only by lease_ticket_block().
ALTER TABLE public.queue_ticket_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.queue_ticket_leases FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.queue_ticket_leases TO authenticated;
GRANT ALL ON public.queue_ticket_leases TO service_role;
DROP POLICY IF EXISTS queue_ticket_leases_select_queue ON public.queue_ticket_leases;
CREATE POLICY queue_ticket_leases_select_queue
  ON public.queue_ticket_leases FOR SELECT TO authenticated
  USING ((SELECT public.app_has_permission('queue')));

-- Counters: no client access at all.
ALTER TABLE public.queue_ticket_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.queue_ticket_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.queue_ticket_counters TO service_role;

-- ----------------------------------------------------------------------------
-- 8. Realtime (the waiting-room display re-syncs when the queue changes)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE WARNING 'queue tickets: publication supabase_realtime does not exist, skipped';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['queue', 'queue_tickets'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 9. Backfill: service day of existing queue rows (Africa/Lagos)
-- ----------------------------------------------------------------------------
-- Runs as the migration owner (the guard does not apply). The server stamp
-- bumps these rows, so devices download their service day once.
DO $$
BEGIN
  IF to_regclass('public.queue') IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.queue
     SET service_date = (queued_at AT TIME ZONE 'Africa/Lagos')::date
   WHERE service_date IS NULL
     AND queued_at IS NOT NULL;
END $$;

-- End of migration.
