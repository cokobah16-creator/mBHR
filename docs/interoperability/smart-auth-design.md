# SMART on FHIR: authorization design (future phase)

**None of this is implemented.** There is no authorization server, no token
endpoint, no client registry and no consent screen. The gateway accepts
only mBHR's own Supabase sessions (staff, and portal patients when
`FHIR_PATIENT_ACCESS_ENABLED` is on). `SMART_ENABLED` and
`SMART_EXTERNAL_CLIENTS_ENABLED` are refused by the gateway configuration:
if either is set to true, `readFhirConfig()` fails and every `/fhir/R4`
request gets a 503. `/oauth/authorize`, `/oauth/token` and
`/.well-known/smart-configuration` are not served (the last answers 404),
and the CapabilityStatement advertises no SMART security service.

This document turns the plan in [smart-auth.md](smart-auth.md) (Phase 1)
into a design for the phase that builds it. It does not change that plan:
the order of work, the common rules and the findings it cites all still
apply. The only code prepared so far is in `src/interoperability/smart/`:
types, and the pure scope functions `parseSmartScope` and
`intersectScopes` with their tests. Nothing imports them.

Decisions marked **(owner)** need confirming by DIOF.

## Contents

1. [Scope and principles](#1-scope-and-principles)
2. [Supabase as the first-party identity provider](#2-supabase-as-the-first-party-identity-provider)
3. [Authorization-code flow](#3-authorization-code-flow)
4. [PKCE](#4-pkce)
5. [Client registry](#5-client-registry)
6. [Launch context](#6-launch-context)
7. [Scope intersection](#7-scope-intersection)
8. [fhirUser](#8-fhiruser)
9. [Audience](#9-audience)
10. [Token signing](#10-token-signing)
11. [Refresh tokens](#11-refresh-tokens)
12. [Revocation](#12-revocation)
13. [Authorization and consent UI](#13-authorization-and-consent-ui)
14. [Consent records](#14-consent-records)
15. [Audit](#15-audit)
16. [Blockers](#16-blockers-what-must-exist-before-smart-can-be-enabled)

## 1. Scope and principles

SMART adds one thing to the gateway: a way for an **app that is not the
mBHR web app** to act for a signed-in person, with that person's approval,
limited by scopes. It never adds a way in for someone who could not read
the data through mBHR today.

The order of work stays as in [smart-auth.md](smart-auth.md#target-design):

1. **Apps chosen by a patient**, acting for them (`patient/` scopes). Phase 2
   adds the patient's own records for mBHR's own portal session, without
   SMART, behind `FHIR_PATIENT_ACCESS_ENABLED` (default off); SMART would
   let a patient hand the same, never wider, access to an app.
2. **Staff-launched apps** (EHR launch inside mBHR), whose scopes can only
   narrow the staff member's permissions.
3. **Registered external systems** (Backend Services, `system/` scopes),
   last, and only after the organisation model, consent enforcement and an
   external security review.

The architecture does not change: request, guard, authenticate, actor,
authorize, query as the caller under row-level security, map, validate,
audit, respond. A SMART token is **one more input to `authenticate` and
one more intersection in `authorize`**. It never replaces the database's
own view of the person (role, permissions, linked patient records), and no
component gets the service-role key.

## 2. Supabase as the first-party identity provider

- **Who the person is** stays Supabase Auth's job, exactly as for the app:
  staff sign in with their staff account, patients with their portal
  account (including one-time codes). The authorization server never has
  its own passwords.
- The authorization page is a page of the mBHR web app on the app's own
  origin. It needs a live Supabase session, and the server checks that
  session the way the gateway does (`GET /auth/v1/user`, the returned id
  must equal the token's `sub`). An offline PIN session has no Supabase
  session, so it can never approve an app.
- **What the person may do** comes from the database at approval time and
  again on every request: `fhir_gateway_context_v2()` (Phase 2) gives the
  staff role and permissions, or the patient records a portal account is
  linked to (`app_portal_patient_ids()`). Nothing is taken from the token,
  the app or the request.
- **Supabase tokens are never given to an app.** An app receives only
  tokens the SMART server issues (section 10), whose audience is the FHIR
  base URL. A Supabase access token could be used directly against
  PostgREST and Storage, outside the gateway and its scopes, so it must
  never leave mBHR's own software.
- **Open problem (blocker B3):** today the gateway reads clinical rows by
  forwarding the caller's own Supabase token, so row-level security
  applies as that person. A request carrying a SMART token has no Supabase
  token to forward. The SMART phase must choose how the gateway reads as
  the approving person under row-level security, without the service-role
  key, without the Supabase JWT secret, and without giving the app a token
  PostgREST would accept. Options to assess: a Supabase session held
  server-side per authorization (encrypted, never sent to the app, ended
  when the grant ends); or a Supabase Auth capability for third-party
  tokens, if its tokens can be refused by PostgREST and Storage outside
  the gateway **(to verify; nothing is assumed here)**. Rewriting reads as
  `SECURITY DEFINER` functions that take a user id would bypass row-level
  security and is not an option.

## 3. Authorization-code flow

Every app that acts for a person uses the authorization-code grant with
PKCE, and nothing else: no implicit flow, no resource-owner password grant,
no device flow. Backend Services (`client_credentials` with a signed JWT
assertion, no person involved) come last, per
[smart-auth.md](smart-auth.md), and are not designed in detail here.

1. The app sends the browser to `GET /oauth/authorize` with
   `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`,
   `aud`, `code_challenge`, `code_challenge_method=S256` and, for an EHR
   launch, `launch` (`SmartAuthorizationRequest` in `smart/types.ts`).
2. The server checks, before showing anything, and in this order:
   - the client exists and is `active`;
   - `redirect_uri` equals one registered URI exactly. If it does not, the
     server shows an error page and **does not redirect** (an unchecked
     redirect would leak the code or be an open redirect);
   - `response_type` is `code`; `state` is present; `aud` equals the FHIR
     base URL (section 9); PKCE is present and S256 (section 4);
   - `launch`, if given, is a live, unused launch id issued to this client
     for this user (section 6);
   - every scope parses (`parseSmartScope`); malformed scopes are refused,
     not repaired.
   Errors after the redirect URI is verified go back to the app as
   `error=` with the same `state`, and fixed descriptions only.
3. The person signs in to mBHR if needed (section 2).
4. The server computes the grant: requested x client-allowed x user
   permissions x consent (section 7). If nothing patient-specific survives,
   the request is denied without asking.
5. The consent screen (section 13) shows the app, the patient, the data,
   the duration. The person approves or denies. Both are audited
   (section 15).
6. On approval the server redirects to `redirect_uri` with `code` and
   `state`. The code is random (at least 128 bits), single use, valid for
   at most 60 seconds, stored only as a hash, and bound to the client, the
   redirect URI, the code challenge, the user, the launch context and the
   granted scopes.
7. The app calls `POST /oauth/token` with `grant_type=authorization_code`,
   `code`, `redirect_uri`, `code_verifier`, and its client authentication
   (confidential) or `client_id` (public). The server checks every binding,
   marks the code used, and answers with `SmartTokenResponse`:
   `access_token`, `token_type` `Bearer`, `expires_in`, `scope` (what was
   granted, which may be less than requested), `patient` and `encounter`
   when in context, `id_token` with `fhirUser` when `openid fhirUser` was
   granted, and `refresh_token` only with `offline_access` or
   `online_access`.
8. A code presented a second time fails, and everything issued from its
   first use is revoked (a replayed code means it leaked).
9. The app calls `/fhir/R4` with the access token. The gateway verifies the
   signature against its own key set, `iss`, `aud`, `exp` and that the
   token id is not revoked, then loads the person from the database as
   today, and decides as today with the token's scopes as one more limit.
   Every response is still audited before release.

Access tokens live 10 minutes at most **(owner: the exact value)**.
Responses carry the same headers as today (`no-store`, no CORS unless the
client is a registered browser app, section 5).

## 4. PKCE

- Required for **every** client, public and confidential.
- `code_challenge_method` must be `S256`. `plain` is refused, and a
  missing method is refused (not defaulted). The existing
  `oauth_authorization_codes` table allows `plain`; that is one reason not
  to reuse it as is (section 5).
- `code_challenge` must be 43 base64url characters (a SHA-256 digest);
  `code_verifier` 43 to 128 characters from the RFC 7636 unreserved set.
- The token endpoint compares `BASE64URL(SHA-256(code_verifier))` with the
  stored challenge in constant time.
- PKCE does not replace `state`, the exact redirect URI match or client
  authentication; each is checked.

## 5. Client registry

### Table (proposed, not created)

Recommended: new tables in the `interop` schema, closed to the Data API
like the rest of it (RLS on, no policies, reached only through narrow
functions). Whether to extend the TEFCA `oauth_clients` family instead is
still **the first decision of the SMART phase (owner)**, as
[smart-auth.md](smart-auth.md#what-already-exists-and-why-it-is-not-reused-yet)
says. Points against reuse as is: it serves the service-role functions
(F2), allows `plain` PKCE, keeps authorization codes unhashed, keeps
signing private keys in a table column (`oauth_signing_keys.private_key_pem`),
stores raw IP addresses on tokens, and is tied to the TEFCA partner table.

`interop.smart_clients` (one row per client; `SmartClientRegistration`):

| Column | Rule |
| --- | --- |
| `id` | uuid, internal |
| `client_id` | random, unique, never reused, public |
| `client_name`, `owner` | shown on the consent screen; set by the approver, not by the client |
| `client_type` | `confidential` or `public` |
| `audience` | `first_party` (software mBHR operates for its own care team or for the patient themself), `third_party` (an app a person chooses) or `external_system` (another organisation). Consent applies to the last two (section 14). |
| `token_endpoint_auth_method` | `private_key_jwt` (preferred), `client_secret_basic` (confidential server-side apps only), `none` (public apps). Backend Services clients: `private_key_jwt` only. |
| `jwks_uri` or `jwks` | public keys for `private_key_jwt`; exactly one |
| `secret_verifier` | for `client_secret_basic` only: see below |
| `redirect_uris` | exact strings; https only, except loopback http for native apps; no wildcards, no fragments |
| `allowed_scopes` | canonical v2 scopes (`patient/Observation.rs`), read permissions only (`r`, `s`) while writes are disabled |
| `allowed_launch` | modes (`ehr`, `standalone`) and contexts (`patient`, `encounter`) |
| `fhir_audience` | the FHIR base URL |
| `allowed_origins` | browser apps only: the exact origins the gateway may answer with CORS; empty for everything else |
| `status` | `pending`, `active`, `suspended` (can be reactivated), `revoked` (final) |
| `requested_by`, `approved_by`, `approved_at` | internal account ids; never published |
| `agreement_reference` | third-party and external clients: the signed data-sharing or processing agreement **(owner)** |
| `created_at`, `updated_at` | server time |

Changes are made through functions that write one
`client_registration_change` audit row each (section 15). Nothing is
deleted: a client is revoked.

### Who approves

- A client is created `pending` by a staff member holding `users`.
- It becomes `active` only when **a different** account holding `users`
  approves it **(owner: whether the approver must also be the DIOF data
  protection lead, and whether `audit_access` must co-sign)**. The same
  rule applies to adding a redirect URI, widening `allowed_scopes`, adding
  a launch mode or changing `audience`. Narrowing, suspending and revoking
  need one account and take effect at once.
- `third_party` and `external_system` clients also need
  `SMART_EXTERNAL_CLIENTS_ENABLED`, which stays refused until the blockers
  in section 16 are cleared.

### Client secrets

- mBHR generates the secret (32 random bytes), shows it once, and stores
  only a keyed hash: HMAC-SHA-256 with a server-held key (a pepper) that is
  not in the database (`SmartClientSecretVerifier`). A slow hash adds
  nothing for a 256-bit random value; the key means a copy of the table
  alone cannot confirm a guess.
- Never in plain text in the database, in logs, in audit rows, in the
  browser bundle or in the repository. Rotation issues a new secret with an
  overlap period; the old verifier then expires.
- Public clients (browser and mobile apps) have no secret: they cannot
  keep one. PKCE and the exact redirect URI protect them.
- `private_key_jwt` assertions are checked for `iss` = `sub` = `client_id`,
  `aud` = the token endpoint, a short `exp`, and a `jti` not seen before
  (replay cache for the assertion lifetime).

## 6. Launch context

Two launches, both bound to one client and one user:

- **EHR launch** (staff, inside mBHR). A staff member with the patient open
  chooses an approved app. The mBHR server creates a launch record: a
  random launch id (at least 128 bits), the client, the staff account, the
  patient's **canonical** `fhir_id`, optionally an encounter id, and an
  expiry of a few minutes. The id is single use and useless to any other
  client or account. The launch is audited like a read of that patient.
- **Standalone launch** (`launch/patient`): the server asks the person to
  pick the patient.
  - A portal account picks among its own linked records
    (`app_portal_patient_ids()`); a merged-away record is never offered.
    Accounts that manage several people (guardians) need an owner decision
    on who may approve for whom **(owner, with the minors and guardians
    question)**.
  - Staff standalone launch needs the same narrowing as a FHIR search
    (identifier, or name with birth date) and is audited; staff should
    prefer the EHR launch.
- `launch/encounter`: the encounter must belong to the patient in context
  and be visible to the person.
- Ids in context are the ids the gateway publishes (`patients.fhir_id`,
  `visits.id`), never an internal `patients.id`. When the patient in
  context is later merged away, the gateway serves the kept record exactly
  as for any other caller (Phase 2 merge rules), and the token's patient
  claim is not re-pointed silently: tokens for a merged-away patient are
  revoked **(owner: or re-issued after the person re-approves)**.
- A token with `patient/` scopes and no patient in context grants nothing.

## 7. Scope intersection

The grant is the intersection of four sets. A scope is granted only where
all of them allow it; nothing can widen another.

| Set | Source |
| --- | --- |
| requested | the app's `scope` parameter |
| client-allowed | `smart_clients.allowed_scopes` |
| user permissions | the person's live permissions turned into scopes: for staff, `user/` and `patient/` read scopes for each type their permissions allow (`authorization/permissions.ts`); for a portal patient, `patient/` read scopes for the Phase 2 self-access types only (Patient, closed Encounters, portal-visible vital signs and dispenses, released lab results, their own documents and Consent) |
| consent | `first_party` clients: not a limit (not applicable). `third_party` and `external_system`: the scopes an active permit covers; no permit means an empty set, so nothing patient-specific is granted (section 14) |

`intersectScopes()` and `intersectScopeSets()` in
`src/interoperability/smart/scopes.ts` compute this and are tested for
"never widens" (every granted scope is covered by a requested scope and by
a scope of every limit, and adding a limit only removes grants). Their
rules:

- SMART v1 (`.read`, `.write`, `.*`) and v2 (`.rs`, `.cruds`, …) forms are
  both accepted and compared in v2 terms (`.read` = `.rs`).
- `*` is accepted only as a whole resource type (`patient/*.rs`) or as the
  v1 permission (`.*`). Any other wildcard is malformed.
- `patient/` is narrower than `user/`; `system/` never mixes with either.
- Granular v2 scopes (`?category=...`) are kept and combined with AND.
  Only search filters are accepted as constraints: a resource search
  parameter (with an optional modifier) or `_id`. Any other parameter
  starting with `_` makes the scope malformed (`unsupported_constraint`),
  so it is refused when the scope is read, never ignored. `_include`,
  `_revinclude` and `_contained` would add resources to a result;
  `_elements`, `_summary`, `_count`, `_sort` and `_total` would change
  what is returned rather than which records; `_has`, `_query` and
  `_filter` depend on other resources or on server-defined queries. The
  rest (`_lastUpdated`, `_tag`, `_security`, `_profile`, and so on) are
  filters, but are not accepted yet: one can be added, with a test, once
  an enforcer can check it. The gateway must refuse to serve a type whose
  scope carries a constraint it cannot evaluate (fail closed), rather than
  ignore the constraint.
- `openid`, `fhirUser`, `profile`, `launch`, `launch/patient`,
  `launch/encounter`, `offline_access`, `online_access` must appear in all
  sets exactly.
- The result is written back to the app as the token response's `scope`,
  which may be narrower than requested.

The intersection is done **twice**: at approval (what the token says) and
on every request (the token's scopes, intersected again with the person's
permissions and consent at that moment). A permission removed or a consent
withdrawn after the token was issued takes effect on the next request, not
at token expiry. Only read permissions (`r`, `s`) can be granted while
writes are disabled.

## 8. fhirUser

- Staff: `Practitioner/<id>`, the random id the Phase 2 staff directory
  (`fhir_staff_directory()`, `interop.resource_links`) assigns to the staff
  account. Never the auth uid, the device-generated staff id or an email.
- Portal patient: `Patient/<canonical fhir_id>` when the account is linked
  to exactly one record. For an account that manages several records,
  `fhirUser` is omitted until the guardian decision is made **(owner)**;
  mBHR does not publish RelatedPerson.
- Only when `openid fhirUser` was granted; it is a claim of the `id_token`
  and is also returned in the token response.
- The `id_token` `sub` is a pairwise identifier per client (a keyed hash of
  the account id and client id), so two apps cannot correlate the same
  person and no app learns the auth uid.

## 9. Audience

- `aud` in the authorization request must **equal** the configured FHIR
  base URL (`FHIR_BASE_URL`), compared as a string: no trailing-slash or
  case repair, no prefix match. Anything else is refused before the
  consent screen. This stops a token meant for mBHR being requested by an
  app for another server, and the reverse.
- The access token's `aud` is the FHIR base URL. The gateway refuses a
  SMART token whose `aud` differs, and keeps refusing Supabase tokens for
  SMART paths (and SMART tokens anywhere Supabase tokens are expected).
- The `id_token` audience is the `client_id`, as OpenID Connect requires.

## 10. Token signing

- Access tokens and ID tokens are JWTs signed with the **SMART server's own
  asymmetric key** (ES256; RS256 only if a client cannot verify ES256). The
  public keys are published at `jwks_uri` with a `kid`.
- **Never the Supabase JWT secret**, and never a key Supabase trusts. Such
  a key would let the SMART server (or anyone who takes its key) mint
  Supabase sessions, and would make SMART tokens valid against PostgREST
  and Storage directly, outside the gateway and its scopes.
- **Key custody:** the private key lives in a managed key service or, at
  minimum, a server-side encrypted environment secret of the hosting
  project (no `VITE_` prefix, so never in the browser bundle). Never in a
  database column, the repository, a log or an audit row. Access to it is
  limited to the deploying owner accounts **(owner)**.
- **Rotation:** a new key is published in the key set before it signs
  anything; the old one stays published until every token it signed has
  expired, then is removed. Scheduled rotation (for example every 90 days,
  **owner**) and immediate rotation on any suspected exposure, which also
  revokes every outstanding refresh token.
- Tokens carry `jti`; the gateway checks a revocation list on every request
  (it already calls the database once per request), so revocation does not
  wait for expiry. Opaque access tokens looked up by hash are an equivalent
  alternative; the choice belongs to the implementation review.
- Tokens carry no clinical data and no internal ids: `sub` (pairwise),
  `client_id`, `scope`, `patient`, `encounter`, `fhirUser`, `iat`, `exp`,
  `jti`, `iss`, `aud` (`SmartAccessTokenClaims`).

## 11. Refresh tokens

- Issued only with `offline_access` (survives the person's sign-out, for a
  bounded time, **owner: at most 30 or 90 days**) or `online_access`
  (ends when the person's mBHR session ends).
- Opaque, random (256 bits), stored only as a SHA-256 hash, each belonging
  to a **family** (one per authorization; `SmartRefreshTokenRecord`).
- **Rotation:** every use returns a new refresh token and marks the old one
  used.
- **Reuse detection:** presenting a refresh token that was already used
  revokes the whole family and every access token from it, and is audited
  as an `authorization_denial` with reason `refresh_token_reuse`. Either
  the app or an attacker holds a copy; both lose access.
- Every refresh re-checks the client (still `active`), the person (still
  an active staff role, or portal access still enabled for that record),
  the consent (still permitting) and recomputes the scopes; a refresh can
  only keep or narrow them. A requested `scope` on refresh may only narrow.
- Public clients get refresh tokens only with rotation; the lifetime is
  shorter than for confidential clients **(owner)**.

## 12. Revocation

- `POST /oauth/revoke` (RFC 7009) for the app to revoke its own refresh or
  access token.
- The person can revoke an app from a "Connected apps" list in the portal
  and in the staff profile; revocation ends the refresh family and adds the
  access tokens' `jti` to the revocation list.
- Automatic revocation of every grant affected when:
  - a client is suspended or revoked;
  - a staff account is deactivated or loses the role that allowed the
    grant, or a portal account's access is switched off;
  - the patient withdraws the consent the grant relied on;
  - the patient in context is merged away (section 6);
  - the signing key is rotated because of suspected exposure.
- Revocation stops future access only. Data an app already received stays
  with the app; the consent screen and the agreement with the app owner
  must say so.

## 13. Authorization and consent UI

- A page of the mBHR web app, on the app's origin, behind the normal
  sign-in. The site's existing `X-Frame-Options: DENY` and
  `frame-ancestors 'none'` stop it being framed (clickjacking).
- It shows, in plain words: the app's registered name and owner (set by
  the approver, never taken from the request), whether mBHR operates it,
  which patient, which kinds of data (a human description of each granted
  scope; no raw scope strings as the only text), read-only, how long
  (until sign-out, or up to N days for `offline_access`), and how to revoke.
- Nothing is pre-approved, and there are no pre-ticked boxes. The person
  may untick kinds of data (that only narrows the grant). "Deny" is as
  prominent as "Allow".
- No remote images or scripts from the app. The app's logo, if any, is
  stored at registration.
- For `third_party` and `external_system` clients, approving by the patient
  also records the consent the grant relies on (section 14). Staff cannot
  approve a third-party app on a patient's behalf: a disclosure to someone
  outside mBHR's care team needs the patient's own permit
  ([consent.md](consent.md#principle)). A staff-launched app is therefore
  either a `first_party` client or needs that permit on record.
- Wording is reviewed by a clinician and DIOF before release, in the
  languages the portal supports **(owner)**.

## 14. Consent records

The relationship to `interop.consent_records` and
`interop.consent_provisions` follows [consent.md](consent.md) and the Phase 2
consent evaluation (`src/interoperability/fhir/consent/evaluateConsent.ts`):

- Internal treatment by mBHR staff and the patient's own access through
  mBHR's own software are **not governed** by stored consent
  (`not-applicable`). A `first_party` SMART client keeps that position only
  if mBHR operates it under its own policy **(owner: which clients, if
  any, count as first party)**.
- **Third-party apps and external systems are default deny.** A grant
  needs an explicit permit: an `active`, verified, not withdrawn, in-period
  record of scope `patient-privacy` with a `permit` provision whose
  `actor_type` is `external_system` (for an app; `organization` also counts
  for another organisation's system), whose `action` matches (`access` or
  `disclose`), whose `purpose` matches (`PATRQT` for an app the patient
  chose; `TREAT` only for a partner treating the patient), and whose
  `resource_type` and `data_class` cover the scope (empty = all). This is
  the rule the Phase 2 evaluation already applies to the `third-party-app`
  and `external-sharing` classes. With no such permit the consent set is
  empty and nothing patient-specific is granted.
- **Per-client permits are missing.** The Phase 2 evaluation does not look
  at `actor_reference` (and `fhir_consent_directives()` does not return
  it), and it also accepts `actor_type` `any`. So a permit today would
  cover every external system, not the one app the patient approved. SMART
  needs provisions matched to the client id before any third-party client
  is enabled (blocker B6), and a decision on whether an `any` permit may
  cover an app the patient never named **(owner)**.
- A matching `deny` provision wins over any permit, and counts even before
  staff verify the record. Scopes have no negation, so deny provisions are
  applied first: a permit for all types with a deny for `DocumentReference`
  becomes explicit `patient/<Type>.rs` scopes for every published type
  except `DocumentReference` (and `Binary`); a deny limited to a data class
  removes every type of that class. A provision limited to a security label
  covers nothing, as in the per-request evaluation (mBHR records no labels
  on data).
- In the Phase 2 evaluation a permit counts only once the record is
  verified by staff. Whether a permit the patient records on the consent
  screen may count without that step is **(owner)**. Records are never
  edited: approval creates a record, withdrawal records a withdrawal
  (Phase 2 history and guards).
- Consent is evaluated **per request** at the gateway as well as at
  approval, so a withdrawal takes effect on the next request and the
  grant is revoked (section 12). Each decision is audited with the consent
  and provision ids it relied on (`access_audit.consent_id`,
  `provision_id`, Phase 2).
- `FHIR_CONSENT_ENFORCEMENT_ENABLED` must be on before any consent-governed
  client is enabled; with it off, consent-governed access is refused
  outright.

## 15. Audit

`interop.access_audit` already allows the actions
`authorization_approval`, `authorization_denial` and
`client_registration_change`, and has the unused columns `client_id` and
`scope`. The SMART server writes one row per event, before the redirect or
response, and fails closed if it cannot:

| Event | action | decision | Notes |
| --- | --- | --- | --- |
| Person approves | `authorization_approval` | permit | `client_id`, granted `scope`, patient in context, consent id and provision id |
| Person denies | `authorization_denial` | deny | reason `user_denied` |
| Request refused by policy | `authorization_denial` | deny | reason such as `client_inactive`, `redirect_uri_mismatch`, `aud_mismatch`, `pkce_required`, `invalid_scope`, `no_scope_granted`, `consent_missing`, `launch_invalid` |
| Code replay, refresh-token reuse | `authorization_denial` | deny | `code_reuse`, `refresh_token_reuse`; the family is revoked |
| Token issued, refreshed, revoked | `authorization_approval` / `authorization_denial` | as applicable | event name in `metadata` only, or new action values **(schema change, owner)** |
| Client created, approved, changed, suspended, revoked; key or secret rotated | `client_registration_change` | permit | `client_id`, `metadata` `{event}` with the field names changed, never values of secrets or keys |

Every gateway request made with a SMART token also records `client_id` and
the token's scopes (the Phase 2 `fhir_record_access_v2()` has no parameter
for them yet: blocker B8).

Never recorded: tokens, codes, code verifiers, client secrets, client
assertions, refresh tokens, the `state` value, or any clinical content.
The function log keeps request id, status and outcome only, as the gateway
does.

## 16. Blockers: what must exist before SMART can be enabled

| # | Blocker | Why |
| --- | --- | --- |
| B1 | Findings F1 to F4 in [security.md](security.md#findings) resolved, and the TEFCA functions (`tefca-oauth`, `tefca-ias`, `tefca-bulk`) undeployed or rebuilt on this gateway | `tefca-oauth` has its own `/.well-known/smart-configuration` and token endpoint backed by the service role (and its deployed copy runs older code, F1); two authorization servers for the same data cannot both be governed |
| B2 | Production database reconciled with the migrations (F3), including Phase 2 | every rule above relies on the helpers, the role matrix and row-level security as written |
| B3 | A decision on how the gateway reads as the person under row-level security when the caller holds a SMART token (section 2) | the current design forwards a Supabase token the app must never have |
| B4 | Decision: extend or replace the `oauth_*` tables (section 5), and the client registry, approval functions and revocation list built | no client can exist without them |
| B5 | Signing key custody and a rotation runbook in place (section 10) | a leaked key is a leaked gateway |
| B6 | Consent enforcement on; permits matched to the client (`actor_reference`, section 14); and a way for the patient to record a permit from the consent screen (the Phase 2 `interop_record_consent()` is staff-only) | third-party and external clients are default deny, and a permit must name the app it covers |
| B7 | Organisation or site on clinical rows (F4, F6) | an external system could otherwise not be limited to one facility |
| B8 | Audit: `client_id` and `scope` written for SMART requests, token events representable, the retention period decided, and the Phase 2 audit views available to `audit_access` holders | every grant must be accountable |
| B9 | The authorization and consent UI built, with wording reviewed by a clinician and DIOF; the guardian and minors decision | patients must understand what they approve |
| B10 | An explicit CORS allowlist per registered browser app (the gateway sends no CORS today) | browser apps on other origins cannot call the gateway otherwise, and `*` is never acceptable |
| B11 | Per-client rate limits, in addition to the per-account ones | one app must not exhaust a person's or the service's budget |
| B12 | External security review of the authorization server and the gateway changes | [smart-auth.md](smart-auth.md) and [security.md](security.md#before-any-external-access) require it |
| B13 | Only then: the CapabilityStatement's security section (SMART service, OAuth URIs) and `/.well-known/smart-configuration`, advertising only what is enforced | a discovery document must not advertise what does not exist |

Until every row above is done, `SMART_ENABLED` and
`SMART_EXTERNAL_CLIENTS_ENABLED` stay refused in `config/config.ts`, and
removing that refusal is part of the SMART change itself, reviewed with it.
