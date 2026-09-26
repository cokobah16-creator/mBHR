import { describe, it, expect } from "vitest";
import type { User } from "@/db";
import type {
  AccountStatus,
  AccountView,
  HealthItem,
  OverviewResponse,
  StatusDetail,
} from "../../../supabase/functions/_shared/staff/types";
import {
  STAFF_COPY,
  adminRoleIsOneWay,
  createResultMessage,
  disableResultMessage,
  healthBlockedText,
  healthRoleNotOffered,
  healthItemText,
  healthTitle,
  inviteLifetimeText,
  inviteRoleCaption,
  inviteRoleOptions,
  isDeviceOnlyRecord,
  mergeStaffRows,
  removedFromServer,
  resendResultMessage,
  resetPasswordResultMessage,
  rowActions,
  rowStatusLabel,
  statusLabel,
  type RowActionContext,
  type StaffRow,
} from "./staffAccountView";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const NURSE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";
const ULID_ID = "01J9Z8X7Y6W5V4T3S2R1Q0P9N8";

function device(over: Partial<User> & { id: string }): User {
  return {
    fullName: "Amina Bello",
    role: "nurse",
    pinHash: "",
    pinSalt: "",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    isActive: 1,
    ...over,
  };
}

/** A record the staff directory download put on this device. */
function synced(over: Partial<User> & { id: string }): User {
  return { ...device(over), _syncedAt: "2026-09-01T00:00:00.000Z" } as unknown as User;
}

function account(over: Partial<AccountView> = {}): AccountView {
  return {
    userId: NURSE_ID,
    fullName: "Amina Bello",
    role: "nurse",
    adminAccess: false,
    adminPermanent: false,
    email: "amina@example.org",
    status: "active",
    statusDetail: "signed_in",
    disablePartial: false,
    invitedAt: "2026-09-01T00:00:00.000Z",
    emailConfirmedAt: "2026-09-01T01:00:00.000Z",
    lastSignInAt: "2026-09-02T00:00:00.000Z",
    passwordSetAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdVia: "users_screen",
    createdByName: "Emeke",
    disabledAt: null,
    disabledByName: null,
    ...over,
  };
}

function overview(accounts: AccountView[]): OverviewResponse {
  return {
    checkedAt: "2026-09-25T00:00:00.000Z",
    accounts,
    health: {
      problems: [],
      counts: { portalPatients: 0, portalSignups: 0, anonymous: 0 },
      truncated: false,
    },
    roles: ["volunteer", "nurse", "doctor", "pharmacist"],
    adminRoleNeedsPermanent: true,
    inviteLifetimeSeconds: 3600,
    caller: { userId: ADMIN_ID, adminPermanent: true },
  };
}

const READY: RowActionContext = {
  currentUserId: ADMIN_ID,
  currentUserPermanent: true,
  serverReady: true,
  online: true,
  offeredRoles: ["volunteer", "nurse", "doctor", "pharmacist"],
};

function serverRow(a: AccountView, d: User | null = null): StaffRow {
  const [row] = mergeStaffRows(d ? [d] : [], overview([a]));
  return row;
}

function kinds(row: StaffRow, ctx: RowActionContext = READY): string[] {
  return rowActions(row, ctx).map((a) => a.kind);
}

describe("isDeviceOnlyRecord", () => {
  it("treats a record with a ULID id as this device's only", () => {
    expect(isDeviceOnlyRecord(device({ id: ULID_ID }), null)).toBe(true);
    expect(isDeviceOnlyRecord(device({ id: ULID_ID }), new Set([NURSE_ID]))).toBe(true);
  });

  it("does not decide for a uuid until the server's list is loaded", () => {
    expect(isDeviceOnlyRecord(device({ id: NURSE_ID }), null)).toBe(false);
  });

  it("treats a uuid the server does not list and that was never downloaded as device-only", () => {
    expect(isDeviceOnlyRecord(device({ id: OTHER_ID }), new Set([NURSE_ID]))).toBe(true);
    expect(isDeviceOnlyRecord(synced({ id: OTHER_ID }), new Set([NURSE_ID]))).toBe(false);
    expect(isDeviceOnlyRecord(device({ id: NURSE_ID }), new Set([NURSE_ID]))).toBe(false);
  });
});

