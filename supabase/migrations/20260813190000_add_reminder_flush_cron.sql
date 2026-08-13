/*
  # Schedule the SMS reminder flush (pg_cron + pg_net)

  Until now nothing ever fired the reminder queues: the browser-side
  notification worker only runs while a pharmacist has the SMS screen open,
  so medication_reminders / outbound_messages rows sat at 'pending' forever.

  This migration:
    1. Enables pg_cron and pg_net.
    2. Adds an attempts counter to medication_reminders and widens its status
       CHECK with 'sending' so a flusher can claim rows (prevents double
       sends when the cron tick and the browser worker overlap; stale
       'sending' claims are reclaimed by the function after 15 minutes).
    3. Schedules a cron job every 5 minutes that POSTs to the
       flush-reminders edge function, which drains both queues through the
       shared Termii/Twilio provider and marks rows sent/failed with up to
       3 attempts and a growing retry delay.

  The edge function is deployed with verify_jwt disabled (see config.toml)
  so the cron call needs no stored key: the operation is a benign,
  rate-limited "send what is already due" and the function uses the
  service role internally. Forks: the URL below embeds this repo's
  project ref (same as supabase/config.toml) — update it if you fork.

  Ops note: if pg_cron/pg_net cannot be created via SQL on your plan,
  enable them once in Dashboard → Database → Extensions and re-run this
  migration.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Retry bookkeeping for the server-side flusher.
ALTER TABLE medication_reminders
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

-- Allow the 'sending' claim state (was: pending/sent/failed).
ALTER TABLE medication_reminders
  DROP CONSTRAINT IF EXISTS medication_reminders_status_check;
ALTER TABLE medication_reminders
  ADD CONSTRAINT medication_reminders_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed'));

CREATE OR REPLACE FUNCTION public.invoke_flush_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_catalog
AS $$
BEGIN
  -- Fire-and-forget: pg_net queues the request; the edge function records
  -- per-row outcomes itself, and responses land in net._http_response for
  -- debugging.
  PERFORM net.http_post(
    url := 'https://dlogqxzejroeyivfmgcv.supabase.co/functions/v1/flush-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
END;
$$;

COMMENT ON FUNCTION public.invoke_flush_reminders() IS
  'Cron hook: POSTs to the flush-reminders edge function to drain due SMS queues';

-- Cron-only: not callable through the Data API by client roles.
REVOKE EXECUTE ON FUNCTION public.invoke_flush_reminders() FROM PUBLIC, anon, authenticated;

-- Idempotent (re)scheduling, matching the bulk-export cleanup precedent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'flush_sms_reminders'
  ) THEN
    PERFORM cron.unschedule('flush_sms_reminders');
  END IF;
  PERFORM cron.schedule(
    'flush_sms_reminders',
    '*/5 * * * *',
    $cron$ SELECT public.invoke_flush_reminders(); $cron$
  );
END $$;
