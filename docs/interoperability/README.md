# mBHR interoperability (FHIR R4)

A read-only FHIR R4 interface over mBHR's own clinical tables, for mBHR's own
signed-in staff. This is the foundation release: **it is switched off
everywhere by default, and nothing in it is enabled in production.** External
systems, SMART on FHIR apps, patient self-access and writes are not part of
it; the settings that would turn those on are refused (see
[Feature flags](#feature-flags)).

This release does not claim conformance to any implementation guide or
certification programme. It serves FHIR R4 (4.0.1) JSON that the HL7 FHIR
Validator accepts, for the resources and searches listed in
[fhir-r4.md](fhir-r4.md), and nothing else.

| Document | What it covers |
| --- | --- |
| [architecture-inventory.md](architecture-inventory.md) | Phase 0: what mBHR is, its auth boundaries, data model, existing FHIR code, production drift, and the CI baseline |
| [resource-mapping.md](resource-mapping.md) | Table-by-table mapping to Patient, Encounter, Observation and Condition, and the plan for the next resources |
| [fhir-r4.md](fhir-r4.md) | The API: endpoints, searches, paging, errors, versioning, examples |
| [security.md](security.md) | Authentication, the access decision, audit, and security findings that affect exposing FHIR |
| [consent.md](consent.md) | Purpose of use, the consent tables, and what is and is not enforced |
| [smart-auth.md](smart-auth.md) | SMART on FHIR: the plan (not enabled) |
| [testing.md](testing.md) | How the gateway and migration are tested, locally and in CI |
| [TEFCA_ROADMAP.md](TEFCA_ROADMAP.md) | The earlier partner-facing TEFCA work (separate edge functions; see below) |

## Where the gateway runs

`/fhir/R4` is a **Vercel Edge Function** in this repository (`api/fhir.ts`),
served on the app's own origin: `https://mbhr.app/fhir/R4`. `vercel.json`
rewrites `/fhir/R4` and `/fhir/R4/*` to it, before the single-page-app
catch-all, and the service worker is told not to answer those paths with the
app shell (`vite.config.ts`, `navigateFallbackDenylist`).

Why Vercel and not a Supabase edge function:

- **It ships the way mBHR already ships.** A pull request, CI, then Vercel.
  Supabase edge functions in this project are deployed by hand, outside CI,
  which is how the TEFCA functions ended up running older code than the
  repository.
- **No service-role key.** The gateway forwards the caller's own Supabase
  session to PostgREST with the public anon key, so every clinical read is
  subject to the same row-level security as the app. It holds no secret that
  could read around RLS.
- **Same origin as the app,** so there is no new CORS surface (the gateway
  sends no CORS headers; see [security.md](security.md)).
- **Tested here.** The whole gateway is a plain `Request -> Response`
  function (`src/interoperability/fhir/gateway/handler.ts`), tested with an
  in-memory Supabase in CI; the hosting file is four lines.
- **Inert when off.** With `FHIR_ENABLED` unset the function answers 404 to
  everything and reads nothing.

The code is host-independent, so moving it (for example into Supabase edge
functions once they deploy through CI) needs a new adapter file, not a
rewrite.

### Relationship to the TEFCA functions

mBHR already contains a partner-facing FHIR stack (`tefca-ias`, `tefca-oauth`,
`tefca-bulk`), described in the [inventory](architecture-inventory.md#4-existing-fhir-code-found-not-assumed).
This work does not use, extend or change it. Those functions use the
service-role key and a separate `fhir_resources` store; this gateway reads the
live tables as the signed-in user. Whether to retire them or rebuild them on
this gateway is a later decision. Until a partner actually needs them, they
should stay undeployed (see [security.md](security.md#findings)).

## Code layout

```
api/fhir.ts                              Vercel adapter (Edge runtime)
src/interoperability/fhir/
  config/        feature flags and settings (refuses unsafe combinations)
  types/         the narrow FHIR R4 types this release produces
  errors/        OperationOutcome and the fixed, caller-safe error set
  search/        strict search-parameter parsing, cursors, searchset Bundles
  terminology/   code systems, LOINC/UCUM vital signs, local namespaces
  mappers/       Patient, Encounter, Observation, Condition; the registry
  capability/    CapabilityStatement, generated from the registry
  validation/    structural checks run on every resource before release
  authorization/ permissions and canAccessFHIRResource()
  consent/       purpose of use and the consent decision
  audit/         access audit records, IP hashing, redacted log lines
  gateway/       authentication, PostgREST access, queries, the handler
  conformance/   synthetic examples validated by the HL7 validator in CI
supabase/migrations/20260925160000_interop_foundation.sql
supabase/tests/interop_foundation.test.sql
```

## Feature flags

Server-side environment variables of the Vercel project. None has a `VITE_`
prefix, so none is compiled into the browser bundle.

| Variable | Default | Effect |
| --- | --- | --- |
| `FHIR_ENABLED` | off | The gateway answers at all. Off: every `/fhir/R4` request gets 404, nothing is read. |
| `FHIR_BASE_URL` | none | Required when enabled; https only (http allowed for localhost). Used in Bundle links and the CapabilityStatement. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | the `VITE_` values | The project the gateway reads as the caller. Refused if the key equals `SUPABASE_SERVICE_ROLE_KEY`. |
| `FHIR_DEFAULT_PAGE_SIZE` | 20 | Page size when `_count` is absent. |
| `FHIR_MAX_PAGE_SIZE` | 100 | Largest page; values above 100 are lowered to 100. |
| `FHIR_RATE_LIMIT_PER_MINUTE` | 60 | Requests per signed-in account per minute (the database clamps it to 1 to 600). |
| `FHIR_AUDIT_IP_SECRET` | none | HMAC key for hashing client IPs in the audit trail. Unset: no IP is kept at all. |
| `FHIR_CONSENT_ENFORCEMENT_ENABLED` | off | Reserved. Carried in the configuration for the release that checks stored consents; no current decision depends on it ([consent.md](consent.md)). |
| `FHIR_WRITE_ENABLED` | off | **Cannot be turned on.** If set to true the gateway refuses to start (503). |
| `SMART_ENABLED` | off | **Cannot be turned on** in this release (503). |
| `SMART_EXTERNAL_CLIENTS_ENABLED` | off | **Cannot be turned on** in this release (503). |

Any invalid setting while `FHIR_ENABLED` is on makes every request a 503 with
a generic OperationOutcome; the reason is written to the function log only as
`config_invalid`, never to the caller.

Turning the flags off leaves the app exactly as it was: nothing in the app
calls the gateway, and the interop tables are used only by it.

## Rollout status

| Step | State |
| --- | --- |
| Code, tests and CI (this pull request) | in review |
| Migration `20260925160000_interop_foundation.sql` applied anywhere | **not applied**; production reconciliation is owned by the HRIS transformation work, and production changes need the owner's go-ahead |
| `FHIR_ENABLED` on a preview deployment | not set |
| `FHIR_ENABLED` in production | not set; do not set until the conditions below hold |
| Clinical review of the representation choices | pending (`docs/clinical/CLINICAL_LOGIC_CHANGES.md` section 2.5) |

Before enabling anywhere with real data:

1. The database behind it has the migrations the gateway depends on:
   `20260503010000` (`patients.fhir_id`), `20260520000004` (rate limits),
   `20260924110000` and `20260925100600` (role and permission helpers), and
   this migration. Production has not got all of them yet
   ([inventory, section 5](architecture-inventory.md#5-production-database)).
   Without them the gateway fails closed (503); it does not fall back.
2. A clinician has signed off section 2.5 of the clinical change log.
3. `FHIR_AUDIT_IP_SECRET` is set if IP hashes are wanted in the audit.

### Trying it on a preview

On a Vercel preview whose Supabase project has the migrations above (not
production):

1. Set `FHIR_ENABLED=true` and `FHIR_BASE_URL=https://<preview-host>/fhir/R4`
   for the Preview environment only, and redeploy the preview.
2. Sign in to the app as a staff user, copy the session's access token, and:

   ```bash
   curl -s https://<preview-host>/fhir/R4/metadata
   curl -s -H "Authorization: Bearer $TOKEN" \
     "https://<preview-host>/fhir/R4/Patient?name=ade&birthdate=1990-01-01"
   ```

Never paste a real patient's data or a production token into a ticket or
chat.

## Rollback

From least to most drastic:

1. **Switch it off.** Remove `FHIR_ENABLED` (or set it to `false`) in Vercel
   and redeploy. `/fhir/R4` answers 404 again. Nothing else changes; the
   audit trail is kept.
2. **Remove the code.** Revert the pull request. The rewrites, the function
   and the service-worker denylist entry go with it; the app is unaffected
   (it never calls the gateway).
3. **Remove the database objects** (only if the migration was applied, and
   only with the owner's go-ahead for that database). The five statements
   are in the migration's header. **Dropping the `interop` schema deletes
   the access audit trail and any consent records**, so export both first
   (as `postgres`: `COPY interop.access_audit TO ...`,
   `COPY interop.consent_records TO ...`,
   `COPY interop.consent_provisions TO ...`). CI runs the rollback on every
   change to prove it removes everything and that the migration can be
   applied again afterwards.

The migration changes no existing table, column, policy or function, so
rolling it back cannot affect the app.

## Where this differs from the original brief

Recorded so the next phase starts from what was actually built.

- **Scope.** Phase 0 and the first delivery only: Patient, Encounter,
  Observation (vital signs) and Condition; `metadata`; read and search. No
  writes, `_include`, `_revinclude`, `_sort`, `_summary`, `_elements`,
  history, `$everything`, Bulk Data, XML, or SMART.
- **Staff only.** Portal patients get 403 (`no_staff_role`); patient
  self-access comes with SMART (see [smart-auth.md](smart-auth.md)).
- **No `smart_clients` table.** SMART is not in this delivery, and mBHR
  already has `oauth_clients` from the TEFCA work; the SMART design decides
  whether to extend it or add a new table.
- **`resource_links` is schema only.** Every published id is derived
  deterministically from its source row, so no link rows are needed yet.
  Resources without a stable id (for example `consultations.provisional_dx`
  entries) will use it.
- **Organisation scoping** is not enforced by the gateway because mBHR
  clinical rows carry no organisation or site id; RLS applies as defined.
- **Consent** records a structure but is not yet enforced; internal treatment
  access does not depend on it, and everything else is refused
  ([consent.md](consent.md)).
- **Lab results, allergies, medications, documents** are planned for the
  second delivery ([resource-mapping.md](resource-mapping.md#planned-second-delivery)).
