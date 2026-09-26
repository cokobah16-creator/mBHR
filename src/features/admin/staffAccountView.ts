// Pure helpers for the Users screen's staff accounts (server mode): the
// wording, merging this device's staff records with the server's accounts,
// status labels and which actions each row offers.
//
// Every string an administrator sees about staff accounts lives in
// STAFF_COPY, in plain English. The hosting service is never named.

import { getRoleDisplayName, isStaffRole, type Role } from "@/auth/roles";
import type { Tone } from "@/components/ui/StatusBadge";
import type { User } from "@/db";
import type { ToastTone } from "@/stores/toast";
import type {
  AccountStatus,
  AccountView,
  HealthItem,
  InvitationResult,
  OverviewResponse,
  StatusDetail,
} from "../../../supabase/functions/_shared/staff/types";

/** A role's name as the app shows it ("nurse" gives "Nurse"). */
export function roleName(role: string): string {
  return getRoleDisplayName(role as Role);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/**
 * When an invitation link stops working, for "The link ... expires {text}".
 * 3600 seconds gives "in about an hour".
 */
export function inviteLifetimeText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "soon";
  if (seconds < 3000) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `in about ${plural(minutes, "minute", "minutes")}`;
  }
  const hours = Math.round(seconds / 3600);
  if (hours <= 1) return "in about an hour";
  return `in about ${hours} hours`;
}

