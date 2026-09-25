// What each staff-admin action does, step by step.
//
// Pure orchestration over a StaffAdminPort (no Deno APIs, no imports from
// outside _shared) so every rule, rollback and retry can be unit tested
// with vitest/bun against a fake port. The real port is
// supabase/functions/staff-admin/port.ts.
//
// Before this runs, index.ts has checked the request's shape
// (routeStaffAdminRequest), that the caller is a signed-in administrator
// and the per-caller action limit. Refusals checked here come from
// staffActionRefusal (guards.ts) and are made before anything is written.
//
// Nothing here logs. Replies and audit rows never hold an email address, a
// name or a link, and no PIN ever reaches the port.

import {
  ADMIN_ACCOUNTS_ENABLED,
  APP_META,
  APP_USERS_PAGE_SIZE,
  BAN_DURATION,
  DEFAULT_STAFF_APP_ORIGIN,
  DISABLE_DEMOTES_ROLE,
  DISABLED_ROLE,
  LIST_USERS_MAX_PAGES,
  LIST_USERS_PER_PAGE,
  MAX_ADMIN_ROWS_CHECKED,
  PROVISIONABLE_ROLES,
  RESEND_MIN_GAP_SECONDS,
  RESUME_WINDOW_SECONDS,
  STAFF_ACCOUNT_TAG,
  STAFF_ADMIN_VERSION,
  STAFF_EMAIL_ACTOR_BUCKET,
  STAFF_EMAIL_ACTOR_LIMIT,
  STAFF_EMAIL_RECIPIENT_BUCKET,
  STAFF_EMAIL_RECIPIENT_LIMIT,
  STAFF_OVERVIEW_BUCKET,
  STAFF_OVERVIEW_LIMIT,
  UNBAN,
} from "./constants.ts";
import {
  classifyAuthError,
  invitationError,
  rateLimitedRefusal,
  refusal,
  refusalBody,
  staffRowRefusal,
  type Refusal,
} from "./errors.ts";
import {
  countOtherActiveAdmins,
  reactivateNeedsPatientChecks,
  staffActionRefusal,
  type GuardInput,
} from "./guards.ts";
import { accountHealth } from "./health.ts";
import { pageAll, pageRange } from "./paging.ts";
import {
  accountStatus,
  accountView,
  isLoginBanned,
  isStaffRole,
  isStaffTagged,
  lastInvitationSentAt,
  staffNameMap,
} from "./status.ts";
import type {
  AppUserFieldsUpdate,
  AppUserRow,
  LoginRecord,
  RateLimitRequest,
  StaffAdminPort,
} from "./portTypes.ts";
import type { AccountView, InvitationResult, OverviewResponse } from "./types.ts";
import { normaliseFullName, type StaffRoute } from "./validate.ts";

/** What every action needs to know besides the request. */
export interface ActionContext {
  /** The signed-in administrator (from requireStaff). */
  actorId: string;
  now: Date;
  /** Where invitation and reset links point (configuredOrigin). */
  appOrigin: string;
  inviteLifetimeSec: number;
  /** STAFF_ADMIN_LAUNCHED_AT, for Account Health. */
  launchedAt: Date | null;
}

/** HTTP status and JSON body (index.ts adds `fn`). */
export interface ActionResult {
  status: number;
  body: Record<string, unknown>;
}

type Meta = Record<string, unknown>;
type RouteOf<K extends StaffRoute["kind"]> = Extract<StaffRoute, { kind: K }>;

const ADMIN_ROLE = "admin";
const STAFF_READ_FAILED = "The staff records couldn't be read. Try again.";
const NO_EMAIL_ON_LOGIN = "Their login has no email address.";

/** Ends an action early with a reply; caught in runStaffAdminAction. */
class Halt {
  readonly result: ActionResult;
  constructor(result: ActionResult) {
    this.result = result;
  }
}

function done(status: number, body: Record<string, unknown>): ActionResult {
  return { status, body: { ...body, success: true } };
}

function refused(r: Refusal, extra: Record<string, unknown> = {}): ActionResult {
  return { status: r.status, body: { ...refusalBody(r), ...extra } };
}

function halt(r: Refusal, extra: Record<string, unknown> = {}): Halt {
  return new Halt(refused(r, extra));
}