describe("mergeStaffRows", () => {
  it("without an overview, lists this device's records as unchecked or device-only", () => {
    const rows = mergeStaffRows(
      [synced({ id: NURSE_ID }), device({ id: ULID_ID, fullName: "Bola Ade" })],
      null,
    );
    expect(rows.map((r) => [r.id, r.source])).toEqual([
      [NURSE_ID, "unchecked"],
      [ULID_ID, "device_only"],
    ]);
    expect(rows[0].account).toBeNull();
    expect(rowStatusLabel(rows[0]).label).toBe("Not checked");
    expect(rowStatusLabel(rows[1]).label).toBe("This device only");
  });

  it("joins each server account with its record on this device, then adds the rest", () => {
    const rows = mergeStaffRows(
      [
        synced({ id: NURSE_ID }),
        device({ id: ULID_ID, fullName: "Old Amina", email: " AMINA@example.org " }),
        device({ id: OTHER_ID, fullName: "Chidi Okafor", email: "chidi@example.org" }),
        synced({ id: "44444444-4444-4444-8444-444444444444", fullName: "Gone Person" }),
      ],
      overview([account()]),
    );
    expect(rows.map((r) => [r.fullName, r.source])).toEqual([
      ["Amina Bello", "server"],
      ["Old Amina", "device_only"],
      ["Chidi Okafor", "device_only"],
      ["Gone Person", "missing"],
    ]);
    expect(rows[0].device?.id).toBe(NURSE_ID);
    expect(rows[0].email).toBe("amina@example.org");
    expect(rows[1].sameEmailServerAccount).toBe(true);
    expect(rows[2].sameEmailServerAccount).toBe(false);
    expect(rowStatusLabel(rows[3]).label).toBe("Not on the server");
  });

  it("leaves out switched-off records that are nobody to act on", () => {
    const rows = mergeStaffRows(
      [
        synced({ id: NURSE_ID }),
        // This person's older entry, retired when they signed in online.
        device({ id: ULID_ID, fullName: "Old Amina", email: "amina@example.org", isActive: 0 }),
        // Removed from the server and already off here.
        synced({ id: "44444444-4444-4444-8444-444444444444", fullName: "Gone Person", isActive: 0 }),
        // Switched off here by hand, never on the server: still listed.
        device({ id: OTHER_ID, fullName: "Chidi Okafor", isActive: 0, disabledLocallyAt: new Date() }),
      ],
      overview([account()]),
    );
    expect(rows.map((r) => [r.fullName, r.source])).toEqual([
      ["Amina Bello", "server"],
      ["Chidi Okafor", "device_only"],
    ]);
  });

  it("without an overview, leaves out the same records, using this device's server accounts", () => {
    const rows = mergeStaffRows(
      [
        synced({ id: NURSE_ID, email: "amina@example.org" }),
        // This person's older entry, retired when they signed in online.
        device({ id: ULID_ID, fullName: "Old Amina", email: " AMINA@example.org ", isActive: 0 }),
        // Marked removed from the server when this device learned it.
        synced({
          id: "44444444-4444-4444-8444-444444444444",
          fullName: "Gone Person",
          isActive: 0,
          removedFromServerAt: new Date(),
        }),
        // Switched off by the server (still on it): listed.
        synced({ id: "55555555-5555-4555-8555-555555555555", fullName: "Disabled Person", isActive: 0 }),
        // Made here and switched off, no server account has its email: listed.
        device({
          id: "01J9Z8X7Y6W5V4T3S2R1Q0P9N9",
          fullName: "Chidi Okafor",
          email: "chidi@example.org",
          isActive: 0,
        }),
      ],
      null,
    );
    expect(rows.map((r) => [r.fullName, r.source])).toEqual([
      ["Amina Bello", "unchecked"],
      ["Disabled Person", "unchecked"],
      ["Chidi Okafor", "device_only"],
    ]);
  });

  it("without an overview, keeps a person whose server account was removed", () => {
    // Their server account is gone, so their older entry here is the only
    // trace of them left: listed, off.
    const rows = mergeStaffRows(
      [
        synced({ id: NURSE_ID, email: "amina@example.org", isActive: 0, removedFromServerAt: new Date() }),
        device({ id: ULID_ID, fullName: "Old Amina", email: "amina@example.org", isActive: 0 }),
      ],
      null,
    );
    expect(rows.map((r) => [r.fullName, r.source])).toEqual([["Old Amina", "device_only"]]);
  });

  it("always lists a record marked for review", () => {
    const review = { isActive: 0, accessConflict: 1, disabledLocallyAt: new Date() } as const;
    const records = [
      synced({ id: NURSE_ID, email: "amina@example.org" }),
      device({ id: ULID_ID, fullName: "Old Amina", email: "amina@example.org", ...review }),
      synced({
        id: "44444444-4444-4444-8444-444444444444",
        fullName: "Gone Person",
        removedFromServerAt: new Date(),
        ...review,
      }),
    ];
    expect(mergeStaffRows(records, null).map((r) => r.fullName)).toEqual([
      "Amina Bello",
      "Old Amina",
      "Gone Person",
    ]);
    expect(mergeStaffRows(records, overview([account()])).map((r) => r.fullName)).toEqual([
      "Amina Bello",
      "Old Amina",
      "Gone Person",
    ]);
  });

  it("without an overview, lists a switched-off device-only record no server account shares", () => {
    const rows = mergeStaffRows(
      [device({ id: ULID_ID, email: "amina@example.org", isActive: 0 })],
      null,
    );
    expect(rows).toHaveLength(1);
  });

  it("leaves out a record marked removed even when it downloaded after the list was read", () => {
    const marked = {
      ...device({ id: OTHER_ID, fullName: "Gone Person", isActive: 0, removedFromServerAt: new Date() }),
      _syncedAt: "2026-09-25T00:05:00.000Z",
    } as unknown as User;
    expect(mergeStaffRows([marked], overview([account()])).map((r) => r.fullName)).toEqual([
      "Amina Bello",
    ]);
  });

  it("does not call a record removed when it was downloaded after the list was read", () => {
    const fresh = {
      ...device({ id: OTHER_ID, fullName: "New Person" }),
      _syncedAt: "2026-09-25T00:05:00.000Z",
    } as unknown as User;
    const rows = mergeStaffRows([fresh], overview([account()]));
    expect(rows.map((r) => [r.fullName, r.source])).toEqual([
      ["Amina Bello", "server"],
      ["New Person", "unchecked"],
    ]);
    expect(rowStatusLabel(rows[1]).label).toBe("Not checked");
    expect(rowStatusLabel(rows[1]).caption).toBeNull();
  });

  it("shows server accounts with no record on this device", () => {
    const rows = mergeStaffRows([], overview([account({ userId: OTHER_ID })]));
    expect(rows).toHaveLength(1);
    expect(rows[0].device).toBeNull();
    expect(rows[0].deviceNote).toBeNull();
  });

  it("marks a server-disabled account that is off here as off on this device, never needs review", () => {
    const disabled = account({ status: "disabled", statusDetail: "by_admin" });
    const row = serverRow(
      disabled,
      synced({ id: NURSE_ID, isActive: 0, accessConflict: 1, disabledLocallyAt: new Date() }),
    );
    expect(row.deviceNote).toBe("off_on_device");
    expect(serverRow(disabled, synced({ id: NURSE_ID, isActive: 0 })).deviceNote).toBe(
      "off_on_device",
    );
  });

  it("keeps Needs review for an account still active online but deactivated here", () => {
    const row = serverRow(
      account(),
      synced({ id: NURSE_ID, isActive: 0, accessConflict: 1, disabledLocallyAt: new Date() }),
    );
    expect(row.deviceNote).toBe("needs_review");
    expect(serverRow(account(), synced({ id: NURSE_ID })).deviceNote).toBeNull();
  });
});