/** Every string about staff accounts on the Users screen. */
export const STAFF_COPY = {
  subtitle: "Add staff, send invitations and manage logins. PINs are set on each device.",
  emptyServer: "No staff yet. Use Add Staff to invite someone by email.",
  addStaff: "Add Staff",
  tryAgain: "Try again",
  /** A refresh of the list failed but the list already shown is still usable. */
  staleList:
    "The staff list couldn't be refreshed just now, so it may be a few minutes out of date. You can keep working.",

  /** The header line for each screen state; none when ready. */
  state: {
    checking: "Checking staff accounts…",
    offline:
      "You're offline. Adding staff and changing logins needs an internet connection. You can still manage PINs on this device.",
    not_signed_in:
      "Sign in online with your administrator account to add staff or manage their logins.",
    not_permitted: "Only an administrator can manage staff accounts.",
    not_deployed:
      "Staff account setup isn't available on this server yet. Ask your system administrator to finish setting it up.",
    not_configured:
      "Staff account setup isn't finished on this server yet. Ask your system administrator.",
    unreachable: "Couldn't reach the server. Try again.",
    error: "Staff accounts couldn't be loaded. Try again.",
    no_server:
      "This device isn't connected to a server, so staff can only be managed on this device.",
  },

  /** Failures of a single request, when the server gave no message. */
  failure: {
    rate_limited: "Too many staff account changes. Try again in a few minutes.",
    refused: "The server didn't accept this change. Check the details and try again.",
    server_error: "The staff account service had an error. Check the list before trying again.",
    /** Loading the list itself hit the server's limit (no change was made). */
    list_rate_limited: (seconds: number | undefined) => {
      const minutes =
        typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
          ? Math.ceil(seconds / 60)
          : null;
      return minutes === null
        ? "The staff list was loaded too many times in a short time. Wait a few minutes, then press Try again."
        : `The staff list was loaded too many times in a short time. Wait ${plural(minutes, "minute", "minutes")}, then press Try again.`;
    },
  },

  /** Column headings. */
  columns: {
    status: "Status",
    actions: "Actions",
  },

  badge: {
    invited: "Invited",
    active: "Active",
    disabled: "Disabled",
    setup_required: "Setup required",
    device_only: "This device only",
    unchecked: "Not checked",
    missing: "Not on the server",
  },

  caption: {
    expired: "Link may have expired",
    never_signed_in: "Never signed in",
    disable_partial: "Devices not updated yet",
    no_staff_role: "No staff role",
    no_login: "No login yet",
    invitation_not_sent: "Invitation not sent",
    password_not_set: "Password not set yet",
    missing: "Removed from the server",
    switched_off: "Turned off outside this screen",
  },

  deviceNote: {
    off_on_device: "Off on this device",
    needs_review: "Needs review",
    needs_review_detail: "Deactivated on this device, still active online.",
  },

  action: {
    edit: "Edit",
    set_device_pin: "Set PIN on this device",
    resend_invitation: "Resend invitation",
    reset_password: "Reset password",
    login_status: "Login status",
    disable: "Disable",
    reactivate: "Reactivate",
    create_login: "Create login",
    create_staff_record: "Create staff record",
    reset_device_pin: "Reset PIN on this device",
    deactivate_on_device: "Deactivate on this device",
    activate_on_device: "Activate on this device",
    delete: "Delete",
    retire_device_record: "Retire device-only record",
  },

  invite: {
    title: "Add staff member",
    fullName: "Full name",
    email: "Email",
    emailHint: "They'll get an email here to set their password.",
    role: "Role",
    adminNeedsPermanent: "Only a permanent administrator can add administrators.",
    adminUnavailable: "Administrator accounts can't be added here yet.",
    roleAccess: (description: string) => `What this role can do: ${description}`,
    offlineInfo:
      "Offline access: the first time they sign in online on a device, they'll choose a PIN for that device.",
    notYetInfo:
      "Facility, individual permissions and an offline-access switch aren't available yet. What someone can do comes from their role.",
    submit: "Send invitation",
    submitting: "Creating account…",
    cancel: "Cancel",
    successTitle: "Account created",
    notSentTitle: "Invitation not sent",
    unconfirmedTitle: "Not confirmed",
    unconfirmed:
      "We couldn't confirm the account was created. Press Send invitation again: it won't create a duplicate.",
    failedTitle: "Account not created",
  },

  edit: {
    title: (name: string) => `Edit ${name}`,
    fullName: "Full name",
    role: "Role",
    submit: "Save changes",
    submitting: "Saving…",
    cancel: "Cancel",
    ownRole: "You can change your own name here, but not your own role.",
    permanentRole: "Permanent administrators keep the administrator role.",
    pinNote: "To set their PIN on this device, use Set PIN on this device.",
    /** Moving an administrator to another role while admin can't be given here. */
    adminOneWay:
      "Administrator accounts can't be added here yet, so they can't be made an administrator again from this screen.",
    nothingChanged: "Change their name or role before saving.",
    savedTitle: "Account updated",
    saved: (name: string) => `${name}'s account was updated.`,
    failedTitle: "Account not updated",
  },

  disable: {
    title: (name: string) => `Disable ${name}?`,
    body:
      "They won't be able to sign in online, and every device will switch them off the next time it syncs, including PIN sign-in. If they're signed in right now, that can continue for a short while.",
    /** Disabling an administrator while admin can't be given here. */
    adminOneWay:
      "They can't be reactivated from this screen yet, because administrator accounts can't be restored here. Ask whoever runs your server if they need access again later.",
    confirm: "Disable",
    busy: "Disabling…",
    doneTitle: "Account disabled",
    done: (name: string) => `${name} is disabled.`,
    partialTitle: "Only partly disabled",
    partial:
      "Online sign-in is blocked, but devices weren't told yet. Press Disable again.",
    failedTitle: "Account not disabled",
  },

  reactivate: {
    title: (name: string) => `Reactivate ${name}?`,
    body: (role: string) =>
      `They'll be able to sign in online again as ${role}. They're switched back on for this device too. Other devices where an administrator deactivated them by hand stay off until they're activated there.`,
    bodyNoRole:
      "They'll be able to sign in online again. They're switched back on for this device too. Other devices where an administrator deactivated them by hand stay off until they're activated there.",
    chooseRole: "Choose the role they should have.",
    role: "Role",
    confirm: "Reactivate",
    busy: "Reactivating…",
    doneTitle: "Account reactivated",
    done: (name: string) => `${name} is active again.`,
    failedTitle: "Account not reactivated",
  },

  resend: {
    title: (name: string) => `Send ${name} a new invitation?`,
    body: "The link in their earlier invitation stops working once the new one is sent.",
    confirm: "Resend invitation",
    busy: "Sending…",
    sentTitle: "Invitation sent",
    sentInvite: (email: string) => `Invitation sent to ${email}.`,
    sentRecovery:
      "They'd already opened their invitation, so we sent a link to set a new password instead.",
    failedTitle: "Invitation not sent",
  },

  resetPassword: {
    title: (name: string) => `Send ${name} a link to set a new password?`,
    body: "Their current password keeps working until they use the link.",
    confirm: "Send link",
    busy: "Sending…",
    sentTitle: "Password link sent",
    sent: (email: string) => `Password link sent to ${email}.`,
    failedTitle: "Password link not sent",
  },

  /** Why an invitation or password email did not go out. */
  emailNotSent: {
    send_failed: "The email didn't go out. Try again in a few minutes.",
    email_not_configured:
      "The email didn't go out because outgoing email isn't set up yet. Ask whoever runs the server to finish email setup.",
    email_rate_limited: "Too many emails were sent. Try again later.",
  },

  loginStatus: {
    title: (name: string) => `Login status for ${name}`,
    close: "Close",
    loading: "Checking their login…",
    email: "Email",
    status: "Status",
    invitationSent: "Invitation sent",
    emailConfirmed: "Email confirmed",
    passwordSet: "Password set",
    lastSignIn: "Last online sign-in",
    created: "Account created",
    createdBy: "Created by",
    disabledOn: "Disabled on",
    disabledBy: "Disabled by",
    missing: "None",
    notRecorded: "Not recorded",
    createdByRepair: (name: string | null) =>
      name ? `${name} (Account health repair)` : "Account health repair",
    linkedPatientRecord:
      "This login is also linked to a patient record. It is still a staff account.",
    passwordSetNote: "Password set is reported by their own device, so treat it as a guide.",
    switchedOffNote:
      "Their staff record was turned off outside this screen. Reactivate can't undo this. Ask whoever runs your server.",
  },

  health: {
    title: "Account health",
    titleWithCount: (n: number) => `Account health (${plural(n, "problem", "problems")})`,
    empty: "No problems found.",
    truncated:
      "Account health may be incomplete: there are more logins than it can check.",
    staffWithoutLogin: (name: string) =>
      `${name} has a staff record but can't sign in online.`,
    staffWithoutLoginNoRole: (name: string) =>
      `${name} has a staff record with no role that can sign in.`,
    staffLoginWithoutRecord: (email: string) =>
      `${email} was invited but has no staff record, so they can't open the staff app.`,
    unknownLogin: (masked: string) =>
      `Unknown login ${masked} has no staff record, so it can't open the staff app.`,
    staffRecordOutsideUsers: (name: string) =>
      `${name}'s staff record wasn't created from the Users screen. Check that it's expected. If you don't know them, use Disable on their row.`,
    blockedUnconfirmed: "This login was never confirmed. If they work here, add them with Add Staff.",
    blockedNoRole:
      "Their role can't have a login. Use Edit on their row to give them a role that can sign in.",
    blockedNotStaff:
      "This record has no staff role, so it can't have a login. Ask whoever runs your server to fix or remove it.",
    blockedAdminNotOffered:
      "Logins for administrators can't be added here yet. Ask whoever runs your server to add their login.",
    blockedRoleNotOffered:
      "A login for their role can't be added here yet. Ask whoever runs your server to add their login.",
    permanentAdminNoRepair:
      "Permanent administrator accounts can't be repaired here. Ask whoever runs your server.",
    repairsUnavailable:
      "Repairs need an internet connection. Try again when the staff list has loaded.",
    counts: (n: number) =>
      `Patient portal logins: ${n} (not staff, no action needed).`,
    deviceOnly: (name: string) =>
      `${name} exists on this device only. Add them with Add Staff using their email, then use Retire device-only record or Delete on their old row in the list.`,
    unnamed: "A staff member",
    unknownEmail: "an unknown email",
    createLogin: "Create login",
    createStaffRecord: "Create staff record",
  },

  createLogin: {
    title: "Create login",
    body: (name: string) =>
      `Type ${name}'s full name to confirm, and the email they'll use.`,
    fullName: "Full name",
    email: "Email",
    emailHint: "They'll get an email here to set their password.",
    submit: "Create login and send invitation",
    submitting: "Creating login…",
    cancel: "Cancel",
    nameMismatch: "What you typed doesn't match their name.",
    unconfirmed:
      "We couldn't confirm the login was created. Close this and check the list before trying again.",
    doneTitle: "Login created",
    failedTitle: "Login not created",
  },

  createStaffRecord: {
    title: "Create staff record",
    body: "Only do this for someone you know works here. They'll be able to open the staff app with the role you choose.",
    confirmEmail: "Their email (type it in full)",
    fullName: "Full name",
    role: "Role",
    noAdmin: "Administrator can't be chosen here.",
    acknowledge: "I know this person and they should have staff access",
    acknowledgeRequired: "Tick the box to confirm you know this person.",
    emailMismatch: "What you typed doesn't match this login's email.",
    unconfirmed:
      "We couldn't confirm the staff record was created. Close this and check the list before trying again.",
    submit: "Create staff record",
    submitting: "Creating staff record…",
    cancel: "Cancel",
    doneTitle: "Staff record created",
    done: (name: string) => `${name} now has a staff record.`,
    failedTitle: "Staff record not created",
  },

  retire: {
    title: (name: string) => `Retire ${name}'s device-only record?`,
    body:
      "They already have an online staff account with the same email. This switches off the old record on this device only; their online account is not changed.",
    confirm: "Retire record",
    doneTitle: "Record retired",
    done: (name: string) => `The device-only record for ${name} is switched off.`,
  },

  deleteDeviceOnly: {
    body: (name: string) =>
      `${name} exists on this device only. Deleting removes them from this device. Nothing on the server changes.`,
  },
} as const;

