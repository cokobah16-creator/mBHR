import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AccountView, OverviewResponse } from "@/services/staffAccounts";

const { mocks, authState } = vi.hoisted(() => {
  const mocks = {
    toArray: vi.fn(),
    update: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    pushToast: vi.fn(),
    pullStaffRoster: vi.fn(),
    reload: vi.fn(),
    staff: {
      state: "device_mode" as string,
      overview: null as unknown,
      failureMessage: null as string | null,
      notice: null as string | null,
    },
    createStaffAccount: vi.fn(),
    newStaffId: vi.fn(),
    disableStaffAccount: vi.fn(),
    reactivateStaffAccount: vi.fn(),
    resendInvitation: vi.fn(),
    sendPasswordReset: vi.fn(),
    updateStaffAccount: vi.fn(),
    getLoginStatus: vi.fn(),
    createLoginForStaffRecord: vi.fn(),
    createStaffRecordForLogin: vi.fn(),
  };
  const authState = {
    currentUser: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      fullName: "Amina Admin",
      role: "admin",
      adminAccess: true,
      adminPermanent: false,
      isActive: 1,
    } as Record<string, unknown>,
  };
  return { mocks, authState };
});

// No fake-indexeddb here: the staff table is hand-mocked.
vi.mock("@/db", () => ({
  db: {
    users: {
      orderBy: () => ({ toArray: () => mocks.toArray() }),
      update: (...args: unknown[]) => mocks.update(...args),
      add: (...args: unknown[]) => mocks.add(...args),
      delete: (...args: unknown[]) => mocks.remove(...args),
    },
  },
  generateId: () => "generated-id",
}));

vi.mock("@/stores/auth", () => {
  const useAuthStore = (selector: (state: typeof authState) => unknown) => selector(authState);
  useAuthStore.getState = () => authState;
  return { useAuthStore };
});

vi.mock("@/stores/toast", () => ({
  useToast: () => ({ push: (...args: unknown[]) => mocks.pushToast(...args) }),
}));

vi.mock("@/db/devicePin", () => ({
  devicePinFields: vi.fn(),
  clearDevicePin: vi.fn(),
}));

vi.mock("@/db/offlineAccess", () => ({
  hasDevicePin: (u: { pinHash?: string; pinSalt?: string } | null | undefined) =>
    !!u?.pinHash && !!u?.pinSalt,
}));

vi.mock("@/db/firstRun", () => ({
  countOtherActiveAdmins: () => Promise.resolve(1),
  LAST_ADMIN_MESSAGE: "This is the only administrator on this device.",
}));

vi.mock("@/sync/staffRoster", () => ({
  pullStaffRoster: () => mocks.pullStaffRoster(),
}));

vi.mock("@/features/admin/useStaffAccounts", () => ({
  useStaffAccounts: () => ({ ...mocks.staff, reload: mocks.reload }),
}));

vi.mock("@/services/staffAccounts", () => ({
  createStaffAccount: (...args: unknown[]) => mocks.createStaffAccount(...args),
  newStaffId: () => mocks.newStaffId(),
  disableStaffAccount: (...args: unknown[]) => mocks.disableStaffAccount(...args),
  reactivateStaffAccount: (...args: unknown[]) => mocks.reactivateStaffAccount(...args),
  resendInvitation: (...args: unknown[]) => mocks.resendInvitation(...args),
  sendPasswordReset: (...args: unknown[]) => mocks.sendPasswordReset(...args),
  updateStaffAccount: (...args: unknown[]) => mocks.updateStaffAccount(...args),
  getLoginStatus: (...args: unknown[]) => mocks.getLoginStatus(...args),
  createLoginForStaffRecord: (...args: unknown[]) => mocks.createLoginForStaffRecord(...args),
  createStaffRecordForLogin: (...args: unknown[]) => mocks.createStaffRecordForLogin(...args),
}));

import { UserManagement } from "./UserManagement";
import { STAFF_COPY } from "@/features/admin/staffAccountView";

const ADA_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEW_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function account(overrides: Partial<AccountView> = {}): AccountView {
  return {
    userId: ADA_ID,
    fullName: "Ada Okafor",
    role: "nurse",
    adminAccess: false,
    adminPermanent: false,
    email: "ada@clinic.ng",
    status: "active",
    statusDetail: "signed_in",
    disablePartial: false,
    invitedAt: null,
    emailConfirmedAt: null,
    lastSignInAt: null,
    passwordSetAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    createdVia: "users_screen",
    createdByName: null,
    disabledAt: null,
    disabledByName: null,
    ...overrides,
  };
}

