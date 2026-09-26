# SMART on FHIR: plan (not enabled)

**Nothing in this document is built or switched on.** The gateway accepts
only mBHR's own sign-in sessions: staff, and portal patients reading their
own records when `FHIR_PATIENT_ACCESS_ENABLED` is on (it is off by default).
There is no client registration: every caller needs an mBHR sign-in
token. `SMART_ENABLED` and
`SMART_EXTERNAL_CLIENTS_ENABLED` cannot be turned on in this release: if
either is set to true the gateway refuses to start (503). There is no SMART
discovery document (`/fhir/R4/.well-known/smart-configuration` returns 404),
and the CapabilityStatement advertises no SMART security service.

## What already exists (and why it is not reused yet)

The TEFCA work added an OAuth issuer (`tefca-oauth` edge function) and
tables `oauth_clients`, `oauth_authorization_codes`, `oauth_access_tokens`,
`oauth_refresh_tokens` and `oauth_signing_keys`. They are not used here
because:

- the deployed issuer ran code with a known bypass (finding F1 in
  [security.md](security.md#findings)); the owner deleted it on
  26 September 2026, and it must not be redeployed as is;
- its tokens lead to the service-role functions, which bypass row-level
  security (F2);
- clinical rows have no organisation, so a client could not be limited to
  one facility's patients (F4).

Whether SMART extends those tables or replaces them is the first decision of
the SMART phase.

## Target design

Order of work, each step behind its own flag and review:

1. **Patient self-access (read-only)** through the portal account, for
   apps acting for the patient (the patient's own portal session can
   already read, see [fhir-r4.md](fhir-r4.md#patient-self-access)):
   `patient/*.read` style scopes limited to the signed-in patient's own
   record (`app_portal_patient_ids()`), only released lab results, and the
   same audit trail.
2. **Staff-launched apps** (EHR launch inside mBHR): scopes can only narrow
   what the staff member's permissions already allow, never widen them.
3. **Registered external systems** (Backend Services, `system/*.read`):
   only after an organisation model exists, consent enforcement is on
   ([consent.md](consent.md)), and an external security review.

Common rules for all three:

- Authorization code with PKCE (S256) for user-facing apps; signed JWT
  client assertions for backend clients; no implicit flow, no client secret
  in a browser.
- Short-lived access tokens, rotating refresh tokens, exact redirect URI
  match, and a client registry with per-client scopes, status and owner.
- The access decision stays one function: token scopes are **one more
  intersection** in `authorizeFhirRequest()`, alongside role permission,
  purpose, consent and RLS; a scope never grants what the other rules deny.
- An explicit CORS allowlist per registered browser app, never `*`.
- Token, client and consent changes are audited (`access_audit` already
  allows the actions `authorization_approval`, `authorization_denial` and
  `client_registration_change`).
- The CapabilityStatement and `/.well-known/smart-configuration` advertise
  only what is actually enforced.