describe("removedFromServer", () => {
  const GONE_ID = "44444444-4444-4444-8444-444444444444";
  const gone = (over: Partial<User> = {}) =>
    synced({ id: GONE_ID, fullName: "Gone Person", ...over });

  it("returns records the server no longer lists that are still on here", () => {
    const list = overview([account()]);
    const users = [synced({ id: NURSE_ID }), gone()];
    expect(removedFromServer(users, list, ADMIN_ID).map((u) => u.id)).toEqual([GONE_ID]);
  });

  it("returns a switched-off one until it is marked, then nothing", () => {
    const list = overview([account()]);
    expect(removedFromServer([gone({ isActive: 0 })], list, ADMIN_ID)).toHaveLength(1);
    expect(
      removedFromServer([gone({ isActive: 0, removedFromServerAt: new Date() })], list, ADMIN_ID),
    ).toEqual([]);
  });

  it("returns nothing when the server's list may be incomplete", () => {
    const list = overview([account()]);
    list.health.truncated = true;
    expect(removedFromServer([gone()], list, ADMIN_ID)).toEqual([]);
    expect(removedFromServer([gone()], null, ADMIN_ID)).toEqual([]);
  });

  it("never returns the signed-in person, a record with changes to upload, or one made here", () => {
    const list = overview([account()]);
    const dirty = { ...gone(), _dirty: 1 } as unknown as User;
    const users = [
      dirty,
      synced({ id: ADMIN_ID.toUpperCase() }),
      device({ id: ULID_ID }),
      device({ id: OTHER_ID }),
      synced({ id: NURSE_ID }),
    ];
    expect(removedFromServer(users, list, ADMIN_ID)).toEqual([]);
  });

  it("does not return a record downloaded after the list was read", () => {
    const list = overview([account()]);
    const fresh = { ...gone(), _syncedAt: "2026-09-25T00:05:00.000Z" } as unknown as User;
    expect(removedFromServer([fresh], list, ADMIN_ID)).toEqual([]);
  });
});

