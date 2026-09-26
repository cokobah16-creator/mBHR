import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { allowedOrigins, corsHeadersFor } from "../_shared/security/cors.ts";
import { enforceRateLimit } from "../_shared/security/rateLimit.ts";
import { getServiceClient, requireStaff } from "../_shared/security/staffAuth.ts";
import {
  BODY_MAX_BYTES,
  STAFF_ACTION_BUCKET,
  STAFF_ACTION_LIMIT,
  STAFF_ADMIN_ROLES,
  STAFF_ADMIN_SERVICE,
  STAFF_ADMIN_VERSION,
  STAFF_IP_BUCKET,
  STAFF_IP_LIMIT,
} from "../_shared/staff/constants.ts";
import {
  isRefusalCode,
  type Refusal,
  rateLimitedRefusal,
  refusal,
  refusalBody,
  REFUSAL_MESSAGES,
} from "../_shared/staff/errors.ts";
import { routeStaffAdminRequest } from "../_shared/staff/validate.ts";
import { configuredOrigin, runStaffAdminAction } from "../_shared/staff/actions.ts";
import { inviteLifetimeSeconds, launchedAt, preflightRefusal } from "../_shared/staff/settings.ts";
import { createStaffAdminPort } from "./port.ts";

// Staff account setup for administrators (the Users screen).
//
// One POST endpoint, { action, ...fields }. The rules for every action live
// in ../_shared/staff/actions.ts (pure, unit tested with a fake port); this
// file only checks the request and the caller, then hands over:
//   1. OPTIONS gets an empty 200; any method other than POST gets 405.
//   2. 30 requests a minute per IP address (fails open), before sign-in.
//   3. The body: at most BODY_MAX_BYTES, JSON, then routeStaffAdminRequest
//      (shape, PIN keys refused, fields checked).
//   4. `ping` answers { version } with no sign-in.
//   5. Every other action needs ALLOWED_ORIGINS set (503 not_configured),
//      then a signed-in administrator: the role is read from app_users
//      (staffAuth.ts), never from the token or the body.
//   6. 60 actions per 10 minutes per administrator (fails closed).
//   7. runStaffAdminAction.
//
// Every reply is JSON { fn: "staff-admin", success, ... } with
// Cache-Control: no-store. A refusal adds error (a code), message (plain
// English for the administrator) and sometimes field / retry_after_seconds.
//
// Settings (function secrets):
//   ALLOWED_ORIGINS                 required (CORS; see cors.ts)
//   RATE_LIMIT_KEY_SALT             required by policy (smsRateLimit.ts)
//   STAFF_APP_ORIGIN                where invitation links point
//                                   (default https://mbhr.app)
//   STAFF_INVITE_LIFETIME_SECONDS   300 to 86400, default 3600; must equal the
//                                   Auth "Email OTP Expiration"
//   STAFF_ADMIN_LAUNCHED_AT         optional ISO date (Account Health)
// See docs/deployment/STAFF_ADMIN_FUNCTION.md.
//
// The server never accepts or stores a PIN. Logs hold the action name and
// error codes only: never an email address, a name, a link or an id.

// requireStaff's own messages talk about SMS; these replace them.
const AUTH_MESSAGES: Record<string, string> = {
  not_authenticated: REFUSAL_MESSAGES.not_authenticated,
  not_permitted: REFUSAL_MESSAGES.not_permitted,
  staff_lookup_failed: REFUSAL_MESSAGES.staff_lookup_failed,
};

type Reply = (
  status: number,
  body: Record<string, unknown>,
  extra?: Record<string, string>,
) => Response;

type ActionContext = Parameters<typeof runStaffAdminAction>[1];

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** STAFF_INVITE_LIFETIME_SECONDS (settings.ts), with a warning when it is not used. */
function readInviteLifetime(): number {
  const raw = Deno.env.get("STAFF_INVITE_LIFETIME_SECONDS");
  const value = inviteLifetimeSeconds(raw);
  if (raw !== undefined && raw.trim() !== "" && value !== Number(raw.trim())) {
    console.warn("[staff-admin] STAFF_INVITE_LIFETIME_SECONDS is not valid; using the default.");
  }
  return value;
}

/** STAFF_ADMIN_LAUNCHED_AT (settings.ts), with a warning when it is not a date. */
function readLaunchedAt(): Date | null {
  const raw = Deno.env.get("STAFF_ADMIN_LAUNCHED_AT");
  const value = launchedAt(raw);
  if (value === null && raw !== undefined && raw.trim() !== "") {
    console.warn("[staff-admin] STAFF_ADMIN_LAUNCHED_AT is not a date; ignoring it.");
  }
  return value;
}

