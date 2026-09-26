// Fixed values for the staff-admin edge function (staff account setup).
//
// Pure values (no Deno APIs, no imports) so they can be unit tested with
// vitest/bun, and so the browser app can check them against its own role
// list (src/auth/staffRolesParity.test.ts).

/** The function name, echoed as `fn` in every reply. */
export const STAFF_ADMIN_SERVICE = "staff-admin";

/** Returned by `ping`. Raise it when the request or reply shape changes. */
export const STAFF_ADMIN_VERSION = "1";

/** Who may call every action other than `ping`: administrators only. */
export const STAFF_ADMIN_ROLES: readonly string[] = ["admin"];

/** Every action the function accepts. */
export const STAFF_ADMIN_ACTIONS = [
  "ping",
  "overview",
  "login_status",
  "create",
  "update",
  "resend_invitation",
  "reset_password",
  "disable",
  "reactivate",
  "create_login",
  "create_staff_record",
] as const;

/**
 * Every staff role the app knows: the keys of ROLE_PERMISSIONS in
 * src/auth/roles.ts other than "guest" (the same rule as isStaffRole there).
 */
export const KNOWN_STAFF_ROLES: readonly string[] = [
  "volunteer",
  "nurse",
  "doctor",
  "pharmacist",
  "admin",
  "registration_lead",
  "auditor",
  "lead_clinician",
];

/**
 * Roles an administrator may give from the Users screen: every staff role,
 * never "guest". registration_lead is on production since Wave B
 * (20260925100600); auditor and lead_clinician were already there. Giving
 * "admin" also needs ADMIN_ACCOUNTS_ENABLED and a permanent administrator.
 */
export const PROVISIONABLE_ROLES: readonly string[] = [
  "volunteer",
  "registration_lead",
  "nurse",
  "doctor",
  "pharmacist",
  "lead_clinician",
  "auditor",
  "admin",
];

/** The role a disabled account's staff record is set to. */
export const DISABLED_ROLE = "guest";

/** Full name length, after trimming and collapsing spaces. */
export const NAME_MIN = 2;
export const NAME_MAX = 120;

/** Longest email address accepted (RFC 5321 path limit). */
export const EMAIL_MAX = 254;

/** Largest request body accepted, in bytes. */
export const BODY_MAX_BYTES = 8192;

/** A ban long enough to be permanent (100 years), as the Auth docs use. */
export const BAN_DURATION = "876000h";

/** The ban duration that lifts a ban. */
export const UNBAN = "none";

/**
 * Disable bans the login and also sets the staff record's role to "guest",
 * keeping the previous role on the login so Reactivate can restore it. When
 * false, Disable only bans the login and is refused for administrators.
 */
export const DISABLE_DEMOTES_ROLE: boolean = true;

/**
 * Whether this function may make or restore an administrator: create with
 * the admin role, update to admin, reactivate into admin, or create_login
 * for an admin record. Only a permanent administrator may. On since Wave A
 * (20260924110200) reached production: no signed-in caller can change a
 * permanent administrator's record through the API any more. Set it to
 * false to refuse all of these with admin_accounts_unavailable.
 */
export const ADMIN_ACCOUNTS_ENABLED: boolean = true;

/** Rate-limit buckets (public.check_and_increment_rate_limit). */
export const STAFF_IP_BUCKET = "edge_staff_admin";
export const STAFF_ACTION_BUCKET = "staff_admin_user";
export const STAFF_OVERVIEW_BUCKET = "staff_admin_overview";
export const STAFF_EMAIL_ACTOR_BUCKET = "staff_admin_email_user";
export const STAFF_EMAIL_RECIPIENT_BUCKET = "staff_admin_email_recipient";

/** Per IP address, before sign-in is checked (fails open). */
export const STAFF_IP_LIMIT = { max: 30, windowSeconds: 60 } as const;
/** Per signed-in caller, every action (fails closed). */
export const STAFF_ACTION_LIMIT = { max: 60, windowSeconds: 600 } as const;
/** Per signed-in caller, the `overview` action. */
export const STAFF_OVERVIEW_LIMIT = { max: 10, windowSeconds: 600 } as const;
/** Per signed-in caller, actions that send an email. */
export const STAFF_EMAIL_ACTOR_LIMIT = { max: 30, windowSeconds: 3600 } as const;
/** Per recipient (hashed email), actions that send an email. */
export const STAFF_EMAIL_RECIPIENT_LIMIT = { max: 5, windowSeconds: 3600 } as const;

/** How long an invitation link lasts unless STAFF_INVITE_LIFETIME_SECONDS says otherwise. */
export const DEFAULT_INVITE_LIFETIME_SECONDS = 3600;
export const INVITE_LIFETIME_MIN_SECONDS = 300;
export const INVITE_LIFETIME_MAX_SECONDS = 86400;

/** A `create` retry with the same id may resume for this long. */
export const RESUME_WINDOW_SECONDS = 86400;

/** A resumed `create` does not resend an invitation sent this recently. */
export const RESEND_MIN_GAP_SECONDS = 60;

/** Where invitation and reset links point unless STAFF_APP_ORIGIN is set. */
export const DEFAULT_STAFF_APP_ORIGIN = "https://mbhr.app";

/** Paging limits for reading logins and staff records. */
export const LIST_USERS_PER_PAGE = 1000;
export const LIST_USERS_MAX_PAGES = 20;
export const APP_USERS_PAGE_SIZE = 1000;
export const MAX_ADMIN_ROWS_CHECKED = 50;

/**
 * user_metadata keys the patient portal sign-up writes
 * (src/hooks/useAuth.ts). A login with any of them came from the portal.
 */
export const PORTAL_SIGNUP_KEYS: readonly string[] = [
  "dob",
  "given_name",
  "family_name",
  "terms_version",
  "privacy_version",
  "accepted_at",
];

/**
 * app_metadata keys this function writes on a login. app_metadata is set by
 * the server only; the person cannot change it.
 */
export const APP_META = {
  account: "mbhr_account",
  createdBy: "mbhr_created_by",
  createdAt: "mbhr_created_at",
  initialRole: "mbhr_initial_role",
  repair: "mbhr_repair",
  repairBy: "mbhr_repair_by",
  repairAt: "mbhr_repair_at",
  disabledRole: "mbhr_disabled_role",
  disabledAdminAccess: "mbhr_disabled_admin_access",
  disabledBy: "mbhr_disabled_by",
  disabledAt: "mbhr_disabled_at",
  lastAction: "mbhr_last_action",
  lastActionBy: "mbhr_last_action_by",
  lastActionAt: "mbhr_last_action_at",
} as const;

/** The app_metadata.mbhr_account value that tags a staff login. */
export const STAFF_ACCOUNT_TAG = "staff";

/**
 * user_metadata key the reset page writes when a staff member sets their
 * password. The person can edit user_metadata, so it is for display only.
 */
export const PASSWORD_SET_META = "mbhr_password_set_at";
