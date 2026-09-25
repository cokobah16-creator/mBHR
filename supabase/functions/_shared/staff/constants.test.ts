import { describe, it, expect } from "vitest";
import {
  ADMIN_ACCOUNTS_ENABLED,
  APP_META,
  BAN_DURATION,
  BODY_MAX_BYTES,
  DEFAULT_INVITE_LIFETIME_SECONDS,
  DISABLE_DEMOTES_ROLE,
  DISABLED_ROLE,
  EMAIL_MAX,
  INVITE_LIFETIME_MAX_SECONDS,
  INVITE_LIFETIME_MIN_SECONDS,
  KNOWN_STAFF_ROLES,
  NAME_MAX,
  NAME_MIN,
  PORTAL_SIGNUP_KEYS,
  PROVISIONABLE_ROLES,
  STAFF_ACTION_BUCKET,
  STAFF_ACTION_LIMIT,
  STAFF_ADMIN_ACTIONS,
  STAFF_ADMIN_ROLES,
  STAFF_ADMIN_SERVICE,
  STAFF_EMAIL_ACTOR_BUCKET,
  STAFF_EMAIL_ACTOR_LIMIT,
  STAFF_EMAIL_RECIPIENT_BUCKET,
  STAFF_EMAIL_RECIPIENT_LIMIT,
  STAFF_OVERVIEW_BUCKET,
  STAFF_OVERVIEW_LIMIT,
  UNBAN,
} from "./constants";

// Source text of this module, so the test can check it stays a leaf.
const SOURCE = import.meta.glob("./constants.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("staff-admin constants", () => {
  it("has no imports, so the browser app can load it for the role parity check", () => {
    const text = SOURCE["./constants.ts"];
    expect(text).toBeTruthy();
    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).not.toMatch(/\bDeno\./);
  });

  it("lets only administrators call the function", () => {
    expect(STAFF_ADMIN_SERVICE).toBe("staff-admin");
    expect(STAFF_ADMIN_ROLES).toEqual(["admin"]);
  });

  it("lists every action once", () => {
    expect([...STAFF_ADMIN_ACTIONS].sort()).toEqual(
      [
        "create",
        "create_login",
        "create_staff_record",
        "disable",
        "login_status",
        "overview",
        "ping",
        "reactivate",
        "reset_password",
        "resend_invitation",
        "update",
      ].sort(),
    );
    expect(new Set(STAFF_ADMIN_ACTIONS).size).toBe(STAFF_ADMIN_ACTIONS.length);
  });

  it("offers only confirmed roles, all of them staff roles, and never guest", () => {
    expect([...PROVISIONABLE_ROLES]).toEqual(["volunteer", "nurse", "doctor", "pharmacist", "admin"]);
    for (const role of PROVISIONABLE_ROLES) expect(KNOWN_STAFF_ROLES).toContain(role);
    expect(KNOWN_STAFF_ROLES).not.toContain("guest");
    expect(PROVISIONABLE_ROLES).not.toContain("guest");
    expect(PROVISIONABLE_ROLES).not.toContain("registration_lead");
    expect(new Set(KNOWN_STAFF_ROLES).size).toBe(KNOWN_STAFF_ROLES.length);
  });

  it("disables by banning the login and setting the role to guest", () => {
    expect(DISABLE_DEMOTES_ROLE).toBe(true);
    expect(DISABLED_ROLE).toBe("guest");
    expect(BAN_DURATION).toBe("876000h");
    expect(UNBAN).toBe("none");
  });

  it("does not make or restore administrators until the database protects them", () => {
    expect(ADMIN_ACCOUNTS_ENABLED).toBe(false);
  });

  it("keeps the request and name limits", () => {
    expect(BODY_MAX_BYTES).toBe(8192);
    expect(EMAIL_MAX).toBe(254);
    expect(NAME_MIN).toBe(2);
    expect(NAME_MAX).toBe(120);
  });

  it("uses its own rate-limit buckets and limits", () => {
    const buckets = [
      STAFF_ACTION_BUCKET,
      STAFF_OVERVIEW_BUCKET,
      STAFF_EMAIL_ACTOR_BUCKET,
      STAFF_EMAIL_RECIPIENT_BUCKET,
    ];
    expect(new Set(buckets).size).toBe(4);
    for (const bucket of buckets) expect(bucket).toMatch(/^staff_admin_/);
    expect(STAFF_ACTION_LIMIT).toEqual({ max: 60, windowSeconds: 600 });
    expect(STAFF_OVERVIEW_LIMIT).toEqual({ max: 10, windowSeconds: 600 });
    expect(STAFF_EMAIL_ACTOR_LIMIT).toEqual({ max: 30, windowSeconds: 3600 });
    expect(STAFF_EMAIL_RECIPIENT_LIMIT).toEqual({ max: 5, windowSeconds: 3600 });
  });

  it("keeps the default invitation lifetime inside the allowed range", () => {
    expect(DEFAULT_INVITE_LIFETIME_SECONDS).toBe(3600);
    expect(DEFAULT_INVITE_LIFETIME_SECONDS).toBeGreaterThanOrEqual(INVITE_LIFETIME_MIN_SECONDS);
    expect(DEFAULT_INVITE_LIFETIME_SECONDS).toBeLessThanOrEqual(INVITE_LIFETIME_MAX_SECONDS);
  });

  it("names the portal sign-up keys and the server-only login keys", () => {
    expect([...PORTAL_SIGNUP_KEYS]).toEqual([
      "dob",
      "given_name",
      "family_name",
      "terms_version",
      "privacy_version",
      "accepted_at",
    ]);
    for (const key of Object.values(APP_META)) expect(key).toMatch(/^mbhr_[a-z_]+$/);
    expect(new Set(Object.values(APP_META)).size).toBe(Object.values(APP_META).length);
  });
});