function overview(accounts: AccountView[]): OverviewResponse {
  return {
    checkedAt: "2026-09-25T10:00:00.000Z",
    accounts,
    health: {
      problems: [],
      counts: { portalPatients: 0, portalSignups: 0, anonymous: 0 },
      truncated: false,
    },
    roles: ["volunteer", "nurse"],
    adminRoleNeedsPermanent: true,
    inviteLifetimeSeconds: 3600,
    caller: { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", adminPermanent: false },
  };
}

/** A record made on this device (a ULID id), never on the server. */
const TUNDE_DEVICE_ONLY = {
  id: "01J8ZX3K5N6P7Q8R9S0T1V2W3X",
  fullName: "Tunde Bello",
  role: "volunteer",
  pinHash: "",
  pinSalt: "",
  isActive: 1,
  createdAt: new Date("2026-01-10T09:00:00.000Z"),
  updatedAt: new Date("2026-01-10T09:00:00.000Z"),
};

function serverMode(state: string, accounts: AccountView[] | null = null) {
  mocks.staff = {
    state,
    overview: accounts ? overview(accounts) : null,
    failureMessage: null,
    notice: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff = { state: "device_mode", overview: null, failureMessage: null, notice: null };
  mocks.toArray.mockResolvedValue([]);
  mocks.update.mockResolvedValue(1);
  mocks.add.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.pullStaffRoster.mockResolvedValue({ ok: true, staff: 1, deactivated: 0 });
  mocks.reload.mockResolvedValue(undefined);
  mocks.newStaffId.mockReturnValue(NEW_ID);
});

describe("UserManagement, device mode", () => {
  it("keeps the PIN form for adding staff on this device", async () => {
    render(<UserManagement />);
    await waitFor(() => expect(mocks.toArray).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: STAFF_COPY.addStaff })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add staff member" }));

    expect(screen.getByLabelText("PIN (6 digits)")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm PIN")).toBeInTheDocument();
  });
});

describe("UserManagement, server mode", () => {
  it("disables Add Staff and says why when the server has no staff account setup", async () => {
    serverMode("not_deployed");
    render(<UserManagement />);

    expect(screen.getByRole("button", { name: STAFF_COPY.addStaff })).toBeDisabled();
    expect(screen.getByText(STAFF_COPY.state.not_deployed)).toBeInTheDocument();
    await waitFor(() => expect(mocks.toArray).toHaveBeenCalled());
  });

  it("explains that adding staff needs a connection when offline", async () => {
    serverMode("offline");
    render(<UserManagement />);

    expect(screen.getByRole("button", { name: STAFF_COPY.addStaff })).toBeDisabled();
    expect(screen.getByText(STAFF_COPY.state.offline)).toBeInTheDocument();
    await waitFor(() => expect(mocks.toArray).toHaveBeenCalled());
  });

  it("adds staff through the server, then brings the directory to this device", async () => {
    serverMode("ready", [account()]);
    mocks.createStaffAccount.mockResolvedValue({
      ok: true,
      data: { userId: NEW_ID, status: "invited", invitation: { sent: true, via: "invite" } },
    });
    render(<UserManagement />);

    fireEvent.click(screen.getByRole("button", { name: STAFF_COPY.addStaff }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Grace Eze" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "grace@clinic.ng" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "nurse" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => expect(mocks.pullStaffRoster).toHaveBeenCalled());
    expect(mocks.createStaffAccount).toHaveBeenCalledWith({
      userId: NEW_ID,
      fullName: "Grace Eze",
      email: "grace@clinic.ng",
      role: "nurse",
    });
    expect(mocks.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "success", title: "Account created" }),
    );
    expect(mocks.add).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
  });

  it("warns when the account was created but the invitation email did not go out", async () => {
    serverMode("ready", [account()]);
    mocks.createStaffAccount.mockResolvedValue({
      ok: true,
      data: {
        userId: NEW_ID,
        status: "invited",
        invitation: { sent: false, via: null, error: "send_failed" },
      },
    });
    render(<UserManagement />);

    fireEvent.click(screen.getByRole("button", { name: STAFF_COPY.addStaff }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Grace Eze" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "grace@clinic.ng" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "nurse" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() =>
      expect(mocks.pushToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: "warning", title: "Invitation not sent" }),
      ),
    );
    expect(mocks.add).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
  });

  it("offers Delete only for a record that exists on this device alone", async () => {
    serverMode("ready", [account()]);
    mocks.toArray.mockResolvedValue([TUNDE_DEVICE_ONLY]);
    render(<UserManagement />);

    expect(
      (await screen.findAllByRole("button", { name: "Delete, Tunde Bello" })).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Disable, Ada Okafor" }).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryAllByRole("button", { name: "Delete, Ada Okafor" })).toHaveLength(0);
  });

  it("disables through the server and then downloads the directory, never switching them off here by hand", async () => {
    serverMode("ready", [account()]);
    mocks.disableStaffAccount.mockResolvedValue({
      ok: true,
      data: { status: "disabled", rowUpdated: true },
    });
    render(<UserManagement />);

    fireEvent.click((await screen.findAllByRole("button", { name: "Disable, Ada Okafor" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: STAFF_COPY.disable.confirm }));

    await waitFor(() => expect(mocks.pullStaffRoster).toHaveBeenCalled());
    expect(mocks.disableStaffAccount).toHaveBeenCalledWith(ADA_ID);
    expect(mocks.disableStaffAccount.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pullStaffRoster.mock.invocationCallOrder[0],
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "success", title: STAFF_COPY.disable.doneTitle }),
    );
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
  });

  it("warns before disabling an administrator that it can't be undone from this screen", async () => {
    serverMode("ready", [account({ role: "admin", adminAccess: true })]);
    render(<UserManagement />);

    fireEvent.click((await screen.findAllByRole("button", { name: "Disable, Ada Okafor" }))[0]);

    expect(screen.getByText(STAFF_COPY.disable.adminOneWay)).toBeInTheDocument();
    expect(mocks.disableStaffAccount).not.toHaveBeenCalled();
  });

  it("reactivates through the server and clears a deactivation by hand on this device", async () => {
    serverMode("ready", [
      account({ role: "guest", status: "disabled", statusDetail: "by_admin" }),
    ]);
    mocks.toArray.mockResolvedValue([
      {
        id: ADA_ID,
        fullName: "Ada Okafor",
        role: "guest",
        pinHash: "",
        pinSalt: "",
        isActive: 0,
        accessConflict: 1,
        disabledLocallyAt: new Date("2026-09-20T08:00:00.000Z"),
        createdAt: new Date("2026-09-01T10:00:00.000Z"),
        updatedAt: new Date("2026-09-20T08:00:00.000Z"),
      },
    ]);
    mocks.reactivateStaffAccount.mockResolvedValue({
      ok: true,
      data: { status: "active", role: "nurse" },
    });
    render(<UserManagement />);

    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Reactivate, Ada Okafor" }))[0],
    );
    fireEvent.click(screen.getByRole("button", { name: STAFF_COPY.reactivate.confirm }));

    await waitFor(() => expect(mocks.pullStaffRoster).toHaveBeenCalled());
    expect(mocks.reactivateStaffAccount).toHaveBeenCalledWith(ADA_ID, undefined);
    expect(mocks.update).toHaveBeenCalledWith(
      ADA_ID,
      expect.objectContaining({ isActive: 1, accessConflict: 0 }),
    );
    const changes = mocks.update.mock.calls[0][1] as Record<string, unknown>;
    expect(changes.disabledLocallyAt).toBeUndefined();
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pullStaffRoster.mock.invocationCallOrder[0],
    );
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
  });
});

