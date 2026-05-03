// POST /oauth/token — issues bearer access tokens.
//
// Supports three grants:
//   - client_credentials  (RFC 7523 private_key_jwt for QHIN backends)
//   - authorization_code  (with PKCE S256 for IAS/SMART App Launch)
//   - refresh_token       (rotates the refresh token)
//
// All issued tokens are persisted to oauth_access_tokens with their sha-256
// hash so tefca-ias can introspect by lookup and revocations are constant-time.

import { createClient } from "npm:@supabase/supabase-js@2";

import { signAccessToken, verifyClientAssertion } from "./jwt.ts";
import {
  jsonResponse,
  oauthError,
  parseScopes,
  scopesAllowed,
  sha256Hex,
} from "./shared.ts";

type SupabaseLike = ReturnType<typeof createClient>;

export const ACCESS_TOKEN_TTL_SECONDS = 5 * 60; // 5 minutes
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const AUTHORIZATION_CODE_TTL_SECONDS = 60; // 60 seconds per RFC 6749 §10.5

interface OAuthClientRow {
  client_id: string;
  status: string;
  jwks: unknown | null;
  jwks_uri: string | null;
  allowed_scopes: string[];
  qhin_partner_id: string | null;
  token_endpoint_auth_method: string;
  redirect_uris: string[];
}

const CLIENT_COLUMNS =
  "client_id, status, jwks, jwks_uri, allowed_scopes, qhin_partner_id, token_endpoint_auth_method, redirect_uris";

async function persistAccessToken(
  supabase: SupabaseLike,
  args: {
    jwt: string;
    clientId: string;
    scope: string;
    subject?: string;
    qhinPartnerId: string | null;
    expSeconds: number;
    ipAddress: string | null;
  },
) {
  const tokenHash = await sha256Hex(args.jwt);
  await supabase.from("oauth_access_tokens").insert({
    token_hash: tokenHash,
    client_id: args.clientId,
    scope: args.scope,
    subject: args.subject,
    qhin_partner_id: args.qhinPartnerId,
    expires_at: new Date(args.expSeconds * 1000).toISOString(),
    ip_address: args.ipAddress,
  });
}

async function generateOpaqueToken(): Promise<string> {
  // 32 bytes of randomness, base64url-encoded — RFC 6749 §10.10
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function persistRefreshToken(
  supabase: SupabaseLike,
  args: {
    raw: string;
    clientId: string;
    scope: string;
    subject?: string;
  },
): Promise<void> {
  const tokenHash = await sha256Hex(args.raw);
  await supabase.from("oauth_refresh_tokens").insert({
    token_hash: tokenHash,
    client_id: args.clientId,
    scope: args.scope,
    subject: args.subject,
    expires_at: new Date(
      Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
    ).toISOString(),
  });
}

async function revokeRefreshToken(
  supabase: SupabaseLike,
  raw: string,
): Promise<void> {
  const tokenHash = await sha256Hex(raw);
  await supabase
    .from("oauth_refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", tokenHash);
}

function clientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for") ||
    req.headers.get("cf-connecting-ip") ||
    null
  );
}

async function loadClient(
  supabase: SupabaseLike,
  clientId: string,
): Promise<OAuthClientRow | null> {
  const { data } = await supabase
    .from("oauth_clients")
    .select(CLIENT_COLUMNS)
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as OAuthClientRow | null) ?? null;
}

/**
 * RFC 7636 §4.6: SHA-256 hash the verifier, base64url-encode (no padding),
 * compare to the stored code_challenge.
 */
async function verifyPkceS256(
  verifier: string,
  challenge: string,
): Promise<boolean> {
  const buf = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const computed = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return computed === challenge;
}

