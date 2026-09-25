# FHIR gateway security

How `/fhir/R4` decides who may read what, what it records, and the security
problems found in Phase 0 that affect exposing FHIR at all. This document
describes controls; it is not a claim of compliance with any regulation or
certification.

## Who can use it

Only **mBHR staff signed in online**, with an active staff role, from a
client that holds their Supabase session. Refused:

| Caller | Result |
| --- | --- |
| No token, malformed token, expired or revoked session | 401 |
| A Supabase account with no staff row, or a guest, unknown or deactivated role (this includes portal patients) | 403, audited |
| Staff without the permission for the resource type | 403, audited |
| An offline PIN session | it has no Supabase session, so it cannot call the gateway at all (by design: a PIN is a device credential, never a server one) |
| External systems, SMART apps, service accounts | no way in: there is no token issuer, no client registry and no CORS; the flags that would add them are refused ([README](README.md#feature-flags)) |

## The access decision

`canAccessFHIRResource()` in
`src/interoperability/fhir/authorization/policy.ts` runs once per request,
**before any clinical table is read**. It is the intersection of the rules
below; no rule can widen another.

1. **Authentication.** The bearer token (the `Authorization` header only; a
   token in the URL is never accepted) must carry `aud` and `role` `authenticated` and an unexpired
   `exp`. Supabase Auth then verifies it (`GET /auth/v1/user`), and the
   returned user id must equal the token's `sub`.
2. **Role and permissions from the database**, never from the token or the
   request: `public.fhir_gateway_context()` returns the caller's
   `app_current_role()` and the permissions `app_role_has_permission()` gives
   it. Supabase sign-up is open in `supabase/config.toml`, so "has an
   account" means nothing on its own.
3. **Permission per resource type** (`authorization/permissions.ts`):

   | Resource | Needs any of |
   | --- | --- |
   | Patient | register, vitals, consult, dispense, lab_review |
   | Encounter | vitals, consult, lab_review |
   | Observation (vital signs) | vitals, consult, lab_review |
   | Condition (diagnoses) | consult |

   With the current role matrix (`src/auth/roles.ts`): admins, doctors and
   lead clinicians read all four; nurses and volunteers read Patient,
   Encounter and Observation but not diagnoses; pharmacists and
   registration leads read Patient only; auditors read nothing. The table
   above is the single place to change this.
4. **Purpose of use:** `TREAT` only ([consent.md](consent.md)).
5. **Patient context:** every search must name a patient or a record
   (see [anti-enumeration](#anti-enumeration)).
6. **Row-level security.** Clinical rows are read through PostgREST with the
   caller's own token and the public anon key, so the database's policies
   apply exactly as they do to the app. The gateway holds no service-role
   key, and `readFhirConfig()` refuses to start if it is given one in place
   of the anon key. A row RLS hides is indistinguishable from one that does
   not exist (404, or absent from a Bundle).
7. **Organisation / site:** not applied, because mBHR clinical rows carry no
   organisation or site (finding F6).
8. **Security labels, break-glass:** none recorded; `ETREAT` is refused.

Writes never reach the decision: every method except GET is 405.

## Anti-enumeration

- A search must include one of its type's required groups (`_id`,
  `patient`/`subject`, `encounter`, `identifier`, or Patient `name` **with**
  `birthdate`). Otherwise 403 before any query.
- Name search needs 2 to 64 letters (no wildcards, digits or punctuation
  beyond hyphen and apostrophe) and an exact birth date; merged records are
  excluded.
- Unknown parameters, modifiers, comma OR lists, `_include`, `_sort` and
  similar are refused (400) rather than ignored, so a typo cannot silently
  widen a search.
- Filters are built into the database query (PostgREST filters with quoted
  values); nothing is fetched and then filtered in code.
- Page size is capped at 100 and paging is keyset-based with an opaque
  cursor; there is no total count.
- A search for a patient the caller cannot see returns an empty Bundle, and
  a read of a hidden or missing record returns the same 404.
- Patient ids are random uuids (`patients.fhir_id`); the device-generated
  ULID (`patients.id`, which encodes a timestamp) is never published.

## Audit

Every decision, permit or deny, is written to `interop.access_audit` through
`public.fhir_record_access()` **before** any data is returned. If the write
fails the response is 503 with no data.

Each row holds: request id, the actor (taken from `auth.uid()` inside the
database, not from the gateway), the actor's role, action, resource type and
id, the internal patient ids involved (up to 100), purpose, decision and
denial reason, result count, search **parameter names** (never values; a
name the type does not support is recorded as `unsupported`), user agent
(first 200 characters), and an HMAC of the client IP when
`FHIR_AUDIT_IP_SECRET` is set (no IP at all otherwise).

Never recorded: tokens, response bodies, search values, names, dates of
birth. The table refuses UPDATE, DELETE and TRUNCATE for every role, and no
API role can read it; reading it is a database-owner task until an audit
viewer exists (planned with AuditEvent).

## Response and log hygiene

- `Cache-Control: no-store` and `Pragma: no-cache` on every answer that can
  contain patient data, `X-Content-Type-Options: nosniff`, and the site's
  existing security headers (CSP, `X-Frame-Options: DENY`) from
  `vercel.json`.
- No CORS headers: other origins cannot read responses in a browser.
- The service worker never serves the app shell for `/fhir/` or `/api/`
  (`vite.config.ts`), and FHIR responses are not in its caches.
- Errors are OperationOutcomes with fixed messages
  ([fhir-r4.md](fhir-r4.md#errors)). Database errors, stack traces and
  configuration problems are never shown to the caller.
- The function log gets one line per request: request id, status, outcome
  code, resource type and duration. No token, patient id, query string or
  resource content is logged; an unexpected exception is logged by class
  name only.
- Every resource is checked by `validation/validate.ts` before release; a
  resource that fails is withheld (500), not sent.
- Requests over 4096 characters (414) and requests with a body (400) are
  refused before authentication.

## Rate limiting

60 requests per minute per account by default (`FHIR_RATE_LIMIT_PER_MINUTE`,
clamped to 1 to 600 by the database), counted in `public.rate_limits` under
the bucket `fhir_gateway`; over the limit is 429 with `Retry-After`.
Unauthenticated requests are not counted by the gateway; they are limited by
Supabase Auth's own limits and Vercel's platform protection.

## Findings

Found in Phase 0 (at `mainone` 2140351). F1 to F4 must be resolved before
FHIR is exposed beyond mBHR's own staff; none is changed by this work.

| # | Severity | Finding | Status / owner |
| --- | --- | --- | --- |
| F1 | Critical | The deployed TEFCA edge functions (`tefca-ias`, `tefca-bulk`, `tefca-oauth`) still run code with the header bypass the September audit found; #135 fixed the repository copy only. Anyone who knows the URL can reach the old code. | Owner decision pending (delete them, or deploy the fixed versions); tracked in the System audit fixes work. This gateway does not use them. |
| F2 | High | Those functions read with the **service-role key**, so row-level security does not apply, and they keep a second copy of clinical data in `fhir_resources`. | Keep them undeployed until a partner needs them; the SMART design decides whether they are retired or rebuilt on this gateway. |
| F3 | High | Production has drifted from the migrations: 62 repository migrations are unapplied, including the Sept 24 permission helpers, the RLS rewrite and Wave A/B. Production's actual RLS on clinical tables is therefore unverified. | Reconciliation owned by the HRIS transformation work. Mitigation here: the gateway checks role and permission in the database itself (step 2) instead of trusting RLS alone, and fails closed (503) where the helpers are missing. **Do not enable FHIR against production until reconciled.** |
| F4 | High | No organisation or site on clinical rows (F6) plus open sign-up: any external party would see all patients of any permitted role. | Blocks external clients and multi-organisation use; needs a data-model change first. |
| F5 | Medium | Supabase sign-up is enabled (`supabase/config.toml`; production's setting is not visible from the repository **(inferred to match)**). Any person can obtain an `authenticated` token. | Handled here by never treating `authenticated` as authorised. Owner to decide whether public sign-up is needed at all (portal patients may need it). |
| F6 | Medium | Clinical tables have no tenant (organisation / site) column; visits have only a free-text `site_name`. | Recorded for the data-model plan; the gateway cannot scope what the data does not record. |
| F7 | Low | The role helpers compare ids as text (`au.id::text = auth.uid()::text`) because production ids may be uuid where the migrations say text. It works, but hides the type drift and defeats indexes. | New interop code compares uuid to uuid. Fixing the helpers belongs to the reconciliation. |
| F8 | Info | `patients.fhir_id` (`20260503010000`) and `rate_limits` (`20260520000004`) may be missing on production **(inferred)**. | The gateway fails closed without them. Check with the Database migrations → status workflow. |

Not a finding for this gateway but relevant to the public repository: two
Resend API keys remain in git history (known; rotation is with the owner).

## Before any external access

Required before SMART apps, partner systems or patient self-access (see
[smart-auth.md](smart-auth.md)): F1 to F4 resolved; a client registry with
per-client scopes and consent checks; an explicit CORS allowlist; audit
retention and an audit viewer; consent enforcement against
`interop.consent_records`; an external security review of the gateway.