function refusalReply(reply: Reply, r: Refusal): Response {
  const extra: Record<string, string> =
    r.status === 429 && r.retryAfterSeconds !== undefined
      ? { "Retry-After": String(r.retryAfterSeconds) }
      : {};
  return reply(r.status, refusalBody(r), extra);
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const jsonHeaders = {
    ...corsHeaders,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  const reply: Reply = (status, body, extra = {}) =>
    new Response(
      JSON.stringify({ success: status < 400, ...body, fn: STAFF_ADMIN_SERVICE }),
      { status, headers: { ...jsonHeaders, ...extra } },
    );

  if (req.method !== "POST") {
    return refusalReply(reply, refusal("method_not_allowed"));
  }

  const rl = await enforceRateLimit(req, {
    bucket: STAFF_IP_BUCKET,
    keyStrategy: "ip",
    max: STAFF_IP_LIMIT.max,
    windowSeconds: STAFF_IP_LIMIT.windowSeconds,
  });
  if (!rl.allowed) {
    return refusalReply(reply, rateLimitedRefusal(rl.retryAfter ?? STAFF_IP_LIMIT.windowSeconds));
  }

  let action = "unknown";
  try {
    // Refuse an oversized body before reading it, when its size is declared.
    const declared = Number(req.headers.get("Content-Length") ?? "");
    if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) {
      return refusalReply(reply, refusal("too_large"));
    }

    const raw = await req.text();
    const rawBytes = new TextEncoder().encode(raw).length;
    let body: unknown = null;
    if (rawBytes <= BODY_MAX_BYTES) {
      try {
        body = JSON.parse(raw);
      } catch {
        return refusalReply(reply, refusal("invalid_request"));
      }
    }

    const route = routeStaffAdminRequest(body, rawBytes);
    if (route.kind === "refused") {
      const refused: Record<string, unknown> = {
        success: false,
        error: route.error,
        message: route.message,
      };
      if (route.field !== undefined) refused.field = route.field;
      return reply(route.status, refused);
    }
    action = route.kind;

    if (route.kind === "ping") {
      return reply(200, { success: true, version: STAFF_ADMIN_VERSION });
    }

    // CORS fails closed: without ALLOWED_ORIGINS, cors.ts answers "*", so
    // nothing but ping runs until it is set.
    const notConfigured = preflightRefusal(allowedOrigins());
    if (notConfigured) return refusalReply(reply, notConfigured);

    const service = getServiceClient();
    const auth = await requireStaff(req, service, STAFF_ADMIN_ROLES);
    if (!auth.ok) {
      return reply(auth.status, {
        success: false,
        error: auth.error,
        message:
          AUTH_MESSAGES[auth.error] ??
          (isRefusalCode(auth.error) ? REFUSAL_MESSAGES[auth.error] : auth.message),
      });
    }

    const port = createStaffAdminPort(service);
    const limit = await port.checkLimits([
      {
        bucket: STAFF_ACTION_BUCKET,
        key: auth.userId,
        max: STAFF_ACTION_LIMIT.max,
        windowSeconds: STAFF_ACTION_LIMIT.windowSeconds,
      },
    ]);
    if (!limit.allowed) {
      return refusalReply(
        reply,
        "error" in limit ? refusal("rate_limit_unavailable") : rateLimitedRefusal(limit.retryAfter),
      );
    }

    const ctx: ActionContext = {
      actorId: auth.userId,
      now: new Date(),
      appOrigin: configuredOrigin(Deno.env.get("STAFF_APP_ORIGIN")),
      inviteLifetimeSec: readInviteLifetime(),
      launchedAt: readLaunchedAt(),
    };

    const result = await runStaffAdminAction(port, ctx, route);
    const retryAfter = result.body.retry_after_seconds;
    const extra: Record<string, string> =
      result.status === 429 && typeof retryAfter === "number"
        ? { "Retry-After": String(retryAfter) }
        : {};
    if (result.status >= 500) {
      console.error(`[staff-admin] ${action} failed: HTTP ${result.status}`, result.body.error ?? "");
    }
    return reply(result.status, result.body, extra);
  } catch (error) {
    console.error(`[staff-admin] ${action} threw:`, errorName(error));
    return refusalReply(reply, refusal("server_error"));
  }
});