describe("UserManagement, one row per person", () => {
  const GONE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  it("switches off a record the server has removed, then leaves it out", async () => {
    serverMode("ready", [account()]);
    const gone = {
      id: GONE_ID,
      fullName: "Old Admin",
      role: "admin",
      pinHash: "",
      pinSalt: "",
      isActive: 1,
      _syncedAt: "2026-09-01T00:00:00.000Z",
      createdAt: new Date("2025-09-30T05:44:00.000Z"),
      updatedAt: new Date("2025-09-30T05:44:00.000Z"),
    };
    mocks.toArray
      .mockResolvedValueOnce([gone])
      .mockResolvedValue([{ ...gone, isActive: 0, removedFromServerAt: new Date() }]);
    render(<UserManagement />);

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(GONE_ID, {
        isActive: 0,
        removedFromServerAt: expect.any(Date),
      }),
    );
    await waitFor(() => expect(screen.queryByText("Old Admin")).toBeNull());
    expect(screen.getAllByText("Ada Okafor").length).toBeGreaterThan(0);
  });

  it("leaves out a person's older device-only entry once it is switched off", async () => {
    serverMode("ready", [account()]);
    mocks.toArray.mockResolvedValue([
      { ...TUNDE_DEVICE_ONLY, fullName: "Ada (old tablet entry)", email: "ADA@clinic.ng", isActive: 0 },
    ]);
    render(<UserManagement />);

    await waitFor(() => expect(mocks.toArray).toHaveBeenCalled());
    expect(screen.getAllByText("Ada Okafor").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ada (old tablet entry)")).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("offline, leaves out the older entry and records the server removed", async () => {
    serverMode("offline");
    mocks.toArray.mockResolvedValue([
      {
        id: ADA_ID,
        fullName: "Ada Okafor",
        role: "nurse",
        email: "ada@clinic.ng",
        pinHash: "",
        pinSalt: "",
        isActive: 1,
        _syncedAt: "2026-09-01T00:00:00.000Z",
        createdAt: new Date("2026-09-01T10:00:00.000Z"),
        updatedAt: new Date("2026-09-01T10:00:00.000Z"),
      },
      { ...TUNDE_DEVICE_ONLY, fullName: "Ada (old tablet entry)", email: "ADA@clinic.ng", isActive: 0 },
      {
        ...TUNDE_DEVICE_ONLY,
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        fullName: "Old Admin",
        isActive: 0,
        removedFromServerAt: new Date("2026-09-26T07:10:00.000Z"),
      },
    ]);
    render(<UserManagement />);

    await waitFor(() => expect(screen.getAllByText("Ada Okafor").length).toBeGreaterThan(0));
    expect(screen.queryByText("Ada (old tablet entry)")).toBeNull();
    expect(screen.queryByText("Old Admin")).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
