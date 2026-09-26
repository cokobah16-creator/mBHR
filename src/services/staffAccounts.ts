/**
 * Staff account setup through the staff-admin server function (Users
 * screen, server mode).
 *
 * Every call goes to supabase.functions.invoke("staff-admin") with the
 * signed-in administrator's own access token in an explicit Authorization
 * header. Before calling, it checks that this device has a server, is
 * online, and holds this staff member's own online sign-in (never after a
 * PIN unlock alone).
 *
 * There is never a fallback: nothing here signs anyone up or writes staff
 * records directly. Request bodies are built from a fixed list of keys per
 * action, so no PIN (or anything else) can ever be sent.
 *
 * Logs name the action and failure kind only: never an email, a name or an
 * id.
 */
import { supabase } from "@/lib/supabase";
import { isSignedInStaffAccount } from "@/lib/cloudSession";
import { edgeFunctionJsonBody, edgeFunctionStatus } from "@/services/edgeFunctionErrors";
import { STAFF_COPY } from "@/features/admin/staffAccountView";
import type {
  AccountResponse,
  CreateResponse,
  CreateStaffRecordResponse,
  DisableResponse,
  InvitationResponse,
  OverviewResponse,
  PingResponse,
  ReactivateResponse,
} from "../../supabase/functions/_shared/staff/types";

export type {
  AccountResponse,
  AccountStatus,
  AccountView,
  CreateResponse,
  CreateStaffRecordResponse,
  DisableResponse,
  HealthItem,
  HealthKind,
  HealthReport,
  InvitationResponse,
  InvitationResult,
  OverviewResponse,
  PingResponse,
  ReactivateResponse,
  StatusDetail,
} from "../../supabase/functions/_shared/staff/types";

/** The function's name, echoed as `fn` in every reply it sends. */
export const STAFF_ADMIN_FUNCTION = "staff-admin";

/** How long to wait for a reply before treating the server as unreachable. */
export const STAFF_ADMIN_TIMEOUT_MS = 30_000;

export type StaffAdminFailure =
  /** This device has no server set up. */
  | "no_server"
  | "offline"
  | "not_signed_in"
  | "not_permitted"
  /** The function is not on the server (404 or a reply without `fn`). */
  | "not_deployed"
  | "not_configured"
  /** No reply at all (network error or timeout). */
  | "unreachable"
  | "rate_limited"
  /** The function refused the request; `message` says why. */
  | "refused"
  | "server_error";

/** A call that did not succeed. */
export interface StaffAdminError {
  ok: false;
  failure: StaffAdminFailure;
  /** The function's error code (for example "own_account"), when it sent one. */
  code: string | null;
  /** Plain English for the administrator. */
  message: string;
  retryAfterSeconds?: number;
  body: Record<string, unknown> | null;
}

export type StaffAdminResult<T> = { ok: true; data: T } | StaffAdminError;

type Body = Record<string, unknown>;

function isOurs(body: Body | null | undefined): boolean {
  return !!body && body.fn === STAFF_ADMIN_FUNCTION;
}

/**
 * What kind of failure a reply is, or null when it is a success from the
 * function. `status` is null when there was no reply; `success` is whether
 * invoke() reported a 2xx reply.
 */
export function classifyStaffAdminReply(
  status: number | null,
  body: Body | null,
  success: boolean,
): StaffAdminFailure | null {
  const ours = isOurs(body);
  if (success) {
    if (!ours) return "not_deployed";
    return body?.success === false ? "refused" : null;
  }
  if (status === null) return "unreachable";
  if (status === 404 && !ours) return "not_deployed";
  if (status === 401) return "not_signed_in";
  if (status === 403) return "not_permitted";
  if (status === 429) return "rate_limited";
  if (status === 503 && ours && body?.error === "not_configured") return "not_configured";
  if (ours && status < 500) return "refused";
  return "server_error";
}

