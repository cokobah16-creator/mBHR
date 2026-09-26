# mBHR interoperability (FHIR R4)

A read-only FHIR R4 interface over mBHR's own clinical tables. It serves
mBHR's own signed-in staff and, behind a separate flag, portal patients
reading their own records. **It is switched off everywhere by default,
and nothing in it is enabled or applied in production.** External
systems, SMART on FHIR apps and writes are not part of it; the settings
that would turn them on are refused (see [Feature flags](#feature-flags)).

This release does not claim conformance to any implementation guide or
certification programme. It serves FHIR R4 (4.0.1) JSON that the HL7 FHIR
Validator accepts for the synthetic examples CI checks, for the resources
and searches listed in [fhir-r4.md](fhir-r4.md), and nothing else.

## Status (Phase 2)

What exists in this repository:

- The gateway (`api/fhir.ts` and `src/interoperability/fhir/`) with 19
  published resource types: Patient, Encounter, Observation (vital signs
  and laboratory), Condition, AllergyIntolerance, Medication,
  MedicationRequest, MedicationDispense, ServiceRequest, DiagnosticReport,
  DocumentReference, Binary, Consent, Practitioner, PractitionerRole,
  Organization, Location, Provenance and AuditEvent. Read and search only.
- Patient self-access for portal accounts, behind
  `FHIR_PATIENT_ACCESS_ENABLED` (off by default).
- A consent register with an append-only history, a consent evaluator, a
  portal "Privacy and data sharing" section, a staff "External sharing"
  chip and a read-only Interoperability panel for admins
  ([consent.md](consent.md)).
- Two migrations: Phase 1 `20260926110000_interop_foundation.sql` and
  Phase 2 `20260926130000_interop_phase2.sql`, with pgTAP tests. Both live
  in `supabase/migrations-deferred/`, which the Supabase CLI does not read,
  so no migration push (including the Supabase GitHub integration, which
  applies `supabase/migrations/` on every merge to `mainone`) can apply
  them. They stay there until the owner decides FHIR goes live; they are
  then given versions above production's newest and moved into
  `supabase/migrations/` ([the folder's README](../../supabase/migrations-deferred/README.md)).

What is not true yet:

- **The gateway is off.** `FHIR_ENABLED` is not set on any deployment.
- **Neither interop migration is applied to production** (or, as far as
  this repository records, to any shared database), nor is
  `patients.fhir_id` (`20260503010000`, also deferred). Production has
  every file in `supabase/migrations/` since 25 September 2026.
- The representation rules still need clinical sign-off
  (`docs/clinical/CLINICAL_LOGIC_CHANGES.md`, sections 2.5 and 2.7).

| Document | What it covers |
| --- | --- |
| [architecture-inventory.md](architecture-inventory.md) | Phase 0: what mBHR is, its auth boundaries, data model, existing FHIR code, production drift, and the CI baseline |
| [resource-mapping.md](resource-mapping.md) | Table-by-table mapping for every published type: sources, ids, elements, status maps, what is never published |
| [fhir-r4.md](fhir-r4.md) | The API: endpoints, search parameters, paging, headers, errors, rate limits, patient self-access |
| [security.md](security.md) | Authentication, the 12-step access decision, anti-enumeration, documents, audit, known limitations and findings |
| [consent.md](consent.md) | Purpose of use, the consent register and evaluator, the consent screens, the Consent resource |
| [privacy-data-flow.md](privacy-data-flow.md) | Where patient data goes, what is logged, cached and stored |
| [terminology-review.md](terminology-review.md) | Every code system and code the gateway publishes, what is left uncoded, and the review process |
| [smart-auth.md](smart-auth.md), [smart-auth-design.md](smart-auth-design.md) | SMART on FHIR: the plan and the design (not built, not enabled) |
| [testing.md](testing.md) | How the gateway and migrations are tested, locally and in CI |
| [TEFCA_ROADMAP.md](TEFCA_ROADMAP.md) | The earlier partner-facing TEFCA work (separate edge functions; see below) |

## Coverage

What each published type does today, as implemented in code. Write is
"No" everywhere: every method other than GET is refused with 405.

- **Consent** column: the consent data class a consent provision can name
  for that type. No access this release serves is governed by stored
  consent: staff treatment (`TREAT`) and a patient's own access
  (`PATRQT`) are "not applicable", and every purpose consent would govern
  is refused ([consent.md](consent.md)).
- **Audit** column: every request from a signed-in account is written to
  the access audit before anything is returned. A request without a valid
  token (401) has no account and is not audited.
- **Tests** column: files in `src/interoperability/fhir/__tests__/`
  (`.test.ts` left off). `statusMaps`, `authorize`, `guard` and
  `vercelRouting` cover every type as well, and `reviewFixes.gateway`
  checks the CapabilityStatement of every type.

| Resource | Read | Search | Write | Consent | Audit | Tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Patient | Yes | Yes | No | demographics | Every request | mappers, gateway, guard, security | Implemented. No MRN or national id is recorded; a merged-away record is served as a tombstone; a birth date on the 1st of a month is sent as the year (1 January) or the year and month, while a name and birth-date search still matches the full stored date. |
| Encounter | Yes | Yes | No | clinical | Every request | mappers, gateway, security, reviewFixes.gateway | Implemented. mBHR records no end time; a "Portal entry" visit has no start time and never matches a date search; patients see closed visits only. |
| Observation (vital signs) | Yes | Yes | No | clinical | Every request | mappers, framework, gateway, security, reviewFixes.gateway | Implemented. LOINC and UCUM from the R4 vital signs profile; no interpretation or reference range. |
| Observation (laboratory) | Yes | Yes | No | clinical | Every request | laboratory, security | Implemented. Staff need consult or lab_review (other staff get a note in their searches and 403 on a read); patients see released results only; tests carry local codes only (no LOINC). |
| Condition | Yes | Yes | No | clinical | Every request | mappers, gateway, security, reviewFixes.gateway | Partial. Reads `public.conditions`, which no app code writes (repository check); diagnoses in consultation notes are not published; clinical status, verification status and category are sent only as recorded (the held-back table fills in none of them). |
| AllergyIntolerance | Yes | Yes | No | clinical | Every request | allergy | Implemented. Staff only; allergen and reaction as free text; "no known allergies" cannot be recorded; the form's pre-selected type (medication) is not sent as a category; allergies marked inactive are not published; a search by type (`category` or `type`) is refused with a message to ask for all allergies. |
| Medication | Yes | `_id` only | No | medication | Every request | medication | Partial. Search by `_id` only; name and strength as text, no medicine code. |
| MedicationRequest | Yes | Yes | No | medication | Every request | medication | Implemented. Staff only; dosing as free text. |
| MedicationDispense | Yes | Yes | No | medication | Every request | medication | Implemented. Status is almost always `unknown`; no handover time is published. |
| ServiceRequest | Yes | Yes | No | laboratory | Every request | laboratory | Implemented. Staff with consult or lab_review only; local test codes only. |
| DiagnosticReport | Yes | Yes | No | laboratory | Every request | laboratory | Implemented. `final` only when every current result is reviewed; never `final` for a patient; no conclusion. |
| DocumentReference | Yes | Yes | No | document | Every request | documents, authorize | Implemented, for portal patients only (staff get no documents: owner decision). No author and no `meta.lastUpdated`. |
| Binary | Yes (the file itself) | No | No | document | Every request | documents, guard, security, authorize | Implemented. Portal patients only, for their own uploads. Read by id only; no ETag or conditional read; the whole file is held in memory (25 MB cap); not scanned for malware. |
| Consent | Yes | Yes | No | consent | Every request | consentResource, consentPolicy, authorize | Partial. Staff are refused (owner decision: the staff app shows only the External sharing badge). The register is empty: nothing in the app records consents yet. Patients do not see directives filed under a record that was merged into theirs. |
| Practitioner | Yes | Yes | No | directory | Every request | directory, security | Implemented. Name only; `active` is left out when the account records no flag. |
| PractitionerRole | Yes | Yes | No | directory | Every request | directory | Implemented. The mBHR access role as a local code, not a qualification. |
| Organization | Yes | Yes | No | directory | Every request | directory | Implemented. Only organisations the caller is a member of (row-level security); no app code creates memberships. |
| Location | Yes | Yes | No | directory | Every request | directory | Implemented. From the server site registry; no Encounter references it. |
| Provenance | Yes | Yes | No | audit | Every request | provenanceAudit | Partial. Only events the database records itself: lab review, release and withhold; server-side merges; document uploads. Nothing for visits, vitals, consultations, prescriptions, dispenses, allergies or conditions. |
| AuditEvent | Yes | Yes | No | audit | Every request | provenanceAudit, security | Partial. FHIR gateway reads and searches only, not activity in the app; no `agent` search. |
| Procedure | No | No | No | n/a | n/a | n/a | Not implemented. The app records no performed procedure, and `public.procedures` has no writer in the repository. |
| CarePlan | No | No | No | n/a | n/a | n/a | Not implemented. There is no structured care plan: the consultation plan is free text and `public.care_plans` has no writer. |
| Communication | No | No | No | n/a | n/a | n/a | Not implemented (deferred). Portal messages exist, but the owner has not decided they are shareable record, clinicians can edit and delete them, and they have no category. |

The reasons for the last three come from a repository review (no code in
`src/` or the edge functions writes those tables); the content of the
production tables is not known.

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
  session to PostgREST and Storage with the public anon key, so every
  clinical read is subject to the same row-level security as the app. It
  holds no secret that could read around RLS.
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
should stay undeployed (see [security.md](security.md#findings)). Their
FHIR mapper, and the app's older client-side FHIR export, do not follow
the representation rules of this gateway (for example, every allergy is
sent as "confirmed"). Phase 2 does not change them
([security.md](security.md#known-security-limitations)).

## Code layout

```
api/fhir.ts                              Vercel adapter (Edge runtime)
src/interoperability/fhir/
  config/        feature flags and settings (refuses unsafe combinations)
  types/         the narrow FHIR R4 types this release produces
  errors/        OperationOutcome and the fixed, caller-safe error set
  search/        strict search-parameter parsing, cursors, searchset Bundles
  terminology/   code systems, vital-sign codes, status maps (status/)
  mappers/       one pure mapper per resource type
  resources/     one module per published type (read, search, validate);
                 registry.ts is the list the CapabilityStatement comes from
  patients/      merge-chain resolution (canonical patient, member ids)
  capability/    CapabilityStatement, generated from the registry
  validation/    structural checks run on every resource before release
  authorization/ permissions and authorizeFhirRequest() (the access decision)
  consent/       purpose of use and evaluateConsent()
  audit/         access audit records, IP hashing, redacted log lines
  gateway/       routing guard, authentication, PostgREST and Storage access,
                 the handler
  conformance/   synthetic examples validated by the HL7 validator in CI
src/interoperability/smart/              SMART scope helpers (not wired in)
supabase/migrations-deferred/20260926110000_interop_foundation.sql   Phase 1 (deferred)
supabase/migrations-deferred/20260926130000_interop_phase2.sql   Phase 2 (deferred)
supabase/migrations-deferred/tests/interop_foundation.test.sql
supabase/migrations-deferred/tests/interop_phase2.test.sql
```

App screens that use the Phase 2 database functions (not the gateway):
`src/features/patient-portal/PrivacyConsentSection.tsx`,
`src/components/ExternalSharingChip.tsx` and
`src/pages/admin/InteroperabilitySettings.tsx`.

## Feature flags

Server-side environment variables of the Vercel project. None has a `VITE_`
prefix, so none is compiled into the browser bundle. The code is
`src/interoperability/fhir/config/config.ts`.

| Variable | Default | Effect |
| --- | --- | --- |
| `FHIR_ENABLED` | off | The gateway answers at all. Off: every `/fhir/R4` request gets 404 and nothing is read. |
| `FHIR_READ_ENABLED` | follows `FHIR_ENABLED` | `false` leaves only `/metadata`, without the resource list; every other request gets 404. |
| `FHIR_PATIENT_ACCESS_ENABLED` | off | Portal patients may read their own records, for the eight types listed in [fhir-r4.md](fhir-r4.md#patient-self-access). Off: patients get 403 (`patient_access_disabled`), and `/metadata` says nothing about what patients get. |
| `FHIR_CONSENT_ENFORCEMENT_ENABLED` | off | For disclosures that stored consent governs: on means directives are evaluated (no explicit permit means deny), off means they are refused outright. No such disclosure is served in this release, so this flag changes no answer today ([consent.md](consent.md)). |
| `FHIR_AUDIT_ENABLED` | on | Must stay on. `false` is refused: every request gets 503. |
| `FHIR_EXTERNAL_ACCESS_ENABLED` | off | **Cannot be turned on.** A true value makes every request a 503. |
| `FHIR_WRITE_ENABLED` | off | **Cannot be turned on** (503). |
| `SMART_ENABLED` | off | **Cannot be turned on** (503). |
| `SMART_EXTERNAL_CLIENTS_ENABLED` | off | **Cannot be turned on** (503). |
| `FHIR_BASE_URL` | none | Required when enabled. https only (http only for `localhost` or `127.0.0.1`), no query or fragment. Used in Bundle links and the CapabilityStatement. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | the `VITE_` values | The project the gateway reads as the caller. Refused if the key equals `SUPABASE_SERVICE_ROLE_KEY`. |
| `FHIR_DEFAULT_PAGE_SIZE` | 20 | Page size when `_count` is absent (never above the maximum). |
| `FHIR_MAX_PAGE_SIZE` | 100 | Largest page; values above 100 are lowered to 100. |
| `FHIR_RATE_LIMIT_PER_MINUTE` | 60 | Requests per signed-in account per minute (the database clamps it to 1 to 600). |
| `FHIR_SENSITIVE_RATE_LIMIT_PER_MINUTE` | 20 | A second, stricter limit, counted on top of the general one, for searches on Patient, Observation, ServiceRequest, DiagnosticReport, DocumentReference, Provenance and AuditEvent, and for every Binary download. Never above the general limit. |
| `FHIR_AUDIT_IP_SECRET` | none | HMAC key for hashing client IPs in the audit trail. Unset: no IP is kept at all. |

How the values are read:

- `FHIR_ENABLED` is on only for `true`, `1`, `yes` or `on`.
- The four refused flags (`FHIR_EXTERNAL_ACCESS_ENABLED`,
  `FHIR_WRITE_ENABLED`, `SMART_ENABLED`, `SMART_EXTERNAL_CLIENTS_ENABLED`)
  are checked **even when `FHIR_ENABLED` is off**: a true value makes every
  request a 503, not a 404. The number variables are also checked then: a
  value that is not a positive whole number gives 503.
- Once `FHIR_ENABLED` is on, `FHIR_READ_ENABLED`,
  `FHIR_PATIENT_ACCESS_ENABLED`, `FHIR_CONSENT_ENFORCEMENT_ENABLED` and
  `FHIR_AUDIT_ENABLED` must be unset or one of `true`, `1`, `yes`, `on`,
  `false`, `0`, `no`, `off`. Anything else is refused (503).
- Any refusal is a generic 503 OperationOutcome; the function log records
  only `config_invalid`, never the reason.

`/metadata` reports the flags as on/off only, in the header
`X-MBHR-FHIR-Flags` (for example
`read=on; patient=off; consent=off; audit=on; external=off; write=off; smart=off`).

Turning the flags off leaves the app exactly as it was: the clinical
screens never call the gateway.

## Rollout

### Order

**The Phase 2 migration must ship with the Phase 2 gateway.** They do not
work with the other phase's counterpart:

- The Phase 2 gateway calls `fhir_gateway_context_v2()` and
  `fhir_record_access_v2()`. Against a database without the Phase 2
  migration, every data request fails closed with 503.
- The Phase 2 migration revokes `EXECUTE` on the Phase 1
  `fhir_record_access()` from `authenticated`. A Phase 1 gateway can then
  no longer write its audit row, so every data request it serves becomes a
  503. (The Phase 1 `fhir_gateway_context()` and
  `fhir_terminology_lookup()` stay granted.)

So, for any database the gateway will use, with the owner's go-ahead:

1. Deploy the code with `FHIR_ENABLED` unset (the gateway stays inert).
2. Apply `20260503010000_add_patient_fhir_id.sql`,
   `20260926110000_interop_foundation.sql`, then
   `20260926130000_interop_phase2.sql`, each re-versioned above the
   database's newest migration and moved out of
   `supabase/migrations-deferred/` in that order. Phase 2 refuses to apply
   without Phase 1.
3. Only then set `FHIR_ENABLED` on that environment.

Applying Phase 2 briefly holds up writes to `public.patients`. The file
sets a 5-second lock timeout for its own transaction (`supabase db push`
runs each migration file in one transaction), so a statement that would
wait more than 5 seconds behind a busy table fails the migration instead
of holding up that table. The `patients.fhir_id` trigger is its last step that locks
`public.patients`, so patient writes wait only from that step to the
commit, not through the index builds. A re-run that finds the trigger in
place takes no lock on `patients`. Apply it at a quiet time, and do not
re-run it on production without a reason.

### State

| Step | State |
| --- | --- |
| Code, tests and CI | in review on this branch |
| Phase 1 and Phase 2 migrations applied anywhere shared | **not applied**; both are deferred (`supabase/migrations-deferred/`). Production database changes are owned by the HRIS transformation work and need the owner's go-ahead |
| `FHIR_ENABLED` on a preview deployment | not set |
| `FHIR_ENABLED` in production | not set; do not set until the conditions below hold |
| `FHIR_PATIENT_ACCESS_ENABLED` anywhere | not set |
| Clinical review of the representation choices | pending (`docs/clinical/CLINICAL_LOGIC_CHANGES.md`, sections 2.5 and 2.7) |

Before enabling anywhere with real data:

1. The database has the migrations the gateway and its modules read
   through. Production has every file in `supabase/migrations/` since
   25 September 2026 (22:49 UTC), which covers the ones the Phase 2
   migration names: `20260517153407` (rate limits; the file was
   `20260520000004`), `20260924110000` and `20260925100600` (role and
   permission helpers), `20260925100000` (portal patient ids, merge
   columns) and `20260925100500` (lab result release), plus
   `20260925100300` (server-side merges), `20260925100400` (stock ledger)
   and `20260925100700` (document ownership). Still missing, because they
   are deferred with the interop migrations: `20260503010000`
   (`patients.fhir_id`), `20260503010200` (dispense FHIR columns),
   `20260926110000` and `20260926130000`. Each is re-versioned above
   production's newest and fixed as `supabase/migrations-deferred/README.md`
   says before it is applied. The pharmacy, dispense and organisation
   columns the package work traced to `20260420000000`, `20260115072241`
   and `20251028120000` come from other versions on production (those
   files are in `supabase/migrations-superseded/`); that every column the
   modules read exists there has not been checked. Without them the
   affected requests fail closed (503); nothing falls back.
2. **Nobody can make themselves staff.** The gateway takes every caller's
   role from `public.app_users`, so that table must refuse writes from
   ordinary accounts: `20260925160000_hotfix_app_users_public_write.sql`
   (applied to production on 25 September 2026) and Wave A's
   `20260924110200_rls_staff_conflicts_messaging.sql` (which resets every
   `app_users` policy) must both be on the database. On a database with an
   open `app_users` write policy, any self-registered account could add
   an admin row for itself and then read every patient over FHIR.
3. A clinician has signed off sections 2.5 and 2.7 of the clinical change
   log.
4. `FHIR_AUDIT_IP_SECRET` is set if IP hashes are wanted in the audit.
5. The open items in [security.md](security.md#known-security-limitations)
   and the risks in [privacy-data-flow.md](privacy-data-flow.md#11-risks)
   have an owner decision, including the [open owner
   decisions](security.md#open-owner-decisions) on what staff may read
   beyond the staff app.

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

1. **Switch the gateway off.** Remove `FHIR_ENABLED` (or set it to `false`)
   in Vercel and redeploy. `/fhir/R4` answers 404 again. Nothing else
   changes; the audit trail and consent register are kept. (If one of the
   refused flags is set to true, or a number variable is invalid, the
   answer is 503 instead; the gateway is still closed.)
2. **Remove the code.** Revert the pull request. The rewrites, the function
   and the service-worker denylist entry go with it. If the database
   objects are also removed (step 3), the consent screens cope: the portal
   list says it is not available yet, and the staff chip is not shown.
3. **Remove the database objects** (only if the migrations were applied,
   only with the owner's go-ahead for that database, and only after step 1,
   because the Phase 2 gateway fails without them). **Phase 2 first, then
   Phase 1:**
   - Phase 2: the 43 statements in the header of
     `20260926130000_interop_phase2.sql`, in order. They drop the Phase 2
     functions and triggers, `interop.consent_record_history` and the
     Phase 2 audit columns (HTTP status, consent result, actor kind,
     restrictions), and grant `EXECUTE` on the Phase 1
     `fhir_record_access()` back to `authenticated`. **Export the consent
     history and the audit trail first.** Minted `interop.resource_links`
     rows (Practitioner and Medication ids) are left in place on purpose,
     so published ids stay the same if Phase 2 is applied again.
   - Phase 1: the five statements in the header of
     `20260926110000_interop_foundation.sql`. **Dropping the `interop`
     schema deletes the access audit trail and every consent record**, so
     export them first (as `postgres`: `COPY interop.access_audit TO ...`,
     `COPY interop.consent_records TO ...`,
     `COPY interop.consent_provisions TO ...`).

   CI runs both rollbacks in this order on every change, checks that they
   remove everything, and applies both migrations again afterwards
   ([testing.md](testing.md)).

The Phase 2 migration changes no existing clinical table or column. It
does add a trigger that keeps `patients.fhir_id` from changing once set,
indexes where missing, and a fixed `search_path` on the three Phase 1
functions; its rollback removes these too.

## Where this differs from the original brief

Recorded so the next phase starts from what was actually built.

- **Scope.** The 19 types above, read and search only. No writes,
  `_include`, `_revinclude`, `_sort`, `_summary`, `_elements`, history,
  `$everything`, Bulk Data, XML or SMART. Procedure, CarePlan and
  Communication are not implemented (see [Coverage](#coverage)).
- **Patient self-access** uses the portal's own Supabase session, behind
  `FHIR_PATIENT_ACCESS_ENABLED`, not SMART. It is limited to what the
  portal already shows.
- **No `smart_clients` table.** SMART is not built, and mBHR already has
  `oauth_clients` from the TEFCA work; the SMART design decides whether to
  extend it or add a new table ([smart-auth-design.md](smart-auth-design.md)).
- **`resource_links`** is used for Practitioner and Medication ids, whose
  source ids cannot be published. Every other id is derived from its
  source row.
- **Organisation scoping** is not enforced, because mBHR clinical rows
  carry no organisation or site id; RLS applies as defined, and every
  decision records the restriction `org_scope_not_applied`.
- **Consent** is evaluated in code, but no purpose the gateway accepts is
  governed by it, and the register has no entries yet
  ([consent.md](consent.md)).
- **Documents** are served, to portal patients only, through `Binary/[id]`
  on the gateway, never as Storage or signed URLs.
- **Condition** still reads `public.conditions` only. Diagnoses typed in
  consultations (`consultations.provisional_dx`) are not published, and
  every Condition searchset says so.