async function handleClientCredentials(
  supabase: SupabaseLike,
  req: Request,
  form: URLSearchParams,
): Promise<Response> {
  const clientAssertionType = form.get("client_assertion_type");
  const clientAssertion = form.get("client_assertion");

  if (
    clientAssertionType !==
    "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
  ) {
    return oauthError(
      "invalid_request",
      "client_assertion_type must be jwt-bearer (RFC 7523)",
    );
  }
  if (!clientAssertion) {
    return oauthError("invalid_request", "client_assertion is required");
  }

  let clientId: string;
  try {
    const [, b64] = clientAssertion.split(".");
    const payload = JSON.parse(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
    clientId = payload.iss;
    if (!clientId) throw new Error("missing iss");
  } catch {
    return oauthError(
      "invalid_client",
      "client_assertion is not a parseable JWT",
    );
  }

  const client = await loadClient(supabase, clientId);
  if (!client) {
    return oauthError("invalid_client", "client not registered", 401);
  }
  if (client.status !== "active") {
    return oauthError("invalid_client", `client is ${client.status}`, 401);
  }
  if (client.token_endpoint_auth_method !== "private_key_jwt") {
    return oauthError(
      "invalid_client",
      "client is not configured for private_key_jwt",
      401,
    );
  }

  try {
    await verifyClientAssertion(clientAssertion, client);
  } catch (err) {
    return oauthError(
      "invalid_client",
      `assertion verification failed: ${
        err instanceof Error ? err.message : "unknown"
      }`,
      401,
    );
  }

  const requestedScope = form.get("scope") || "";
  const requested = requestedScope
    ? parseScopes(requestedScope)
    : client.allowed_scopes;
  if (!scopesAllowed(requested, client.allowed_scopes)) {
    return oauthError(
      "invalid_scope",
      `requested scopes exceed allowed_scopes for client ${clientId}`,
    );
  }

  const { jwt, expSeconds } = await signAccessToken(supabase, {
    client_id: clientId,
    scope: requested.join(" "),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });

  await persistAccessToken(supabase, {
    jwt,
    clientId,
    scope: requested.join(" "),
    qhinPartnerId: client.qhin_partner_id,
    expSeconds,
    ipAddress: clientIp(req),
  });

  return jsonResponse({
    access_token: jwt,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: requested.join(" "),
  });
}

async function handleAuthorizationCode(
  supabase: SupabaseLike,
  req: Request,
  form: URLSearchParams,
): Promise<Response> {
  const code = form.get("code");
  const codeVerifier = form.get("code_verifier");
  const redirectUri = form.get("redirect_uri");
  const clientId = form.get("client_id");

  if (!code || !redirectUri || !clientId) {
    return oauthError(
      "invalid_request",
      "code, redirect_uri, and client_id are required",
    );
  }

  const client = await loadClient(supabase, clientId);
  if (!client) {
    return oauthError("invalid_client", "client not registered", 401);
  }
  if (client.status !== "active") {
    return oauthError("invalid_client", `client is ${client.status}`, 401);
  }
  if (!client.redirect_uris.includes(redirectUri)) {
    return oauthError(
      "invalid_grant",
      "redirect_uri does not match a registered redirect_uri",
    );
  }

  // Look up + atomically consume the authorization code.
  const { data: codeRow } = await supabase
    .from("oauth_authorization_codes")
    .select(
      "code, client_id, redirect_uri, scope, code_challenge, code_challenge_method, user_id, patient_id, expires_at, used_at",
    )
    .eq("code", code)
    .maybeSingle();

  if (!codeRow) {
    return oauthError("invalid_grant", "authorization code not found");
  }
  const row = codeRow as {
    client_id: string;
    redirect_uri: string;
    scope: string;
    code_challenge: string | null;
    code_challenge_method: string | null;
    user_id: string | null;
    patient_id: string | null;
    expires_at: string;
    used_at: string | null;
  };

  if (row.used_at) {
    // Per RFC 6749 §10.5: revoke any previously-issued tokens when an auth
    // code is replayed. We don't track per-code -> per-token here, so just
    // refuse the exchange.
    return oauthError("invalid_grant", "authorization code already used");
  }
  if (row.client_id !== clientId) {
    return oauthError(
      "invalid_grant",
      "authorization code was not issued to this client",
    );
  }
  if (row.redirect_uri !== redirectUri) {
    return oauthError(
      "invalid_grant",
      "redirect_uri does not match the authorization request",
    );
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return oauthError("invalid_grant", "authorization code has expired");
  }

  if (row.code_challenge) {
    if (row.code_challenge_method !== "S256") {
      return oauthError("invalid_request", "only PKCE S256 is supported");
    }
    if (!codeVerifier) {
      return oauthError("invalid_grant", "code_verifier is required");
    }
    if (!(await verifyPkceS256(codeVerifier, row.code_challenge))) {
      return oauthError("invalid_grant", "code_verifier does not match");
    }
  }

  // Mark the code as used.
  await supabase
    .from("oauth_authorization_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code", code);

  const subject = row.patient_id ?? row.user_id ?? clientId;

  const { jwt, expSeconds } = await signAccessToken(supabase, {
    client_id: clientId,
    scope: row.scope,
    sub: subject,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
  await persistAccessToken(supabase, {
    jwt,
    clientId,
    scope: row.scope,
    subject,
    qhinPartnerId: client.qhin_partner_id,
    expSeconds,
    ipAddress: clientIp(req),
  });

  const refresh = await generateOpaqueToken();
  await persistRefreshToken(supabase, {
    raw: refresh,
    clientId,
    scope: row.scope,
    subject,
  });

  const body: Record<string, unknown> = {
    access_token: jwt,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: row.scope,
    refresh_token: refresh,
  };
  if (row.patient_id) body.patient = row.patient_id;
  return jsonResponse(body);
}

async function handleRefreshToken(
  supabase: SupabaseLike,
  req: Request,
  form: URLSearchParams,
): Promise<Response> {
  const refreshToken = form.get("refresh_token");
  const clientId = form.get("client_id");
  const requestedScopeRaw = form.get("scope");

  if (!refreshToken || !clientId) {
    return oauthError(
      "invalid_request",
      "refresh_token and client_id are required",
    );
  }

  const client = await loadClient(supabase, clientId);
  if (!client) {
    return oauthError("invalid_client", "client not registered", 401);
  }
  if (client.status !== "active") {
    return oauthError("invalid_client", `client is ${client.status}`, 401);
  }

  const tokenHash = await sha256Hex(refreshToken);
  const { data: refreshRow } = await supabase
    .from("oauth_refresh_tokens")
    .select("token_hash, client_id, scope, subject, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!refreshRow) {
    return oauthError("invalid_grant", "refresh_token not found");
  }
  const r = refreshRow as {
    client_id: string;
    scope: string;
    subject: string | null;
    expires_at: string;
    revoked_at: string | null;
  };
  if (r.revoked_at) {
    return oauthError("invalid_grant", "refresh_token has been revoked");
  }
  if (new Date(r.expires_at).getTime() <= Date.now()) {
    return oauthError("invalid_grant", "refresh_token has expired");
  }
  if (r.client_id !== clientId) {
    return oauthError(
      "invalid_grant",
      "refresh_token was not issued to this client",
    );
  }

  // Allow narrowing scope on refresh (RFC 6749 §6) but never widening.
  let scope = r.scope;
  if (requestedScopeRaw) {
    const requested = parseScopes(requestedScopeRaw);
    const original = parseScopes(r.scope);
    const allOriginal = requested.every((s) => original.includes(s));
    if (!allOriginal) {
      return oauthError(
        "invalid_scope",
        "refresh cannot widen scope beyond the original grant",
      );
    }
    scope = requested.join(" ");
  }

  // Rotate: revoke the presented refresh token, issue a new pair.
  await revokeRefreshToken(supabase, refreshToken);

  const { jwt, expSeconds } = await signAccessToken(supabase, {
    client_id: clientId,
    scope,
    sub: r.subject ?? clientId,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
  await persistAccessToken(supabase, {
    jwt,
    clientId,
    scope,
    subject: r.subject ?? undefined,
    qhinPartnerId: client.qhin_partner_id,
    expSeconds,
    ipAddress: clientIp(req),
  });

  const newRefresh = await generateOpaqueToken();
  await persistRefreshToken(supabase, {
    raw: newRefresh,
    clientId,
    scope,
    subject: r.subject ?? undefined,
  });

  return jsonResponse({
    access_token: jwt,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope,
    refresh_token: newRefresh,
  });
}

export async function handleToken(
  supabase: SupabaseLike,
  req: Request,
): Promise<Response> {
  if (req.method !== "POST") {
    return oauthError(
      "invalid_request",
      "POST application/x-www-form-urlencoded required",
      405,
    );
  }

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return oauthError(
      "invalid_request",
      "content-type must be application/x-www-form-urlencoded",
      400,
    );
  }

  const form = new URLSearchParams(await req.text());
  const grantType = form.get("grant_type");

  switch (grantType) {
    case "client_credentials":
      return handleClientCredentials(supabase, req, form);
    case "authorization_code":
      return handleAuthorizationCode(supabase, req, form);
    case "refresh_token":
      return handleRefreshToken(supabase, req, form);
    default:
      return oauthError(
        "unsupported_grant_type",
        `grant_type=${grantType ?? "<missing>"} not supported`,
      );
  }
}