/** Plain English for a failure, using the function's own message when it sent one. */
export function staffAdminFailureMessage(
  failure: StaffAdminFailure,
  body?: Body | null,
): string {
  const own =
    isOurs(body) && typeof body?.message === "string" && body.message.trim() !== ""
      ? body.message
      : null;
  switch (failure) {
    case "no_server":
      return STAFF_COPY.state.no_server;
    case "offline":
      return STAFF_COPY.state.offline;
    case "not_signed_in":
      return STAFF_COPY.state.not_signed_in;
    case "not_permitted":
      return own ?? STAFF_COPY.state.not_permitted;
    case "not_deployed":
      return STAFF_COPY.state.not_deployed;
    case "not_configured":
      return STAFF_COPY.state.not_configured;
    case "unreachable":
      return STAFF_COPY.state.unreachable;
    case "rate_limited":
      return own ?? STAFF_COPY.failure.rate_limited;
    case "refused":
      return own ?? STAFF_COPY.failure.refused;
    case "server_error":
      return own ?? STAFF_COPY.failure.server_error;
  }
  return STAFF_COPY.failure.server_error;
}

/** A new staff member's id (uuid v4), generated once per Add Staff form. */
export function newStaffId(): string {
  return crypto.randomUUID();
}

/**
 * Whether the server's sign-in service answers at all, to tell "the staff
 * function is missing" from "the server can't be reached". Any HTTP reply
 * counts. Never throws.
 */