describe("rowActions", () => {
  it("offers reset password, edit, login status and disable for an active account", () => {
    expect(kinds(serverRow(account(), synced({ id: NURSE_ID })))).toEqual([
      "reset_password",
      "edit_account",
      "login_status",
      "disable",
      "edit_on_device",
      "deactivate_on_device",
    ]);
  });

  it("labels the device form on a server row as the PIN on this device", () => {
    const actions = rowActions(serverRow(account(), synced({ id: NURSE_ID })), READY);
    expect(actions.find((a) => a.kind === "edit_on_device")?.label).toBe("Set PIN on this device");
    expect(actions.find((a) => a.kind === "edit_account")?.label).toBe("Edit");
    expect(actions.find((a) => a.kind === "disable")?.danger).toBe(true);
    expect(actions.find((a) => a.kind === "disable")?.server).toBe(true);
  });

  it("offers reset PIN on this device only when there is a PIN here", () => {
    const withPin = synced({ id: NURSE_ID, pinHash: "h", pinSalt: "s" });
    expect(kinds(serverRow(account(), withPin))).toContain("reset_device_pin");
    expect(kinds(serverRow(account(), synced({ id: NURSE_ID })))).not.toContain(
      "reset_device_pin",
    );
  });

  it("offers resend invitation for invited accounts and setup required with a login", () => {
    expect(kinds(serverRow(account({ status: "invited", statusDetail: "pending" })))).toEqual([
      "resend_invitation",
      "edit_account",
      "login_status",
      "disable",
    ]);
    expect(
      kinds(serverRow(account({ status: "setup_required", statusDetail: "password_not_set" }))),
    ).toEqual(["resend_invitation", "edit_account", "login_status", "disable"]);
  });

  it("offers create login, and no disable, for a staff record with no login", () => {
    expect(
      kinds(serverRow(account({ status: "setup_required", statusDetail: "no_login" }))),
    ).toEqual(["edit_account", "login_status", "create_login"]);
    expect(
      kinds(
        serverRow(
          account({
            status: "setup_required",
            statusDetail: "no_login",
            role: "admin",
            adminPermanent: true,
          }),
        ),
      ),
    ).not.toContain("create_login");
  });

  it("offers no create login for a role the server can't give", () => {
    for (const role of ["guest", "auditor", "admin"]) {
      expect(
        kinds(serverRow(account({ status: "setup_required", statusDetail: "no_login", role }))),
      ).toEqual(["edit_account", "login_status"]);
    }
  });

  it("offers reactivate and login status for a disabled account", () => {
    const disabled = account({ status: "disabled", statusDetail: "by_admin" });
    expect(kinds(serverRow(disabled, synced({ id: NURSE_ID, isActive: 0 })))).toEqual([
      "reactivate",
      "login_status",
    ]);
    expect(kinds(serverRow({ ...disabled, disablePartial: true }))).toEqual([
      "reactivate",
      "login_status",
      "disable",
    ]);
    expect(
      kinds(serverRow(account({ status: "disabled", statusDetail: "switched_off" }))),
    ).toEqual(["login_status"]);
  });

  it("never offers disable or reactivate on your own account", () => {
    const self = { ...READY, currentUserId: NURSE_ID };
    expect(kinds(serverRow(account(), synced({ id: NURSE_ID })), self)).toEqual([
      "reset_password",
      "edit_account",
      "login_status",
      "edit_on_device",
    ]);
    expect(
      kinds(serverRow(account({ status: "disabled", statusDetail: "by_admin" })), self),
    ).toEqual(["login_status"]);
  });

  it("never offers disable on a permanent administrator", () => {
    const perm = account({
      userId: OTHER_ID,
      role: "admin",
      adminAccess: true,
      adminPermanent: true,
    });
    const d = synced({ id: OTHER_ID, role: "admin", adminPermanent: true });
    expect(kinds(serverRow(perm, d))).toEqual([
      "reset_password",
      "edit_account",
      "login_status",
      "edit_on_device",
    ]);
    // Only a permanent administrator may open a permanent administrator's device form.
    expect(kinds(serverRow(perm, d), { ...READY, currentUserPermanent: false })).toEqual([
      "reset_password",
      "edit_account",
      "login_status",
    ]);
  });

  it("still offers disable for another administrator, and says it can't be undone here", () => {
    const admin = account({ userId: OTHER_ID, role: "admin", adminAccess: true });
    expect(kinds(serverRow(admin))).toEqual([
      "reset_password",
      "edit_account",
      "login_status",
      "disable",
    ]);
    // overview.roles has no admin while administrator accounts can't be added here.
    expect(adminRoleIsOneWay(admin.role, READY.offeredRoles)).toBe(true);
    expect(adminRoleIsOneWay(admin.role, [...READY.offeredRoles, "admin"])).toBe(false);
    expect(adminRoleIsOneWay("nurse", READY.offeredRoles)).toBe(false);
    expect(STAFF_COPY.disable.adminOneWay).toBe(
      "They can't be reactivated from this screen yet, because administrator accounts can't be restored here. Ask whoever runs your server if they need access again later.",
    );
  });

  it("hides server actions until the screen is ready and online", () => {
    const row = serverRow(account(), synced({ id: NURSE_ID }));
    const deviceOnly = ["edit_on_device", "deactivate_on_device"];
    expect(kinds(row, { ...READY, serverReady: false })).toEqual(deviceOnly);
    expect(kinds(row, { ...READY, online: false })).toEqual(deviceOnly);
    expect(rowActions(row, { ...READY, online: false }).every((a) => !a.server)).toBe(true);
  });

  it("offers delete only for device-only records, and retire when the email matches", () => {
    const rows = mergeStaffRows(
      [
        device({ id: ULID_ID, fullName: "Old Amina", email: "amina@example.org" }),
        device({ id: OTHER_ID, fullName: "Chidi Okafor" }),
      ],
      overview([account()]),
    );
    expect(rows.map((r) => r.source)).toEqual(["server", "device_only", "device_only"]);
    const [server, oldAmina, chidi] = rows;
    expect(kinds(oldAmina)).toEqual([
      "edit_on_device",
      "deactivate_on_device",
      "delete",
      "retire_device_record",
    ]);
    expect(rowActions(oldAmina, READY)[0].label).toBe("Edit");
    expect(kinds(chidi)).toEqual(["edit_on_device", "deactivate_on_device", "delete"]);
    expect(kinds(server)).not.toContain("delete");
    expect(kinds(serverRow(account(), synced({ id: NURSE_ID })))).not.toContain("delete");
  });

  it("offers no delete for records that could not be checked", () => {
    const [row] = mergeStaffRows([synced({ id: NURSE_ID })], null);
    expect(kinds(row, { ...READY, serverReady: false })).toEqual([
      "edit_on_device",
      "deactivate_on_device",
    ]);
  });

  it("offers activate on this device for a record switched off here", () => {
    const [row] = mergeStaffRows([device({ id: ULID_ID, isActive: 0 })], null);
    expect(kinds(row)).toEqual(["edit_on_device", "activate_on_device", "delete"]);
  });

  it("gives a disabled server account no new PIN and no activate on this device", () => {
    const disabled = account({ status: "disabled", statusDetail: "by_admin", disablePartial: true });
    const stillOn = synced({ id: NURSE_ID, isActive: 1, pinHash: "h", pinSalt: "s" });
    const actions = kinds(serverRow(disabled, stillOn));
    expect(actions).not.toContain("edit_on_device");
    expect(actions).not.toContain("activate_on_device");
    expect(actions).toContain("reset_device_pin");
    const off = kinds(serverRow(disabled, synced({ id: NURSE_ID, isActive: 0 })));
    expect(off).not.toContain("edit_on_device");
    expect(off).not.toContain("activate_on_device");
  });

  it("keeps a record the directory download switched off off, until the server is checked", () => {
    const offline = { ...READY, serverReady: false, online: false };
    const [byDownload] = mergeStaffRows([synced({ id: NURSE_ID, isActive: 0 })], null);
    expect(byDownload.source).toBe("unchecked");
    expect(kinds(byDownload, offline)).toEqual(["edit_on_device"]);

    const [byHand] = mergeStaffRows(
      [synced({ id: NURSE_ID, isActive: 0, disabledLocallyAt: new Date() })],
      null,
    );
    expect(kinds(byHand, offline)).toEqual(["edit_on_device", "activate_on_device"]);
  });
});

