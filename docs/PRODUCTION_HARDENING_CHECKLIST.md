# mBHR Production-Hardening Checklist

This file tracks the production-readiness work driven by the audit
(`/root/.claude/plans/after-doing-an-audit-immutable-bentley.md`). Items below
that require a **dashboard click** (and so cannot be done from a migration or
code) are listed at the bottom.

## Phase A — Critical security ✅

| Item                                                                                                                                   | Status | Notes                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 59 `USING (true)` RLS policies dropped + scoped replacements                                                                           | ✅     | Migration `20260520000000_lockdown_rls_and_definer.sql`                                                                                                  |
| 13 legacy SELECT-true policies tightened                                                                                               | ✅     | Migration `20260520000001_tighten_legacy_select_policies.sql` (incl. removing the anon-readable session-token leak)                                      |
| Anon UPDATE on `patient_portal_sessions` constrained                                                                                   | ✅     | Migration `20260520000002_tighten_portal_session_anon_update.sql`                                                                                        |
| `is_staff()` / `has_role()` moved to `SECURITY INVOKER` + `notifications` policy added                                                 | ✅     | Migration `20260520000003_helpers_invoker_and_notifications_policy.sql`                                                                                  |
| 6 functions: `SET search_path = public, pg_catalog`                                                                                    | ✅     | Same migration as RLS lockdown                                                                                                                           |
| `check_and_increment_otp_rate_limit` / `cleanup_expired_otp_rate_limits` revoked from anon+authenticated, granted only to service_role | ✅     | Same                                                                                                                                                     |
| `photos` storage bucket: `public = false` + scoped RLS on `storage.objects`                                                            | ✅     | Same                                                                                                                                                     |
| Sentry `captureException` wired from both error boundaries + window error/unhandledrejection handlers                                  | ✅     | `src/lib/logger.ts` `captureError`, used by `GlobalErrorBoundary.tsx`, `ErrorBoundary.tsx`, `main.tsx`                                                   |
| Generic `rate_limits` table + `check_and_increment_rate_limit()` SQL function                                                          | ✅     | Migration `20260520000004_generic_rate_limits.sql`                                                                                                       |
| Edge functions wrapped in `enforceRateLimit` + `corsHeadersFor`                                                                        | ✅     | `supabase/functions/_shared/security/{rateLimit,cors}.ts` applied to send-otp-sms, send-otp-email, send-sms-reminder, tefca-oauth, tefca-ias, tefca-bulk |

## Phase A — Manual / dashboard items

These cannot be applied via migration. Walk through them in Supabase
Dashboard for `Med Bridge Health Reach` (project ref `dlogqxzejroeyivfmgcv`).

- [ ] **Enable leaked-password protection.**
      Dashboard → Authentication → Policies → Password Settings → toggle
      "Check passwords against HaveIBeenPwned.org" **on**.
      Closes the `auth_leaked_password_protection` advisor warning.

- [ ] **Set `ALLOWED_ORIGINS` secret on each edge function.**
      Dashboard → Edge Functions → (each function) → Secrets → add
      `ALLOWED_ORIGINS=https://your-prod-domain.vercel.app,https://staging.your-domain`.
      Until set, the new CORS helper falls back to `*` and logs a warning at
      cold-start. **Set it before the next deploy.** Apply to: send-otp-sms,
      send-otp-email, send-sms-reminder, tefca-oauth, tefca-ias, tefca-bulk.

- [ ] **Confirm Supabase Auth login-throttle is enabled.**
      Dashboard → Authentication → Rate Limits. Built-in. Confirm and record
      the chosen values (defaults are usually fine for healthcare).

## Phase B — Observability + CI/CD ⏳

(In progress.)

## Phase C — Resilience ⏳

(Not started.)

## Phase D — Polish ⏳

(Not started.)
