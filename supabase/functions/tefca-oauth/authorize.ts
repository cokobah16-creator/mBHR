// GET /oauth/authorize — SMART App Launch authorization endpoint with PKCE.
//
// This endpoint sits behind the user's identity. Two ways to satisfy that
// requirement, in priority order:
//
//   1. Bearer Authorization header carrying a Supabase Auth access token —
//      mBHR's main app passes this through after the user logs in. We
//      validate the token via supabase.auth.getUser() and use auth.uid() as
//      the user_id; if the user is linked to a patient row we also store
//      patient_id on the auth code.
//
//   2. ?session_token= query param — same semantics as (1) but for clients
//      that can't customize headers on a redirect. The value is treated as a
//      Supabase JWT.
//
// If neither is present, we return a 401 with an HTML body that links to the
// main app's login. (Handing-off to a separately hosted login UI is Phase
// C-2.5 — for now, the app is responsible for redirecting through this
// endpoint AFTER its own login flow.)

import { createClient } from "npm:@supabase/supabase-js@2";

import {
  jsonResponse,
  oauthError,
  parseScopes,
  scopesAllowed,
} from "./shared.ts";
import { AUTHORIZATION_CODE_TTL_SECONDS } from "./token.ts";

type SupabaseLike = ReturnType<typeof createClient>;

interface AuthorizeParams {
  responseType: string | null;
  clientId: string | null;
  redirectUri: string | null;
  scope: string | null;
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  aud: string | null;
}

function parseParams(url: URL): AuthorizeParams {
  return {
    responseType: url.searchParams.get("response_type"),
    clientId: url.searchParams.get("client_id"),
    redirectUri: url.searchParams.get("redirect_uri"),
    scope: url.searchParams.get("scope"),
    state: url.searchParams.get("state"),
    codeChallenge: url.searchParams.get("code_challenge"),
    codeChallengeMethod: url.searchParams.get("code_challenge_method"),
    aud: url.searchParams.get("aud"),
  };
}

function loginRequiredHtml(returnUrl: string): Response {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sign in required</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, sans-serif; padding: 24px; max-width: 480px; margin: 40px auto; }
      h1 { color: #0A7A3B; margin: 0 0 12px; }
      a.btn { display: inline-block; padding: 10px 16px; background: #0A7A3B; color: #fff; border-radius: 6px; text-decoration: none; }
    </style>
  </head>
  <body>
    <h1>Med Bridge Health Reach</h1>
    <p>Sign in to continue authorizing this application.</p>
    <p><a class="btn" href="/login?return_to=${encodeURIComponent(returnUrl)}">Sign in</a></p>
  </body>
</html>`;
  return new Response(body, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function generateAuthorizationCode(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function resolveCallerIdentity(
  supabase: SupabaseLike,
  req: Request,
  url: URL,
): Promise<
  | { ok: true; userId: string; patientId: string | null }
  | { ok: false; reason: string }
> {
  // 1. Authorization: Bearer <supabase-access-token>
  const auth = req.headers.get("Authorization") || "";
  let token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  // 2. ?session_token= fallback
  if (!token) token = url.searchParams.get("session_token") || undefined;

  if (!token) return { ok: false, reason: "missing user session" };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, reason: "invalid user session" };
  }

  const userId = data.user.id;

  // Look for a patient linked to this auth user.
  const { data: patient } = await supabase
    .from("patients")
    .select("id")
    .eq("auth_uid", userId)
    .maybeSingle();

  return {
    ok: true,
    userId,
    patientId: (patient as { id: string } | null)?.id ?? null,
  };
}

export async function handleAuthorize(
  supabase: SupabaseLike,
  req: Request,
): Promise<Response> {
  if (req.method !== "GET") {
    return oauthError(
      "invalid_request",
      "GET required for /oauth/authorize",
      405,
    );
  }

  const url = new URL(req.url);
  const params = parseParams(url);

  if (params.responseType !== "code") {
    return oauthError(
      "invalid_request",
      `response_type must be 'code' (got ${params.responseType ?? "missing"})`,
    );
  }
  if (!params.clientId) {
    return oauthError("invalid_request", "client_id is required");
  }
  if (!params.redirectUri) {
    return oauthError("invalid_request", "redirect_uri is required");
  }

  const { data: clientData } = await supabase
    .from("oauth_clients")
    .select(
      "client_id, status, redirect_uris, allowed_scopes, token_endpoint_auth_method",
    )
    .eq("client_id", params.clientId)
    .maybeSingle();

  if (!clientData) {
    return oauthError("invalid_client", "client not registered", 401);
  }
  const client = clientData as {
    client_id: string;
    status: string;
    redirect_uris: string[];
    allowed_scopes: string[];
    token_endpoint_auth_method: string;
  };

  if (client.status !== "active") {
    return oauthError("invalid_client", `client is ${client.status}`, 401);
  }
  if (!client.redirect_uris.includes(params.redirectUri)) {
    // RFC 6749 §3.1.2.4: the AS MUST NOT redirect when redirect_uri is invalid.
    return oauthError(
      "invalid_request",
      "redirect_uri does not match a registered redirect_uri",
      400,
    );
  }

  // PKCE is required for non-confidential clients; we require S256 always.
  if (
    client.token_endpoint_auth_method === "none" &&
    (!params.codeChallenge || params.codeChallengeMethod !== "S256")
  ) {
    return redirectWithError(
      params.redirectUri,
      "invalid_request",
      "code_challenge with code_challenge_method=S256 is required",
      params.state,
    );
  }
  if (params.codeChallenge && params.codeChallengeMethod !== "S256") {
    return redirectWithError(
      params.redirectUri,
      "invalid_request",
      "only PKCE S256 is supported",
      params.state,
    );
  }

  // Scope negotiation
  const requested = params.scope
    ? parseScopes(params.scope)
    : client.allowed_scopes;
  if (!scopesAllowed(requested, client.allowed_scopes)) {
    return redirectWithError(
      params.redirectUri,
      "invalid_scope",
      "requested scope exceeds allowed_scopes",
      params.state,
    );
  }

  // Identify the caller. If they're not signed in, return a small HTML page
  // pointing at the main app's login. Conformant clients pass the user
  // through after their own auth flow.
  const identity = await resolveCallerIdentity(supabase, req, url);
  if (!identity.ok) {
    return loginRequiredHtml(req.url);
  }

  const code = await generateAuthorizationCode();
  await supabase.from("oauth_authorization_codes").insert({
    code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: requested.join(" "),
    code_challenge: params.codeChallenge,
    code_challenge_method: params.codeChallengeMethod,
    user_id: identity.userId,
    patient_id: identity.patientId,
    expires_at: new Date(
      Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000,
    ).toISOString(),
  });

  // Redirect back to the client's redirect_uri with code + state.
  const target = new URL(params.redirectUri);
  target.searchParams.set("code", code);
  if (params.state) target.searchParams.set("state", params.state);

  return new Response(null, {
    status: 302,
    headers: { Location: target.toString() },
  });
}

function redirectWithError(
  redirectUri: string,
  error: string,
  description: string,
  state: string | null,
): Response {
  const target = new URL(redirectUri);
  target.searchParams.set("error", error);
  target.searchParams.set("error_description", description);
  if (state) target.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: { Location: target.toString() },
  });
}

// Re-export jsonResponse for callers that need it (kept for symmetry with
// other modules; tree-shaking will drop if unused).
export { jsonResponse };