describe("statusLabel", () => {
  const cases: [AccountStatus, StatusDetail, boolean, string, string | null][] = [
    ["invited", "pending", false, "Invited", null],
    ["invited", "expired", false, "Invited", "Link may have expired"],
    ["active", "signed_in", false, "Active", null],
    ["active", "never_signed_in", false, "Active", "Never signed in"],
    ["disabled", "by_admin", false, "Disabled", null],
    ["disabled", "by_admin", true, "Disabled", "Devices not updated yet"],
    ["disabled", "switched_off", false, "Disabled", "Turned off outside this screen"],
    ["disabled", "no_staff_role", false, "Disabled", "No staff role"],
    ["setup_required", "no_login", false, "Setup required", "No login yet"],
    ["setup_required", "invitation_not_sent", false, "Setup required", "Invitation not sent"],
    ["setup_required", "password_not_set", false, "Setup required", "Password not set yet"],
  ];
  it.each(cases)("%s/%s (partial %s) is %s", (status, detail, partial, label, caption) => {
    const result = statusLabel(status, detail, partial);
    expect(result.label).toBe(label);
    expect(result.caption).toBe(caption);
  });

  it("uses a success tone for active and a warning tone for setup required", () => {
    expect(statusLabel("active", "signed_in").tone).toBe("success");
    expect(statusLabel("setup_required", "no_login").tone).toBe("warning");
  });
});

