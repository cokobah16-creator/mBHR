// Reply shapes of the staff-admin edge function (staff account setup).
//
// Types only, with no imports, so the browser app can use them with
// `import type` and the Deno function and the app always agree.

export type AccountStatus = "invited" | "active" | "disabled" | "setup_required";

export type StatusDetail =
  // invited
  | "pending"
  | "expired"
  // setup_required
  | "no_login"
  | "invitation_not_sent"
  | "password_not_set"
  // disabled
  | "by_admin"
  | "switched_off"
  | "no_staff_role"
  // active
  | "signed_in"
  | "never_signed_in";

/** One staff account: a staff record, and its login when there is one. */
export interface AccountView {
  userId: string;
  fullName: string;
  role: string;
  adminAccess: boolean;
  adminPermanent: boolean;
  email: string | null;
  status: AccountStatus;
  statusDetail: StatusDetail;
  /** The login is banned but the staff record still has a staff role. */
  disablePartial: boolean;
  invitedAt: string | null;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  /** Set by the reset page; the person can edit it, so display only. */
  passwordSetAt: string | null;
  createdAt: string;
  createdVia: "users_screen" | "repair" | "not_recorded";
  createdByName: string | null;
  disabledAt: string | null;
  disabledByName: string | null;
  /**
   * The login is also linked to a patient record. It is still a staff
   * account: this is information only and never blocks anything.
   */
  linkedPatientRecord?: boolean;
}

export interface InvitationResult {
  sent: boolean;
  via: "invite" | "recovery" | null;
  alreadySent?: boolean;
  error?: "email_not_configured" | "email_rate_limited" | "send_failed";
}

export type HealthKind =
  | "staff_without_login"
  | "staff_without_login_no_role"
  | "staff_login_without_record"
  | "unknown_login"
  | "staff_record_outside_users";

export interface HealthItem {
  kind: HealthKind;
  userId: string;
  /** Full email only for staff accounts; null otherwise. */
  email: string | null;
  emailMasked: string | null;
  fullName: string | null;
  createdAt: string | null;
  repair: "create_login" | "create_staff_record" | null;
  blocked?: "login_unconfirmed" | "no_staff_role";
}

export interface HealthReport {
  problems: HealthItem[];
  counts: { portalPatients: number; portalSignups: number; anonymous: number };
  /** Not every login could be read; some problems may be missing. */
  truncated: boolean;
}

export interface OverviewResponse {
  checkedAt: string;
  accounts: AccountView[];
  health: HealthReport;
  roles: string[];
  adminRoleNeedsPermanent: boolean;
  inviteLifetimeSeconds: number;
  caller: { userId: string; adminPermanent: boolean };
}

/** Fields present on every reply. */
export interface StaffAdminReplyBase {
  fn: "staff-admin";
  success: boolean;
}

/** A refused or failed request. */
export interface StaffAdminErrorBody extends StaffAdminReplyBase {
  success: false;
  error: string;
  message: string;
  field?: string;
  retry_after_seconds?: number;
  loginLeftBehind?: boolean;
}

/** `ping`. */
export interface PingResponse {
  version: string;
}

/** `login_status` and `update`. */
export interface AccountResponse {
  account: AccountView;
}

/** `create` and `create_login`. */
export interface CreateResponse {
  userId: string;
  status: "invited";
  invitation: InvitationResult;
  resumed?: boolean;
}

/** `resend_invitation` and `reset_password`. */
export interface InvitationResponse {
  invitation: InvitationResult;
}

/** `disable`. */
export interface DisableResponse {
  status: "disabled";
  /** Whether the staff record's role was set to "guest". */
  rowUpdated: boolean;
  alreadyDisabled?: boolean;
}

/** `reactivate`. */
export interface ReactivateResponse {
  status: AccountStatus;
  role: string;
}

/** `create_staff_record`. */
export interface CreateStaffRecordResponse {
  userId: string;
  status: AccountStatus;
}
