// Types for a FUTURE SMART App Launch 2.x authorization server in front of
// the /fhir/R4 gateway. Nothing here is wired to a route, and nothing issues
// or accepts a SMART token: SMART_ENABLED and SMART_EXTERNAL_CLIENTS_ENABLED
// are refused by the gateway configuration (config/config.ts). The design is
// in docs/interoperability/smart-auth-design.md.
//
// This file holds types and interfaces only. The pure scope helpers are in
// ./scopes.ts. Wire formats (authorization request, token response, error)
// keep the OAuth / SMART parameter names exactly, hence the snake_case.

// ---------------------------------------------------------------------------
// Scope grammar (SMART App Launch 2.x, with the 1.0 forms accepted on input)
// ---------------------------------------------------------------------------

/** `patient/`: the one patient in launch context. `user/`: what the signed-in
 *  user may see. `system/`: a backend client with no user. */
export type SmartScopeContext = "patient" | "user" | "system";

/** SMART v2 permission letters, always in this order: c r u d s. */
export type SmartPermission = "c" | "r" | "u" | "d" | "s";

/** Which grammar a scope was written in. v1 `.read` = v2 `.rs`,
 *  v1 `.write` = v2 `.cud`, v1 `.*` = v2 `.cruds`. */
export type SmartScopeSyntax = "v1" | "v2";

/** One `name=value` pair of a SMART v2 granular scope
 *  (`patient/Observation.rs?category=...`). Values are kept exactly as
 *  written (not percent-decoded) and compared as text. Several pairs are
 *  combined with AND, as in a FHIR search. `name` is always a search
 *  filter (a resource search parameter or `_id`), never a parameter such
 *  as `_include` that would add to a result. */
export interface SmartScopeConstraint {
  name: string;
  value: string;
}

/** `<context>/<ResourceType or *>.<permissions>[?<constraints>]`. */
export interface SmartResourceScope {
  kind: "resource";
  context: SmartScopeContext;
  /** A FHIR resource type name, or "*" (the only wildcard the spec allows). */
  resourceType: string;
  /** Non-empty, deduplicated, in c r u d s order. */
  permissions: readonly SmartPermission[];
  /** Sorted by name then value; empty when the scope has no query. */
  constraints: readonly SmartScopeConstraint[];
  syntax: SmartScopeSyntax;
}

/** `launch` (EHR launch: context comes from the launch parameter),
 *  `launch/patient` and `launch/encounter` (standalone launch: the server
 *  asks the user to pick the patient). */
export interface SmartLaunchScope {
  kind: "launch";
  context: "ehr" | "patient" | "encounter";
}

/** OpenID Connect identity: `openid`, `fhirUser` (SMART 2), `profile`
 *  (OIDC standard claims; SMART 1 used it for the FHIR user). */
export interface SmartIdentityScope {
  kind: "identity";
  name: "openid" | "fhirUser" | "profile";
}

/** Refresh-token lifetime request. */
export interface SmartAccessDurationScope {
  kind: "access";
  name: "offline_access" | "online_access";
}

export type SmartScope =
  | SmartResourceScope
  | SmartLaunchScope
  | SmartIdentityScope
  | SmartAccessDurationScope;

export type SmartScopeParseError =
  | "empty"
  | "too_long"
  | "invalid_characters"
  | "unknown_scope"
  | "invalid_context"
  | "invalid_resource_type"
  | "invalid_wildcard"
  | "missing_permissions"
  | "invalid_permissions"
  | "permissions_out_of_order"
  | "invalid_query"
  /** A well-formed query whose parameter is not accepted as a constraint
   *  (only resource search parameters and `_id` are): `_include`,
   *  `_revinclude`, `_elements`, `_summary`, `_count`, `_security`, … */
  | "unsupported_constraint"
  | "query_not_allowed_in_v1"
  | "unsupported_launch_context";

export type SmartScopeParseResult =
  | { ok: true; scope: SmartScope }
  | { ok: false; error: SmartScopeParseError };

/** A space-separated scope string (the OAuth `scope` parameter) or a list. */
export type SmartScopeInput = string | readonly string[];

/** One source that must allow a scope for it to be granted. */
export interface SmartScopeLimit<N extends string = string> {
  /** Names the source in refusals, e.g. "client", "user", "consent". */
  name: N;
  scopes: SmartScopeInput;
}

export type SmartScopeRefusal<N extends string = string> =
  | { scope: string; reason: "malformed"; error: SmartScopeParseError }
  /** The first limit that left nothing of the requested scope. */
  | { scope: string; reason: "not_allowed"; by: N };

export interface SmartScopeIntersection<N extends string = string> {
  /** Canonical (SMART v2) scope strings, sorted and deduplicated, none
   *  covered by another. Each is covered by a requested scope AND by a
   *  scope of every limit. */
  granted: string[];
  /** Requested scopes that produced no grant at all. A requested scope that
   *  was narrowed (fewer permissions, a specific type instead of *, an added
   *  constraint, `patient/` instead of `user/`) is not listed here. */
  refused: SmartScopeRefusal<N>[];
}