/** A toast: tone, title and body. */
export interface StaffMessage {
  tone: ToastTone;
  title: string;
  body: string;
}

function notSentBody(invitation: InvitationResult): string {
  const reason = invitation.error;
  if (reason === "email_not_configured" || reason === "email_rate_limited") {
    return STAFF_COPY.emailNotSent[reason];
  }
  return STAFF_COPY.emailNotSent.send_failed;
}

/** The toast after Add Staff (or Create login) created an account. */
export function createResultMessage(
  name: string,
  email: string,
  invitation: InvitationResult,
  inviteLifetimeSeconds: number,
): StaffMessage {
  if (invitation.sent) {
    return {
      tone: "success",
      title: STAFF_COPY.invite.successTitle,
      body: `Account created for ${name}. We've emailed ${email} a link to set their password. The link works once and expires ${inviteLifetimeText(inviteLifetimeSeconds)}.`,
    };
  }
  if (invitation.error === "email_not_configured") {
    return {
      tone: "warning",
      title: STAFF_COPY.invite.notSentTitle,
      body: `Account created for ${name}, but the invitation email didn't go out because outgoing email isn't set up yet. Use Resend invitation once it is.`,
    };
  }
  if (invitation.error === "email_rate_limited") {
    return {
      tone: "warning",
      title: STAFF_COPY.invite.notSentTitle,
      body: `Account created for ${name}, but the invitation email didn't go out because too many emails were sent. Use Resend invitation on their row later.`,
    };
  }
  return {
    tone: "warning",
    title: STAFF_COPY.invite.notSentTitle,
    body: `Account created for ${name}, but the invitation email didn't go out. Use Resend invitation on their row.`,
  };
}