describe("inviteLifetimeText", () => {
  it("says how long an invitation link lasts in plain words", () => {
    expect(inviteLifetimeText(3600)).toBe("in about an hour");
    expect(inviteLifetimeText(7200)).toBe("in about 2 hours");
    expect(inviteLifetimeText(86400)).toBe("in about 24 hours");
    expect(inviteLifetimeText(1800)).toBe("in about 30 minutes");
    expect(inviteLifetimeText(0)).toBe("soon");
  });
});

describe("result messages", () => {
  it("confirms an invitation with the email and how long the link lasts", () => {
    expect(
      createResultMessage("Amina Bello", "amina@example.org", { sent: true, via: "invite" }, 3600),
    ).toEqual({
      tone: "success",
      title: "Account created",
      body: "Account created for Amina Bello. We've emailed amina@example.org a link to set their password. The link works once and expires in about an hour.",
    });
  });

  it("says when the invitation email did not go out", () => {
    const failed = createResultMessage(
      "Amina Bello",
      "amina@example.org",
      { sent: false, via: null, error: "send_failed" },
      3600,
    );
    expect(failed.tone).toBe("warning");
    expect(failed.body).toBe(
      "Account created for Amina Bello, but the invitation email didn't go out. Use Resend invitation on their row.",
    );
    expect(
      createResultMessage(
        "Amina Bello",
        "amina@example.org",
        { sent: false, via: null, error: "email_not_configured" },
        3600,
      ).body,
    ).toContain("outgoing email isn't set up yet");
  });

  it("words resend, reset password and disable results", () => {
    expect(resendResultMessage("a@example.org", { sent: true, via: "invite" }).body).toBe(
      "Invitation sent to a@example.org.",
    );
    expect(resendResultMessage("a@example.org", { sent: true, via: "recovery" }).body).toBe(
      STAFF_COPY.resend.sentRecovery,
    );
    expect(
      resendResultMessage("a@example.org", { sent: false, via: null, error: "email_rate_limited" })
        .tone,
    ).toBe("warning");
    expect(resetPasswordResultMessage("a@example.org", { sent: true, via: "recovery" }).body).toBe(
      "Password link sent to a@example.org.",
    );
    expect(disableResultMessage("Amina Bello", true).body).toBe("Amina Bello is disabled.");
    expect(disableResultMessage("Amina Bello", false).body).toBe(STAFF_COPY.disable.partial);
  });
});

