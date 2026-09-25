// The real StaffAdminPort for the staff-admin function (Deno).
//
// One Auth or database call per method, with no decisions: every rule lives
// in ../_shared/staff/actions.ts, which is unit tested against a fake port.
// Each method returns errors as values (code and HTTP status only) and never
// throws. Nothing here logs an email address, a name, a link or an id.

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2";
import { checkSmsLimits, hashKey } from "../_shared/security/smsRateLimit.ts";
import { classifyAuthError } from "../_shared/staff/errors.ts";
import { pageAll, pageRange } from "../_shared/staff/paging.ts";
import { APP_USERS_PAGE_SIZE, LIST_USERS_MAX_PAGES } from "../_shared/staff/constants.ts";
import type {
  AppUserFieldsUpdate,
  AppUserRow,
  LoginRecord,
  PortError,
  PortResult,
  RateLimitRequest,
  RateLimitResult,
  StaffAdminPort,
} from "../_shared/staff/portTypes.ts";

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * An Auth or PostgREST error as a PortError. A missing code stays "" so the
 * HTTP status can still be read (classifyAuthError).
 */
function toPortError(error: unknown, status?: number): PortError {
  const e = isRecord(error) ? error : {};
  const code = typeof e.code === "string" ? e.code : "";
  const errorStatus = typeof e.status === "number" ? e.status : status;
  return typeof errorStatus === "number" && errorStatus > 0
    ? { code, status: errorStatus }
    : { code };
}

function ok<T>(data: T): PortResult<T> {
  return { data, error: null };
}

/** A failed result; it fits every PortResult<T>. */
type Failed = { data: null; error: PortError };

function failed(error: PortError): Failed {
  return { data: null, error };
}

/** A call that threw (network failure, bad reply): never "not found". */
function thrown(where: string, error: unknown): Failed {
  console.error(`[staff-admin] ${where} failed:`, errorName(error));
  return failed({ code: "exception" });
}

/**
 * The fields of an Auth user that the function reads. banned_until is read
 * from the raw object because the client's User type leaves it out (as in
 * ../_shared/security/staffAuth.ts).
 */
function toLoginRecord(user: unknown): LoginRecord | null {
  if (!isRecord(user) || typeof user.id !== "string" || user.id === "") return null;
  return {
    id: user.id,
    email: text(user.email),
    createdAt: text(user.created_at),
    invitedAt: text(user.invited_at),
    confirmationSentAt: text(user.confirmation_sent_at),
    emailConfirmedAt: text(user.email_confirmed_at),
    lastSignInAt: text(user.last_sign_in_at),
    bannedUntil: text(user.banned_until),
    isAnonymous: user.is_anonymous === true,
    appMetadata: isRecord(user.app_metadata) ? { ...user.app_metadata } : {},
    userMetadata: isRecord(user.user_metadata) ? { ...user.user_metadata } : {},
  };
}

function toLoginRecords(users: unknown): LoginRecord[] {
  if (!Array.isArray(users)) return [];
  const records: LoginRecord[] = [];
  for (const user of users) {
    const record = toLoginRecord(user);
    if (record) records.push(record);
  }
  return records;
}

/** An app_users row, read with select("*") so missing columns do no harm. */
function toAppUserRow(row: unknown): AppUserRow | null {
  if (!isRecord(row) || typeof row.id !== "string" || row.id === "") return null;
  const result: AppUserRow = {
    id: row.id,
    full_name: typeof row.full_name === "string" ? row.full_name : null,
    role: typeof row.role === "string" ? row.role : "",
    admin_access: row.admin_access === true,
    admin_permanent: row.admin_permanent === true,
    created_at: text(row.created_at),
  };
  if (typeof row.is_active === "boolean") result.is_active = row.is_active;
  return result;
}

/** The only columns an update may write. admin_permanent never is. */
function fieldsPatch(next: AppUserFieldsUpdate): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (typeof next.full_name === "string") patch.full_name = next.full_name;
  if (typeof next.role === "string") patch.role = next.role;
  if (typeof next.admin_access === "boolean") patch.admin_access = next.admin_access;
  return patch;
}

/** An exact, case-insensitive ilike pattern: %, _ and \ match themselves. */
function exactIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * A client for resetPasswordForEmail only. It uses the implicit flow, so the
 * reset link carries its tokens in the URL and works in any browser (a PKCE
 * link would need a code verifier stored here).
 */
function implicitFlowClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  }
  return createClient(url, serviceKey, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** The port over a service-role client (getServiceClient in staffAuth.ts). */
export function createStaffAdminPort(service: SupabaseClient): StaffAdminPort {
  let recoveryClient: SupabaseClient | null = null;

  const port: StaffAdminPort = {
    async getUserById(id: string): Promise<PortResult<LoginRecord | null>> {
      try {
        const { data, error } = await service.auth.admin.getUserById(id);
        if (error) {
          const portError = toPortError(error);
          // Only a clear "no such user" is null; anything else is an error.
          return classifyAuthError(portError) === "not_found" ? ok(null) : failed(portError);
        }
        const record = toLoginRecord(data?.user);
        return record ? ok(record) : failed({ code: "no_user_returned" });
      } catch (error) {
        return thrown("getUserById", error);
      }
    },

    async listUsersPage(page: number, perPage: number): Promise<PortResult<LoginRecord[]>> {
      try {
        const { data, error } = await service.auth.admin.listUsers({ page, perPage });
        if (error) return failed(toPortError(error));
        return ok(toLoginRecords((data as { users?: unknown } | null)?.users));
      } catch (error) {
        return thrown("listUsers", error);
      }
    },

    async createUser(i): Promise<PortResult<LoginRecord>> {
      try {
        const { data, error } = await service.auth.admin.createUser({
          id: i.id,
          email: i.email,
          email_confirm: false,
          user_metadata: i.userMetadata,
          app_metadata: i.appMetadata,
        });
        if (error) return failed(toPortError(error));
        const record = toLoginRecord(data?.user);
        return record ? ok(record) : failed({ code: "no_user_returned" });
      } catch (error) {
        return thrown("createUser", error);
      }
    },

    async deleteUser(id: string): Promise<PortResult<true>> {
      try {
        const { error } = await service.auth.admin.deleteUser(id);
        return error ? failed(toPortError(error)) : ok(true as const);
      } catch (error) {
        return thrown("deleteUser", error);
      }
    },

    async updateUserById(id, i): Promise<PortResult<LoginRecord>> {
      const attributes: {
        ban_duration?: string;
        app_metadata?: Record<string, unknown>;
        user_metadata?: Record<string, unknown>;
      } = {};
      if (i.banDuration !== undefined) attributes.ban_duration = i.banDuration;
      if (i.appMetadata !== undefined) attributes.app_metadata = i.appMetadata;
      if (i.userMetadata !== undefined) attributes.user_metadata = i.userMetadata;
      try {
        const { data, error } = await service.auth.admin.updateUserById(id, attributes);
        if (error) return failed(toPortError(error));
        const record = toLoginRecord(data?.user);
        return record ? ok(record) : failed({ code: "no_user_returned" });
      } catch (error) {
        return thrown("updateUserById", error);
      }
    },

    async inviteUserByEmail(email, i): Promise<PortResult<true>> {
      try {
        const { error } = await service.auth.admin.inviteUserByEmail(email, {
          redirectTo: i.redirectTo,
          data: i.data,
        });
        return error ? failed(toPortError(error)) : ok(true as const);
      } catch (error) {
        return thrown("inviteUserByEmail", error);
      }
    },

    async resetPasswordForEmail(email, i): Promise<PortResult<true>> {
      try {
        recoveryClient ??= implicitFlowClient();
        const { error } = await recoveryClient.auth.resetPasswordForEmail(email, {
          redirectTo: i.redirectTo,
        });
        return error ? failed(toPortError(error)) : ok(true as const);
      } catch (error) {
        return thrown("resetPasswordForEmail", error);
      }
    },

    async selectAppUser(id: string): Promise<PortResult<AppUserRow | null>> {
      try {
        const { data, error, status } = await service
          .from("app_users")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error) return failed(toPortError(error, status));
        return ok(data ? toAppUserRow(data) : null);
      } catch (error) {
        return thrown("selectAppUser", error);
      }
    },

    async selectAppUsersPage(from: number, to: number): Promise<PortResult<AppUserRow[]>> {
      try {
        const { data, error, status } = await service
          .from("app_users")
          .select("*")
          .order("id", { ascending: true })
          .range(from, to);
        if (error) return failed(toPortError(error, status));
        const rows: AppUserRow[] = [];
        for (const raw of Array.isArray(data) ? data : []) {
          const row = toAppUserRow(raw);
          if (row) rows.push(row);
        }
        return ok(rows);
      } catch (error) {
        return thrown("selectAppUsersPage", error);
      }
    },

    // INSERT ... ON CONFLICT (id) DO NOTHING: an existing row is never
    // overwritten. No row back means the id was taken, reported as the
    // unique-violation code so it maps to staff_exists. admin_permanent is
    // never written (the column's default applies), nor is is_active.
    async insertAppUser(r): Promise<PortResult<true>> {
      try {
        const { data, error, status } = await service
          .from("app_users")
          .upsert(
            { id: r.id, full_name: r.full_name, role: r.role, admin_access: r.admin_access },
            { onConflict: "id", ignoreDuplicates: true },
          )
          .select("id");
        if (error) return failed(toPortError(error, status));
        if (!Array.isArray(data) || data.length === 0) {
          return failed({ code: "23505", status: 409 });
        }
        return ok(true as const);
      } catch (error) {
        return thrown("insertAppUser", error);
      }
    },

    async updateAppUserFields(id, expectedRole, next): Promise<PortResult<{ updated: boolean }>> {
      const patch = fieldsPatch(next);
      try {
        if (Object.keys(patch).length === 0) {
          // Nothing to write: report whether the row still matches.
          const { data, error, status } = await service
            .from("app_users")
            .select("id")
            .eq("id", id)
            .eq("role", expectedRole)
            .maybeSingle();
          if (error) return failed(toPortError(error, status));
          return ok({ updated: data !== null });
        }
        let query = service
          .from("app_users")
          .update(patch)
          .eq("id", id)
          .eq("role", expectedRole);
        // A role or admin change never touches a permanent administrator
        // (production's trigger would refuse it anyway): 0 rows, not an error.
        if ("role" in patch || "admin_access" in patch) {
          query = query.eq("admin_permanent", false);
        }
        const { data, error, status } = await query.select("id");
        if (error) return failed(toPortError(error, status));
        return ok({ updated: Array.isArray(data) && data.length > 0 });
      } catch (error) {
        return thrown("updateAppUserFields", error);
      }
    },

    updateAppUserAccess(id, expectedRole, next): Promise<PortResult<{ updated: boolean }>> {
      return port.updateAppUserFields(id, expectedRole, {
        role: next.role,
        admin_access: next.admin_access,
      });
    },

    // Only logins linked to a patient record have auth_uid set, so this is
    // a short list; it is still read in pages so no link is missed.
    async selectPatientAuthUids(): Promise<PortResult<string[]>> {
      try {
        const paged = await pageAll<string>(
          async (page) => {
            const { from, to } = pageRange(page, APP_USERS_PAGE_SIZE);
            const { data, error, status } = await service
              .from("patients")
              .select("auth_uid")
              .not("auth_uid", "is", null)
              .order("auth_uid", { ascending: true })
              .range(from, to);
            if (error) return { items: [], error: toPortError(error, status) };
            // One item per row read (unusable values as ""), so a full page
            // is never mistaken for the last one; "" is dropped below.
            const items = (Array.isArray(data) ? data : []).map((row) => {
              const uid = isRecord(row) ? row.auth_uid : null;
              return typeof uid === "string" ? uid : "";
            });
            return { items, error: null };
          },
          APP_USERS_PAGE_SIZE,
          LIST_USERS_MAX_PAGES,
        );
        if (paged.error) return failed(paged.error);
        return ok(paged.items.filter((uid) => uid !== ""));
      } catch (error) {
        return thrown("selectPatientAuthUids", error);
      }
    },

    async isPatientLogin(uid: string): Promise<PortResult<boolean>> {
      try {
        const { data, error, status } = await service
          .from("patients")
          .select("id")
          .eq("auth_uid", uid)
          .limit(1);
        if (error) return failed(toPortError(error, status));
        return ok(Array.isArray(data) && data.length > 0);
      } catch (error) {
        return thrown("isPatientLogin", error);
      }
    },

    async patientEmailExists(email: string): Promise<PortResult<boolean>> {
      try {
        const { data, error, status } = await service
          .from("patients")
          .select("id")
          .ilike("email", exactIlike(email))
          .limit(1);
        if (error) return failed(toPortError(error, status));
        return ok(Array.isArray(data) && data.length > 0);
      } catch (error) {
        return thrown("patientEmailExists", error);
      }
    },

    async checkLimits(limits: RateLimitRequest[]): Promise<RateLimitResult> {
      const result = await checkSmsLimits(service, limits);
      if (result.allowed) return { allowed: true };
      if ("error" in result) return { allowed: false, error: true };
      return { allowed: false, retryAfter: result.retryAfter };
    },

    hashKey(value: string): Promise<string> {
      return hashKey(value);
    },

    // public.audit_logs (id, actor_role, action, entity, entity_id, at). The
    // table has no actor id column; who acted is on the login's app_metadata.
    async insertAuditLog(i): Promise<void> {
      try {
        const { error } = await service.from("audit_logs").insert({
          id: i.id,
          actor_role: "admin",
          action: i.action,
          entity: "app_users",
          entity_id: i.entityId,
          at: new Date().toISOString(),
        });
        if (error) console.error("[staff-admin] audit log not written:", error.code ?? "error");
      } catch (error) {
        console.error("[staff-admin] audit log not written:", errorName(error));
      }
    },

    newId(): string {
      return crypto.randomUUID();
    },
  };

  return port;
}
