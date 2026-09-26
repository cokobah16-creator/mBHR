# Testing the FHIR gateway and the interop migrations

Three layers run in CI in `.github/workflows/interop-fhir.yml` ("FHIR R4
interoperability"). It runs on pull requests that touch the interop files
(`src/interoperability/**`, `api/fhir.ts`, `vercel.json`, the two example
and report scripts, `scripts/ci/interop_db_base.py`, both interop
migrations, both pgTAP files, and the workflow itself) and on every push to
`mainone`. None of it connects to Supabase or Vercel. No real patient data
is used anywhere: the fixtures are synthetic.

| Layer | CI job | What it checks |
| --- | --- | --- |
| Unit and security tests | `gateway` | The gateway code, end to end against an in-memory Supabase |
| HL7 FHIR Validator | `gateway` | The gateway's own output is valid FHIR R4 |
| Migrations with pgTAP | `interop-db` | Both migrations on PostgreSQL 16: grants, guards, idempotence, rollback |

## 1. Unit and security tests

In CI (Vitest):

```bash
npx vitest run src/interoperability
```

Locally, where `npm install` is not possible, the same files run under Bun:

```bash
bun test src/interoperability
```

With Bun this is 19 files and 678 tests (678 pass, 0 fail). Vitest is
what CI uses; the Bun run is a local convenience.

Files in `src/interoperability/fhir/__tests__/` (plus
`src/interoperability/smart/__tests__/scopes.test.ts`):

| File | Covers |
| --- | --- |
| `security.test.ts` | The Phase 2 security matrix at the gateway (below) |
| `gateway.test.ts` | The whole request path: feature flag, metadata, authentication, authorisation, enumeration protection, reads, searches, errors and request limits |
| `guard.test.ts` | The routing guard (`routeRequest`), keyset paging, `LIKE` escaping, reference checks in the validator |
| `authorize.test.ts` | The order of the 12 steps, the restrictions handed to modules, and the consent step, including `consentStep()` on a governed purpose |
| `consentPolicy.test.ts` | `evaluateConsent()`: which accesses consent governs, default-deny, withdrawal and expiry, a permit for one named recipient never permits, parsing of directives |
| `consentResource.test.ts` | Consent status maps, mapper, who may read, searches, patient self-access, nothing forbidden is served, a rule for one named recipient withholds the record |
| `consentDirectiveLoader.test.ts` | The consent step's directive lookup: the named patient's merge family, directives read as the named patient's, more than 100 refused (503) |
| `framework.test.ts` | Configuration and flags, search parameter parsing, the access decision, the CapabilityStatement |
| `mappers.test.ts` | Patient, Encounter, vital-sign Observation and Condition mapping; the structural validator; the conformance examples |
| `laboratory.test.ts` | Lab status maps, test codes, values, interpretation, review state; laboratory Observation, DiagnosticReport and ServiceRequest; staff and patient access, including staff without consult or lab_review (a note on every search that could include laboratory results; a 403 read audited as `missing_permission`); status tokens in their own code system; merged patients; what is never published |
| `allergy.test.ts` | AllergyIntolerance mapping, status tables, validation, access, enumeration, search, read, recorder, what is never published |
| `medication.test.ts` | Medication, MedicationRequest and MedicationDispense: status maps, mappers, who may read, ids, gateway behaviour |
| `documents.test.ts` | DocumentReference and Binary: mapping, stored paths, staff and patient access, downloads, merged patients, search |
| `directory.test.ts` | Practitioner, PractitionerRole, Organization and Location: mappers, name searches, gateway behaviour |
| `provenanceAudit.test.ts` | Provenance and AuditEvent: activity and outcome maps, ids, mapping, gateway behaviour |
| `statusMaps.test.ts` | Every status map against the owner's rules: unknown stays unknown, and no status is promoted |
| `vercelRouting.test.ts` | `vercel.json` sends `/fhir/R4` and everything under it to the function, before the app catch-all |
| `reviewFixes.gateway.test.ts` | Fixes from the Phase 2 final review, end to end: an Encounter date search never matches a visit published without a period (including across pages); a searchset with nothing to list has no `entry`; a padded visit status is `unknown`; status tokens in another code system match nothing; Observation `code=` matches only what `Observation.code` carries; a 304 read is audited as 304; a module's refusal is audited with the reason it names; Binary declares no versioning and no conditional read; nothing in the CapabilityStatement, search parameters included, describes patients while patient access is off |
| `smart/__tests__/scopes.test.ts` | SMART scope parsing and intersection, including constraints that are refused (`_include`, `_revinclude` and every other `_` parameter except `_id`) (design code; SMART is not enabled) |

Helpers: `fakeSupabase.ts` (an in-memory Auth and PostgREST with a
row-level security hook) and `fixtures.ts` (synthetic rows).

The consent and interoperability screens have their own tests outside this
folder: `src/components/ExternalSharingChip.test.tsx`,
`src/features/patient-portal/PrivacyConsentSection.test.tsx`,
`src/features/patient-portal/privacyCopy.test.ts`,
`src/pages/admin/InteroperabilitySettings.test.tsx` and
`src/services/interop*.test.ts`. They run with the rest of the app's tests
(`npm run test:run` in `.github/workflows/build.yml`), not in the interop
workflow.

### What `security.test.ts` proves

Each case runs through `handleFhirRequest()` against the in-memory
Supabase, with patient access switched on.

- **Anonymous:** every type answers 401, with nothing read and nothing
  audited.
- **Patient self-access:**
  - patient A reading A is permitted and audited as the patient's own
    request;
  - A reading B is refused whatever the id, and the refusal is audited;
  - a changed `patient=` parameter does not reach another patient's data;
  - a search that names no patient is confined to A's own records;
  - naming another patient's row by id finds nothing;
  - A sees what the portal shows: closed visits and portal-visible vital
    signs only;
  - types the portal does not show are refused;
  - nothing is served while patient access is off;
  - an account linked to no record gets nothing;
  - a patient cannot state another purpose to widen access;
  - rows outside the patient's scope are never released, even if the
    database returned them (the owner check after read).
- **Staff limits:** a nurse cannot write and cannot read diagnoses or
  laboratory results; a pharmacist cannot read clinical notes or vital
  signs; a doctor reads an encounter they may see; staff searches must
  name a record, and the refusal is audited.
- **Merged patients:**
  - a search by the merged-away record matches nothing and names the kept
    record;
  - a search by the kept record includes rows still on the merged-away id,
    shown as the kept record;
  - a read of the merged-away record is a tombstone pointing at the kept
    one;
  - a merge chain the caller cannot follow resolves to nothing;
  - a patient cannot reach a merged-away record by naming it.
- **Paging and cursors:** a cursor continues only the search, caller and
  scope it was issued for; a forged or changed cursor is refused and
  audited; oversized pages are capped; `_count=0`, `_include` and unknown
  parameters are refused; `Bundle.total` is never sent.
- **Audit of every request after sign-in:**
  - malformed searches, invalid values and rate limiting are recorded;
  - a refusal is still returned when it cannot be recorded;
  - sensitive searches and downloads count against the stricter limit;
  - tokens, patient ids and search values are never logged.
- **Records that cannot be shown as valid FHIR:** they are left out of a
  search with a warning, and a read of one fails closed.
- **Metadata and flags:** the flags are reported as on or off only; the
  gateway refuses to start with write, SMART or external access switched
  on; no SMART configuration is published (404).

Document and consent cases are in `documents.test.ts` and
`consentResource.test.ts`.

## 2. HL7 FHIR Validator

The `gateway` job, after the unit tests:

1. writes the gateway's own output for synthetic data with
   `npx tsx scripts/fhir-r4-examples.ts fhir-examples`: 53 examples from
   `src/interoperability/fhir/conformance/examples.ts` (the published
   resource shapes, searchset Bundles including one with no match and so
   no `entry`, an OperationOutcome and the CapabilityStatement);
2. installs Java 21 and downloads the official HL7 validator 6.10.4, with
   its SHA-256 checksum pinned in the workflow;
3. runs it with `-version 4.0.1`, writing `validation.json`. The
   validator's own exit code is ignored;
4. runs `node scripts/fhir-validator-report.mjs validation.json`, which
   fails the job on any error or fatal issue and lists warnings.

The validator downloads the R4 core and terminology packages, so this step
needs network access and runs in CI only.

## 3. The migrations (PostgreSQL 16 and pgTAP)

The repository's full migration history cannot be replayed on an empty
database (a known, older problem), so this job does not run
`supabase db reset`. Instead `scripts/ci/interop_db_base.py` prints the SQL
the two interop migrations depend on:

- the Supabase API roles (`anon`, `authenticated`, `service_role`);
- an `auth.uid()` and `auth.jwt()` that read `request.jwt.claims`, as
  Supabase's do;
- minimal stand-ins for the tables the functions read (only the columns
  they use, and the indexes the repository's migrations leave on them);
- the real latest definitions of the helper functions
  (`app_current_role()`, `app_role_has_permission()`, `app_is_staff()`,
  `app_portal_patient_ids()` and others), copied from their migration
  files.

### pgTAP files

| File | Plan | Covers |
| --- | --- | --- |
| `supabase/migrations-deferred/tests/interop_foundation.test.sql` | 42 | Phase 1: the `interop` schema is closed to API roles; anon is refused; role and permissions come from the database; the audit actor is `auth.uid()`; argument checks; non-staff get no role; the rate limit; the audit trail is append-only; consent deletion and withdrawal rules; terminology review rules |
| `supabase/migrations-deferred/tests/interop_phase2.test.sql` | 277 | Phase 2, in ten sections (below) |

Sections of `interop_phase2.test.sql`:

1. Structure, grants, Phase 1 fixes and indexes.
2. `anon` can call no function.
3. A doctor: gateway context, `fhir_record_access_v2`, patient resolution,
   staff directory, link ids, consent management (including the staff
   chip's `sharing_state` and `sharing_reason` for each kind of record),
   and the functions a doctor is refused.
4. A pharmacist: rate buckets and the link functions; consent functions
   refused. A nurse and a volunteer cannot use the link functions.
5. A signed-in account that is neither staff nor a portal patient.
6. Portal patient A: own lab results, refused for patient B (and for a
   malformed or another patient's `p_patient_id`), consent on a
   merged-away record. What a patient may withdraw: only a permission to
   share, never a refusal, a treatment consent or an advance directive.
   One sign-in linked to two people: each page lists and withdraws only
   its own patient's records.
7. Consent history, audit rows and the consent guards; the directives
   JSON says whether a rule names one recipient, never who; the staff
   summary reads a verified permit for one named recipient as limited
   (never allowed) and a refusal for one as refused in part.
8. `patients.fhir_id` is kept once set.
9. The audit rate bucket.
10. An auditor: audit events and the admin status; an admin with `users`;
    a deactivated account is not staff.

### The `interop-db` job, step by step

On `ubuntu-24.04`, with PostgreSQL 16 and pgTAP from the Ubuntu packages:

1. Build the base with `interop_db_base.py`.
2. Apply Phase 1 twice, then Phase 2 twice. Each must be idempotent.
3. Run both pgTAP files with `pg_prove`.
4. Roll back Phase 2: take the rollback lines from the Phase 2 migration
   header, check there are exactly 43 statements, run them.
5. Check that `authenticated` can execute the v1 `fhir_record_access`
   again, then run the Phase 1 pgTAP file.
6. Roll back Phase 1: take its rollback lines, check there are exactly 5
   statements, run them.
7. Check the `interop` schema and every `fhir_` function are gone.
8. Apply both migrations again and run both pgTAP files.
9. **Index scenario:** build a second base without the `patient_allergies`
   and `patient_documents` indexes (production may lack them). Apply
   Phase 1, then Phase 2 twice. Expect exactly five `interop_%_idx`
   indexes. Run the Phase 2 pgTAP file.

The job prints no SQL and no schema.

### What this does not cover

These checks run on stand-ins, not on the real production schema. The full
check against the real schema is the manual **Actions → Database
migrations → rehearse** workflow (`db-migrations.yml`), which needs the
owner's approval. Whether it has been run for Phase 2 is not recorded
here: treat it as not run until the owner confirms.

## Running locally

Unit tests under Bun, and the database tests under a local PostgreSQL 16
with pgTAP installed:

```bash
bun test src/interoperability

python3 scripts/ci/interop_db_base.py > /tmp/base.sql
createdb interop_t
psql -d interop_t -c 'ALTER DATABASE interop_t SET search_path = public, extensions'
psql -v ON_ERROR_STOP=1 -d interop_t -f /tmp/base.sql
psql -v ON_ERROR_STOP=1 -d interop_t -f supabase/migrations-deferred/20260926110000_interop_foundation.sql
psql -v ON_ERROR_STOP=1 -d interop_t -f supabase/migrations-deferred/20260926130000_interop_phase2.sql
psql -d interop_t -c 'CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions'
pg_prove -d interop_t supabase/migrations-deferred/tests/interop_foundation.test.sql supabase/migrations-deferred/tests/interop_phase2.test.sql
```

Never run these against production or any database with real patients.
