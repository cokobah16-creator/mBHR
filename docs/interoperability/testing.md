# Testing the FHIR gateway and interop schema

Three layers, all in CI (`.github/workflows/interop-fhir.yml`, "FHIR R4
interoperability"), which runs on pull requests that touch the interop files
and on every push to `mainone`. None of it connects to Supabase or Vercel.

## 1. Unit and security tests (Vitest)

```bash
npx vitest run src/interoperability
```

Files in `src/interoperability/fhir/__tests__/`:

| File | Covers |
| --- | --- |
| `mappers.test.ts` | Patient, Encounter, Observation and Condition mapping: status carried exactly, missing and zero values not published, units in UCUM, blood pressure as a two-component panel, profiles only with a measurement time, con-5 for entered-in-error, merged patients, verified codings only; the structural validator; every conformance example passes it |
| `framework.test.ts` | Configuration refusals (write/SMART flags, http base URL, service-role key), search parsing (`_count`, dates, tokens, names, cursors, modifiers, OR lists), the access decision, the CapabilityStatement lists only what is implemented |
| `gateway.test.ts` | The whole request path against an in-memory Supabase (`fakeSupabase.ts`, with an RLS hook): flag off = 404; metadata; 401 for missing, malformed, expired, wrong-audience and unknown tokens; 403 for portal users, missing permissions and refused purposes, each audited; RLS-hidden rows stay hidden; searches that do not name a record, filter syntax in values, and bad ids are refused before any query; page cap; ETag / 304 / no-store; audit before release and 503 with no data when the audit fails; audit holds parameter names, never values; paging with no duplicates; 405 / 414 / 429; no database detail or patient data in responses or logs |
| `vercelRouting.test.ts` | `vercel.json` sends `/fhir/R4` and everything under it to the function, before the app catch-all |

Fixtures are synthetic (`fixtures.ts`); no real patient data is used
anywhere in these tests.

## 2. HL7 FHIR Validator

CI writes the gateway's own output for synthetic data
(`npx tsx scripts/fhir-r4-examples.ts fhir-examples`: every published
resource shape, a searchset Bundle, an OperationOutcome and the
CapabilityStatement) and runs the official HL7 validator (6.10.4, checksum
pinned) with `-version 4.0.1`. `scripts/fhir-validator-report.mjs` fails the
job on any error or fatal issue and lists warnings.

The validator downloads the R4 core and terminology packages, which the
cloud environment this was written in cannot reach, so this step runs in
CI only.

## 3. The migration (PostgreSQL 16 + pgTAP)

The repository's full migration history cannot be replayed on an empty
database (known and pre-existing; production reconciliation is separate
work), so this job does not run `supabase db reset`. Instead
`scripts/ci/interop_db_base.py` builds only what the migration depends on:
the Supabase API roles, an `auth.uid()` that reads `request.jwt.claims` like
Supabase's, a minimal `app_users`, the real rate-limit migration, and the
real latest definitions of `app_current_role()`, `app_role_has_permission()`
and `app_is_staff()` copied from their migration files. Then it:

1. applies `20260925160000_interop_foundation.sql` twice (it must be
   idempotent);
2. runs `supabase/tests/interop_foundation.test.sql` with `pg_prove`
   (42 tests: the schema is closed to API roles, anon is refused, role and
   permissions come from the database, the audit actor is `auth.uid()`,
   argument validation, non-staff get no role, the rate limit, the audit
   trail is append-only, consent withdrawal rules, terminology review
   rules);
3. runs the rollback from the migration header and checks nothing is left;
4. applies the migration again.

No SQL or schema is printed by the job.

The full check against the real schema is the manual **Actions → Database
migrations → rehearse** workflow, which needs the owner's approval; it has
not been run for this change.

## Running locally without npm

Where `npm install` is not possible, the same tests run under Bun, and the
database test under a local PostgreSQL 16:

```bash
bun test src/interoperability
python3 scripts/ci/interop_db_base.py > /tmp/base.sql
createdb interop_t
psql -v ON_ERROR_STOP=1 -d interop_t -f /tmp/base.sql
psql -v ON_ERROR_STOP=1 -d interop_t -f supabase/migrations/20260925160000_interop_foundation.sql
psql -d interop_t -c 'CREATE EXTENSION pgtap'   # or pg_prove if installed
psql -d interop_t -f supabase/tests/interop_foundation.test.sql
```

Never run these against production or any database with real patients.
