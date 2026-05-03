// JWT sign/verify helpers backed by jose (npm:jose).
//
// Two flows live here:
//
//  1. private_key_jwt assertion verification (RFC 7523) — the QHIN/Backend
//     Services client signs a JWT with its private key. We fetch the public
//     JWKS from `oauth_clients.jwks` (preferred) or `oauth_clients.jwks_uri`
//     and verify the signature, plus iss/sub/aud/exp claims.
//
//  2. Server access-token signing (ES256) using the active key from
//     oauth_signing_keys. We expose the public half via /.well-known/jwks.json.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
  type JWK,
  type JSONWebKeySet,
  type KeyLike,
} from "npm:jose@5";

import { getTokenEndpoint, nowSeconds } from "./shared.ts";

type SupabaseLike = ReturnType<typeof createClient>;

const remoteJwksCache = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

/** Fixed 5-minute clock skew allowance for client assertions. */
const CLIENT_ASSERTION_CLOCK_TOLERANCE_S = 300;

/**
 * Verify an RFC 7523 client_assertion JWT. The caller has already loaded the
 * matching `oauth_clients` row from the database.
 *
 * Returns the parsed payload on success, throws on any failure (caller maps
 * to OAuth error responses).
 */
export async function verifyClientAssertion(
  assertion: string,
  client: {
    client_id: string;
    jwks: unknown | null;
    jwks_uri: string | null;
  },
): Promise<{ iss: string; sub: string; aud: string; exp: number }> {
  let keySet:
    | ReturnType<typeof createLocalJWKSet>
    | ReturnType<typeof createRemoteJWKSet>;

  if (client.jwks) {
    keySet = createLocalJWKSet(client.jwks as JSONWebKeySet);
  } else if (client.jwks_uri) {
    let cached = remoteJwksCache.get(client.jwks_uri);
    if (!cached) {
      cached = createRemoteJWKSet(new URL(client.jwks_uri));
      remoteJwksCache.set(client.jwks_uri, cached);
    }
    keySet = cached;
  } else {
    throw new Error("client has no jwks or jwks_uri");
  }

  const tokenEndpoint = getTokenEndpoint();
  const { payload } = await jwtVerify(assertion, keySet, {
    issuer: client.client_id,
    subject: client.client_id,
    audience: tokenEndpoint,
    clockTolerance: CLIENT_ASSERTION_CLOCK_TOLERANCE_S,
  });

  // jose enforces exp via clockTolerance above; surface concrete claims to
  // the caller so it can store/audit them.
  return {
    iss: payload.iss as string,
    sub: payload.sub as string,
    aud: Array.isArray(payload.aud)
      ? (payload.aud[0] as string)
      : (payload.aud as string),
    exp: payload.exp as number,
  };
}

/**
 * Verify a bearer access token issued by /oauth/token. Returns the verified
 * payload (including `client_id` and `scope`) or null if the token is
 * malformed or its signature does not match an active server key.
 *
 * This does NOT consult oauth_access_tokens for revocation — call sites that
 * need revocation enforcement should do their own DB lookup by the
 * sha256Hex(token) and reject if revoked_at is set or expires_at has passed.
 */
export async function verifyAccessToken(
  supabase: SupabaseLike,
  token: string,
): Promise<{
  client_id: string;
  scope: string;
  sub?: string;
  exp: number;
} | null> {
  const jwks = await loadServerPublicJwks(supabase);
  if (jwks.keys.length === 0) return null;

  try {
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      audience: getTokenEndpoint().replace("/oauth/token", "/oauth/token"),
      // Note: aud is the token endpoint itself; we set issuer below.
      issuer: getTokenEndpoint().replace("/oauth/token", ""),
      clockTolerance: 60,
    });
    return {
      client_id: (payload.client_id as string) || (payload.sub as string),
      scope: (payload.scope as string) || "",
      sub: payload.sub as string | undefined,
      exp: payload.exp as number,
    };
  } catch {
    return null;
  }
}

/**
 * Sign and serialize a server access token using the currently-active
 * oauth_signing_keys row. ES256 only (jose handles other algorithms but
 * SMART recommends ES256 for backend services).
 */
export async function signAccessToken(
  supabase: SupabaseLike,
  payload: {
    client_id: string;
    scope: string;
    sub?: string;
    expiresIn: number;
  },
): Promise<{ jwt: string; kid: string; expSeconds: number }> {
  const { data, error } = await supabase
    .from("oauth_signing_keys")
    .select("kid, algorithm, private_key_pem")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error("no active server signing key");
  }

  const row = data as {
    kid: string;
    algorithm: "ES256" | "RS256";
    private_key_pem: string;
  };

  const privateKey: KeyLike = await importPKCS8(
    row.private_key_pem,
    row.algorithm,
  );

  const exp = nowSeconds() + payload.expiresIn;
  const issuer = getTokenEndpoint().replace("/oauth/token", "");

  const jwt = await new SignJWT({
    client_id: payload.client_id,
    scope: payload.scope,
  })
    .setProtectedHeader({ alg: row.algorithm, kid: row.kid, typ: "JWT" })
    .setIssuer(issuer)
    .setSubject(payload.sub ?? payload.client_id)
    .setAudience(getTokenEndpoint())
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(privateKey);

  return { jwt, kid: row.kid, expSeconds: exp };
}

/**
 * Public JWKS for /.well-known/jwks.json. Returns an empty key set if no
 * active signing keys are configured (clients should treat this as
 * "endpoint not yet provisioned" and refuse to issue tokens).
 */
export async function loadServerPublicJwks(
  supabase: SupabaseLike,
): Promise<JSONWebKeySet> {
  const { data, error } = await supabase
    .from("oauth_signing_keys")
    .select("kid, algorithm, public_jwk, active")
    .eq("active", true);

  if (error || !data) return { keys: [] };

  const rows = data as Array<{
    kid: string;
    algorithm: string;
    public_jwk: JWK;
  }>;

  return {
    keys: rows.map((r) => ({
      ...r.public_jwk,
      kid: r.kid,
      alg: r.algorithm,
      use: "sig",
    })),
  };
}
