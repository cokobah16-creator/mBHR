# Security Hardening Runbook

Operational steps to complete the 12-Aug security findings. The code fixes
are on this branch; everything below is an action **only an operator can
take** (dashboard toggles, deploys, live verification). Work top to bottom.

## 1. Deploy the security fixes (required — code alone changes nothing live)

The deployed edge functions predate the shared security helpers (the audit
found deployed `send-otp-sms` v13 with no rate limit while the repo source
had one — deployed ≠ repo). Redeploy everything that changed:

```bash
REF=<your-project-ref>

# SMS provider + queues + OTP authority
supabase functions deploy send-sms-reminder send-otp-sms send-otp-email portal-otp --project-ref $REF
supabase functions deploy flush-reminders --no-verify-jwt --project-ref $REF

# TEFCA: bearer-only auth (legacy X-QHIN-ID now 410 Gone)
supabase functions deploy tefca-ias --no-verify-jwt --project-ref $REF

# All migrations: reminder cron, portal OTP policies, outreach visibility
supabase db push
```

## 2. TEFCA: prefer undeploying over patching (30 min)

TEFCA is US-interop scaffolding. For a Nigerian launch with no active QHIN
partner, remove the attack surface entirely instead of maintaining it:

```bash
supabase functions delete tefca-ias tefca-bulk tefca-oauth --project-ref $REF
```

If you keep them deployed, the code fix already closed the unauthenticated
`X-QHIN-ID` path (verify: a request with only that header must return
**410 Gone**). Two smaller known issues remain open by choice — moot if you
undeploy, ticket them if you don't:

- `X-Exchange-Purpose` is client-controlled and `individual-access`
  auto-passes consent checks even for bearer callers.
- `tefca-bulk` status/cancel endpoints are reachable with only the job UUID
  (no `authorize()` call).

## 3. Enable leaked-password protection (5 min)

Dashboard → **Authentication → Providers → Email → Password protection** →
enable "Check passwords against HaveIBeenPwned". This was the only warning
the Supabase security advisor raised; there is no SQL/config file for it —
it is a dashboard toggle.

While there: consider lowering OTP expiry (Auth → Email) if it is above
1 hour, and confirm signups you don't use are disabled.

## 4. Verify OTP rate limiting is real (15 min)

Two independent brakes now exist — test both after deploying:

**Per-IP (generic `rate_limits` table, 10/min on the OTP functions):**

```bash
# 20 rapid requests: expect HTTP 429 from roughly the 11th onward
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST "https://$REF.supabase.co/functions/v1/portal-otp/issue" \
    -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" \
    -d '{"contact":"+2348000000000","channel":"sms"}'
done
```

**Per-contact (`otp_rate_limit_tracking`, 5/hour — previously dead, now
wired):** after the burst above, confirm the tracking row incremented:

```sql
select contact_method, contact_value, request_count, window_start_time
from otp_rate_limit_tracking
order by last_request_time desc limit 5;
```

If `request_count` is not incrementing, the `portal-otp` function is not
deployed or the RPC grant is missing — both fail loud in the function logs.

Also verify the forged-code hole is closed: calling `send-otp-sms` (or
`send-otp-email` with an `otp` field) with the **anon** key must return
**403** "OTP sends are internal".

## 5. Verify portal activation is no longer forgeable (10 min)

```sql
-- anon must have NO UPDATE policy on patient_portal_users
-- and NO SELECT/UPDATE policy on patient_portal_sessions:
select policyname, cmd, roles from pg_policies
where tablename in ('patient_portal_users', 'patient_portal_sessions')
order by tablename, policyname;
```

Expected: `patient_portal_users_register` (INSERT, anon,
`pending_verification` + consent only) is the **only** anon policy on
`patient_portal_users`; no anon policies remain on
`patient_portal_sessions`. Then try the attack that used to work: an anon
`PATCH` to `patient_portal_users` setting `account_status=active` must
affect 0 rows.

## 6. Known-good state checks (5 min)

```sql
select jobname, schedule, active from cron.job;          -- flush_sms_reminders */5
select count(*) from message_templates;                  -- 30 after seed:live
select status, count(*) from medication_reminders group by status;
```

## Standing notes

- `SMS_DEMO_MODE` must never be set in production — it is the explicit
  opt-in that restores log-only sends.
- `sendPortalInvitation`'s SMS branch still posts `{phone, message}` to
  `send-otp-sms` — it was already dead (the function requires `otp`) and
  now 403s; the code falls back to the link flow. Cleanup candidate, not a
  vulnerability.
- The portal register/login UI does not yet surface the OTP entry step
  (`OTPInput.tsx` exists but is unmounted); `requestOTP`/`verifyOTP` are
  live and wired to `portal-otp`. Until the UI step is added, accounts
  enrolled online stay `pending_verification` — which is the safe direction.
  Ticket the UI wiring as follow-up work.
- **Rotate the Resend API key.** A live key was committed in plaintext
  across five files (`NEXT_STEPS.md`, `QUICK_REFERENCE_CARD.md`,
  `EMAIL_NOW_WORKING.md`, `RESEND_API_KEY_SETUP.md`,
  `scripts/set-resend-key.sh`). This branch redacts them from HEAD, but the
  key remains in git history — treat it as compromised: create a new key in
  the Resend dashboard, `supabase secrets set RESEND_API_KEY=<new>`, and
  revoke the old one.