// ---------------------------------------------------------------------------
// Client registration
// ---------------------------------------------------------------------------

/** SMART client types. `confidential` authenticates at the token endpoint;
 *  `public` (a browser or native app) cannot keep a secret and relies on
 *  PKCE alone. */
export type SmartClientType = "confidential" | "public";

/** `private_key_jwt` (asymmetric, preferred) or `client_secret_basic`
 *  (symmetric) for confidential clients; `none` for public clients. */
export type SmartTokenEndpointAuthMethod = "private_key_jwt" | "client_secret_basic" | "none";

/** `pending` until an approver accepts it; only `active` clients may start
 *  an authorization. `suspended` can be reactivated; `revoked` is final. */
export type SmartClientStatus = "pending" | "active" | "suspended" | "revoked";

/** Who the client belongs to. Consent governs `third_party` and
 *  `external_system` clients (default deny); `first_party` is mBHR's own
 *  software acting for its own staff or the patient themself. */
export type SmartClientAudience = "first_party" | "third_party" | "external_system";

export type SmartLaunchMode = "ehr" | "standalone";
export type SmartLaunchContextKind = "patient" | "encounter";

export interface SmartAllowedLaunch {
  /** Launch modes the client may use. Empty = none. */
  modes: readonly SmartLaunchMode[];
  /** Context the client may receive. Empty = none. */
  contexts: readonly SmartLaunchContextKind[];
}

/**
 * A verifier of a symmetric client secret. mBHR generates the secret (32
 * random bytes), shows it once at registration and never stores it: only a
 * keyed hash is kept, with the key (a server-side pepper) outside the
 * database, so a copy of the table alone cannot confirm a guess.
 */
export interface SmartClientSecretVerifier {
  algorithm: "hmac-sha256";
  /** Which server-side pepper key produced the digest (for rotation). */
  keyId: string;
  /** Lower-case hex digest. */
  digest: string;
  createdAt: string;
  /** Secrets are rotated, not edited: an expired verifier no longer works. */
  expiresAt: string | null;
}

