// The port between the staff-admin actions and the outside world (Auth,
// the database, rate limits, audit log).
//
// Types only (no Deno APIs, no imports) so the actions can be unit tested
// with vitest/bun against a fake port. The real port is
// supabase/functions/staff-admin/port.ts: one call per method, no logic.

/** An error from Auth or the database: its code and HTTP status only. */
export interface PortError {
  code: string;
  status?: number;
}

export type PortResult<T> = { data: T; error: null } | { data: null; error: PortError };

/** The fields of an Auth login that the function reads. */
export interface LoginRecord {
  id: string;
  email: string | null;
  createdAt: string | null;
  invitedAt: string | null;
  confirmationSentAt: string | null;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  isAnonymous: boolean;
  /** Set by the server only. */
  appMetadata: Record<string, unknown>;
  /** The person can edit this; never use it to decide access. */
  userMetadata: Record<string, unknown>;
}

/** A public.app_users row (only the columns production has). */
export interface AppUserRow {
  id: string;
  full_name: string | null;
  role: string;
  admin_access: boolean;
  admin_permanent: boolean;
  created_at: string | null;
  is_active?: boolean;
}

/** Fields `updateAppUserFields` may change. admin_permanent is never written. */
export interface AppUserFieldsUpdate {
  full_name?: string;
  role?: string;
  admin_access?: boolean;
}

export interface RateLimitRequest {
  bucket: string;
  key: string;
  max: number;
  windowSeconds: number;
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfter: number }
  | { allowed: false; error: true };

export interface StaffAdminPort {
  /** data null means there is no such login (user_not_found). */
  getUserById(id: string): Promise<PortResult<LoginRecord | null>>;
  /** page starts at 1. */
  listUsersPage(page: number, perPage: number): Promise<PortResult<LoginRecord[]>>;
  /** Created with email_confirm false: no email is sent. */
  createUser(i: {
    id: string;
    email: string;
    userMetadata: Record<string, unknown>;
    appMetadata: Record<string, unknown>;
  }): Promise<PortResult<LoginRecord>>;
  deleteUser(id: string): Promise<PortResult<true>>;
  /**
   * appMetadata and userMetadata are written as given: pass the whole merged
   * object, never a partial one.
   */
  updateUserById(
    id: string,
    i: {
      banDuration?: string;
      appMetadata?: Record<string, unknown>;
      userMetadata?: Record<string, unknown>;
    },
  ): Promise<PortResult<LoginRecord>>;
  inviteUserByEmail(
    email: string,
    i: { redirectTo: string; data: Record<string, unknown> },
  ): Promise<PortResult<true>>;
  /** Uses a separate implicit-flow client, so the link works in any browser. */
  resetPasswordForEmail(email: string, i: { redirectTo: string }): Promise<PortResult<true>>;
  /** data null means there is no row. */
  selectAppUser(id: string): Promise<PortResult<AppUserRow | null>>;
  /** Rows from..to inclusive, ordered by id. */
  selectAppUsersPage(from: number, to: number): Promise<PortResult<AppUserRow[]>>;
  insertAppUser(r: Omit<AppUserRow, "created_at">): Promise<PortResult<true>>;
  /**
   * Conditional update: only when the row's role is still expectedRole.
   * updated false means the row changed (or went) in the meantime.
   */
  updateAppUserFields(
    id: string,
    expectedRole: string,
    next: AppUserFieldsUpdate,
  ): Promise<PortResult<{ updated: boolean }>>;
  /** The role-and-access form of updateAppUserFields (Disable, Reactivate). */
  updateAppUserAccess(
    id: string,
    expectedRole: string,
    next: { role: string; admin_access: boolean },
  ): Promise<PortResult<{ updated: boolean }>>;
  /** patients.auth_uid values that are not null (select("auth_uid") only). */
  selectPatientAuthUids(): Promise<PortResult<string[]>>;
  /**
   * Whether a patient record has this auth_uid (one targeted lookup, so the
   * answer never depends on a page cap).
   */
  isPatientLogin(uid: string): Promise<PortResult<boolean>>;
  /** Whether a patient record has this email (case-insensitive, exact). */
  patientEmailExists(email: string): Promise<PortResult<boolean>>;
  /** Counts one request against every limit, in order; fails closed. */
  checkLimits(limits: RateLimitRequest[]): Promise<RateLimitResult>;
  /** Salted hash, so rate-limit keys never hold an email address. */
  hashKey(v: string): Promise<string>;
  /** Best effort; never throws. Holds no email or name. */
  insertAuditLog(i: { id: string; action: string; entityId: string }): Promise<void>;
  newId(): string;
}