describe("account health wording", () => {
  const item = (over: Partial<HealthItem>): HealthItem => ({
    kind: "staff_without_login",
    userId: NURSE_ID,
    email: null,
    emailMasked: null,
    fullName: "Amina Bello",
    createdAt: null,
    repair: "create_login",
    ...over,
  });

  it("describes each problem", () => {
    expect(healthItemText(item({}))).toBe(
      "Amina Bello has a staff record but can't sign in online.",
    );
    expect(
      healthItemText(item({ kind: "staff_login_without_record", email: "a@example.org" })),
    ).toBe("a@example.org was invited but has no staff record, so they can't open the staff app.");
    expect(
      healthItemText(item({ kind: "unknown_login", fullName: null, emailMasked: "a***@e***.org" })),
    ).toBe("Unknown login a***@e***.org has no staff record, so it can't open the staff app.");
    expect(
      healthBlockedText(item({ kind: "unknown_login", repair: null, blocked: "login_unconfirmed" })),
    ).toBe("This login was never confirmed. If they work here, add them with Add Staff.");
    expect(healthBlockedText(item({}))).toBeNull();
  });

  it("says where to fix a record whose role can't have a login", () => {
    const offeredRoles = ["volunteer", "nurse", "doctor", "pharmacist"];
    const admin = item({});
    expect(healthRoleNotOffered(admin, { role: "admin", offeredRoles })).toBe(true);
    expect(healthBlockedText(admin, { role: "admin", offeredRoles })).toBe(
      "Logins for administrators can't be added here yet. Ask whoever runs your server to add their login.",
    );
    expect(healthBlockedText(admin, { role: "lead_clinician", offeredRoles })).toBe(
      STAFF_COPY.health.blockedRoleNotOffered,
    );
    expect(healthRoleNotOffered(admin, { role: "nurse", offeredRoles })).toBe(false);
    expect(healthRoleNotOffered(admin, {})).toBe(false);

    const noRole = item({
      kind: "staff_without_login_no_role",
      repair: null,
      blocked: "no_staff_role",
    });
    expect(healthBlockedText(noRole)).toBe(STAFF_COPY.health.blockedNoRole);
    expect(healthBlockedText(noRole, { role: "auditor", offeredRoles })).toBe(
      STAFF_COPY.health.blockedNoRole,
    );
    expect(healthBlockedText(noRole, { role: "guest", offeredRoles })).toBe(
      STAFF_COPY.health.blockedNotStaff,
    );
  });

  it("counts problems in the header", () => {
    expect(healthTitle(0)).toBe("Account health");
    expect(healthTitle(1)).toBe("Account health (1 problem)");
    expect(healthTitle(3)).toBe("Account health (3 problems)");
  });
});

describe("Add Staff roles", () => {
  it("says administrators can't be added while the server offers no admin role", () => {
    const o = overview([]);
    expect(inviteRoleCaption(o)).toBe("Administrator accounts can't be added here yet.");
    expect(inviteRoleOptions(o).map((r) => r.value)).toEqual([
      "volunteer",
      "nurse",
      "doctor",
      "pharmacist",
    ]);
  });

  it("shows admin disabled for an administrator who is not permanent", () => {
    const o = {
      ...overview([]),
      roles: ["nurse", "admin"],
      caller: { userId: ADMIN_ID, adminPermanent: false },
    };
    expect(inviteRoleCaption(o)).toBe("Only a permanent administrator can add administrators.");
    expect(inviteRoleOptions(o).find((r) => r.value === "admin")?.disabled).toBe(true);
    expect(inviteRoleCaption({ ...o, caller: { userId: ADMIN_ID, adminPermanent: true } })).toBeNull();
  });
});

describe("STAFF_COPY", () => {
  function allStrings(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (typeof value === "function") {
      return [String((value as (a: unknown, b: unknown) => unknown)("X", "Y"))];
    }
    if (value && typeof value === "object") return Object.values(value).flatMap(allStrings);
    return [];
  }

  it("is plain English with no em-dashes and never names the hosting service", () => {
    const strings = allStrings(STAFF_COPY);
    expect(strings.length).toBeGreaterThan(100);
    for (const s of strings) {
      expect(s).not.toMatch(/—/);
      expect(s).not.toMatch(/supabase/i);
    }
  });
});