/** A client in the registry (one row per client). */
export interface SmartClientRegistration {
  /** Internal row id (uuid). */
  id: string;
  /** Public client identifier, random, never reused. */
  clientId: string;
  clientName: string;
  clientType: SmartClientType;
  audience: SmartClientAudience;
  tokenEndpointAuthMethod: SmartTokenEndpointAuthMethod;
  /** `client_secret_basic` only. */
  secretVerifier: SmartClientSecretVerifier | null;
  /** `private_key_jwt` only: exactly one of the two. */
  jwksUri: string | null;
  jwks: { keys: readonly Record<string, unknown>[] } | null;
  /** Compared by exact string match; https only (loopback http for native
   *  apps); no wildcards, fragments or open redirects. */
  redirectUris: readonly string[];
  /** Canonical v2 scopes the client may ever be granted. */
  allowedScopes: readonly string[];
  allowedLaunch: SmartAllowedLaunch;
  /** The FHIR base URL the client's tokens are for (`aud`). */
  fhirAudience: string;
  /** Browser apps only: exact origins the gateway may answer with CORS
   *  (never "*"). Empty for every other client. */
  allowedOrigins: readonly string[];
  status: SmartClientStatus;
  /** Owner of the client (organisation or team), set by the approver. */
  owner: string;
  /** Third-party and external clients: the signed agreement it relies on. */
  agreementReference: string | null;
  /** Internal account ids; never published. The approver must be a
   *  different account from the requester. */
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Authorization request / response (authorization-code flow with PKCE)
// ---------------------------------------------------------------------------

/** GET /oauth/authorize query parameters (not served in this release). */
export interface SmartAuthorizationRequest {
  response_type: "code";
  client_id: string;
  /** Must equal one of the client's registered redirect URIs exactly. */
  redirect_uri: string;
  /** Space-separated scopes. */
  scope: string;
  /** Opaque, unguessable, echoed back unchanged. Required. */
  state: string;
  /** Must equal the FHIR base URL exactly. */
  aud: string;
  /** BASE64URL(SHA-256(code_verifier)), 43 characters. */
  code_challenge: string;
  /** S256 only; `plain` is refused. */
  code_challenge_method: "S256";
  /** EHR launch only: the opaque launch id the EHR passed to the app. */
  launch?: string;
}

/** Redirect back to the app on success. */
export interface SmartAuthorizationCodeResponse {
  code: string;
  state: string;
}

export type SmartOAuthErrorCode =
  | "invalid_request"
  | "unauthorized_client"
  | "access_denied"
  | "unsupported_response_type"
  | "invalid_scope"
  | "invalid_grant"
  | "invalid_client"
  | "unsupported_grant_type"
  | "server_error"
  | "temporarily_unavailable";

export interface SmartOAuthError {
  error: SmartOAuthErrorCode;
  /** Fixed, caller-safe text; never data, stack traces or internal names. */
  error_description?: string;
  /** Echoed on authorization errors sent to a verified redirect URI. */
  state?: string;
}

/** Server-side record of an issued authorization code (stored hashed). */
export interface SmartAuthorizationCodeRecord {
  codeHash: string;
  clientId: string;
  redirectUri: string;
  /** Granted (already intersected) scopes. */
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  /** Internal account id of the user who approved. */
  userId: string;
  launch: SmartLaunchContext | null;
  expiresAt: string;
  /** Set on first use; a second use revokes everything issued from it. */
  usedAt: string | null;
}

// ---------------------------------------------------------------------------
// Token request / response
// ---------------------------------------------------------------------------

export type SmartTokenRequest =
  | {
      grant_type: "authorization_code";
      code: string;
      redirect_uri: string;
      code_verifier: string;
      /** Public clients; confidential clients authenticate instead. */
      client_id?: string;
    }
  | {
      grant_type: "refresh_token";
      refresh_token: string;
      /** May only narrow the originally granted scopes. */
      scope?: string;
      client_id?: string;
    };

/** POST /oauth/token success body (not served in this release). */
export interface SmartTokenResponse {
  access_token: string;
  token_type: "Bearer";
  /** Seconds. */
  expires_in: number;
  /** The scopes actually granted (may be narrower than requested). */
  scope: string;
  /** FHIR Patient id (the canonical `patients.fhir_id`), when in context. */
  patient?: string;
  /** FHIR Encounter id, when in context. */
  encounter?: string;
  /** Relative reference to the user, e.g. `Practitioner/<id>` or
   *  `Patient/<id>`; also a claim of the id_token when `openid fhirUser`
   *  was granted. Never an auth uid. */
  fhirUser?: string;
  id_token?: string;
  /** Only with `offline_access` or `online_access`; rotated on every use. */
  refresh_token?: string;
  need_patient_banner?: boolean;
}

/** Claims of an access token issued by the future server. Signed with the
 *  SMART server's own key, never with the Supabase JWT secret. */
export interface SmartAccessTokenClaims {
  iss: string;
  /** Opaque per-client subject; not the Supabase auth uid. */
  sub: string;
  /** The FHIR base URL. The gateway refuses any other audience. */
  aud: string;
  client_id: string;
  scope: string;
  iat: number;
  exp: number;
  /** Unique id, for revocation lists and audit. */
  jti: string;
  patient?: string;
  encounter?: string;
  fhirUser?: string;
}

/** Server-side record of a refresh token (stored hashed). Tokens of one
 *  authorization share a family; presenting a used token revokes the
 *  whole family (reuse detection). */
export interface SmartRefreshTokenRecord {
  tokenHash: string;
  familyId: string;
  /** Hash of the token this one replaced; null for the first. */
  parentHash: string | null;
  clientId: string;
  userId: string;
  scope: string;
  launch: SmartLaunchContext | null;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}

// ---------------------------------------------------------------------------
// Launch context
// ---------------------------------------------------------------------------

/** Context bound to one authorization. Ids are FHIR ids as the gateway
 *  publishes them, never internal `patients.id` values. */
export interface SmartLaunchContext {
  mode: SmartLaunchMode;
  /** EHR launch: the opaque, single-use launch id mBHR handed the app. */
  launchId: string | null;
  patient: string | null;
  encounter: string | null;
  /** `Practitioner/<id>` for staff, `Patient/<id>` for a portal patient. */
  fhirUser: string | null;
  /** When the launch id stops being accepted (short, minutes). */
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Consent and scopes
// ---------------------------------------------------------------------------

/**
 * How stored consent (interop.consent_records + consent_provisions) limits
 * the scopes of one authorization.
 *
 * - `not-applicable`: a first-party client for internal treatment by staff,
 *   or the patient's own access (owner decision 7). Consent is not a limit.
 * - `permit`: the consent-derived scopes are one more limit in the
 *   intersection (requested x client x user x consent).
 * - `deny`: no permit covers this client, or a deny provision matches.
 *   Nothing patient-specific is granted.
 *
 * Third-party and external-system clients are default deny: with no
 * active, verified, in-period permit for that client the basis is `deny`
 * and `scopes` is empty.
 */
export interface SmartConsentBasis {
  decision: "permit" | "deny" | "not-applicable";
  /** The consent record relied on (audited), when there is one. */
  consentId: string | null;
  provisionId: string | null;
  /** Canonical scopes the consent permits; [] with `deny`. Deny provisions
   *  are applied before this list is built (scopes have no negation). */
  scopes: readonly string[];
}

/** access_audit actions this server would write (the CHECK already allows
 *  them). */
export type SmartAuditAction =
  | "authorization_approval"
  | "authorization_denial"
  | "client_registration_change";

/** Shape of `.well-known/smart-configuration` for when SMART is enabled.
 *  It is NOT served in this release; publishing it would advertise
 *  capabilities that do not exist. */
export interface SmartConfiguration {
  issuer: string;
  jwks_uri: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  grant_types_supported: readonly ("authorization_code" | "refresh_token")[];
  response_types_supported: readonly "code"[];
  code_challenge_methods_supported: readonly "S256"[];
  token_endpoint_auth_methods_supported: readonly SmartTokenEndpointAuthMethod[];
  scopes_supported: readonly string[];
  capabilities: readonly string[];
}
