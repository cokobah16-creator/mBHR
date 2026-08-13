/*
  # Move portal OTP verification server-side; close anon activation/session holes

  The 20260520 lockdown intended a service-role OTP model but left it
  half-built:

  - 'pending_verification' was referenced by the anon policies yet was not a
    legal account_status (CHECK only allowed active/suspended/locked), so the
    register policy could never insert and the verify policy matched nothing —
    while every enrollment code path still inserted rows born 'active'.
  - The anon UPDATE policy ("patient_portal_users_verify") gated only
    account_status; otp_secret / otp_expires_at / phone_verified were freely
    writable within it — activation was designed to be client-side and thus
    forgeable.
  - Legacy USING(true) anon SELECT/UPDATE policies on patient_portal_sessions
    from 20251031000000 ("Anyone can validate/refresh session by token") were
    never dropped BY NAME by the lockdown, leaving every session_token (a
    bearer credential) anon-readable depending on apply order.

  OTP issue + verify + session validation now live in the portal-otp edge
  function (service role): the code is generated server-side, stored as a
  salted hash, compared server-side with attempt caps, and only a successful
  verify flips account_status to 'active' and mints a session. Per-contact
  send throttling finally uses check_and_increment_otp_rate_limit /
  otp_rate_limit_tracking, which no code had ever consulted.
*/

-- 1. Make 'pending_verification' a legal account_status so enrollment can
--    create unverified rows and the register policy can actually match.
ALTER TABLE patient_portal_users
  DROP CONSTRAINT IF EXISTS patient_portal_users_account_status_check;
ALTER TABLE patient_portal_users
  ADD CONSTRAINT patient_portal_users_account_status_check
  CHECK (account_status IN ('pending_verification', 'active', 'suspended', 'locked'));

-- 2. Drop the legacy v3-era USING(true) policies on patient_portal_users
--    (superseded by the 20260520 set, but never dropped by these names).
DROP POLICY IF EXISTS "Portal users can view own data" ON patient_portal_users;
DROP POLICY IF EXISTS "Portal users can update own data" ON patient_portal_users;
DROP POLICY IF EXISTS "Allow insert for portal users" ON patient_portal_users;

-- 3. Remove anon UPDATE entirely: verification is server-side now, so no
--    anon caller has any reason to write account_status, otp_* or *_verified.
--    (The "patient_portal_users_register" INSERT policy stays: enrollment may
--    create rows, but only in pending_verification with consent recorded.)
DROP POLICY IF EXISTS "patient_portal_users_verify" ON patient_portal_users;

-- 4. Close the session-token leak: these two 20251031000000 policies exposed
--    every session_token via anon SELECT USING(true) and allowed anon expiry
--    extension. Validation/refresh moves to portal-otp/session-validate.
DROP POLICY IF EXISTS "Anyone can validate session by token" ON patient_portal_sessions;
DROP POLICY IF EXISTS "Anyone can refresh session by token" ON patient_portal_sessions;

-- 5. With anon SELECT gone, the remaining anon UPDATE/DELETE policies are
--    inert (UPDATE/DELETE require row visibility) — drop them so pg_policies
--    reflects reality. Session creation for verified logins happens in the
--    edge function with the service role.
DROP POLICY IF EXISTS "patient_portal_sessions_anon_update" ON patient_portal_sessions;
DROP POLICY IF EXISTS "patient_portal_sessions_anon_delete" ON patient_portal_sessions;
DROP POLICY IF EXISTS "patient_portal_sessions_anon_create" ON patient_portal_sessions;
