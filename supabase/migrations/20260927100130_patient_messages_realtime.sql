/*
  # Live updates for portal messages

  Adds public.patient_secure_messages to the supabase_realtime publication,
  so the portal's messages screen refreshes when the clinic writes. The
  portal subscribes with a filter on patient_id (#170); until now nothing
  arrived because the table was not published.

  ## Who receives what
  Realtime checks each subscriber's row-level security for inserts and
  updates, so a patient receives only changes to their own messages, and
  the anon key receives none (it has no SELECT on the table: "401").

  Deletes are not checked by row-level security. Because row-level security
  is on, a delete event carries only the message id, never its content or
  patient. Only subscribers without a filter receive it; a subscriber
  filtered on patient_id receives no delete events, because the id is the
  only column a delete sends (replica identity stays the default). So a
  signed-in user who subscribes without a filter, or a portal copy from
  before #170 until it reloads, can learn that some message was deleted and
  when, but nothing about it. public.queue and public.queue_tickets already
  behave the same way.

  Checked on a local copy of production's schema with production's own
  Realtime functions (realtime.apply_rls, 26 Sept 2026): one patient's
  filtered and unfiltered subscriptions received that patient's new message
  and never another patient's, the anon key got "401", and a delete reached
  only the unfiltered subscriptions, carrying only the id.

  ## Rollback
    ALTER PUBLICATION supabase_realtime DROP TABLE public.patient_secure_messages;
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE WARNING 'portal messages: publication supabase_realtime does not exist, skipped';
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'patient_secure_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.patient_secure_messages;
  END IF;
END $$;
