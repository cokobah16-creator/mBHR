// Request checks for the staff-admin edge function.
//
// Pure functions (no Deno APIs) so they can be unit tested with vitest/bun.
//
// routeStaffAdminRequest turns a parsed JSON body into one action with
// clean values, or a refusal. It runs before sign-in is checked, so it only
// looks at the request's shape: who may do what is decided afterwards, from
// the caller's app_users row. The server never accepts a PIN: any key that
// looks like one is refused, wherever it appears in the body.

import { validEmail } from "../security/recipient.ts";
import {
  BODY_MAX_BYTES,
  EMAIL_MAX,
  NAME_MAX,
  NAME_MIN,
  PROVISIONABLE_ROLES,
  STAFF_ADMIN_ACTIONS,
} from "./constants.ts";
import { refusal, type RefusalCode } from "./errors.ts";

export type StaffAdminAction = (typeof STAFF_ADMIN_ACTIONS)[number];

export type StaffRoute =
  | { kind: "ping" }
  | { kind: "overview" }
  | { kind: "login_status"; userId: string }
  | { kind: "create"; userId: string; fullName: string; email: string; role: string }
  /** At least one of fullName and role is set. */
  | { kind: "update"; userId: string; fullName: string | null; role: string | null }
  | { kind: "resend_invitation" | "reset_password" | "disable"; userId: string }
  | { kind: "reactivate"; userId: string; role: string | null }
  | { kind: "create_login"; userId: string; email: string; confirmFullName: string }
  | {
      kind: "create_staff_record";
      userId: string;
      fullName: string;
      role: string;
      confirmEmail: string;
      acknowledged: true;
    }
  | { kind: "refused"; status: number; error: string; message: string; field?: string };

export type RefusedRoute = Extract<StaffRoute, { kind: "refused" }>;

/** The fields each action accepts, besides `action`. */
export const ACTION_FIELDS: Readonly<Record<StaffAdminAction, readonly string[]>> = {
  ping: [],
  overview: [],
  login_status: ["userId"],
  create: ["userId", "fullName", "email", "role"],
  update: ["userId", "fullName", "role"],
  resend_invitation: ["userId"],
  reset_password: ["userId"],
  disable: ["userId"],
  reactivate: ["userId", "role"],
  create_login: ["userId", "email", "confirmFullName"],
  create_staff_record: ["userId", "fullName", "role", "confirmEmail", "acknowledged"],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// C0 and C1 control characters, and the bidirectional overrides and
// isolates that can make a name display differently from what it is.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
const PIN_KEY = /pin/i;
const MAX_FIELD_ECHO = 64;

/** A uuid v4 (the id the app generates for a new staff member). */
export function isUuidV4(raw: unknown): raw is string {
  return typeof raw === "string" && UUID_V4.test(raw);
}

/** Any RFC 4122 uuid (an existing login or staff record id). */
export function isUuid(raw: unknown): raw is string {
  return typeof raw === "string" && UUID.test(raw);
}

/**
 * Trimmed, lower-case email address, or null when it is not a string, has a
 * space inside, is longer than 254 characters or does not look like one.
 */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || /\s/.test(email)) return null;
  return validEmail(email);
}

/**
 * Full name with runs of spaces collapsed to one and the ends trimmed, or
 * null when it has control characters, "<" or ">", or is not 2 to 120
 * characters long.
 */
export function normaliseFullName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (CONTROL_CHARS.test(name) || /[<>]/.test(name)) return null;
  if (name.length < NAME_MIN || name.length > NAME_MAX) return null;
  return name;
}

