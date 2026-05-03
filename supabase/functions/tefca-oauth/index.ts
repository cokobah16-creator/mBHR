// SMART-on-FHIR + Backend Services OAuth issuer.
//
// Phase C-1 endpoints:
//   GET  /.well-known/smart-configuration
//   GET  /.well-known/openid-configuration   (skinny — issuer + jwks_uri only)
//   GET  /.well-known/jwks.json
//   POST /oauth/token                        client_credentials + private_key_jwt
//
// Deferred to Phase C-2:
//   GET  /oauth/authorize  (authorization_code + PKCE for IAS apps)
//   POST /oauth/register   (RFC 7591 dynamic client registration)
//   refresh_token grant on /oauth/token

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  loadServerPublicJwks,
  signAccessToken,
  verifyClientAssertion,
} from "./jwt.ts";
import {
  corsHeaders,
  getFhirBaseUrl,
  getOAuthBaseUrl,
  jsonResponse,
  oauthError,
  parseScopes,
  scopesAllowed,
  sha256Hex,
  SUPPORTED_PATIENT_SCOPES,
  SUPPORTED_SYSTEM_SCOPES,
} from "./shared.ts";

type SupabaseLike = ReturnType<typeof createClient>;

const ACCESS_TOKEN_TTL_SECONDS = 5 * 60; // 5 minutes; SMART Backend Services norm

function smartConfiguration() {
  const oauthBase = getOAuthBaseUrl();
  return {
    issuer: oauthBase,
    authorization_endpoint: `${oauthBase}/oauth/authorize`,
    token_endpoint: `${oauthBase}/oauth/token`,
    token_endpoint_auth_methods_supported: ["private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["ES256", "RS256"],
    registration_endpoint: `${oauthBase}/oauth/register`,
    jwks_uri: `${oauthBase}/.well-known/jwks.json`,
    grant_types_supported: ["client_credentials", "authorization_code"],
    scopes_supported: [
      ...SUPPORTED_SYSTEM_SCOPES,
      ...SUPPORTED_PATIENT_SCOPES,
      "openid",
      "profile",
      "fhirUser",
      "launch",
      "launch/patient",
    ],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    capabilities: [
      "launch-ehr",
      "launch-standalone",
      "client-public",
      "client-confidential-symmetric",
      "client-confidential-asymmetric",
      "permission-system",
      "permission-patient",
      "sso-openid-connect",
    ],
    aud: getFhirBaseUrl(),
  };
}

function openidConfiguration() {
  const oauthBase = getOAuthBaseUrl();
  return {
    issuer: oauthBase,
    jwks_uri: `${oauthBase}/.well-known/jwks.json`,
    token_endpoint: `${oauthBase}/oauth/token`,
    authorization_endpoint: `${oauthBase}/oauth/authorize`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["ES256", "RS256"],
  };
}

async function handleToken(
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

  if (grantType !== "client_credentials") {
    // Phase C-2 will add authorization_code + refresh_token.
    return oauthError(
      "unsupported_grant_type",
      `grant_type=${grantType ?? "<missing>"} not supported in Phase C-1`,
    );
  }

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

  // Decode the assertion's `iss` to find the client without verifying first.
  let clientId: string;
  try {
    const [, b64payload] = clientAssertion.split(".");
    const payload = JSON.parse(
      atob(b64payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    clientId = payload.iss;
    if (!clientId) throw new Error("missing iss");
  } catch {
    return oauthError(
      "invalid_client",
      "client_assertion is not a parseable JWT",
    );
  }

  const { data: clientData } = await supabase
    .from("oauth_clients")
    .select(
      "client_id, status, jwks, jwks_uri, allowed_scopes, qhin_partner_id, token_endpoint_auth_method",
    )
    .eq("client_id", clientId)
    .maybeSingle();

  if (!clientData) {
    return oauthError("invalid_client", "client not registered", 401);
  }
  const client = clientData as {
    client_id: string;
    status: string;
    jwks: unknown | null;
    jwks_uri: string | null;
    allowed_scopes: string[];
    qhin_partner_id: string | null;
    token_endpoint_auth_method: string;
  };

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

  // Scope negotiation: client may request a subset of allowed_scopes via
  // scope=, otherwise we issue every scope they're allowed.
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

  // Sign the bearer token, persist a hash for revocation lookups, return.
  const { jwt, expSeconds } = await signAccessToken(supabase, {
    client_id: clientId,
    scope: requested.join(" "),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });

  const tokenHash = await sha256Hex(jwt);
  const ipAddress =
    req.headers.get("x-forwarded-for") ||
    req.headers.get("cf-connecting-ip") ||
    null;

  await supabase.from("oauth_access_tokens").insert({
    token_hash: tokenHash,
    client_id: clientId,
    scope: requested.join(" "),
    qhin_partner_id: client.qhin_partner_id,
    expires_at: new Date(expSeconds * 1000).toISOString(),
    ip_address: ipAddress,
  });

  return jsonResponse({
    access_token: jwt,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: requested.join(" "),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const idx = pathParts.indexOf("tefca-oauth");
  const path = "/" + pathParts.slice(idx + 1).join("/");

  try {
    if (path === "/.well-known/smart-configuration") {
      return jsonResponse(smartConfiguration());
    }
    if (path === "/.well-known/openid-configuration") {
      return jsonResponse(openidConfiguration());
    }
    if (path === "/.well-known/jwks.json") {
      return jsonResponse(await loadServerPublicJwks(supabase));
    }
    if (path === "/oauth/token") {
      return await handleToken(supabase, req);
    }

    return oauthError("invalid_request", `unknown path ${path}`, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return oauthError("server_error", message, 500);
  }
});
