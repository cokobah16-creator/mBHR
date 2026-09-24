-- ============================================================================
-- Queue transition audit trail (append-only).
--
-- Every queue change made in the app (new ticket, call, send on, end here,
-- move to front, remove, triage priority raised or lowered) is recorded on
-- the device in the same local transaction as the change, then uploaded
-- here by the sync (src/sync/adapter.ts, table "queue_transitions").
--
-- Rules:
--   * RLS on.
--   * INSERT: signed-in staff whose role may move patients through the
--     queue. The app allows "register" holders (volunteer, nurse, doctor,
--     lead_clinician, admin) at every stage and a pharmacist at the pharmacy
--     stage, so pharmacist is included; otherwise their rows could never
--     upload. The uploader must be the signed-in user (uploaded_by).
--   * SELECT: admin, auditor, lead_clinician only.
--   * No UPDATE or DELETE for anyone (no policy, privileges revoked, and a
--     trigger that rejects both, including for table owners' ad hoc SQL
--     through the API roles).
--
-- user_id / user_role / device_id are what the device recorded for the
-- person who made the change (user_id may be "system" for the automatic
-- long-wait escalation). uploaded_by is the server-verified account that
-- uploaded the row; the two can differ when a shared device syncs rows
-- recorded by several staff members.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.queue_transitions (
  id               text PRIMARY KEY,
  queue_item_id    text NOT NULL,
  to_queue_item_id text,
  patient_id       text NOT NULL,
  kind             text NOT NULL CHECK (kind IN (
                     'enqueue', 'requeue', 'call', 'send_on', 'end_here',
                     'prioritise', 'remove',
                     'priority_escalate', 'priority_downgrade')),
  from_stage       text CHECK (from_stage IS NULL OR from_stage IN (
                     'registration', 'vitals', 'consult', 'pharmacy')),
  to_stage         text NOT NULL CHECK (to_stage IN (
                     'registration', 'vitals', 'consult', 'pharmacy',
                     'done', 'removed')),
  from_status      text CHECK (from_status IS NULL OR from_status IN (
                     'waiting', 'in_progress', 'done')),
  to_status        text CHECK (to_status IS NULL OR to_status IN (
                     'waiting', 'in_progress', 'done')),
  from_priority    text CHECK (from_priority IS NULL OR from_priority IN (
                     'urgent', 'normal', 'low')),
  to_priority      text CHECK (to_priority IS NULL OR to_priority IN (
                     'urgent', 'normal', 'low')),
  reason           text CHECK (reason IS NULL OR char_length(reason) <= 500),
  user_id          text NOT NULL,
  user_role        text NOT NULL,
  device_id        text NOT NULL,
  at               timestamptz NOT NULL,
  uploaded_by      uuid NOT NULL DEFAULT auth.uid(),
  received_at      timestamptz NOT NULL DEFAULT now(),
  -- A downgrade must say why.
  CONSTRAINT queue_transitions_downgrade_reason CHECK (
    kind <> 'priority_downgrade'
    OR (reason IS NOT NULL AND char_length(btrim(reason)) > 0)
  )
);

COMMENT ON TABLE public.queue_transitions IS
  'Append-only audit of queue changes (who, which device, when, from/to stage and priority). Uploaded from devices; never updated or deleted.';

CREATE INDEX IF NOT EXISTS idx_queue_transitions_patient_at
  ON public.queue_transitions (patient_id, at);
CREATE INDEX IF NOT EXISTS idx_queue_transitions_queue_item
  ON public.queue_transitions (queue_item_id);
CREATE INDEX IF NOT EXISTS idx_queue_transitions_kind_at
  ON public.queue_transitions (kind, at);

ALTER TABLE public.queue_transitions ENABLE ROW LEVEL SECURITY;

-- Privileges: insert + select only. The app uploads with
-- upsert(..., ignoreDuplicates) = INSERT ... ON CONFLICT DO NOTHING, which
-- needs INSERT only.
REVOKE ALL ON public.queue_transitions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.queue_transitions TO authenticated;
GRANT ALL ON public.queue_transitions TO service_role;

DROP POLICY IF EXISTS "queue_transitions_insert_queue_staff" ON public.queue_transitions;
CREATE POLICY "queue_transitions_insert_queue_staff"
  ON public.queue_transitions FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND (SELECT public.has_role(
      'volunteer', 'nurse', 'doctor', 'lead_clinician', 'admin', 'pharmacist'
    ))
  );

DROP POLICY IF EXISTS "queue_transitions_select_audit_roles" ON public.queue_transitions;
CREATE POLICY "queue_transitions_select_audit_roles"
  ON public.queue_transitions FOR SELECT TO authenticated
  USING ((SELECT public.has_role('admin', 'auditor', 'lead_clinician')));

-- No UPDATE / DELETE policies: with RLS on, both are refused for
-- authenticated users. The trigger also refuses them for any role that
-- bypasses RLS through the API, so the trail stays append-only.
CREATE OR REPLACE FUNCTION public.queue_transitions_reject_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'queue_transitions is append-only (% refused)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_transitions_reject_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS queue_transitions_append_only ON public.queue_transitions;
CREATE TRIGGER queue_transitions_append_only
  BEFORE UPDATE OR DELETE ON public.queue_transitions
  FOR EACH ROW EXECUTE FUNCTION public.queue_transitions_reject_change();

-- TRUNCATE bypasses row triggers; refuse it too.
DROP TRIGGER IF EXISTS queue_transitions_no_truncate ON public.queue_transitions;
CREATE TRIGGER queue_transitions_no_truncate
  BEFORE TRUNCATE ON public.queue_transitions
  FOR EACH STATEMENT EXECUTE FUNCTION public.queue_transitions_reject_change();

-- End.
