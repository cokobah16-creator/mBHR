# FHIR gateway security

How `/fhir/R4` decides who may read what, how documents are served, what
it records, what it logs, the known limitations, and the security problems
found in Phase 0 that affect exposing FHIR at all. This document describes
controls; it is not a claim of compliance with any regulation or
certification.

## Who can use it

| Caller | Result |
| --- | --- |
| mBHR staff signed in online, with an active staff role | read and search, per permission (below) |
| A portal patient signed in online, linked to a kept (not merged) record | only with `FHIR_PATIENT_ACCESS_ENABLED`, and only their own records for eight types ([below](#patient-self-access)); otherwise 403, audited |
| No token, malformed token, expired or revoked session, wrong audience | 401, not audited (there is no account to attribute) |
| A signed-in account that is neither staff nor a linked portal patient (guest, unknown or deactivated role, open sign-up) | 403, audited |
| An offline PIN session | it has no Supabase session, so it cannot call the gateway at all (a PIN is a device credential, never a server one) |
| External systems, SMART apps, service accounts | no way in: there is no token issuer, no client registry and no CORS; the flags that would add them are refused ([README](README.md#feature-flags)) |

## Authentication

- The bearer token comes from the `Authorization` header only; a token in
  the URL is never accepted.
- It must be a JWT whose `aud` includes `authenticated`, whose `role` is
  `authenticated`, and whose `exp` is in the future.
- Supabase Auth then verifies it (`GET /auth/v1/user`), and the returned
  user id must equal the token's `sub`.
- **Who the caller is to mBHR comes from the database**, never from the
  token or the request: `public.fhir_gateway_context_v2()` returns the
  caller's role (`app_current_role()`), permissions
  (`app_role_has_permission()`), kind (staff, patient or none) and, for a
  portal patient, the internal ids of their linked records
  (`app_portal_patient_ids()`, which excludes merged-away records). The
  same call takes one step of the rate limits. Supabase sign-up is open
  in `supabase/config.toml`, so "has an account" means nothing on its own.

## The access decision

`authorizeFhirRequest()` in
`src/interoperability/fhir/authorization/authorize.ts` runs exactly once
per request, **before any clinical row is read**. The steps run in this
order and the first refusal wins; no step can widen what an earlier one
allowed. Every decision, permit or deny, is audited.

| # | Step | Rule | Refusal (reason, status) |
| --- | --- | --- | --- |
| 1 | enabled | `FHIR_ENABLED` and `FHIR_READ_ENABLED` are on | `reads_disabled`, 404 |
| 2 | authenticated | a valid Supabase session for a real account | `unauthenticated`, 401 |
| 3 | active | active staff (a staff role), or a portal patient linked to at least one kept record | `no_active_account`, `no_staff_role`, `no_linked_record`, 403 |
| 4 | surface | no external client and no SMART scopes (none can exist in this release); a patient only with `FHIR_PATIENT_ACCESS_ENABLED`; a known purpose; no break-glass; staff may state `TREAT` only, patients `PATRQT` only | `external_access_disabled`, `smart_not_enabled`, `patient_access_disabled`, `purpose_invalid`, `break_glass_not_enabled`, `purpose_not_supported`, 403 |
| 5 | permission | staff: one of the type's permissions (`READ_PERMISSIONS`); patients: the type is in `PATIENT_SELF_ACCESS` | `missing_permission`, `not_available_to_patients`, 403 |
| 6 | organisation | no request can name an organisation scope; none is applied (restriction `org_scope_not_applied`) | `organization_scope_not_supported`, 403 |
| 7 | patient | patients: every patient the request names must be their own; the query is confined to their records (restriction `patient_scope`) | `patient_not_in_context`, 403 |
| 8 | ownership | every row returned must belong to a patient in scope, checked after the read and before release (restriction `owner_check_after_read`) | a mismatch is a 500 (`scope_violation` in the log), nothing released |
| 9 | resource class | per-class limits as restrictions (below) | none (limits only) |
| 10 | consent | `evaluateConsent()` for every named patient, where consent governs the access ([consent.md](consent.md)) | the consent reason, 403 |
| 11 | sensitivity | no security labels are recorded in mBHR yet (restriction `no_security_labels`) | none |
| 12 | log | the gateway writes the decision to the access audit before answering | a failed permit write is 503 |

Step 9 restrictions:

- **Patients:** Encounter `closed_encounters_only`, Observation
  `portal_visible_only`, DiagnosticReport `released_results_only`,
  MedicationDispense `portal_visible_only`, DocumentReference
  `own_documents_only`, Binary `patient_uploads_only`, Consent
  `own_consents_only`.
- **Staff:** Observation gets `no_lab_rows` without consult or
  lab_review; Provenance gets `lab_events_only` without audit_access.

Step 10 in practice: no purpose the surface accepts today (staff `TREAT`,
patient `PATRQT`) is governed by stored consent, so the directive lookup
is never reached through the gateway. The step does not load directives
when enforcement is off or when the staff member cannot read consents.

**Row-level security** applies on top of all of this. Clinical rows are
read through PostgREST (and files through Storage) with the caller's own
token and the public anon key, so the database's policies apply exactly as
they do to the app. The gateway holds no service-role key, and
`readFhirConfig()` refuses to start if it is given one in place of the
anon key. A row RLS hides is indistinguishable from one that does not
exist (404, or absent from a Bundle). The gateway reads only an allowlist
of tables and only functions named `fhir_*`.

Writes never reach the decision: every method except GET is 405.

## Staff permission per type

`READ_PERMISSIONS` in `authorization/permissions.ts`. A type is readable
when the account holds **any** of the listed permissions; row-level
security then decides which rows it sees.

| Resource | Needs any of |
| --- | --- |
| Patient | register, vitals, consult, dispense, lab_review |
| Encounter | vitals, consult, lab_review |
| Observation | vitals, consult, lab_review; **laboratory rows also need consult or lab_review** |
| Condition | consult |
| AllergyIntolerance | register, vitals, consult, dispense |
| Medication | consult, dispense, inventory |
| MedicationRequest, MedicationDispense | consult, dispense |
| ServiceRequest, DiagnosticReport | consult, lab_review |
| DocumentReference, Binary | consult |
| Consent | consult, portal_manage, audit_access |
| Practitioner, PractitionerRole, Organization, Location | any staff permission (every staff member) |
| Provenance | audit_access, lab_review (lab_review alone: laboratory events only) |
| AuditEvent | audit_access |

With the role matrix in `src/auth/roles.ts` (kept equal to the database
copy by `src/auth/roleMatrixParity.test.ts`), the directory types aside:

| Role | Can read |
| --- | --- |
| admin | every type |
| lead_clinician | every type |
| doctor | every type except AuditEvent; Provenance laboratory events only |
| nurse, volunteer | Patient, Encounter, Observation (vital signs only), AllergyIntolerance, Consent |
| pharmacist | Patient, AllergyIntolerance, Medication, MedicationRequest, MedicationDispense |
| registration_lead | Patient, AllergyIntolerance, Consent |
| auditor | Consent, Provenance, AuditEvent |
| guest | nothing |

Row-level security may narrow this further: if a table's policies are
narrower than these permissions, the caller gets fewer rows (or none).
The table above is the single place to change what the gateway allows.

### Open owner decisions

The owner's rule is that FHIR never lets staff read more than the staff
app shows. Two rows of the table go beyond today's staff app. They are
defaults chosen during the build, not settled decisions, and need the
owner's decision before the gateway is enabled with real data:

| Type | Who can read it | What the staff app shows today | Options |
| --- | --- | --- | --- |
| DocumentReference, Binary | consult (doctor, lead clinician, admin): every patient's document list and files, portal uploads and insurance documents included | No staff screen reads patient documents; only the patient portal does | Keep for consult; or patients only (their own files) until a staff documents screen exists |
| AuditEvent | audit_access (admin, lead clinician, auditor): the FHIR access trail for any patient | No staff screen shows the FHIR access trail per patient | Keep for audit_access; or refuse until an audit screen exists |

The clinical change log lists the documents question for sign-off
(`docs/clinical/CLINICAL_LOGIC_CHANGES.md`, section 2.7).

## Patient self-access

Off unless `FHIR_PATIENT_ACCESS_ENABLED` is set. The model:

- The patient's records are `app_portal_patient_ids()` for their account,
  computed in the database. Nothing from the request, the token or the
  browser's cached portal profile decides it.
- Eight types only: Patient, Encounter, Observation, DiagnosticReport,
  MedicationDispense, DocumentReference, Binary, Consent. Everything else
  is 403 `not_available_to_patients`.
- Each type applies the portal's own visibility rules: closed visits;
  vital signs whose `portal_visible` is not false; laboratory results only
  through `fhir_patient_lab_results()` (reviewed, released, not withheld,
  not superseded); dispenses with `portal_visible = true`; their own
  documents that were not removed; files they uploaded themselves; their
  own consents. Details per type are in
  [fhir-r4.md](fhir-r4.md#patient-self-access).
- Restrictions: a patient's DiagnosticReport is never `final`; their
  MedicationDispense carries no quantity, performer or prescription link;
  clinic documents are listed but their files are not served (there is no
  release step for them); the purpose is always `PATRQT`.
- Naming another patient, in any parameter or read id, is 403
  (`patient_not_in_context`) and audited.
- The audit function accepts a patient's permit only when every patient it
  names is one of their own records, and at least one is named.

## Anti-enumeration

- **Every staff search must name a record** (`requiredSearch` per type,
  listed in [fhir-r4.md](fhir-r4.md#parameters-per-type)). Otherwise 403
  before any clinical row is read, audited as `search_not_narrowed`.
- Patient search by name needs an exact birth date as well; the name is 2
  to 64 letters, spaces, hyphens or apostrophes (no wildcards or digits);
  merged-away records are excluded.
- Date-only searches are allowed only where they cannot list patients
  wholesale: Provenance `recorded` and AuditEvent `date` on their own need
  a closed range of at most 31 days (Provenance also needs audit_access).
- Unknown parameters, modifiers, comma OR lists, `_include`, `_sort` and
  similar are refused (400) rather than ignored, so a typo cannot silently
  widen a search.
- Filters are built into the database query (PostgREST filters with quoted
  values, or function arguments), not fetched and then filtered, except
  a few filters that are applied after mapping; those can only narrow.
- Page size is capped at 100; paging is keyset-based with an opaque cursor
  bound to the caller, query and type; there is no total count.
- A search for a patient a staff member cannot see returns an empty
  Bundle, and a read of a hidden or missing record returns the same 404.
- Published patient ids are random uuids (`patients.fhir_id`); the
  device-generated ULID (`patients.id`, which encodes a timestamp) is never
  published. Practitioner and Medication ids are random uuids too.

## Owner check after read

Every module returns, with each resource, the internal id of the patient
it belongs to (or none, for directory and catalogue data). Before
validation and release, the gateway checks:

- a patient caller: every owner must be one of their own records (a row
  with no owner is refused as well);
- any search that named a patient: every owner must be among that
  patient's records (the canonical record and its merged-away members).

A mismatch means a module or a database policy returned more than it
should. The gateway releases nothing and answers 500 (logged as
`scope_violation`). This is defence in depth: the queries are already
confined, and `security.test.ts` checks that rows outside the scope are
never released even if the database returns them.

## Merged patients

- `patient=` (or `subject=`) naming a merged-away record returns an empty
  result plus an informational OperationOutcome naming the kept record.
- A search by the kept record includes rows still filed under its
  merged-away members, each shown with the kept record as subject.
- A read of a merged-away Patient returns a tombstone: `active: false`,
  the name, and a `replaced-by` link to the kept record.
- A merge chain that does not end cleanly fails closed: more than 10 hops
  or a loop, a hop the caller cannot see, or a merged-away record whose
  kept record is gone. Nothing is resolved, so nothing is returned (and
  rows of such a patient are left out).
- Resolution runs as the caller (`fhir_resolve_patients()` is SECURITY
  INVOKER), so row-level security applies to every hop.
- A patient cannot reach a merged-away record by naming it:
  `app_portal_patient_ids()` excludes merged-away records.

## Documents

`DocumentReference` describes a file; `Binary/[id]` serves it. Controls:

- **Each download is authorised on its own.** An earlier DocumentReference
  read never counts. Staff need consult; a patient gets only files they
  uploaded to their own record (restriction `patient_uploads_only`).
- **The row is read as the caller** (row-level security applies): the id,
  not removed (`deleted_at is null`), confined to the caller's records,
  and for a patient `upload_source = 'patient'`.
- **The row's patient is resolved** through `fhir_resolve_patients()`; a
  chain that does not end is 404.
- **The path is confined to the patient's folders.** The stored path comes
  from the row, never from the request. An optional `patient-documents/`
  prefix is dropped. Then every segment must match `[A-Za-z0-9._ -]`, with
  no `.`, `..` or empty segment, no leading or trailing spaces, at most 8
  segments and at least 2, and **the first folder must be the row's
  patient or a record merged into it**. Otherwise 404, and Storage is
  never called.
- **Storage is read as the caller** (`/storage/v1/object/authenticated/…`
  with the caller's token), so the bucket's own policies apply a second
  time. A missing object, a Storage refusal (400, 403 or 404) or an empty
  file is 404.
- **Allowlisted content types only:** PDF, JPEG, PNG, WebP, HEIC, HEIF,
  Word `.doc` and `.docx`. Anything else is served as
  `application/octet-stream` with a `.bin` file name, so a browser never
  renders HTML, SVG or scripts. The type comes from the row, not from
  Storage.
- **Response headers:** `Content-Disposition: attachment` with a safe ASCII
  file name, `Content-Security-Policy: default-src 'none'; sandbox`,
  `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
- **Audited before any byte is sent.**
- **Never used:** Storage signed URLs, public URLs, folder listings, or any
  storage path or URL in a FHIR resource. A signed URL is a bearer
  capability that outlives removal and deactivation.
- Every Binary read counts against the sensitive rate limit.

## Audit

Every request from a signed-in account writes one row to
`interop.access_audit` through `public.fhir_record_access_v2()`, as the
caller:

- **A permitted request is audited before release.** If that write fails,
  the answer is **503 and no data leaves**.
- A refusal, bad request, rate limit or server error is audited on a best
  effort basis: the refusal is still returned if it cannot be recorded
  (the function log keeps the request id).
- A request without a valid token (401) has no account and is not
  audited.

Each row holds:

- request id and time (server clock);
- the actor: account id taken from `auth.uid()` inside the database, never
  from the gateway; role (`app_current_role()`); actor kind (staff,
  patient or none), recomputed by the database;
- interaction (read or search), resource type and id;
- the **internal** ids of the patients whose data was returned or named,
  at most 100 (a response that would name more is refused with 500
  instead of being served partly unaudited);
- purpose, decision, denial reason, result count, HTTP status;
- consent decision, consent id and provision id, and restriction codes
  (at most 12);
- search parameter **names** only (never values; a name the type does not
  support is recorded as `unsupported`), the user agent (first 200
  characters), and an HMAC of the client IP when `FHIR_AUDIT_IP_SECRET` is
  set (no IP at all otherwise).

Guards:

- The table is **append-only**: UPDATE, DELETE and TRUNCATE are refused for
  every role. No API role can read or write it directly.
- `fhir_record_access_v2()` accepts a permit row only from staff, or from a
  portal patient naming only their own records; any other account may
  record only refusals naming no patient. It has its own rate limit
  (bucket `fhir_audit`: 300 rows a minute for staff and patients, 30 for
  other accounts).
- Holders of audit_access read the trail through AuditEvent, which never
  publishes account ids, IP hashes, user agents or internal patient ids.
  Reading AuditEvents is itself audited against every patient the served
  events name. The admin panel (`fhir_interop_admin_status()`, audit_access
  or users) shows counts and recent decisions without ids.

Never recorded: tokens, headers other than the user agent, search values,
names, birth dates, resource or file content, consent content.

## Response and log hygiene

- `Cache-Control: private, no-store`, `Pragma: no-cache` and
  `X-Content-Type-Options: nosniff` on every answer, including `metadata`
  and errors, plus the site's existing security headers from
  `vercel.json`.
- No CORS headers: other origins cannot read responses in a browser.
- The service worker never serves the app shell for `/fhir/`, and FHIR
  responses are not in its caches.
- Errors are OperationOutcomes with fixed messages
  ([fhir-r4.md](fhir-r4.md#errors)). Database errors are mapped by SQLSTATE
  only; their messages, stack traces and configuration problems are never
  shown to the caller.
- **Logs never hold tokens or patient data.** The function log gets one
  JSON line per request: `component`, request id, status, outcome code,
  and where known the resource type and duration. No token, header, query
  string, search value, patient id of any kind, or resource or file
  content is logged. An unexpected exception is logged by class name only.
  `security.test.ts` checks this.
- Every resource is validated before release; a read of one that fails is
  500, a search leaves it out with a warning.
- Requests over 4096 characters (414), with a body (400), with another
  method (405) or asking for a non-JSON format (406) are refused before
  authentication.

## Rate limiting

Per account, counted in `public.rate_limits`:

- general: 60 a minute by default (`FHIR_RATE_LIMIT_PER_MINUTE`, clamped
  to 1 to 600 by the database), bucket `fhir_gateway`;
- sensitive: 20 a minute by default
  (`FHIR_SENSITIVE_RATE_LIMIT_PER_MINUTE`, never above the general limit),
  bucket `fhir_gateway_sensitive`, on top of the general one, for searches
  on Patient, Observation, ServiceRequest, DiagnosticReport,
  DocumentReference, Provenance and AuditEvent, and every Binary read;
- audit writes: bucket `fhir_audit` (above).

Over a limit is 429 with `Retry-After`, audited. Unauthenticated requests
are not counted by the gateway; Supabase Auth's own limits and Vercel's
platform protection apply.

## Known security limitations

Open items, each needing an owner decision or later work. None is hidden
by the gateway; several are also in the CapabilityStatement notes.

| Limitation | Effect | Notes |
| --- | --- | --- |
| **Staff roles come from `public.app_users`** | If that table accepts writes from ordinary accounts, anyone who signs up could make themselves admin and read every patient over FHIR. | Production's open write policy was closed by `20260925160000` (25 September 2026); Wave A's `20260924110200` resets every `app_users` policy. Both are enablement preconditions ([README](README.md#state)). The gateway cannot detect an open policy itself. |
| **Organisation scoping is not applied** | Any permitted staff member can read any patient row-level security lets them see, whatever their organisation or site. | mBHR clinical rows carry no organisation or site (F6). Every decision records `org_scope_not_applied`. Blocks external and multi-organisation use (F4). |
| **`public.canonical_patient_id(text)` is executable by `authenticated`** | Any signed-in account (sign-up is open) that knows an internal patient id can learn whether that record was merged and the internal id of the kept record. No clinical data is returned. | Existing code (`20260925100000_sync_authority_foundation.sql`, SECURITY DEFINER), not part of this work; the gateway does not call it. Narrowing the grant belongs to that migration's owners. |
| **AuditEvent `agent` search is not implemented** | An auditor cannot list what one staff member accessed through FHIR; they can search by patient or by a date range of at most 31 days. | The directory does not map a Practitioner id back to an account for the audit function. |
| **Binary holds the whole file in memory** | Each download is read fully into the function's memory (up to 25 MB, then 503) before it is sent. | Streaming is not implemented. Portal uploads are capped at 10 MB in the app. |
| **The Vercel response size limit is unverified** | Vercel limits the size of function responses; files above that limit may fail. | Not checked against current Vercel documentation or a deployment. Verify before larger files are expected to work. |
| No malware or content scanning | `.doc` and `.docx` can carry macros. | Files are always downloads, never rendered inline (attachment, sandbox CSP, nosniff, octet-stream fallback). Scanning is an owner decision. |
| Search values in URLs | Names with birth dates and patient ids reach Vercel and Supabase request logs, outside the audit trail. | See [privacy-data-flow.md](privacy-data-flow.md), risk R1. |
| Forged refusal rows | The Phase 1 recording function accepted any signed-in caller, so older deny rows may have been written by the account itself. | Kept (a refusal grants nothing); forged permit rows are withheld from AuditEvent. |
| Audit retention | No period is set and no job deletes or archives rows; a rollback drops the trail. | Owner decision; export before any rollback. |
| Directory searches write | A Practitioner name or PractitionerRole role search can mint `resource_links` rows (a GET with a write side effect). | By design: it keeps published ids stable. No clinical data. |

## Findings

Found in Phase 0 (at `mainone` 2140351). F1 to F4 must be resolved before
FHIR is exposed beyond mBHR's own staff and portal patients; none is
changed by this work.

| # | Severity | Finding | Status / owner |
| --- | --- | --- | --- |
| F1 | Critical | The deployed TEFCA edge functions (`tefca-ias`, `tefca-bulk`, `tefca-oauth`) still run code with the header bypass the September audit found; #135 fixed the repository copy only. Anyone who knows the URL can reach the old code. | Owner decision pending (delete them, or deploy the fixed versions); tracked in the System audit fixes work. This gateway does not use them. |
| F2 | High | Those functions read with the **service-role key**, so row-level security does not apply, and they keep a second copy of clinical data in `fhir_resources`. | Keep them undeployed until a partner needs them; the SMART design decides whether they are retired or rebuilt on this gateway. |
| F3 | High | Production has drifted from the migrations: 62 repository migrations are unapplied, including the Sept 24 permission helpers, the RLS rewrite and Wave A/B. Production's actual RLS on clinical tables is therefore unverified. | Reconciliation owned by the HRIS transformation work. Mitigation here: the gateway checks role and permission in the database itself instead of trusting RLS alone, and fails closed (503) where helpers or columns are missing. **Do not enable FHIR against production until reconciled.** |
| F4 | High | No organisation or site on clinical rows (F6) plus open sign-up: any external party would see all patients of any permitted role. | Blocks external clients and multi-organisation use; needs a data-model change first. |
| F5 | Medium | Supabase sign-up is enabled (`supabase/config.toml`; production's setting is not visible from the repository **(inferred to match)**). Any person can obtain an `authenticated` token. | Handled here by never treating `authenticated` as authorised. Owner to decide whether public sign-up is needed at all (portal patients may need it). |
| F6 | Medium | Clinical tables have no tenant (organisation / site) column; visits have only a free-text `site_name`. | Recorded for the data-model plan; the gateway cannot scope what the data does not record. |
| F7 | Low | The role helpers compare ids as text (`au.id::text = auth.uid()::text`) because production ids may be uuid where the migrations say text. It works, but hides the type drift and defeats indexes. | New interop code compares uuid to uuid. Fixing the helpers belongs to the reconciliation. |
| F8 | Info | `patients.fhir_id` (`20260503010000`) and `rate_limits` (`20260520000004`) may be missing on production **(inferred)**. | The gateway fails closed without them. Check with the Database migrations → status workflow. |

Not a finding for this gateway but relevant to the public repository: two
Resend API keys remain in git history (known; rotation is with the owner).

## Before any external access

Required before SMART apps or partner systems (see
[smart-auth-design.md](smart-auth-design.md#16-blockers-what-must-exist-before-smart-can-be-enabled)):
F1 to F4 resolved; a client registry with per-client scopes and consent
checks; an explicit CORS allowlist; a decided audit retention period;
consent enforcement on, with permits matched to the client; an external
security review of the gateway.