export async function probeAuthHealth(): Promise<boolean> {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (!url || typeof fetch !== "function") return false;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 10_000) : null;
  try {
    const headers: Record<string, string> = {};
    if (key) headers.apikey = key;
    await fetch(`${url.replace(/\/+$/, "")}/auth/v1/health`, {
      method: "GET",
      headers,
      signal: controller?.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function failed(failure: StaffAdminFailure, body: Body | null = null): StaffAdminError {
  const result: StaffAdminError = {
    ok: false,
    failure,
    code: body && typeof body.error === "string" ? body.error : null,
    message: staffAdminFailureMessage(failure, body),
    body,
  };
  const retry = body?.retry_after_seconds;
  if (typeof retry === "number" && Number.isFinite(retry) && retry > 0) {
    result.retryAfterSeconds = retry;
  }
  return result;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** The fields each action may send, besides `action`. */
const ACTION_KEYS = {
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
} as const satisfies Record<string, readonly string[]>;

export type StaffAdminAction = keyof typeof ACTION_KEYS;

/** The request body: `action` plus only this action's own keys that are set. */
export function staffAdminRequestBody(
  action: StaffAdminAction,
  fields: Record<string, unknown> = {},
): Body {
  const body: Body = { action };
  for (const key of ACTION_KEYS[action] as readonly string[]) {
    const value = fields[key];
    if (value !== undefined && value !== null) body[key] = value;
  }
  return body;
}

type Invoked = { data: unknown; error: unknown };

const TIMED_OUT = Symbol("timed out");

async function withTimeout(promise: Promise<Invoked>): Promise<Invoked | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), STAFF_ADMIN_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callStaffAdmin<T>(
  action: StaffAdminAction,
  fields: Record<string, unknown> = {},
  opts: { needsSignIn: boolean } = { needsSignIn: true },
): Promise<StaffAdminResult<T>> {
  const client = supabase;
  if (!client) return failed("no_server");
  if (isOffline()) return failed("offline");

  const headers: Record<string, string> = {};
  if (opts.needsSignIn) {
    let token: string | null = null;
    try {
      const { data } = await client.auth.getSession();
      const session = data?.session ?? null;
      if (session && isSignedInStaffAccount(session.user?.id)) {
        token = session.access_token || null;
      }
    } catch (error) {
      console.warn(
        `[staff-admin] ${action}: could not read the online sign-in`,
        error instanceof Error ? error.name : typeof error,
      );
    }
    if (!token) return failed("not_signed_in");
    headers.Authorization = `Bearer ${token}`;
  }

  let reply: Invoked | typeof TIMED_OUT;
  try {
    reply = await withTimeout(
      client.functions.invoke(STAFF_ADMIN_FUNCTION, {
        body: staffAdminRequestBody(action, fields),
        headers,
      }) as Promise<Invoked>,
    );
  } catch (error) {
    console.warn(
      `[staff-admin] ${action}: request failed`,
      error instanceof Error ? error.name : typeof error,
    );
    return failed("unreachable");
  }
  if (reply === TIMED_OUT) {
    console.warn(`[staff-admin] ${action}: no reply in time`);
    return failed("unreachable");
  }

  if (!reply.error) {
    const data =
      reply.data && typeof reply.data === "object" && !Array.isArray(reply.data)
        ? (reply.data as Body)
        : null;
    const failure = classifyStaffAdminReply(200, data, true);
    if (failure) {
      console.warn(`[staff-admin] ${action}: ${failure}`);
      return failed(failure, data);
    }
    return { ok: true, data: data as unknown as T };
  }

  const status = edgeFunctionStatus(reply.error);
  const body = status === null ? null : await edgeFunctionJsonBody(reply.error);
  const failure = classifyStaffAdminReply(status, body, false) ?? "server_error";
  const code = body && typeof body.error === "string" ? body.error : "none";
  console.warn(`[staff-admin] ${action}: ${failure} (HTTP ${status ?? "none"}, ${code})`);
  return failed(failure, body);
}

/** Whether the function is on the server (no sign-in needed). */
export function pingStaffAdmin(): Promise<StaffAdminResult<PingResponse>> {
  return callStaffAdmin<PingResponse>("ping", {}, { needsSignIn: false });
}

/** Every staff account, Account Health and the roles Add Staff may give. */
export function getStaffOverview(): Promise<StaffAdminResult<OverviewResponse>> {
  return callStaffAdmin<OverviewResponse>("overview");
}

/** One account's login details, read fresh. */
export function getLoginStatus(userId: string): Promise<StaffAdminResult<AccountResponse>> {
  return callStaffAdmin<AccountResponse>("login_status", { userId });
}

/**
 * Add Staff: a login and a staff record, then the invitation email. After a
 * timeout, call again with the same userId: the server resumes rather than
 * creating a duplicate.
 */
export function createStaffAccount(input: {
  userId: string;
  fullName: string;
  email: string;
  role: string;
}): Promise<StaffAdminResult<CreateResponse>> {
  return callStaffAdmin<CreateResponse>("create", {
    userId: input.userId,
    fullName: input.fullName,
    email: input.email,
    role: input.role,
  });
}

/** Changes a name, a role or both. Leave out what is not changing. */
export function updateStaffAccount(
  userId: string,
  changes: { fullName?: string | null; role?: string | null },
): Promise<StaffAdminResult<AccountResponse>> {
  return callStaffAdmin<AccountResponse>("update", {
    userId,
    fullName: changes.fullName,
    role: changes.role,
  });
}

/** Sends the invitation again (or a password link if it was already opened). */
export function resendInvitation(userId: string): Promise<StaffAdminResult<InvitationResponse>> {
  return callStaffAdmin<InvitationResponse>("resend_invitation", { userId });
}

/** Emails a link to set a new password. */
export function sendPasswordReset(userId: string): Promise<StaffAdminResult<InvitationResponse>> {
  return callStaffAdmin<InvitationResponse>("reset_password", { userId });
}

/** Blocks online sign-in and takes away the staff role (kept for Reactivate). */
export function disableStaffAccount(userId: string): Promise<StaffAdminResult<DisableResponse>> {
  return callStaffAdmin<DisableResponse>("disable", { userId });
}

/**
 * Restores a disabled account. Pass a role when the server replied
 * `role_needed` (it had no earlier role to restore).
 */
export function reactivateStaffAccount(
  userId: string,
  role?: string | null,
): Promise<StaffAdminResult<ReactivateResponse>> {
  return callStaffAdmin<ReactivateResponse>("reactivate", { userId, role });
}

/** Account Health repair: a login for a staff record that has none. */
export function createLoginForStaffRecord(input: {
  userId: string;
  email: string;
  confirmFullName: string;
}): Promise<StaffAdminResult<CreateResponse>> {
  return callStaffAdmin<CreateResponse>("create_login", {
    userId: input.userId,
    email: input.email,
    confirmFullName: input.confirmFullName,
  });
}

/** Account Health repair: a staff record (never administrator) for a login. */
export function createStaffRecordForLogin(input: {
  userId: string;
  fullName: string;
  role: string;
  confirmEmail: string;
  acknowledged: boolean;
}): Promise<StaffAdminResult<CreateStaffRecordResponse>> {
  return callStaffAdmin<CreateStaffRecordResponse>("create_staff_record", {
    userId: input.userId,
    fullName: input.fullName,
    role: input.role,
    confirmEmail: input.confirmEmail,
    // Only a real tick counts; the server refuses anything else.
    acknowledged: input.acknowledged === true,
  });
}