/** The toast after Resend invitation. */
export function resendResultMessage(email: string, invitation: InvitationResult): StaffMessage {
  if (!invitation.sent) {
    return { tone: "warning", title: STAFF_COPY.resend.failedTitle, body: notSentBody(invitation) };
  }
  return {
    tone: "success",
    title: STAFF_COPY.resend.sentTitle,
    body:
      invitation.via === "recovery"
        ? STAFF_COPY.resend.sentRecovery
        : STAFF_COPY.resend.sentInvite(email),
  };
}

/** The toast after Reset password. */
export function resetPasswordResultMessage(
  email: string,
  invitation: InvitationResult,
): StaffMessage {
  if (!invitation.sent) {
    return {
      tone: "warning",
      title: STAFF_COPY.resetPassword.failedTitle,
      body: notSentBody(invitation),
    };
  }
  return {
    tone: "success",
    title: STAFF_COPY.resetPassword.sentTitle,
    body: STAFF_COPY.resetPassword.sent(email),
  };
}

/** The toast after Disable. */
export function disableResultMessage(name: string, rowUpdated: boolean): StaffMessage {
  if (!rowUpdated) {
    return { tone: "warning", title: STAFF_COPY.disable.partialTitle, body: STAFF_COPY.disable.partial };
  }
  return { tone: "success", title: STAFF_COPY.disable.doneTitle, body: STAFF_COPY.disable.done(name) };
}

