-- ============================================================================
-- Phase A WS4: Generic per-bucket rate limiting
-- ============================================================================
-- Edge functions other than the OTP flow had no rate limiting at all. This
-- migration adds a single `rate_limits` table and a SQL function
-- `check_and_increment_rate_limit(bucket, key, max, window_seconds)` that any
-- edge function can call via service_role to enforce per-IP / per-API-key
-- throttling.
--
-- Buckets we'll use initially:
--   'edge_otp_sms'       (per IP)
--   'edge_otp_email'     (per IP)
--   'edge_sms_reminder'  (per IP)
--   'edge_tefca_oauth'   (per client_id)
--   'edge_tefca_ias'     (per access_token jti)
--   'edge_tefca_bulk'    (per access_token jti)
--
-- Rollback: DROP TABLE public.rate_limits CASCADE; DROP FUNCTION public.check_and_increment_rate_limit(text, text, integer, integer);
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket        text         NOT NULL,
  key           text         NOT NULL,
  window_start  timestamptz  NOT NULL DEFAULT now(),
  count         integer      NOT NULL DEFAULT 0,
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, key)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_updated_at ON public.rate_limits (updated_at);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Only service_role touches this table.
CREATE POLICY "rate_limits_service_only"
  ON public.rate_limits FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Check-and-increment in one round-trip. Returns:
--   {allowed: boolean, remaining: int, retry_after_seconds: int|null}
-- The window rolls forward when the previous one expires.
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_bucket          text,
  p_key             text,
  p_max             integer,
  p_window_seconds  integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now         timestamptz := now();
  v_window_age  interval    := make_interval(secs => p_window_seconds);
  v_row         public.rate_limits%ROWTYPE;
  v_count       integer;
  v_window_end  timestamptz;
BEGIN
  -- Atomic upsert: start a new window if the previous one expired,
  -- otherwise increment the existing window.
  INSERT INTO public.rate_limits AS rl (bucket, key, window_start, count, updated_at)
  VALUES (p_bucket, p_key, v_now, 1, v_now)
  ON CONFLICT (bucket, key) DO UPDATE
    SET count = CASE
                  WHEN rl.window_start + v_window_age < v_now THEN 1
                  ELSE rl.count + 1
                END,
        window_start = CASE
                         WHEN rl.window_start + v_window_age < v_now THEN v_now
                         ELSE rl.window_start
                       END,
        updated_at = v_now
  RETURNING * INTO v_row;

  v_count := v_row.count;
  v_window_end := v_row.window_start + v_window_age;

  IF v_count > p_max THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'retry_after_seconds', GREATEST(1, EXTRACT(EPOCH FROM (v_window_end - v_now))::int)
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'remaining', GREATEST(0, p_max - v_count),
    'retry_after_seconds', NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, text, integer, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, text, integer, integer) TO service_role;

-- Garbage collector for stale rows (anything not touched in 24h). Suitable
-- for pg_cron if you want; not scheduled here.
CREATE OR REPLACE FUNCTION public.cleanup_expired_rate_limits()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH deleted AS (
    DELETE FROM public.rate_limits WHERE updated_at < now() - interval '24 hours' RETURNING 1
  )
  SELECT count(*)::int FROM deleted;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cleanup_expired_rate_limits() TO service_role;

-- End.