function staffReadFailed(): Refusal {
  return refusal("staff_record_error", { message: STAFF_READ_FAILED });
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isTime(value: unknown): boolean {
  const s = text(value);
  return s !== null && !Number.isNaN(Date.parse(s));
}

function knownStaffRole(value: unknown): string | null {
  return isStaffRole(value) ? (value as string) : null;
}

// ---------------------------------------------------------------------------
// Helpers other modules use

/**
 * current with patch laid over it. A key set to null in patch is cleared
 * (kept as null, which every reader treats as absent); a key set to
 * undefined is left as it was. Auth is always sent the whole merged object,
 * so the result is right whether it merges or replaces app_metadata.
 */
export function mergeAppMetadata(current: Meta | null | undefined, patch: Meta): Meta {
  const merged: Meta = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/** Where an invitation or a reset link sends the person. */
export function redirectFor(kind: "invite" | "recovery", appOrigin: string): string {
  const base = `${appOrigin}/reset-password?for=staff`;
  return kind === "invite" ? `${base}&link=invite` : base;
}

/**
 * STAFF_APP_ORIGIN when it is a plain https origin (no path, query, hash or
 * credentials), else https://mbhr.app. Never taken from request headers.
 */
export function configuredOrigin(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_STAFF_APP_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return DEFAULT_STAFF_APP_ORIGIN;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    return DEFAULT_STAFF_APP_ORIGIN;
  }
  return url.origin;
}

// ---------------------------------------------------------------------------
// Reads

async function readRow(port: StaffAdminPort, id: string): Promise<AppUserRow | null> {
  const res = await port.selectAppUser(id);
  if (res.error) throw halt(staffReadFailed());
  return res.data;
}

/** null means there is no login; any other failure stops the request. */
async function readLogin(port: StaffAdminPort, id: string): Promise<LoginRecord | null> {
  const res = await port.getUserById(id);
  if (res.error) throw halt(refusal("login_service_error"));
  return res.data;
}

/**
 * Whether the caller's own row is a permanent administrator. Read only for
 * a request that would make or restore an administrator, and only while
 * ADMIN_ACCOUNTS_ENABLED is on (otherwise the guard refuses it anyway).
 */
async function actorIsPermanent(port: StaffAdminPort, ctx: ActionContext): Promise<boolean> {
  if (!ADMIN_ACCOUNTS_ENABLED) return false;
  const res = await port.selectAppUser(ctx.actorId);
  if (res.error) throw halt(refusal("staff_lookup_failed"));
  return res.data?.admin_permanent === true;
}

async function readAllRows(
  port: StaffAdminPort,
): Promise<{ rows: AppUserRow[]; truncated: boolean } | null> {
  const paged = await pageAll<AppUserRow>(
    async (page) => {
      const { from, to } = pageRange(page, APP_USERS_PAGE_SIZE);
      const res = await port.selectAppUsersPage(from, to);
      return res.error ? { items: [], error: res.error } : { items: res.data, error: null };
    },
    APP_USERS_PAGE_SIZE,
    LIST_USERS_MAX_PAGES,
  );
  return paged.error ? null : { rows: paged.items, truncated: paged.truncated };
}

async function readAllLogins(
  port: StaffAdminPort,
): Promise<{ logins: LoginRecord[]; truncated: boolean } | null> {
  const paged = await pageAll<LoginRecord>(
    async (page) => {
      const res = await port.listUsersPage(page, LIST_USERS_PER_PAGE);
      return res.error ? { items: [], error: res.error } : { items: res.data, error: null };
    },
    LIST_USERS_PER_PAGE,
    LIST_USERS_MAX_PAGES,
  );
  return paged.error ? null : { logins: paged.items, truncated: paged.truncated };
}

/**
 * How many administrators other than targetId can still act (A9). Each
 * admin's login is read on its own, so the count never depends on the
 * login list's page cap. A login that cannot be read does not count.
 * null when the staff records cannot be read.
 */
async function otherActiveAdmins(
  port: StaffAdminPort,
  targetId: string,
  now: Date,
): Promise<number | null> {
  const all = await readAllRows(port);
  if (!all) return null;
  const admins = all.rows
    .filter((row) => row.role === ADMIN_ROLE && row.id !== targetId)
    .slice(0, MAX_ADMIN_ROWS_CHECKED);
  const pairs = await Promise.all(
    admins.map(async (row) => {
      const res = await port.getUserById(row.id);
      return { row, login: res.error ? null : res.data };
    }),
  );
  return countOtherActiveAdmins(pairs, targetId, now);
}

async function mustCountOtherAdmins(
  port: StaffAdminPort,
  targetId: string,
  now: Date,
): Promise<number> {
  const count = await otherActiveAdmins(port, targetId, now);
  if (count === null) throw halt(staffReadFailed());
  return count;
}

/** Staff names for "created by" and "disabled by" on one login. */
async function namesFor(
  port: StaffAdminPort,
  login: LoginRecord | null,
): Promise<Map<string, string>> {
  const meta = login?.appMetadata ?? {};
  const ids = new Set<string>();
  for (const key of [APP_META.createdBy, APP_META.repairBy, APP_META.disabledBy]) {
    const id = text(meta[key]);
    if (id !== null) ids.add(id);
  }
  const rows: AppUserRow[] = [];
  for (const id of ids) {
    const res = await port.selectAppUser(id);
    if (!res.error && res.data) rows.push(res.data);
  }
  return staffNameMap(rows);
}

async function viewOf(
  port: StaffAdminPort,
  ctx: ActionContext,
  userId: string,
  row: AppUserRow | null,
  login: LoginRecord | null,
): Promise<AccountView> {
  // Display only, as in overview: a failed lookup just leaves the note off.
  const linked = await port.isPatientLogin(userId);
  const patientUids = !linked.error && linked.data === true ? new Set([userId]) : undefined;
  return accountView({
    userId,
    row,
    login,
    now: ctx.now,
    inviteLifetimeSec: ctx.inviteLifetimeSec,
    names: await namesFor(port, login),
    patientUids,
  });
}

// ---------------------------------------------------------------------------
// Checks and writes shared by several actions

function check(input: GuardInput): void {
  const r = staffActionRefusal(input);
  if (r) throw halt(r);
}

async function limit(port: StaffAdminPort, limits: RateLimitRequest[]): Promise<void> {
  const res = await port.checkLimits(limits);
  if (res.allowed) return;
  throw halt("error" in res ? refusal("rate_limit_unavailable") : rateLimitedRefusal(res.retryAfter));
}

/** The two email limits: per caller, and per recipient (hashed). */
async function emailLimits(port: StaffAdminPort, ctx: ActionContext, email: string): Promise<void> {
  let recipientKey: string;
  try {
    recipientKey = await port.hashKey(email);
  } catch {
    throw halt(refusal("rate_limit_unavailable"));
  }
  await limit(port, [
    {
      bucket: STAFF_EMAIL_ACTOR_BUCKET,
      key: ctx.actorId,
      max: STAFF_EMAIL_ACTOR_LIMIT.max,
      windowSeconds: STAFF_EMAIL_ACTOR_LIMIT.windowSeconds,
    },
    {
      bucket: STAFF_EMAIL_RECIPIENT_BUCKET,
      key: recipientKey,
      max: STAFF_EMAIL_RECIPIENT_LIMIT.max,
      windowSeconds: STAFF_EMAIL_RECIPIENT_LIMIT.windowSeconds,
    },
  ]);
}

function lastAction(ctx: ActionContext, action: string): Meta {
  return {
    [APP_META.lastAction]: action,
    [APP_META.lastActionBy]: ctx.actorId,
    [APP_META.lastActionAt]: ctx.now.toISOString(),
  };
}

/** Best effort: records the last action on the login. */
async function stamp(
  port: StaffAdminPort,
  ctx: ActionContext,
  login: LoginRecord,
  action: string,
  extra: Meta = {},
): Promise<LoginRecord | null> {
  const res = await port.updateUserById(login.id, {
    appMetadata: mergeAppMetadata(login.appMetadata, { ...extra, ...lastAction(ctx, action) }),
  });
  return res.error ? null : res.data;
}

/**
 * The app_metadata that undoes `written` over `original`: keys it added are
 * cleared, keys it changed get their old value back.
 */
function revertOf(original: Meta, written: Meta): Meta {
  const patch: Meta = {};
  for (const key of Object.keys(written)) {
    patch[key] = Object.prototype.hasOwnProperty.call(original, key) ? original[key] : null;
  }
  return mergeAppMetadata(original, patch);
}

/** Best effort; the id is the only detail it holds. */
async function audit(port: StaffAdminPort, action: string, entityId: string): Promise<void> {
  try {
    await port.insertAuditLog({ id: port.newId(), action, entityId });
  } catch {
    // The audit row is best effort and never fails the request.
  }
}

async function sendRecovery(
  port: StaffAdminPort,
  ctx: ActionContext,
  email: string,
): Promise<InvitationResult> {
  const res = await port.resetPasswordForEmail(email, {
    redirectTo: redirectFor("recovery", ctx.appOrigin),
  });
  if (!res.error) return { sent: true, via: "recovery" };
  return { sent: false, via: null, error: invitationError(classifyAuthError(res.error)) };
}

/**
 * An invitation. When the login has already accepted one (Auth answers
 * email_exists or 422), a link to set a new password is sent instead.
 * A failure here never undoes anything.
 */
async function sendInvitation(
  port: StaffAdminPort,
  ctx: ActionContext,
  email: string,
  fullName: string | null,
): Promise<InvitationResult> {
  const res = await port.inviteUserByEmail(email, {
    redirectTo: redirectFor("invite", ctx.appOrigin),
    data: fullName ? { full_name: fullName } : {},
  });
  if (!res.error) return { sent: true, via: "invite" };
  const kind = classifyAuthError(res.error);
  if (kind === "email_not_authorized" || kind === "email_rate_limited") {
    return { sent: false, via: null, error: invitationError(kind) };
  }
  if (kind === "email_exists" || res.error.status === 422) return sendRecovery(port, ctx, email);
  return { sent: false, via: null, error: "send_failed" };
}

/**
 * Why an email is already taken: a staff account, a patient, or another
 * login. A login with a staff record (or a staff tag) is a staff account
 * whatever its patient link, so it is checked first.
 */
async function emailInUse(port: StaffAdminPort, email: string): Promise<Refusal> {
  const all = await readAllLogins(port);
  const match = all?.logins.find((login) => (login.email ?? "").toLowerCase() === email);
  if (match) {
    if (isStaffTagged(match)) return refusal("email_in_use_staff");
    const row = await port.selectAppUser(match.id);
    if (!row.error && row.data) return refusal("email_in_use_staff");
  }
  const patient = await port.patientEmailExists(email);
  if (!patient.error && patient.data) return refusal("email_in_use_patient");
  return refusal("email_in_use");
}

// ---------------------------------------------------------------------------
// overview, login_status

async function overview(port: StaffAdminPort, ctx: ActionContext): Promise<ActionResult> {
  await limit(port, [
    {
      bucket: STAFF_OVERVIEW_BUCKET,
      key: ctx.actorId,
      max: STAFF_OVERVIEW_LIMIT.max,
      windowSeconds: STAFF_OVERVIEW_LIMIT.windowSeconds,
    },
  ]);

  const all = await readAllRows(port);
  if (!all) throw halt(staffReadFailed());
  const read = await readAllLogins(port);
  if (!read) throw halt(refusal("login_service_error"));
  const uids = await port.selectPatientAuthUids();
  if (uids.error) throw halt(staffReadFailed());

  const patientUids = new Set(uids.data);
  const loginsById = new Map<string, LoginRecord>();
  for (const login of read.logins) {
    if (!loginsById.has(login.id)) loginsById.set(login.id, login);
  }
  const names = staffNameMap(all.rows);
  const accounts = all.rows.map((row) =>
    accountView({
      userId: row.id,
      row,
      login: loginsById.get(row.id) ?? null,
      now: ctx.now,
      inviteLifetimeSec: ctx.inviteLifetimeSec,
      names,
      patientUids,
    }),
  );
  const caller = all.rows.find((row) => row.id === ctx.actorId);

  const response: OverviewResponse = {
    checkedAt: ctx.now.toISOString(),
    accounts,
    health: accountHealth(
      read.logins,
      all.rows,
      patientUids,
      ctx.now,
      ctx.launchedAt,
      read.truncated || all.truncated,
    ),
    // The admin role is offered only while administrators can be added.
    roles: PROVISIONABLE_ROLES.filter((role) => ADMIN_ACCOUNTS_ENABLED || role !== ADMIN_ROLE),
    adminRoleNeedsPermanent: true,
    inviteLifetimeSeconds: ctx.inviteLifetimeSec,
    caller: { userId: ctx.actorId, adminPermanent: caller?.admin_permanent === true },
  };
  return done(200, { ...response });
}

async function loginStatus(
  port: StaffAdminPort,
  ctx: ActionContext,
  userId: string,
): Promise<ActionResult> {
  const row = await readRow(port, userId);
  const login = await readLogin(port, userId);
  check({ action: "login_status", actorId: ctx.actorId, actorPermanent: false, row, login, otherActiveAdmins: 0, now: ctx.now });
  return done(200, { account: await viewOf(port, ctx, userId, row, login) });
}

// ---------------------------------------------------------------------------
// create

/** A retry of an earlier create by the same caller with the same details (A8). */
function canResume(login: LoginRecord, r: RouteOf<"create">, ctx: ActionContext): boolean {
  const meta = login.appMetadata ?? {};
  if (meta[APP_META.createdBy] !== ctx.actorId) return false;
  const createdAt = text(meta[APP_META.createdAt]);
  const createdMs = createdAt === null ? NaN : Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return false;
  if (ctx.now.getTime() - createdMs > RESUME_WINDOW_SECONDS * 1000) return false;
  if (isLoginBanned(login, ctx.now)) return false;
  if ((login.email ?? "").toLowerCase() !== r.email) return false;
  if (meta[APP_META.initialRole] !== r.role) return false;
  return login.userMetadata?.full_name === r.fullName;
}

/**
 * Whether the staff record now holds exactly what this create asked for.
 * A failed read counts as no, so the rollback still runs.
 */
async function rowMatchesCreate(port: StaffAdminPort, r: RouteOf<"create">): Promise<boolean> {
  const res = await port.selectAppUser(r.userId);
  if (res.error || !res.data) return false;
  return res.data.id === r.userId && res.data.role === r.role && res.data.full_name === r.fullName;
}

async function create(
  port: StaffAdminPort,
  ctx: ActionContext,
  r: RouteOf<"create">,
): Promise<ActionResult> {
  const actorPermanent = r.role === ADMIN_ROLE ? await actorIsPermanent(port, ctx) : false;
  check({
    action: "create",
    actorId: ctx.actorId,
    actorPermanent,
    row: null,
    login: null,
    otherActiveAdmins: 0,
    requestedRole: r.role,
    now: ctx.now,
  });
  await emailLimits(port, ctx, r.email);

  const nowIso = ctx.now.toISOString();
  let login: LoginRecord | null = null;
  let createdHere = false;
  // A second pass when createUser reports the id or the email as taken, or
  // fails without saying why: the login may be this caller's own earlier
  // attempt (a double submit, or a retry while the first is still running).
  // Auth checks the email before the id, so a concurrent same-id create
  // usually shows up as email_exists.
  for (let attempt = 1; attempt <= 2 && login === null; attempt++) {
    const existing = await readLogin(port, r.userId);
    if (existing) {
      if (!canResume(existing, r, ctx)) throw halt(refusal("id_conflict"));
      login = existing;
      break;
    }
    if (await readRow(port, r.userId)) throw halt(refusal("id_conflict"));

    const res = await port.createUser({
      id: r.userId,
      email: r.email,
      userMetadata: { full_name: r.fullName },
      appMetadata: {
        [APP_META.account]: STAFF_ACCOUNT_TAG,
        [APP_META.createdBy]: ctx.actorId,
        [APP_META.createdAt]: nowIso,
        [APP_META.initialRole]: r.role,
        ...lastAction(ctx, "created"),
      },
    });
    if (!res.error) {
      login = res.data;
      createdHere = true;
      break;
    }
    const kind = classifyAuthError(res.error);
    const serverFailure = kind === "unknown" && (res.error.status ?? 0) >= 500;
    if (attempt === 1 && (kind === "id_taken" || kind === "email_exists" || serverFailure)) continue;
    if (kind === "id_taken") throw halt(refusal("id_conflict"));
    if (kind === "email_exists") throw halt(await emailInUse(port, r.email));
    throw halt(refusal("login_service_error"));
  }
  if (!login) throw halt(refusal("id_conflict"));
  const resumed = !createdHere;

  const existingRow = resumed ? await readRow(port, r.userId) : null;
  if (!existingRow) {
    const ins = await port.insertAppUser({
      id: r.userId,
      full_name: r.fullName,
      role: r.role,
      admin_access: r.role === ADMIN_ROLE,
      // Never written by the port; the column default applies.
      admin_permanent: false,
    });
    // A row that appeared since the check with this request's own details is
    // a concurrent retry of the same create, or this insert committed before
    // its reply was lost (a timeout): it is kept, and so is the login.
    const sameCreate = ins.error ? await rowMatchesCreate(port, r) : false;
    if (ins.error && !sameCreate) {
      // Any other row that appeared since the check is a clash, not a duplicate.
      const rowRefusal = ins.error.code === "23505" ? refusal("id_conflict") : staffRowRefusal(ins.error.code);
      if (!createdHere) throw halt(rowRefusal, { loginLeftBehind: true });
      const removed = await port.deleteUser(r.userId);
      if (removed.error) throw halt(refusal("partial_create"), { loginLeftBehind: true });
      throw halt(rowRefusal, { loginLeftBehind: false });
    }
  }

  let invitation: InvitationResult;
  const lastSent = lastInvitationSentAt(login);
  if (
    resumed &&
    lastSent !== null &&
    ctx.now.getTime() - lastSent < RESEND_MIN_GAP_SECONDS * 1000
  ) {
    invitation = { sent: true, via: "invite", alreadySent: true };
  } else {
    invitation = await sendInvitation(port, ctx, r.email, r.fullName);
  }

  await audit(port, "staff_account_created", r.userId);
  const body: Record<string, unknown> = { userId: r.userId, status: "invited", invitation };
  if (resumed) body.resumed = true;
  return done(resumed ? 200 : 201, body);
}

// ---------------------------------------------------------------------------
// update

async function update(
  port: StaffAdminPort,
  ctx: ActionContext,
  r: RouteOf<"update">,
): Promise<ActionResult> {
  const row = await readRow(port, r.userId);
  const login = row ? await readLogin(port, r.userId) : null;
  const newRole = row && r.role !== null && r.role !== row.role ? r.role : null;

  const actorPermanent = newRole === ADMIN_ROLE ? await actorIsPermanent(port, ctx) : false;
  const others =
    newRole !== null &&
    row !== null &&
    row.role === ADMIN_ROLE &&
    row.admin_permanent !== true &&
    row.id !== ctx.actorId
      ? await mustCountOtherAdmins(port, r.userId, ctx.now)
      : 0;
  check({
    action: "update",
    actorId: ctx.actorId,
    actorPermanent,
    row,
    login,
    otherActiveAdmins: others,
    requestedRole: r.role,
    now: ctx.now,
  });
  if (!row) throw halt(refusal("not_staff_account"));

  const next: AppUserFieldsUpdate = {};
  if (r.fullName !== null && r.fullName !== row.full_name) next.full_name = r.fullName;
  if (newRole !== null) {
    next.role = newRole;
    next.admin_access = newRole === ADMIN_ROLE;
  }
  if (Object.keys(next).length === 0) {
    // Nothing differs from what is stored.
    return done(200, { account: await viewOf(port, ctx, r.userId, row, login) });
  }

  // Only if the role is still the one read above; admin_permanent is never
  // written.
  const res = await port.updateAppUserFields(r.userId, row.role, next);
  if (res.error) throw halt(staffRowRefusal(res.error.code));
  if (!res.data.updated) throw halt(refusal("changed_elsewhere"));

  // Recount after taking the admin role away (A9): two administrators may
  // be changing each other's role at the same moment. If none is left, put
  // the record back and refuse.
  if (newRole !== null && row.role === ADMIN_ROLE) {
    const count = await otherActiveAdmins(port, r.userId, ctx.now);
    if (count === null || count < 1) {
      const back: AppUserFieldsUpdate = { role: row.role, admin_access: row.admin_access === true };
      if (next.full_name !== undefined && row.full_name !== null) back.full_name = row.full_name;
      const undo = await port.updateAppUserFields(r.userId, newRole, back);
      if (undo.error || !undo.data.updated) throw halt(refusal("server_error"));
      throw halt(count === null ? staffReadFailed() : refusal("last_admin"));
    }
  }

  let current = login;
  if (login) {
    // Best effort: the staff record decides, the login only follows.
    const patch: { appMetadata: Meta; userMetadata?: Meta } = {
      appMetadata: mergeAppMetadata(login.appMetadata, lastAction(ctx, "updated")),
    };
    if (next.full_name !== undefined) {
      patch.userMetadata = mergeAppMetadata(login.userMetadata, { full_name: next.full_name });
    }
    const up = await port.updateUserById(login.id, patch);
    if (!up.error) current = up.data;
  }
  await audit(port, "staff_account_updated", r.userId);

  const reread = await port.selectAppUser(r.userId);
  const fresh: AppUserRow = !reread.error && reread.data ? reread.data : { ...row, ...next };
  return done(200, { account: await viewOf(port, ctx, r.userId, fresh, current) });
}

// ---------------------------------------------------------------------------
// resend_invitation, reset_password

async function resendInvitation(
  port: StaffAdminPort,
  ctx: ActionContext,
  userId: string,
): Promise<ActionResult> {
  const row = await readRow(port, userId);
  const login = await readLogin(port, userId);
  check({ action: "resend_invitation", actorId: ctx.actorId, actorPermanent: false, row, login, otherActiveAdmins: 0, now: ctx.now });
  if (!row || !login) throw halt(refusal("not_staff_account"));
  const email = text(login.email)?.toLowerCase() ?? null;
  if (!email) throw halt(refusal("no_login", { message: NO_EMAIL_ON_LOGIN }));

  await emailLimits(port, ctx, email);
  const invitation = isTime(login.emailConfirmedAt)
    ? await sendRecovery(port, ctx, email)
    : await sendInvitation(
        port,
        ctx,
        email,
        text(row.full_name) ?? text(login.userMetadata?.full_name),
      );
  if (invitation.sent) await stamp(port, ctx, login, "invitation_resent");
  await audit(port, "staff_invitation_resent", userId);
  return done(200, { invitation });
}

async function resetPassword(
  port: StaffAdminPort,
  ctx: ActionContext,
  userId: string,
): Promise<ActionResult> {
  const row = await readRow(port, userId);
  const login = await readLogin(port, userId);
  // The caller may send a reset link to their own account.
  check({ action: "reset_password", actorId: ctx.actorId, actorPermanent: false, row, login, otherActiveAdmins: 0, now: ctx.now });
  if (!row || !login) throw halt(refusal("not_staff_account"));
  const email = text(login.email)?.toLowerCase() ?? null;
  if (!email) throw halt(refusal("no_login", { message: NO_EMAIL_ON_LOGIN }));

  await emailLimits(port, ctx, email);
  const invitation = await sendRecovery(port, ctx, email);
  if (invitation.sent) await stamp(port, ctx, login, "password_reset_sent");
  await audit(port, "staff_password_reset_sent", userId);
  return done(200, { invitation });
}

// ---------------------------------------------------------------------------
// disable

/**
 * Disable, in this order, so a failure part way never leaves more access
 * than before:
 * 1. Refusals (own account, permanent administrator, last administrator)
 *    before anything is written.
 * 2. Record the previous role on the login (no ban yet).
 * 3. Demote the staff record to guest, only if its role is still the one
 *    read and it is not a permanent administrator (DISABLE_DEMOTES_ROLE).
 *    If that writes nothing or fails, stop: the login is never banned
 *    while its record keeps a staff role.
 * 4. For an administrator, count the other active administrators again; if
 *    none is left, put the record back and refuse.
 * 5. Ban the login. If that fails, put the record back.
 */
async function disable(
  port: StaffAdminPort,
  ctx: ActionContext,
  userId: string,
): Promise<ActionResult> {
  const row = await readRow(port, userId);
  const login = await readLogin(port, userId);
  const needsCount =
    row !== null &&
    login !== null &&
    row.role === ADMIN_ROLE &&
    row.admin_permanent !== true &&
    row.id !== ctx.actorId &&
    DISABLE_DEMOTES_ROLE;
  const others = needsCount ? await mustCountOtherAdmins(port, userId, ctx.now) : 0;
  check({ action: "disable", actorId: ctx.actorId, actorPermanent: false, row, login, otherActiveAdmins: others, now: ctx.now });
  if (!row || !login) throw halt(refusal("not_staff_account"));

  const meta = login.appMetadata ?? {};
  const rowIsStaff = isStaffRole(row.role);
  const rowDemoted = row.role === DISABLED_ROLE && row.admin_access !== true;
  const recorded = text(meta[APP_META.disabledAt]) !== null;
  if (isLoginBanned(login, ctx.now) && recorded && (!DISABLE_DEMOTES_ROLE || rowDemoted)) {
    return done(200, { status: "disabled", rowUpdated: DISABLE_DEMOTES_ROLE, alreadyDisabled: true });
  }

  // 2. Record. The row's own role wins while it still has a staff role; an
  // earlier interrupted Disable may already have demoted it.
  const storedAccess = meta[APP_META.disabledAdminAccess];
  const record: Meta = {
    [APP_META.disabledRole]: rowIsStaff ? row.role : (knownStaffRole(meta[APP_META.disabledRole]) ?? undefined),
    [APP_META.disabledAdminAccess]: rowIsStaff
      ? row.admin_access === true
      : typeof storedAccess === "boolean"
        ? storedAccess
        : false,
    [APP_META.disabledBy]: ctx.actorId,
    [APP_META.disabledAt]: ctx.now.toISOString(),
    ...lastAction(ctx, "disabled"),
  };
  const recordRes = await port.updateUserById(userId, {
    appMetadata: mergeAppMetadata(meta, record),
  });
  if (recordRes.error) throw halt(refusal("login_service_error"));
  const unrecord = async (): Promise<void> => {
    await port.updateUserById(userId, { appMetadata: revertOf(meta, record) });
  };

  // 3. Demote.
  let rowUpdated = false;
  let demotedHere = false;
  if (DISABLE_DEMOTES_ROLE) {
    if (rowDemoted) {
      rowUpdated = true;
    } else {
      const res = await port.updateAppUserAccess(userId, row.role, {
        role: DISABLED_ROLE,
        admin_access: false,
      });
      if (res.error) {
        // Never ban a login whose record still has its staff role: stop
        // before the ban, so a retry starts again from the top.
        await unrecord();
        throw halt(refusal("staff_record_error"));
      }
      if (!res.data.updated) {
        // The record changed since it was read (or is a permanent
        // administrator): stop before the ban.
        await unrecord();
        throw halt(refusal("changed_elsewhere"));
      }
      rowUpdated = true;
      demotedHere = true;
    }
  }

  /** Puts the staff record back; false when that failed. */
  const restoreRow = async (): Promise<boolean> => {
    if (!demotedHere) return true;
    const res = await port.updateAppUserAccess(userId, DISABLED_ROLE, {
      role: row.role,
      admin_access: row.admin_access === true,
    });
    return !res.error && res.data.updated;
  };

  // 4. Recount: two administrators may be disabling each other at once.
  if (DISABLE_DEMOTES_ROLE && row.role === ADMIN_ROLE) {
    const count = await otherActiveAdmins(port, userId, ctx.now);
    if (count === null || count < 1) {
      if (!(await restoreRow())) throw halt(refusal("partial_disable"));
      await unrecord();
      throw halt(count === null ? staffReadFailed() : refusal("last_admin"));
    }
  }

  // 5. Ban.
  const ban = await port.updateUserById(userId, { banDuration: BAN_DURATION });
  if (ban.error) {
    if (!(await restoreRow())) throw halt(refusal("partial_disable"));
    await unrecord();
    throw halt(refusal("login_service_error"));
  }

  await audit(port, "staff_account_disabled", userId);
  return done(200, { status: "disabled", rowUpdated });
}

// ---------------------------------------------------------------------------
// reactivate

/** Restores the staff record first, then lifts the ban last. */
async function reactivate(
  port: StaffAdminPort,
  ctx: ActionContext,
  r: RouteOf<"reactivate">,
): Promise<ActionResult> {
  const row = await readRow(port, r.userId);
  const login = await readLogin(port, r.userId);
  const meta = login?.appMetadata ?? {};
  const rowIsStaff = row !== null && isStaffRole(row.role);
  const restoreRole =
    row !== null && rowIsStaff ? row.role : (knownStaffRole(meta[APP_META.disabledRole]) ?? r.role);
  // Also when the row still has the admin role and only the ban is left:
  // lifting it gives administrator access back (A4).
  const actorPermanent = restoreRole === ADMIN_ROLE ? await actorIsPermanent(port, ctx) : false;

  // Giving a role to a record on a login this function never disabled or
  // tagged would promote that login: the same patient checks as
  // create_staff_record, failing closed.
  let patientLinked: boolean | undefined;
  let patientEmailOnFile: boolean | undefined;
  if (
    row !== null &&
    login !== null &&
    !rowIsStaff &&
    r.userId !== ctx.actorId &&
    reactivateNeedsPatientChecks(login)
  ) {
    const linked = await port.isPatientLogin(login.id);
    if (linked.error) throw halt(staffReadFailed());
    patientLinked = linked.data === true;
    const email = text(login.email)?.toLowerCase() ?? null;
    patientEmailOnFile = false;
    if (email !== null) {
      const onFile = await port.patientEmailExists(email);
      if (onFile.error) throw halt(staffReadFailed());
      patientEmailOnFile = onFile.data === true;
    }
  }
  check({
    action: "reactivate",
    actorId: ctx.actorId,
    actorPermanent,
    row,
    login,
    otherActiveAdmins: 0,
    requestedRole: restoreRole,
    now: ctx.now,
    patientLinked,
    patientEmailOnFile,
  });
  if (!row || !login || !restoreRole) throw halt(refusal("role_needed"));

  let finalRow: AppUserRow = row;
  if (!rowIsStaff) {
    // Administrator access goes with the admin role only.
    const next = { role: restoreRole, admin_access: restoreRole === ADMIN_ROLE };
    const res = await port.updateAppUserAccess(r.userId, row.role, next);
    if (res.error) throw halt(staffRowRefusal(res.error.code));
    if (!res.data.updated) throw halt(refusal("changed_elsewhere"));
    finalRow = { ...row, ...next };
  }

  const unban = await port.updateUserById(r.userId, {
    banDuration: UNBAN,
    appMetadata: mergeAppMetadata(meta, {
      [APP_META.disabledRole]: null,
      [APP_META.disabledAdminAccess]: null,
      [APP_META.disabledBy]: null,
      [APP_META.disabledAt]: null,
      ...lastAction(ctx, "reactivated"),
    }),
  });
  if (unban.error) throw halt(refusal("partial_reactivate"));

  await audit(port, "staff_account_reactivated", r.userId);
  const s = accountStatus(unban.data, finalRow, ctx.now, ctx.inviteLifetimeSec);
  return done(200, { status: s.status, role: finalRow.role });
}

// ---------------------------------------------------------------------------
// create_login, create_staff_record (Account Health repairs)

/** A login for a staff record that has none. Never deletes anything. */
async function createLogin(
  port: StaffAdminPort,
  ctx: ActionContext,
  r: RouteOf<"create_login">,
): Promise<ActionResult> {
  const row = await readRow(port, r.userId);
  const login = row ? await readLogin(port, r.userId) : null;
  const actorPermanent = row?.role === ADMIN_ROLE ? await actorIsPermanent(port, ctx) : false;
  check({ action: "create_login", actorId: ctx.actorId, actorPermanent, row, login, otherActiveAdmins: 0, now: ctx.now });
  if (!row) throw halt(refusal("not_staff_account"));

  const storedName = normaliseFullName(row.full_name ?? "");
  if (storedName === null || storedName.toLowerCase() !== r.confirmFullName.toLowerCase()) {
    throw halt(refusal("confirm_mismatch", { field: "confirmFullName" }));
  }
  await emailLimits(port, ctx, r.email);

  const nowIso = ctx.now.toISOString();
  const res = await port.createUser({
    id: r.userId,
    email: r.email,
    userMetadata: { full_name: storedName },
    appMetadata: {
      [APP_META.account]: STAFF_ACCOUNT_TAG,
      [APP_META.repair]: "create_login",
      [APP_META.repairBy]: ctx.actorId,
      [APP_META.repairAt]: nowIso,
      ...lastAction(ctx, "login_created"),
    },
  });
  if (res.error) {
    const kind = classifyAuthError(res.error);
    if (kind === "email_exists") throw halt(await emailInUse(port, r.email));
    if (kind === "id_taken") throw halt(refusal("login_exists"));
    throw halt(refusal("login_service_error"));
  }

  const invitation = await sendInvitation(port, ctx, r.email, storedName);
  await audit(port, "staff_login_created", r.userId);
  return done(201, { userId: r.userId, status: "invited", invitation });
}

/**
 * A staff record for a login that has none. Refused for anything that may
 * be a patient's login, and never grants administrator access.
 */
async function createStaffRecord(
  port: StaffAdminPort,
  ctx: ActionContext,
  r: RouteOf<"create_staff_record">,
): Promise<ActionResult> {
  const login = await readLogin(port, r.userId);
  if (!login) throw halt(refusal("not_found"));
  const row = await readRow(port, r.userId);
  if (row) throw halt(refusal("staff_exists"));

  // The typed email is compared before anything about the login is said.
  const email = text(login.email)?.toLowerCase() ?? null;
  if (email === null || email !== r.confirmEmail) {
    throw halt(refusal("confirm_mismatch", { field: "confirmEmail" }));
  }

  // A targeted lookup, never the paged list: a login past a page cap must
  // still be seen as a patient's.
  const linked = await port.isPatientLogin(login.id);
  if (linked.error) throw halt(staffReadFailed());
  const patientEmail = await port.patientEmailExists(email);
  if (patientEmail.error) throw halt(staffReadFailed());
  check({
    action: "create_staff_record",
    actorId: ctx.actorId,
    actorPermanent: false,
    row: null,
    login,
    otherActiveAdmins: 0,
    requestedRole: r.role,
    now: ctx.now,
    patientLinked: linked.data === true,
    patientEmailOnFile: patientEmail.data === true,
  });

  const newRow: AppUserRow = {
    id: r.userId,
    full_name: r.fullName,
    role: r.role,
    admin_access: false,
    admin_permanent: false,
    created_at: ctx.now.toISOString(),
  };
  const ins = await port.insertAppUser({
    id: newRow.id,
    full_name: newRow.full_name,
    role: newRow.role,
    admin_access: false,
    // Never written by the port; the column default applies.
    admin_permanent: false,
  });
  if (ins.error) throw halt(staffRowRefusal(ins.error.code));

  const nowIso = ctx.now.toISOString();
  const tagged = await stamp(port, ctx, login, "staff_record_created", {
    [APP_META.account]: STAFF_ACCOUNT_TAG,
    [APP_META.repair]: "create_staff_record",
    [APP_META.repairBy]: ctx.actorId,
    [APP_META.repairAt]: nowIso,
  });
  await audit(port, "staff_record_created", r.userId);
  const s = accountStatus(tagged ?? login, newRow, ctx.now, ctx.inviteLifetimeSec);
  return done(201, { userId: r.userId, status: s.status });
}

// ---------------------------------------------------------------------------

/**
 * Runs one routed request for a signed-in administrator. Returns the HTTP
 * status and body; `success` is set, `fn` is added by index.ts.
 */
export async function runStaffAdminAction(
  port: StaffAdminPort,
  ctx: ActionContext,
  route: StaffRoute,
): Promise<ActionResult> {
  try {
    switch (route.kind) {
      case "refused": {
        const body: Record<string, unknown> = {
          success: false,
          error: route.error,
          message: route.message,
        };
        if (route.field !== undefined) body.field = route.field;
        return { status: route.status, body };
      }
      case "ping":
        return done(200, { version: STAFF_ADMIN_VERSION });
      case "overview":
        return await overview(port, ctx);
      case "login_status":
        return await loginStatus(port, ctx, route.userId);
      case "create":
        return await create(port, ctx, route);
      case "update":
        return await update(port, ctx, route);
      case "resend_invitation":
        return await resendInvitation(port, ctx, route.userId);
      case "reset_password":
        return await resetPassword(port, ctx, route.userId);
      case "disable":
        return await disable(port, ctx, route.userId);
      case "reactivate":
        return await reactivate(port, ctx, route);
      case "create_login":
        return await createLogin(port, ctx, route);
      case "create_staff_record":
        return await createStaffRecord(port, ctx, route);
      default:
        return refused(refusal("invalid_action"));
    }
  } catch (error) {
    if (error instanceof Halt) return error.result;
    throw error;
  }
}
