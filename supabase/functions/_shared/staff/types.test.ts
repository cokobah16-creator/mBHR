import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  AccountStatus,
  AccountView,
  HealthReport,
  InvitationResult,
  OverviewResponse,
  StaffAdminErrorBody,
  StatusDetail,
} from "./types";

// Source text of this module, so the test can check it stays a leaf.
const SOURCE = import.meta.glob("./types.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const ACCOUNT: AccountView = {
  userId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  fullName: "Test Person",
  role: "nurse",
  adminAccess: false,
  adminPermanent: false,
  email: "test.person@example.org",
  status: "invited",
  statusDetail: "pending",
  disablePartial: false,
  invitedAt: "2026-09-25T10:00:00.000Z",
  emailConfirmedAt: null,
  lastSignInAt: null,
  passwordSetAt: null,
  createdAt: "2026-09-25T10:00:00.000Z",
  createdVia: "users_screen",
  createdByName: "Admin Person",
  disabledAt: null,
  disabledByName: null,
};

describe("staff-admin reply types", () => {
  it("has no imports, so the browser app can use it with import type", () => {
    const text = SOURCE["./types.ts"];
    expect(text).toBeTruthy();
    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).not.toMatch(/^\s*export\s+(const|function|class|let|var)\s/m);
  });

  it("describes an account without any PIN field", () => {
    for (const key of Object.keys(ACCOUNT)) expect(key).not.toMatch(/pin/i);
    expectTypeOf(ACCOUNT.status).toEqualTypeOf<AccountStatus>();
    expectTypeOf(ACCOUNT.statusDetail).toEqualTypeOf<StatusDetail>();
    expectTypeOf<AccountView["linkedPatientRecord"]>().toEqualTypeOf<boolean | undefined>();
  });

  it("builds a full overview reply", () => {
    const health: HealthReport = {
      problems: [
        {
          kind: "unknown_login",
          userId: "0b6f1d2e-3c4a-4b5c-9d6e-7f8091a2b3c4",
          email: null,
          emailMasked: "a•••@e•••.org",
          fullName: null,
          createdAt: null,
          repair: null,
          blocked: "login_unconfirmed",
        },
      ],
      counts: { portalPatients: 1, portalSignups: 0, anonymous: 0 },
      truncated: false,
    };
    const overview: OverviewResponse = {
      checkedAt: "2026-09-25T10:00:00.000Z",
      accounts: [ACCOUNT],
      health,
      roles: ["volunteer", "nurse"],
      adminRoleNeedsPermanent: true,
      inviteLifetimeSeconds: 3600,
      caller: { userId: ACCOUNT.userId, adminPermanent: true },
    };
    expect(overview.accounts[0].status).toBe("invited");
    expect(overview.health.problems[0].email).toBeNull();
  });

  it("reports an invitation that was not sent with a reason", () => {
    const result: InvitationResult = { sent: false, via: null, error: "email_not_configured" };
    expect(result.sent).toBe(false);
    expectTypeOf<InvitationResult["error"]>().toEqualTypeOf<
      "email_not_configured" | "email_rate_limited" | "send_failed" | undefined
    >();
  });

  it("marks every error body as coming from staff-admin", () => {
    const body: StaffAdminErrorBody = {
      fn: "staff-admin",
      success: false,
      error: "not_permitted",
      message: "Only an administrator can manage staff accounts.",
    };
    expect(body.fn).toBe("staff-admin");
    expectTypeOf<StaffAdminErrorBody["fn"]>().toEqualTypeOf<"staff-admin">();
  });
});
