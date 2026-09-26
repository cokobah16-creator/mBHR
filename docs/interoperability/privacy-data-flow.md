# FHIR gateway: privacy data flows

Where patient data goes when someone uses the `/fhir/R4` gateway and the
consent views: who calls what, which data crosses which boundary, and what
is logged, cached and stored. It describes controls; it is not a claim of
compliance with any regulation.

**Status.** The gateway is off everywhere by default (`FHIR_ENABLED`
unset), and nothing described here is enabled in production. Items marked
**Phase 2** are the additions of the second delivery; they sit behind the
same switch, and patient self-access has its own flag,
`FHIR_PATIENT_ACCESS_ENABLED`, which is also off by default. External
systems, SMART apps and writes stay refused
([smart-auth-design.md](smart-auth-design.md)).

Related: [security.md](security.md) (the access decision and findings),
[consent.md](consent.md) (purpose of use and consent),
[README](README.md#feature-flags) (flags).

## 1. Parties

| Party | Where it runs | Holds patient data? |
| --- | --- | --- |
| **Browser**: the mBHR web app (staff tablet or phone, or a patient's phone for the portal), or another HTTP client the signed-in person uses | the person's device | yes: the app's own offline copy (section 8) and whatever the person downloads |
| **Gateway**: `api/fhir.ts`, a Vercel Edge Function on the app's own origin (`https://mbhr.app/fhir/R4`) | Vercel | only in memory, for one request |
| **Supabase Auth** | Supabase | account records (not clinical) |
| **PostgREST / Postgres**: clinical tables under row-level security, the `fhir_*` functions, the `interop` schema | Supabase | yes: the system of record |
| **Supabase Storage**: bucket `patient-documents` | Supabase | yes: uploaded files |
| **Platform logs**: Vercel request and function logs, Supabase API logs | Vercel, Supabase | see section 3 |

Nobody else is a party: the gateway sends no CORS headers, has no token
issuer, and refuses `SMART_ENABLED`, `SMART_EXTERNAL_CLIENTS_ENABLED`,
`FHIR_EXTERNAL_ACCESS_ENABLED` (Phase 2) and `FHIR_WRITE_ENABLED`.

## 2. Flows

### 2.1 Who calls what

| Caller | Calls | With |
| --- | --- | --- |
| Signed-in staff member | `GET /fhir/R4/...` (read, search) | their own Supabase access token |
| Signed-in portal patient (**Phase 2**, only with `FHIR_PATIENT_ACCESS_ENABLED`) | `GET /fhir/R4/...` for their own records | their own Supabase access token |
| Anyone | `GET /fhir/R4/metadata` | nothing (section 10) |
| Gateway | Supabase Auth `GET /auth/v1/user`; PostgREST table reads and `fhir_*` functions; Storage (**Phase 2**, document downloads only) | the **caller's** token and the public anon key; never the service-role key (the configuration refuses to start if given it) |
| Web app, consent views (**Phase 2**) | PostgREST functions `interop_consent_summary`, `interop_my_consents`, `interop_record_consent`, `interop_verify_consent`, `interop_withdraw_consent` directly, **not** through the gateway | the person's own Supabase session |
| Web app, interoperability admin view (**Phase 2**) | `fhir_interop_admin_status()` (counts and recent decisions, no ids or patient data) and the flags header of `/metadata` | the person's own session; needs `audit_access` or `users` |

The web app's clinical screens do not read through the gateway; they keep
using their own Supabase and offline paths.

### 2.2 A read or search, step by step

What crosses each boundary. "Internal id" means `patients.id`, the
device-generated identifier that is never published; published patient ids
are the random `patients.fhir_id`.

| # | From → to | What crosses | Patient data? |
| --- | --- | --- | --- |
| 1 | Browser → gateway (HTTPS) | `Authorization: Bearer <Supabase access token>`; optional `X-Purpose-Of-Use`; the URL: resource type, id, and **search values** (a patient reference, an identifier, a name with a birth date, codes, dates); `User-Agent`; the client IP as seen by the platform | **yes**, in the URL |
| 2 | Gateway → Supabase Auth | the caller's token (`GET /auth/v1/user`); the answer is the account record, of which the gateway keeps only the user id | no clinical data; the account record passes through memory only |
| 3 | Gateway → PostgREST, `fhir_gateway_context_v2()` (**Phase 2**; v1 before) | the caller's token, rate-limit settings | returns role and permissions, or for a portal patient their **internal ids** |
| 4 | Gateway → PostgREST, table reads (GET) | filters in the **URL query**: internal ids, `fhir_id` values, name prefixes, birth dates, codes, date ranges, cursor keys | **yes**, in the URL |
| 5 | Gateway → PostgREST, functions (POST) | arguments in the **request body**: `fhir_resolve_patients`, `fhir_staff_directory`, `fhir_link_ids`/`fhir_link_sources`, `fhir_consent_directives`, `fhir_patient_lab_results`, `fhir_access_audit_events` (all **Phase 2**) | yes, in bodies |
| 6 | PostgREST → gateway | the rows row-level security lets the caller see, from fixed column lists | **yes** |
| 7 | Gateway (memory) | map to FHIR, validate, re-check every row's owner against the caller's scope (a mismatch fails closed, **Phase 2**) | yes, in memory only |
| 8 | Gateway → PostgREST, `fhir_record_access_v2()` (**Phase 2**; v1 before) | the audit record (section 9), **before** anything is returned; if it cannot be written the caller gets 503 and no data | internal ids of the patients involved |
| 9 | Gateway → browser | FHIR JSON (a resource, a searchset Bundle, or an OperationOutcome) | **yes** |
| 10 | Gateway → Vercel function log | one line (section 3) | no |

Refusals (401, 403, 400, 429) stop at the step that refuses. From Phase 2,
refusals, bad requests, rate limiting and server errors of a signed-in
caller are audited too (best effort on error paths: if that audit write
fails, the function log keeps the request id).

### 2.3 Patient self-access (Phase 2, flag off by default)

Same path as 2.2, with a portal session. The patient records the account
may see come from `app_portal_patient_ids()` in the database, never from
the request or the browser's cached portal profile. Every query is limited
to those ids, and each resource type applies the portal's own visibility
rules (for example, lab results only through `fhir_patient_lab_results()`:
reviewed, released, not withheld, not superseded). Types the portal does
not show are refused.

### 2.4 Document downloads (Binary, Phase 2)

1. The gateway reads the `patient_documents` row **as the caller** (row-level
   security applies), skips removed rows, and runs the same permission and
   patient-scope checks as for the DocumentReference.
2. It fetches the file from Storage **as the caller**
   (`/storage/v1/object/authenticated/patient-documents/<path>`), so the
   bucket's own policies apply a second time. The object path comes from
   the row, is checked (no `..`, no empty or odd segments) and is never
   taken from the request. Storage refusals and missing files are both
   answered as "not found".
3. The access is audited before any byte is returned.
4. The file is relayed through the gateway in the response: it is held in
   the function's memory for that request only (at most 25 MB) and never
   written anywhere. Headers: `Content-Disposition: attachment` with a safe
   ASCII file name, an allowlisted `Content-Type` (otherwise
   `application/octet-stream`), `X-Content-Type-Options: nosniff`, and no
   caching.
5. **Never used:** Storage signed URLs, public URLs, folder listing, or any
   storage path or URL in a FHIR resource. A signed URL is a bearer
   capability: it outlives removal, deactivation and portal switch-off
   until it expires, leaks through logs and referrers, and is not audited
   per use. The DocumentReference's attachment URL is the gateway's own
   `Binary/<id>`.
6. Only portal patients download documents: staff accounts are refused
   (owner decision, until mBHR has a staff documents screen). Portal
   patients (with `FHIR_PATIENT_ACCESS_ENABLED`) get file content only for
   documents they uploaded themselves (`upload_source = 'patient'`);
   clinic documents have no release step yet.

### 2.5 Consent views (Phase 2)

The staff consent panel and the portal consent page call the `interop_*`
functions directly from the browser with the person's own session; the
gateway is not involved. What crosses:

- **Summary** (`interop_consent_summary`, staff or the patient themself):
  `external_sharing` (allowed, not allowed or withdrawn, as the evaluator
  reads it), and for the staff chip `sharing_state` (allowed, restricted
  or withdrawn) with `sharing_reason` (for example `refused_partly`),
  record counts, last change time. No provision details, no staff
  identities. This summary is all a staff member sees of a patient's
  consents.
- **Records** (`interop_my_consents(p_patient_id)`: one of the patient's
  own portal records and the records merged into it; and, for a portal
  patient's own records only, the Consent resource through the gateway,
  from `fhir_consent_directives()`; no staff account gets it, by owner
  decision): status, scope, category, periods, verification state,
  withdrawal state and provisions. Never returned:
  `recorded_by`, `verified_by`, `withdrawn_by` (account ids),
  `withdrawal_reason`, `granted_by`, `source_document_id` or
  `actor_reference` (only `names_recipient`, whether a provision names
  one specific recipient; the gateway does not publish such a consent).
- **Changes** (`interop_record_consent`, `interop_verify_consent`,
  `interop_withdraw_consent`): the arguments go to the database (for a
  withdrawal: the consent id, an optional reason and the page's patient
  id, `p_patient_id`); each change writes one row in the append-only
  `interop.consent_record_history` and one `consent_change` row in
  `interop.access_audit` whose metadata is the event name only, never the
  record's content.

## 3. What is logged

| Log | What it holds | Never |
| --- | --- | --- |
| Gateway function log (Vercel runtime log) | one JSON line per request: `component`, request id, HTTP status, outcome code, and where known the resource type and duration; an unexpected exception by its class name only | tokens or any header, query strings or search values, patient ids of any kind, resource or file content, database error messages |
| Vercel platform request log | the request line, which includes the **path and query string**, with the platform's own metadata (inferred from platform behaviour; not visible from the repository) | the gateway cannot filter it |
| Supabase API logs | PostgREST and Storage request URLs, which include the table-read **filters** of step 4 (internal ids, name prefixes, birth dates) (inferred) | function arguments travel in POST bodies (inferred not to be logged by default) |
| Supabase Auth logs | the `/auth/v1/user` calls of step 2 | |
| `interop.access_audit` | the audit trail (section 9) | |

The URL-borne values in the platform and Supabase logs are the main
residual exposure (risk R1). The gateway allows only allowlisted
parameters, so what can appear there is bounded, but it cannot be kept out
while searches are GET requests.

## 4. What is cached

Nothing that holds patient data:

- Every answer that can contain patient data carries
  `Cache-Control: private, no-store` and `Pragma: no-cache`, so neither the
  browser nor any shared cache (including Vercel's edge) keeps it.
- Reads (not Binary) carry an `ETag` (from **Phase 2**, a hash of the
  resource content), and `Last-Modified` only when the resource has
  `meta.lastUpdated`. `If-None-Match` with the current tag gets a 304 with
  no body, and only after authentication, the access decision and the audit
  record, exactly like a 200 (the audit row records 304). A Binary
  download carries no ETag and ignores `If-None-Match`.
- The service worker never answers `/fhir/` with the app shell
  (`navigateFallbackDenylist` in `vite.config.ts`), `/fhir/` is not in its
  precache, and no runtime-caching rule matches it; Supabase responses are
  `NetworkOnly` for the app too.
- Document downloads are not cached either (2.4).
- `/metadata` carries the same `Cache-Control: private, no-store` as every
  other answer. It holds no patient data.
- The gateway itself keeps nothing between requests: no disk, no key-value
  store, no in-memory cache of rows or decisions.

## 5. What is stored

| Where | What | Retention |
| --- | --- | --- |
| `interop.access_audit` | one row per request (section 9) | **owner decision**, not set. No job deletes or archives rows. Rolling the migration back drops the schema and the trail: export first ([README](README.md#rollback)). |
| `public.rate_limits` | per-account request counters for the buckets `fhir_gateway`, `fhir_gateway_sensitive` (**Phase 2**) and `fhir_audit` (**Phase 2**): account id, bucket, window, count | 60-second windows; the table and its upkeep are the existing rate-limit mechanism, unchanged here |
| `interop.resource_links` (**Phase 2**) | random published ids for staff accounts (Practitioner) and pharmacy items (Medication), minted on first use | kept; mappings, no clinical content |
| `interop.consent_record_history` (**Phase 2**) | consent events: record, event, status before and after, time, the account that changed it (never published) | kept; append-only |
| Gateway | nothing | the function holds data in memory for one request only |

The IP address is never stored. The audit row holds an HMAC-SHA-256 of
the client IP only when `FHIR_AUDIT_IP_SECRET` is set; without a secret no
IP information is kept at all, because an unkeyed hash of an IPv4 address
is trivially reversible. The user agent is cut to 200 characters.

## 6. Document downloads

See 2.4. In short: content only through the gateway, to portal patients
only, as the caller, after the permission check and the audit record;
`Content-Disposition: attachment`; no caching; no signed or public URL
ever created or published. The downloaded file then lives in the device's
downloads folder, outside mBHR's control (risk R4).

## 7. Browser storage

- **The gateway sets nothing in the browser**: no cookies, no local or
  session storage, no service-worker cache entries.
- The token the gateway accepts is the Supabase session the web app
  already keeps in `localStorage` (`sb-<project>-auth-token`, shared by the
  staff app and the portal in the same browser). Signing out removes it,
  even offline (`clearStoredSupabaseAuth()` in
  `src/lib/supabaseAuthStorage.ts`).
- The web app's IndexedDB database (Dexie) holds offline copies of patient
  records for field work. That is the app's own storage, **out of FHIR
  scope**: the gateway never reads or writes it, and FHIR responses are
  never put in it. Its field-level encryption exists in code but is not
  active in the repository (`encryption_v1` is `off`; see
  `src/db/encryptionHooks.ts` and `docs/security/PHI_ENCRYPTION_SPIKE.md`).

## 8. Offline copies on tablets

- FHIR adds no offline copy. The gateway works only online, with a
  Supabase session; an offline PIN session has no server credential and
  cannot call it.
- Tablets keep the web app's own offline copy (section 7), unchanged by
  this work. Device controls (screen lock, device encryption, the app's
  PIN, sign-out on shared devices) protect it.
- Files downloaded through Binary stay on the device until someone deletes
  them (risk R4).
- A future FHIR client app that stores responses would be responsible for
  its own storage; none is allowed in this release.

## 9. Audit records

Each request from a signed-in account writes one row to
`interop.access_audit` through `fhir_record_access_v2()` (**Phase 2**;
`fhir_record_access()` before), with the caller's own session. A request
without a valid token (401) has no account to attribute and is not
audited. A row holds:

- request id, time (server clock);
- the actor: account id taken from the session inside the database
  (`auth.uid()`), role (`app_current_role()`), and actor kind
  (staff / patient / none, recomputed by the database, **Phase 2**);
- interaction (read or search), resource type and id;
- the **internal** ids of the patients whose data was returned or named
  (at most 100);
- purpose of use, decision, denial reason, result count, HTTP status
  (**Phase 2**);
- the consent decision and the consent and provision ids it relied on, and
  restriction codes such as `org_scope_not_applied` (**Phase 2**);
- search parameter **names** (never values; an unknown name is recorded as
  `unsupported`), the user agent (200 characters), and the IP HMAC when
  configured.

Never recorded: tokens, headers other than the user agent, search values,
names, birth dates, resource or file content, consent content.

The trail is itself sensitive: it shows that a patient was seen by mBHR
and who looked. So:

- the table is append-only (UPDATE, DELETE and TRUNCATE are refused for
  every role) and no API role reads it directly;
- from **Phase 2**, `fhir_record_access_v2()` accepts a `permit` row only
  from staff, or from a portal patient about their own records, and is
  rate-limited per account (`fhir_audit`), which narrows forged rows;
- holders of `audit_access` read it through the gateway's AuditEvent
  (**Phase 2**), which never publishes account ids, IP hashes, user agents
  or internal patient ids; the admin view (`fhir_interop_admin_status()`)
  shows counts and recent decisions without any ids.

## 10. The metadata endpoint

`GET /fhir/R4/metadata` answers without a token, reads no database table,
writes no audit row and is not rate-limited by the gateway (the platform's
own protection applies). It returns the CapabilityStatement: the base URL,
the software version, the published resource types, interactions and
search parameters, and the security description. From **Phase 2** it also
carries an `X-MBHR-FHIR-Flags` header with on/off states of the flags
only (never URLs or keys), for the admin view. It holds no patient data
and must name no database table, function or policy. With `FHIR_ENABLED`
off it answers 404 like everything else.

## 11. Risks

Likelihood and impact are for when the gateway is switched on with real
data; today it is off.

| # | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| R1 | Search values (names with birth dates, patient ids) sit in URLs and reach Vercel request logs and Supabase API logs, outside the audit trail | High | Medium | parameter allowlists; name search only with an exact birth date; the gateway's own log has no query; confirm log retention, access and drains on both platforms before enabling; consider `POST _search` for demographic searches | Owner (DIOF) with engineering |
| R2 | A Supabase session left on a shared tablet is used to call the gateway | Medium | High | access tokens expire after an hour (`jwt_expiry` in `supabase/config.toml`; production to confirm); the gateway re-checks the session with Supabase Auth on every request; sign-out clears the stored session even offline; per-account and sensitive-search rate limits; every access audited | Site operations with engineering |
| R3 | Production database drift (F3): row-level security or helpers differ from the repository, so reads return more than intended | Low (production has every file in `supabase/migrations/` since 25 September 2026; the interop files are deferred) | High | the gateway checks role and permission in the database itself and fails closed when helpers are missing; apply the deferred interop files (re-versioned) and rehearse before enabling | HRIS database work, owner go-ahead |
| R4 | Downloaded documents stay on devices | High | Medium | `attachment` disposition, no caching, allowlisted content types, one audit row per download; staff get no documents over FHIR (owner decision); portal patients limited to their own uploads | Site operations |
| R5 | Uploaded files are not scanned; `.doc`/`.docx` can carry macros | Low | High | never rendered inline (`attachment`, `nosniff`, octet-stream fallback); scanning is an owner decision | Owner (DIOF) |
| R6 | The audit trail is lost (rollback drops the schema) or kept for no defined period | Low | High | export before any rollback; decide retention; append-only guards | Owner (DIOF) |
| R7 | The audit trail itself reveals who was seen and by whom | Medium | Medium | no direct API read; AuditEvent only for `audit_access`, without account ids, IP hashes or internal ids; admin view shows counts only | Owner (DIOF) |
| R8 | Forged or noisy audit rows from any signed-in account (open sign-up) | Medium | Low | Phase 2: permit rows only from staff or the owning patient, per-account audit rate limit, actor recomputed in the database | Engineering |
| R9 | IP hashes become reversible if `FHIR_AUDIT_IP_SECRET` leaks | Low | Low | secret only in server environment variables; rotate on exposure; unset means no IP information at all | Engineering |
| R10 | The web app's offline IndexedDB copies are not encrypted at field level | Medium | High | out of FHIR scope; device encryption, screen lock and the app PIN; field-level encryption work tracked separately | Engineering |
| R11 | Patient data transits Vercel and Supabase infrastructure; regions and processing terms not recorded here | Medium | Medium | confirm hosting regions and processing agreements for both providers before enabling | Owner (DIOF) |
| R12 | The older TEFCA functions publish the same data outside these controls (F1, F2) | Medium | High | keep them undeployed or fix them before any exposure; not used by the gateway | Owner (DIOF) |
| R13 | A clinic document reaches a patient before any release step | Low | Medium | Phase 2 gives portal patients content only for their own uploads | Clinical lead |
| R14 | A consent withdrawal cannot recall data already disclosed | Low (no disclosures are enabled) | Medium | consent is evaluated per request, so withdrawal stops future access; say so in consent wording | Owner (DIOF) |
| R15 | Error answers leak database detail | Low | Medium | fixed OperationOutcome messages; only the SQLSTATE of a database error is examined, never its message | Engineering |
| R16 | Staff with consult, portal_manage or audit_access call `fhir_consent_directives()` directly through the Supabase API and read full consent rules that no screen or FHIR request shows them | Low (the register is empty; the deferred migration is not applied) | Medium | no app code calls it; the gateway's consent check needs it to answer for staff, so closing it means moving the consent decision into the database | Owner (DIOF) with engineering |
