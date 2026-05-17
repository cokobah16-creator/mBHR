// SMART-on-FHIR + Backend Services OAuth issuer.
//
// Phase C-1 endpoints:
//   GET  /.well-known/smart-configuration
//   GET  /.well-known/openid-configuration
//   GET  /.well-known/jwks.json
//   POST /oauth/token        client_credentials + private_key_jwt
//
// Phase C-2 additions (this file is the slim router; handlers live in
// authorize.ts, token.ts, register.ts):
//   GET  /oauth/authorize    SMART App Launch with PKCE S256
//   POST /oauth/token        also handles authorization_code + refresh_token
//   POST /oauth/register     RFC 7591 dynamic client registration (admin-gated)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { handleAuthorize } from "./authorize.ts";
import { loadServerPublicJwks } from "./jwt.ts";
import { handleRegister } from "./register.ts";
import { handleToken } from "./token.ts";
import {
  corsHeaders,
  getFhirBaseUrl,
  getOAuthBaseUrl,
  jsonResponse,
  oauthError,
  SUPPORTED_PATIENT_SCOPES,
  SUPPORTED_PATIENT_WRITE_SCOPES,
  SUPPORTED_SYSTEM_SCOPES,
  SUPPORTED_SYSTEM_WRITE_SCOPES,
} from "./shared.ts";
import { enforceRateLimit } from "../_shared/security/rateLimit.ts";

function smartConfiguration() {
  const oauthBase = getOAuthBaseUrl();
  return {
    issuer: oauthBase,
    authorization_endpoint: `${oauthBase}/oauth/authorize`,
    token_endpoint: `${oauthBase}/oauth/token`,
    token_endpoint_auth_methods_supported: [
      "private_key_jwt",
      "client_secret_basic",
      "none",
    ],
    token_endpoint_auth_signing_alg_values_supported: ["ES256", "RS256"],
    registration_endpoint: `${oauthBase}/oauth/register`,
    jwks_uri: `${oauthBase}/.well-known/jwks.json`,
    grant_types_supported: [
      "client_credentials",
      "authorization_code",
      "refresh_token",
    ],
    scopes_supported: [
      ...SUPPORTED_SYSTEM_SCOPES,
      ...SUPPORTED_SYSTEM_WRITE_SCOPES,
      ...SUPPORTED_PATIENT_SCOPES,
      ...SUPPORTED_PATIENT_WRITE_SCOPES,
      "openid",
      "profile",
      "fhirUser",
      "launch",
      "launch/patient",
      "offline_access",
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
      "permission-offline",
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
    registration_endpoint: `${oauthBase}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: [
      "client_credentials",
      "authorization_code",
      "refresh_token",
    ],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["ES256", "RS256"],
    code_challenge_methods_supported: ["S256"],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const rl = await enforceRateLimit(req, {
    bucket: "edge_tefca_oauth",
    keyStrategy: "ip",
    max: 60,
    windowSeconds: 60,
  });
  if (!rl.allowed && rl.response) {
    return new Response(rl.response.body, {
      status: rl.response.status,
      headers: { ...corsHeaders, "Retry-After": String(rl.retryAfter ?? 60) },
    });
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
    if (path === "/oauth/authorize") {
      return await handleAuthorize(supabase, req);
    }
    if (path === "/oauth/token") {
      return await handleToken(supabase, req);
    }
    if (path === "/oauth/register") {
      return await handleRegister(supabase, req);
    }

    return oauthError("invalid_request", `unknown path ${path}`, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return oauthError("server_error", message, 500);
  }
});
