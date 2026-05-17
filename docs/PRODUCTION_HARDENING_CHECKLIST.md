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

## Phase B — Observability + CI/CD ✅

| Item                                                    | Status | Notes                                                                                                                                        |
| ------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| CI: preview deploy job (per PR)                         | ✅     | `.github/workflows/build.yml` `deploy-preview` job — needs `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` repo secrets to actually run |
| CI: smoke test against the deployed preview URL         | ✅     | `smoke-test` job runs `e2e/login.spec.ts` with `PLAYWRIGHT_BASE_URL`                                                                         |
| CI: production deploy gated by `production` Environment | ✅     | `migrate-prod` + `deploy-prod` jobs                                                                                                          |
| CI: DB migrations applied on prod deploy                | ✅     | `supabase/setup-cli` + `supabase db push --linked`; needs `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`            |
| Sticky PR comment with preview URL                      | ✅     | `marocchino/sticky-pull-request-comment@v2`                                                                                                  |
| Centralised Supabase call wrapper                       | ✅     | `src/services/supabaseQuery.ts` + 7 unit tests                                                                                               |
| `supabase/config.toml` project_id corrected             | ✅     | Was `xxbbafonflieyqcwaeyx`, now `dlogqxzejroeyivfmgcv`                                                                                       |
| Zod env validation at app boot                          | ✅     | `src/config/env.ts`; throws in dev, reports + falls back in prod                                                                             |

## Phase B — Manual / dashboard items

- [ ] **Create the `production` GitHub Environment** with required reviewer(s)
      before merging anything to `main` — otherwise `migrate-prod` + `deploy-prod`
      will run automatically.
- [ ] **Add the following GitHub Action secrets** to the repository:
      `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
      `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` (use
      `dlogqxzejroeyivfmgcv`), `SUPABASE_DB_PASSWORD`.
- [ ] **(Recommended) Raise vitest coverage threshold** in
      `vitest.config.ts` from 60 → 75% in two PRs. Backfill the most
      under-tested service first — likely `src/services/portalEnrollment.ts`
      or `src/services/messaging.ts`.

## Phase C — Resilience ⏳

(Not started.)

## Phase D — Polish ⏳

(Not started.)
