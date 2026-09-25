# Phase 0: architecture inventory and baseline

Written before any interoperability code, at `mainone` 2140351 (the #136
merge), on 2026-09-25. It records what mBHR actually is, so the FHIR layer
maps to real tables and boundaries rather than assumed ones. Facts are from
the repository unless marked **(inferred)**; the production database has
drifted from the migrations (see "Production database" below).

## 1. Application

| Area | What exists | Where |
| --- | --- | --- |
| Framework | React 18.3 single-page app, Vite 5.4, TypeScript 5.9 (`strict: false`), react-router 6 (routes inline in `App.tsx`), zustand, zod | `package.json`, `src/App.tsx` |
| Hosting | Vercel, static `dist/` with an SPA rewrite; no server code before this change (no `api/`) | `vercel.json` |
| Backend | Supabase: Postgres + RLS, Auth, Storage, six Deno edge functions | `supabase/` |
| Supabase client | Browser only, anon key, `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; `null` when unset (offline-only mode) | `src/lib/supabaseClient.ts`, `src/lib/supabase.ts` (older duplicate) |
| Config | zod-validated `src/config/env.ts`; no feature-flag mechanism existed | `src/config/` |
| Offline / PWA | Dexie databases `mbhr_v5` (v18: patients, vitals, visits, consultations, queue, …), `mbhr` (v4: prescriptions, dispenses), `mbhr_outbox`, `gamification_db`; vite-plugin-pwa (workbox generateSW, auto-update) | `src/db/`, `vite.config.ts` |
| Sync | Push/pull adapter, server-command outbox, conflict resolver, staff roster pull | `src/sync/adapter.ts`, `commandOutbox.ts`, `staffRosterSync.ts` |

## 2. Authentication and authorisation

- **Staff, online:** Supabase email/password (`loginOnline`, `src/stores/auth.ts`).
  The account's `app_users` row gives the role; deactivated accounts are
  refused. `app_users.id` **is** the auth user id (no separate link column).
- **Staff, offline:** 6-digit device PIN (PBKDF2, device-local, never synced).
  An offline session has no Supabase session and cannot sync.
- **Patients:** Supabase accounts linked to a patient record through
  `patients.auth_uid` or `patient_portal_users`
  (`public.app_portal_patient_ids()`); a legacy on-device portal login also
  exists.
- **Roles and permissions:** `src/auth/roles.ts` (client) and
  `public.app_role_has_permission()` (server, latest in
  `20260925100600`), kept equal by `src/auth/roleMatrixParity.test.ts`.
  Roles: admin, doctor, nurse, pharmacist, volunteer, auditor,
  lead_clinician, registration_lead (guest and unknown roles get nothing).
  Permissions: register, vitals, consult, dispense, inventory, export, users,
  approve_phi_conflicts, audit_access, resolve_conflicts, lab_review, queue,
  portal_manage, merge_patients, lab_release, portal_invite.
- **Server helpers:** `app_current_role()`, `app_has_permission()`,
  `app_is_staff()`, `app_portal_patient_ids()` (`20260924110000` onward).
  Id comparisons there cast to text because production ids may be uuid where
  the migrations say text.
- **Row-level security:** rewritten by the Sept 24 migrations
  (`20260924110100`–`20260924110400`) and Wave B (`20260925100000`–`100700`);
  see `docs/security/RLS_MATRIX.md`. pgTAP tests for Wave B in
  `supabase/tests/`.
- **Organisation / site:** `organizations`, `sites`, `outreach_events`,
  `user_org_sites` exist, but **clinical rows carry no org or site id**
  (visits have a free-text `site_name`). There is no tenant boundary to
  enforce on clinical data yet.

## 3. Clinical data model (what FHIR maps from)

| Concept | Table | Id | Notes |
| --- | --- | --- | --- |
| Patient | `patients` | `id text` (device ULID); `fhir_id uuid` (added for FHIR, unique) | given/family name, sex (free text), dob, phone, email, one-line address, lga, state, photo_url, merge columns (`merged_into`). **No MRN, national id or active flag.** |
| Visit (encounter) | `visits` | `id text` | patient, started_at, free-text site_name and status (app writes `open` / `closed`) |
| Vital signs | `vitals` | `id text` | one row: height, weight, temp, pulse, BP, SpO₂, BMI, taken_at, visit; app `flags` |
| Consultation / SOAP | `consultations` | `id text` | SOAP text, `provisional_dx text[]`, provider_name (text) |
| Diagnoses | `conditions` | `id uuid` | FHIR-shaped clinical/verification status, category, severity; local code, no code system |
| Allergies | `patient_allergies` | `id uuid` | allergen text, type, severity, `is_active` |
| Prescriptions | `prescriptions` | `id text` | `lines jsonb`, status open/dispensed/partial/void |
| Dispenses | `dispenses` | `id text` | item, qty, FHIR dispense_status, authorizing prescription |
| Medicines | `pharmacy_items`, `pharmacy_batches` | text | catalog and lots |
| Lab orders / results | `lab_orders`, `lab_results` | uuid | status, priority; result value text, unit, range text, interpretation, review and release |
| Documents | `patient_documents`, `document_references` | uuid | storage paths; ownership and soft delete (Wave B) |
| Other FHIR-shaped | `immunizations`, `procedures`, `care_plans`, `goals`, `service_requests`, `sdoh_observations` | uuid | from the TEFCA work |
| Staff | `app_users` | `id` = auth uid | full_name, role; no qualifications, no contact details |
| Audit | `audit_logs`, `tefca_access_logs`, many domain logs | | no append-only FHIR access log |
| Consent | `patient_consent_records` (yes/no per type), `patient_data_sharing_preferences` (TEFCA purposes) | uuid | no provisions, no FHIR status |
| Queue | `queue`, `queue_transitions` | text | operational, not clinical encounters |

## 4. Existing FHIR code (found, not assumed)

mBHR already has a **partner-facing FHIR stack** from the TEFCA work:

- Edge functions `tefca-ias` (FHIR R4 / US Core read, search, writes into a
  separate `fhir_resources` store), `tefca-oauth` (SMART / Backend Services
  issuer, PKCE) and `tefca-bulk` (Bulk `$export`), with shared mappers in
  `supabase/functions/_shared/fhir/`. They use the **service-role key**, so
  RLS does not apply to them.
- Tables `fhir_resources`, `resource_versions` (+ triggers on several
  clinical tables), `oauth_clients`, `oauth_access_tokens`,
  `oauth_authorization_codes`, `oauth_refresh_tokens`, `oauth_signing_keys`,
  `bulk_export_*`, `tefca_qhin_partners`, `tefca_access_logs`.
- Client-side export (`src/services/fhir/*`) that builds FHIR from Dexie for
  a patient's own download.

The September audit found a critical unauthenticated bypass and four high
findings in these functions; #135 fixed the code, but **the deployed copies
still run the old code** until someone deletes or redeploys them (owner
decision pending in the System audit fixes thread).

**Decision for this work:** the new gateway does not reuse or extend the
TEFCA functions. It is first-party only, reads as the signed-in user under
RLS, and has no service-role key. The TEFCA stack stays as it is (and should
stay undeployed until a partner exists); consolidating it onto this gateway
is a later decision. See [README.md](README.md#where-the-gateway-runs).

## 5. Production database

- Update, 25 September 2026 (22:49 UTC): production now has every file in
  `supabase/migrations/` (51 recorded versions, newest `20260926120100`),
  including the Sept 24 permission helpers, Wave A/B and the rate limits
  (the file `20260520000004` was renamed to production's recorded version
  `20260517153407`). The HRIS transformation thread owns production
  database changes; they need the owner's go-ahead.
- Not on production, by design: the TEFCA/FHIR files moved to
  `supabase/migrations-deferred/`, among them `20260503010000`
  (`patients.fhir_id`) and `20260503010200` (dispense FHIR columns), and
  both interop migrations (`20260926110000`, `20260926130000`). They are
  re-versioned above production's newest when the owner decides FHIR goes
  live (`supabase/migrations-deferred/README.md`).
- Consequence: the gateway's database functions depend on migrations that
  production does not have yet. With `FHIR_ENABLED` off this changes
  nothing; switched on against such a database, the gateway fails closed
  (503), it does not fall back to anything weaker.

## 6. Baseline (before this change)

`npm` downloads are blocked in the cloud environment this work was done in,
so the repository's own checks could not run locally; the baseline is the
CI on `mainone`:

| Check | Where | Result at 2140351 |
| --- | --- | --- |
| Typecheck, lint, unit tests, i18n, build | Build & Deploy run 36155621546 | pass |
| `npm audit --audit-level=critical` | same run (advisory off `main`) | reported, not gating |
| FHIR fixture validation (TEFCA US Core fixtures) | FHIR Fixture Validation run 36155621539 | pass |
| Migration validation, RLS pgTAP | Actions → Database migrations → rehearse (manual, needs the owner's approval) | not run for this change; the pending history has known pre-existing problems (section 5) |
| Playwright login smoke | Build & Deploy | runs on pull requests only |

No pre-existing failure is attributed to this work. The new code was also
checked locally: strict `tsc` over `src/interoperability`, `bun test`
(vitest-compatible) for its tests, and the migration plus its pgTAP file on
a local PostgreSQL 16 (see [testing.md](testing.md)).