// ---------------------------------------------------------------------------
// Status labels

export interface StatusLabel {
  label: string;
  caption: string | null;
  /** StatusBadge tone. */
  tone: Tone;
}

/** Badge text, caption and tone for a server account status. */
export function statusLabel(
  status: AccountStatus,
  detail: StatusDetail,
  disablePartial = false,
): StatusLabel {
  const c = STAFF_COPY.caption;
  switch (status) {
    case "invited":
      return {
        label: STAFF_COPY.badge.invited,
        caption: detail === "expired" ? c.expired : null,
        tone: "info",
      };
    case "active":
      return {
        label: STAFF_COPY.badge.active,
        caption: detail === "never_signed_in" ? c.never_signed_in : null,
        tone: "success",
      };
    case "disabled": {
      let caption: string | null = null;
      if (detail === "by_admin" && disablePartial) caption = c.disable_partial;
      else if (detail === "no_staff_role") caption = c.no_staff_role;
      else if (detail === "switched_off") caption = c.switched_off;
      return { label: STAFF_COPY.badge.disabled, caption, tone: "neutral" };
    }
    case "setup_required": {
      let caption: string | null = null;
      if (detail === "no_login") caption = c.no_login;
      else if (detail === "invitation_not_sent") caption = c.invitation_not_sent;
      else if (detail === "password_not_set") caption = c.password_not_set;
      return { label: STAFF_COPY.badge.setup_required, caption, tone: "warning" };
    }
  }
  return { label: STAFF_COPY.badge.unchecked, caption: null, tone: "neutral" };
}

// ---------------------------------------------------------------------------
// Merging this device's records with the server's accounts

export type StaffRowSource =
  /** On the server (the overview lists it). */
  | "server"
  /** Created on this device and never on the server. */
  | "device_only"
  /** No overview yet, so the server was not asked. */
  | "unchecked"
  /** Came from the server before, but the server no longer lists it. */
  | "missing";

export type DeviceNote = "off_on_device" | "needs_review";

export interface StaffRow {
  id: string;
  fullName: string;
  role: string;
  email: string | null;
  source: StaffRowSource;
  account: AccountView | null;
  device: User | null;
  deviceNote: DeviceNote | null;
  /** A device-only record whose email belongs to a server account. */
  sameEmailServerAccount: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function syncedAt(u: User): unknown {
  return (u as unknown as { _syncedAt?: unknown })._syncedAt;
}

function normEmail(value: string | null | undefined): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email === "" ? null : email;
}

/**
 * Whether a staff record exists on this device only: its id is not a uuid
 * (records made on a device get a ULID), or the server's list is loaded,
 * does not have it and it was never downloaded from the server.
 */
export function isDeviceOnlyRecord(u: User, serverIds: Set<string> | null): boolean {
  if (!UUID.test(u.id)) return true;
  if (!serverIds) return false;
  if (serverIds.has(u.id.toLowerCase())) return false;
  return !syncedAt(u);
}

/**
 * Whether a record was downloaded after the server's list was read, so the
 * list is too old to say the server dropped it.
 */
function downloadedAfter(u: User, checkedAt: number): boolean {
  const at = syncedAt(u);
  if (typeof at !== "string" || !Number.isFinite(checkedAt)) return false;
  const synced = Date.parse(at);
  return Number.isFinite(synced) && synced > checkedAt;
}

/** The note beside a server account's status about its record on this device. */
function deviceNoteFor(account: AccountView, device: User | null): DeviceNote | null {
  if (!device) return null;
  // A server-disabled account that is off here is expected, never a
  // conflict to review.
  if (device.accessConflict === 1 && account.status !== "disabled") return "needs_review";
  if (device.isActive === 0 || device.accessConflict === 1) return "off_on_device";
  return null;
}

/**
 * One row per person: every server account (with its record on this device,
 * when there is one), then the records on this device the server does not
 * list. Without an overview, every record on this device is a row.
 */
