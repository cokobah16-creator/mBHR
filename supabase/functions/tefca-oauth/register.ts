// POST /oauth/register — RFC 7591 dynamic client registration.
//
// Admin-gated: caller must present a Supabase Auth bearer token belonging to
// an admin (app_users.role='admin'). RFC 7591's `software_statement` /
// `initial_access_token` flows are not implemented; the admin's Supabase
// session token IS the initial access token.

import { createClient } from "npm:@supabase/supabase-js@2";

import {
  jsonResponse,
  oauthError,
  parseScopes,
  SUPPORTED_PATIENT_SCOPES,
  SUPPORTED_SYSTEM_SCOPES,
} from "./shared.ts";

type SupabaseLike = ReturnType<typeof createClient>;

interface RegistrationRequest {
  client_name?: string;
  client_type?: "backend-services" | "public" | "confidential";
  redirect_uris?: string[];
  jwks?: unknown;
  jwks_uri?: string;
  token_endpoint_auth_method?:
    | "private_key_jwt"
    | "client_secret_basic"
    | "none";
  scope?: string;
  contact_email?: string;
  qhin_partner_id?: string;
}

const ALL_SUPPORTED_SCOPES = new Set([
  ...SUPPORTED_SYSTEM_SCOPES,
  ...SUPPORTED_PATIENT_SCOPES,
]);

async function requireAdmin(
  supabase: SupabaseLike,
  req: Request,
): Promise<{ ok: true; adminId: string } | { ok: false; resp: Response }> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) {
    return {
      ok: false,
      resp: oauthError(
        "invalid_request",
        "Authorization: Bearer <admin Supabase token> required",
        401,
      ),
    };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return {
      ok: false,
      resp: oauthError("invalid_client", "invalid admin session", 401),
    };
  }

  const { data: userRow } = await supabase
    .from("app_users")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  if ((userRow as { role?: string } | null)?.role !== "admin") {
    return {
      ok: false,
      resp: oauthError(
        "unauthorized_client",
        "/oauth/register requires an admin caller",
        403,
      ),
    };
  }

  return { ok: true, adminId: data.user.id };
}

function generateClientId(): string {
  // 16 bytes of randomness, hex-encoded — distinguishable from token strings.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return (
    "mbhr-" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

function validateRegistration(
  body: RegistrationRequest,
): { ok: true } | { ok: false; description: string } {
  if (!body.client_name || typeof body.client_name !== "string") {
    return { ok: false, description: "client_name is required" };
  }
  const clientType = body.client_type ?? "backend-services";
  if (
    clientType !== "backend-services" &&
    clientType !== "public" &&
    clientType !== "confidential"
  ) {
    return {
      ok: false,
      description:
        "client_type must be one of backend-services|public|confidential",
    };
  }

  if (clientType !== "backend-services") {
    if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
      return {
        ok: false,
        description: "redirect_uris is required for non-backend clients",
      };
    }
    for (const uri of body.redirect_uris) {
      try {
        const u = new URL(uri);
        if (u.protocol !== "https:" && u.hostname !== "localhost") {
          return {
            ok: false,
            description: `redirect_uri ${uri} must use https (or http://localhost for development)`,
          };
        }
      } catch {
        return {
          ok: false,
          description: `redirect_uri ${uri} is not a valid URL`,
        };
      }
    }
  }

  const tokenAuth =
    body.token_endpoint_auth_method ??
    (clientType === "backend-services" ? "private_key_jwt" : "none");

  if (tokenAuth === "private_key_jwt" && !body.jwks && !body.jwks_uri) {
    return {
      ok: false,
      description:
        "private_key_jwt requires either jwks or jwks_uri at registration time",
    };
  }
  if (body.jwks_uri) {
    try {
      const u = new URL(body.jwks_uri);
      if (u.protocol !== "https:") {
        return {
          ok: false,
          description: "jwks_uri must use https",
        };
      }
    } catch {
      return { ok: false, description: "jwks_uri is not a valid URL" };
    }
  }

  if (body.scope) {
    const scopes = parseScopes(body.scope);
    for (const s of scopes) {
      if (
        ALL_SUPPORTED_SCOPES.has(s) ||
        s === "openid" ||
        s === "profile" ||
        s === "fhirUser" ||
        s === "launch" ||
        s === "launch/patient" ||
        s === "offline_access"
      ) {
        continue;
      }
      return { ok: false, description: `scope '${s}' is not supported` };
    }
  }

  return { ok: true };
}

export async function handleRegister(
  supabase: SupabaseLike,
  req: Request,
): Promise<Response> {
  if (req.method !== "POST") {
    return oauthError("invalid_request", "POST application/json required", 405);
  }

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return oauthError(
      "invalid_request",
      "content-type must be application/json",
      400,
    );
  }

  const admin = await requireAdmin(supabase, req);
  if (!admin.ok) return admin.resp;

  let body: RegistrationRequest;
  try {
    body = (await req.json()) as RegistrationRequest;
  } catch {
    return oauthError("invalid_request", "body must be valid JSON");
  }

  const validation = validateRegistration(body);
  if (!validation.ok) {
    return oauthError("invalid_request", validation.description);
  }

  const clientType = body.client_type ?? "backend-services";
  const tokenAuth =
    body.token_endpoint_auth_method ??
    (clientType === "backend-services" ? "private_key_jwt" : "none");

  const clientId = generateClientId();
  const allowedScopes = body.scope
    ? parseScopes(body.scope)
    : ["system/*.read"];

  const insertRow = {
    client_id: clientId,
    client_name: body.client_name!,
    client_type: clientType,
    redirect_uris: body.redirect_uris ?? [],
    jwks: body.jwks ?? null,
    jwks_uri: body.jwks_uri ?? null,
    token_endpoint_auth_method: tokenAuth,
    allowed_scopes: allowedScopes,
    qhin_partner_id: body.qhin_partner_id ?? null,
    contact_email: body.contact_email ?? null,
    status: "active",
  };

  const { error } = await supabase.from("oauth_clients").insert(insertRow);
  if (error) {
    return oauthError(
      "server_error",
      `failed to register client: ${error.message}`,
      500,
    );
  }

  // RFC 7591 §3.2 registration response shape.
  return jsonResponse(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: body.client_name,
      client_type: clientType,
      redirect_uris: body.redirect_uris ?? [],
      token_endpoint_auth_method: tokenAuth,
      grant_types:
        clientType === "backend-services"
          ? ["client_credentials"]
          : ["authorization_code", "refresh_token"],
      response_types: clientType === "backend-services" ? [] : ["code"],
      scope: allowedScopes.join(" "),
      jwks: body.jwks ?? undefined,
      jwks_uri: body.jwks_uri ?? undefined,
    },
    201,
  );
}