/** A role an administrator may give from the Users screen, or null. */
export function parseProvisionableRole(raw: unknown): string | null {
  return typeof raw === "string" && PROVISIONABLE_ROLES.includes(raw) ? raw : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAction(value: unknown): value is StaffAdminAction {
  return typeof value === "string" && (STAFF_ADMIN_ACTIONS as readonly string[]).includes(value);
}

/** Whether any key, at any depth, looks like a PIN field. */
function hasPinKey(value: unknown, depth = 0): boolean {
  if (depth > 8) return true; // far deeper than any real request: refuse
  if (Array.isArray(value)) return value.some((item) => hasPinKey(item, depth + 1));
  if (!isPlainObject(value)) return false;
  for (const [key, inner] of Object.entries(value)) {
    if (PIN_KEY.test(key)) return true;
    if (hasPinKey(inner, depth + 1)) return true;
  }
  return false;
}

function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

function refused(code: RefusalCode, field?: string): RefusedRoute {
  const r = refusal(code, field === undefined ? {} : { field });
  const route: RefusedRoute = { kind: "refused", status: r.status, error: r.error, message: r.message };
  if (r.field !== undefined) route.field = r.field;
  return route;
}

/**
 * Routes a parsed JSON body. rawBytes is the size of the body as received.
 * Checks run in this order: size, shape, PIN keys, action, unexpected
 * fields, then each field's value.
 */
export function routeStaffAdminRequest(body: unknown, rawBytes: number): StaffRoute {
  if (!(rawBytes <= BODY_MAX_BYTES)) return refused("too_large");
  if (!isPlainObject(body)) return refused("invalid_request");
  if (hasPinKey(body)) return refused("pin_not_accepted");

  const action = body.action;
  if (!isAction(action)) return refused("invalid_action");

  const accepted = ACTION_FIELDS[action];
  for (const key of Object.keys(body)) {
    if (key === "action" || accepted.includes(key)) continue;
    return refused("unexpected_field", key.slice(0, MAX_FIELD_ECHO));
  }

  if (action === "ping") return { kind: "ping" };
  if (action === "overview") return { kind: "overview" };

  // Every other action names one account. A new staff member's id is
  // generated by the app (uuid v4); any other action targets an existing id.
  const rawId = body.userId;
  const idOk = action === "create" ? isUuidV4(rawId) : isUuid(rawId);
  if (!idOk) return refused("invalid_id", "userId");
  const userId = (rawId as string).toLowerCase();

  switch (action) {
    case "login_status":
      return { kind: "login_status", userId };
    case "resend_invitation":
      return { kind: "resend_invitation", userId };
    case "reset_password":
      return { kind: "reset_password", userId };
    case "disable":
      return { kind: "disable", userId };

    case "create": {
      const fullName = normaliseFullName(body.fullName);
      if (!fullName) return refused("invalid_name", "fullName");
      const email = normaliseEmail(body.email);
      if (!email) return refused("invalid_email", "email");
      const role = parseProvisionableRole(body.role);
      if (!role) return refused("role_not_allowed", "role");
      return { kind: "create", userId, fullName, email, role };
    }

    case "update": {
      if (absent(body.fullName) && absent(body.role)) return refused("nothing_to_update");
      let fullName: string | null = null;
      if (!absent(body.fullName)) {
        fullName = normaliseFullName(body.fullName);
        if (!fullName) return refused("invalid_name", "fullName");
      }
      let role: string | null = null;
      if (!absent(body.role)) {
        role = parseProvisionableRole(body.role);
        if (!role) return refused("role_not_allowed", "role");
      }
      return { kind: "update", userId, fullName, role };
    }

    case "reactivate": {
      if (absent(body.role)) return { kind: "reactivate", userId, role: null };
      const role = parseProvisionableRole(body.role);
      if (!role) return refused("role_not_allowed", "role");
      return { kind: "reactivate", userId, role };
    }

    case "create_login": {
      const email = normaliseEmail(body.email);
      if (!email) return refused("invalid_email", "email");
      const confirmFullName = normaliseFullName(body.confirmFullName);
      if (!confirmFullName) return refused("invalid_name", "confirmFullName");
      return { kind: "create_login", userId, email, confirmFullName };
    }

    case "create_staff_record": {
      const fullName = normaliseFullName(body.fullName);
      if (!fullName) return refused("invalid_name", "fullName");
      // A staff record made for an existing login never grants admin.
      const role = parseProvisionableRole(body.role);
      if (!role || role === "admin") return refused("role_not_allowed", "role");
      const confirmEmail = normaliseEmail(body.confirmEmail);
      if (!confirmEmail) return refused("invalid_email", "confirmEmail");
      if (body.acknowledged !== true) return refused("acknowledgement_required", "acknowledged");
      return {
        kind: "create_staff_record",
        userId,
        fullName,
        role,
        confirmEmail,
        acknowledged: true,
      };
    }
  }
  return refused("invalid_action");
}
