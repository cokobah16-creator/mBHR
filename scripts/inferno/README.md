# ONC Inferno harness for mBHR TEFCA IAS

Runs the official ONC Inferno test suite — `(g)(10) Standardized API`,
`SMART App Launch`, and `Bulk Data Access` — against a deployed mBHR
`tefca-ias` + `tefca-oauth` pair. This is **manual**: it's slow, requires
network access, and burns external test-server quota; we don't run it on
every PR. The CI-mandatory check is the in-house validator suite
(`src/services/fhir/__tests__/fixtures.test.ts`).

## Prerequisites

- Docker + Docker Compose v2
- A Supabase project with both edge functions deployed (`tefca-ias`,
  `tefca-oauth`) and at least one row in:
  - `oauth_signing_keys` (active ES256 keypair) — see Phase C-1 commit
  - `oauth_clients` (a registered Backend Services client whose `jwks` Inferno
    will be configured with)
- Inferno running locally on `:4567` (default in the compose file)

## Run

```bash
export FHIR_REFERENCE_SERVER="https://<project>.functions.supabase.co/tefca-ias"
export OAUTH_BASE_URL="https://<project>.functions.supabase.co/tefca-oauth"

cd scripts/inferno
docker compose up
```

Inferno is then reachable at <http://localhost:4567>. Pick the test suite
in the UI:

- **`(g)(10) Standardized API for Patient and Population Services`** —
  exercises read endpoints, scope enforcement, error envelopes,
  CapabilityStatement.
- **`SMART App Launch`** — exercises `/.well-known/smart-configuration`,
  `/oauth/authorize`, `/oauth/token` (PKCE).
- **`Bulk Data Access`** — exercises `POST /$export`, `/bulk-status/{id}`,
  `/bulk-files/{id}/{f}`.

Configure the test-suite-specific options in the Inferno UI:

| Field                  | Value                                                 |
| ---------------------- | ----------------------------------------------------- |
| FHIR Endpoint          | `${FHIR_REFERENCE_SERVER}`                            |
| Authorization Endpoint | `${OAUTH_BASE_URL}/oauth/authorize`                   |
| Token Endpoint         | `${OAUTH_BASE_URL}/oauth/token`                       |
| Client ID              | The `client_id` from a registered `oauth_clients` row |
| Client Secret / JWKS   | per `token_endpoint_auth_method`                      |

Inferno writes every request + response to its UI; capture the run summary
when reporting findings.

## Tear down

```bash
docker compose down -v
```

## Why not in CI?

1. The test suites take ~15-30 min each.
2. They poke an external terminology server (`tx.fhir.org`) which we
   shouldn't hit on every PR.
3. They require a fully-deployed environment, not a local fixture.

We instead run Inferno:

- **Pre-deploy** for any change touching `tefca-ias` or `tefca-oauth`.
- **Pre-TEFCA-onboarding** for each new QHIN partner.
- **Quarterly** as a regression check.