export function mergeStaffRows(
  deviceUsers: User[],
  overview: OverviewResponse | null,
): StaffRow[] {
  if (!overview) {
    return deviceUsers.map((u): StaffRow => ({
      id: u.id,
      fullName: u.fullName,
      role: u.role,
      email: u.email?.trim() || null,
      source: isDeviceOnlyRecord(u, null) ? "device_only" : "unchecked",
      account: null,
      device: u,
      deviceNote: null,
      sameEmailServerAccount: false,
    }));
  }

  const deviceById = new Map<string, User>();
  for (const u of deviceUsers) deviceById.set(u.id.toLowerCase(), u);

  const serverIds = new Set<string>();
  const serverEmails = new Set<string>();
  const accounts = [...overview.accounts].sort((a, b) =>
    (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
  );
  const rows: StaffRow[] = [];
  for (const account of accounts) {
    const id = account.userId.toLowerCase();
    if (serverIds.has(id)) continue;
    serverIds.add(id);
    const email = normEmail(account.email);
    if (email) serverEmails.add(email);
    const device = deviceById.get(id) ?? null;
    rows.push({
      id: account.userId,
      fullName: account.fullName || device?.fullName || "",
      role: account.role,
      email: account.email,
      source: "server",
      account,
      device,
      deviceNote: deviceNoteFor(account, device),
      sameEmailServerAccount: false,
    });
  }

  const checkedAt = Date.parse(overview.checkedAt);
  for (const u of deviceUsers) {
    if (serverIds.has(u.id.toLowerCase())) continue;
    const email = normEmail(u.email);
    const deviceOnly = isDeviceOnlyRecord(u, serverIds);
    rows.push({
      id: u.id,
      fullName: u.fullName,
      role: u.role,
      email: u.email?.trim() || null,
      source: deviceOnly
        ? "device_only"
        : downloadedAfter(u, checkedAt)
          ? "unchecked"
          : "missing",
      account: null,
      device: u,
      deviceNote: null,
      sameEmailServerAccount: deviceOnly && email !== null && serverEmails.has(email),
    });
  }
  return rows;
}

/** Badge text, caption and tone for any row. */
export function rowStatusLabel(row: StaffRow): StatusLabel {
  if (row.account) {
    return statusLabel(row.account.status, row.account.statusDetail, row.account.disablePartial);
  }
  if (row.source === "device_only") {
    return { label: STAFF_COPY.badge.device_only, caption: null, tone: "neutral" };
  }
  if (row.source === "missing") {
    return { label: STAFF_COPY.badge.missing, caption: STAFF_COPY.caption.missing, tone: "neutral" };
  }
  return { label: STAFF_COPY.badge.unchecked, caption: null, tone: "neutral" };
}

// ---------------------------------------------------------------------------
// Row actions

export type RowActionKind =
  // Server actions (need the screen state "ready" and a connection).
  /** Name and role through the server's update action (EditStaffAccountDialog). */
  | "edit_account"
  | "resend_invitation"
  | "reset_password"
  | "login_status"
  | "disable"
  | "reactivate"
  | "create_login"
  // Actions on this device's record.
  /**
   * The existing edit form on this device: the whole form for a
   * device-only record; for a server account only its PIN section matters.
   */
  | "edit_on_device"
  | "reset_device_pin"
  | "deactivate_on_device"
  | "activate_on_device"
  /** Device-only records only. */
  | "delete"
  /** Device-only record whose email belongs to a server account. */
  | "retire_device_record";

export interface RowAction {
  kind: RowActionKind;
  label: string;
  /** Calls the server. */
  server: boolean;
  /** Shown in the danger style. */
  danger: boolean;
}

export interface RowActionContext {
  currentUserId: string | null | undefined;
  /** Whether the signed-in administrator is a permanent administrator. */
  currentUserPermanent: boolean;
  /** The screen state is "ready" (the overview loaded). */
  serverReady: boolean;
  online: boolean;
  /**
   * The roles the server lets this administrator give (`overview.roles`).
   * Create login is only offered for a staff record with one of them, as
   * the server refuses every other role.
   */
  offeredRoles: readonly string[];
}

function action(kind: RowActionKind, label: string, server: boolean, danger = false): RowAction {
  return { kind, label, server, danger };
}

function hasPin(u: User): boolean {
  // Same rule as hasDevicePin (src/db/offlineAccess.ts).
  return !!u.pinHash && !!u.pinSalt;
}

/** Actions on this device's record, the same rules as the device PIN form. */
function deviceActions(
  row: StaffRow,
  ctx: RowActionContext,
  opts: { self: boolean; permanent: boolean; serverDisabled: boolean },
): RowAction[] {
  const u = row.device;
  if (!u) return [];
  const out: RowAction[] = [];
  const canEdit = !(opts.permanent && !ctx.currentUserPermanent);
  if (canEdit) {
    // No new PIN for someone the server has disabled; removing one is
    // always safe.
    if (!opts.serverDisabled) {
      out.push(
        action(
          "edit_on_device",
          row.source === "server" ? STAFF_COPY.action.set_device_pin : STAFF_COPY.action.edit,
          false,
        ),
      );
    }
    if (hasPin(u)) out.push(action("reset_device_pin", STAFF_COPY.action.reset_device_pin, false));
  }
  // A record the staff directory download switched off (not switched off
  // by hand here) stays off until the server lists it as active again.
  const offByDownload =
    !row.account &&
    row.source !== "device_only" &&
    !!syncedAt(u) &&
    !u.disabledLocallyAt &&
    u.accessConflict !== 1;
  if (!opts.self && !opts.permanent) {
    if (u.isActive === 1 && u.accessConflict !== 1) {
      out.push(action("deactivate_on_device", STAFF_COPY.action.deactivate_on_device, false));
    } else if (!opts.serverDisabled && !offByDownload) {
      out.push(action("activate_on_device", STAFF_COPY.action.activate_on_device, false));
    }
  }
  return out;
}

/**
 * The actions a row offers. Server actions need `serverReady` and `online`.
 * Nobody can disable or reactivate their own account, and permanent
 * administrators are never disabled. Delete is only for records that exist
 * on this device alone.
 */
export function rowActions(row: StaffRow, ctx: RowActionContext): RowAction[] {
  const self = !!ctx.currentUserId && row.id.toLowerCase() === ctx.currentUserId.toLowerCase();
  const account = row.account;
  const permanent = account?.adminPermanent === true || row.device?.adminPermanent === true;
  const out: RowAction[] = [];

  if (account && row.source === "server") {
    if (ctx.serverReady && ctx.online) {
      const a = STAFF_COPY.action;
      const canDisable = !self && !account.adminPermanent;
      switch (account.status) {
        case "invited":
          out.push(action("resend_invitation", a.resend_invitation, true));
          break;
        case "setup_required":
          if (account.statusDetail !== "no_login") {
            out.push(action("resend_invitation", a.resend_invitation, true));
          }
          break;
        case "active":
          out.push(action("reset_password", a.reset_password, true));
          break;
        case "disabled":
          // A switched-off record is not something Reactivate can undo.
          if (!self && account.statusDetail !== "switched_off") {
            out.push(action("reactivate", a.reactivate, true));
          }
          break;
      }
      if (account.status !== "disabled") out.push(action("edit_account", a.edit, true));
      out.push(action("login_status", a.login_status, true));
      if (
        account.status === "setup_required" &&
        account.statusDetail === "no_login" &&
        !account.adminPermanent &&
        (account.role !== "admin" || ctx.currentUserPermanent) &&
        ctx.offeredRoles.includes(account.role)
      ) {
        out.push(action("create_login", a.create_login, true));
      }
      const hasLogin = !(account.status === "setup_required" && account.statusDetail === "no_login");
      // Disable again finishes a disable that devices were not told about.
      const disableAgain = account.status === "disabled" && account.disablePartial;
      if (canDisable && hasLogin && (account.status !== "disabled" || disableAgain)) {
        out.push(action("disable", a.disable, true, true));
      }
    }
    out.push(
      ...deviceActions(row, ctx, {
        self,
        permanent,
        serverDisabled: account.status === "disabled",
      }),
    );
    return out;
  }

  out.push(...deviceActions(row, ctx, { self, permanent, serverDisabled: false }));
  if (row.source === "device_only") {
    if (!self && !permanent) out.push(action("delete", STAFF_COPY.action.delete, false, true));
    if (row.sameEmailServerAccount && row.device?.isActive === 1 && !self && !permanent) {
      out.push(action("retire_device_record", STAFF_COPY.action.retire_device_record, false));
    }
  }
  return out;
}

/**
 * Whether moving someone off the administrator role (Disable, or Edit to
 * another role) can't be undone from this screen: they are an administrator
 * and the server does not let this administrator give the role
 * (`overview.roles` has no admin while administrator accounts can't be
 * added here).
 */
export function adminRoleIsOneWay(role: string, offeredRoles: readonly string[]): boolean {
  return role === "admin" && !offeredRoles.includes("admin");
}

// ---------------------------------------------------------------------------
// Account health

/** The sentence describing one Account Health problem. */
export function healthItemText(item: HealthItem): string {
  const h = STAFF_COPY.health;
  const name = item.fullName?.trim() || h.unnamed;
  switch (item.kind) {
    case "staff_without_login":
      return h.staffWithoutLogin(name);
    case "staff_without_login_no_role":
      return h.staffWithoutLoginNoRole(name);
    case "staff_login_without_record":
      return h.staffLoginWithoutRecord(item.email ?? item.emailMasked ?? h.unknownEmail);
    case "unknown_login":
      return h.unknownLogin(item.emailMasked ?? h.unknownEmail);
    case "staff_record_outside_users":
      return h.staffRecordOutsideUsers(name);
  }
  return h.unknownLogin(item.emailMasked ?? h.unknownEmail);
}

/** What else is known about a problem's account, from the overview. */
export interface HealthItemContext {
  /** The role on the item's staff record, from `overview.accounts`, when known. */
  role?: string | null;
  /** The roles this administrator can give (`overview.roles`). */
  offeredRoles?: readonly string[];
}

/**
 * A Create login repair the server would refuse: the staff record's role is
 * not one this administrator can give (for example Administrator while
 * administrator accounts can't be added here).
 */
export function healthRoleNotOffered(item: HealthItem, ctx: HealthItemContext = {}): boolean {
  return (
    item.repair === "create_login" &&
    !!ctx.role &&
    !!ctx.offeredRoles &&
    !ctx.offeredRoles.includes(ctx.role)
  );
}

/** Why a problem has no repair button, or null. */
export function healthBlockedText(item: HealthItem, ctx: HealthItemContext = {}): string | null {
  if (item.blocked === "login_unconfirmed") return STAFF_COPY.health.blockedUnconfirmed;
  if (item.blocked === "no_staff_role") {
    return ctx.role && !isStaffRole(ctx.role)
      ? STAFF_COPY.health.blockedNotStaff
      : STAFF_COPY.health.blockedNoRole;
  }
  if (healthRoleNotOffered(item, ctx)) {
    return ctx.role === "admin"
      ? STAFF_COPY.health.blockedAdminNotOffered
      : STAFF_COPY.health.blockedRoleNotOffered;
  }
  if (item.kind === "staff_without_login" && item.repair === null) {
    return STAFF_COPY.health.permanentAdminNoRepair;
  }
  return null;
}

/** The Account Health header: "Account health (2 problems)" or "Account health". */
export function healthTitle(problemCount: number): string {
  return problemCount > 0
    ? STAFF_COPY.health.titleWithCount(problemCount)
    : STAFF_COPY.health.title;
}

/**
 * The roles Add Staff offers, from the server's list. `admin` is listed only
 * when the server offers it; `adminDisabled` says the caller cannot give it.
 */
export function inviteRoleOptions(
  overview: Pick<OverviewResponse, "roles" | "adminRoleNeedsPermanent" | "caller">,
): { value: string; label: string; disabled: boolean }[] {
  return overview.roles.map((role) => ({
    value: role,
    label: roleName(role),
    disabled:
      role === "admin" && overview.adminRoleNeedsPermanent && !overview.caller.adminPermanent,
  }));
}

/** The caption under the role picker, or null when admin can be chosen. */
export function inviteRoleCaption(
  overview: Pick<OverviewResponse, "roles" | "adminRoleNeedsPermanent" | "caller">,
): string | null {
  if (!overview.roles.includes("admin")) return STAFF_COPY.invite.adminUnavailable;
  if (overview.adminRoleNeedsPermanent && !overview.caller.adminPermanent) {
    return STAFF_COPY.invite.adminNeedsPermanent;
  }
  return null;
}
