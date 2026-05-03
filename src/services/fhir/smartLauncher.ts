/**
 * SMART App Launch helper for browser/PWA contexts. Implements the parts of
 * SMART App Launch / OAuth2 + PKCE that consumer code needs:
 *
 *   1. Generate a PKCE verifier/challenge pair.
 *   2. Open the authorization URL with response_type=code.
 *   3. Exchange the returned code for an access token (+ refresh token).
 *   4. Refresh an access token before it expires.
 *
 * Pairs with /oauth/authorize and /oauth/token in supabase/functions/tefca-oauth.
 */

import { getSMARTConfiguration } from "./tefcaAuth";

const PKCE_STATE_KEY = "mbhr.smart.pkce";

interface PkceState {
  verifier: string;
  state: string;
  redirectUri: string;
  clientId: string;
  scope: string;
  oauthBaseUrl: string;
}

export interface SmartTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  refresh_token?: string;
  patient?: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generatePkceVerifier(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function pkceChallengeS256(verifier: string): Promise<string> {
  const buf = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return bytesToBase64Url(new Uint8Array(digest));
}

function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/**
 * Begin the SMART App Launch flow. Builds the authorize URL and persists
 * the PKCE state in sessionStorage. Caller is responsible for navigating
 * (e.g. window.location.assign(url)).
 */
export async function beginSmartLaunch(args: {
  oauthBaseUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  /** Optional bearer token for the user's Supabase session — passed via
   * `session_token` query param so the authorize endpoint can identify the
   * user without redirecting through a separate login UI. */
  supabaseAccessToken?: string;
}): Promise<{ authorizeUrl: string; state: string }> {
  const config = await getSMARTConfiguration(args.oauthBaseUrl);
  const verifier = await generatePkceVerifier();
  const challenge = await pkceChallengeS256(verifier);
  const state = generateState();

  const persisted: PkceState = {
    verifier,
    state,
    redirectUri: args.redirectUri,
    clientId: args.clientId,
    scope: args.scope,
    oauthBaseUrl: args.oauthBaseUrl,
  };
  sessionStorage.setItem(PKCE_STATE_KEY, JSON.stringify(persisted));

  const url = new URL(config.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("scope", args.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (args.supabaseAccessToken) {
    url.searchParams.set("session_token", args.supabaseAccessToken);
  }

  return { authorizeUrl: url.toString(), state };
}

/**
 * Complete the flow when the OAuth callback redirects back with `?code=...`.
 * Reads the persisted PKCE state, exchanges the code, and clears state.
 */
export async function completeSmartLaunch(
  callbackUrl: string,
): Promise<SmartTokenResponse> {
  const url = new URL(callbackUrl);
  const code = url.searchParams.get("code");
  const callbackState = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) {
    const description = url.searchParams.get("error_description") ?? error;
    throw new Error(`SMART launch failed: ${description}`);
  }
  if (!code) throw new Error("SMART launch callback missing code");

  const raw = sessionStorage.getItem(PKCE_STATE_KEY);
  if (!raw) throw new Error("No PKCE state found in sessionStorage");
  const persisted = JSON.parse(raw) as PkceState;

  if (callbackState !== persisted.state) {
    throw new Error("OAuth state mismatch — possible CSRF");
  }

  const config = await getSMARTConfiguration(persisted.oauthBaseUrl);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: persisted.verifier,
    redirect_uri: persisted.redirectUri,
    client_id: persisted.clientId,
  });

  const resp = await fetch(config.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${errText}`);
  }

  const token = (await resp.json()) as SmartTokenResponse;
  sessionStorage.removeItem(PKCE_STATE_KEY);
  return token;
}

/**
 * Trade a refresh token for a fresh access token. Returns the new token pair
 * (refresh_token will be rotated server-side, so callers should always
 * persist the response value, not the previous one).
 */
export async function refreshSmartToken(args: {
  oauthBaseUrl: string;
  clientId: string;
  refreshToken: string;
  scope?: string;
}): Promise<SmartTokenResponse> {
  const config = await getSMARTConfiguration(args.oauthBaseUrl);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  });
  if (args.scope) body.set("scope", args.scope);

  const resp = await fetch(config.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Token refresh failed (${resp.status}): ${errText}`);
  }

  return (await resp.json()) as SmartTokenResponse;
}
