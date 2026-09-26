import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AccountView } from "@/services/staffAccounts";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    reactivateStaffAccount: vi.fn(),
  },
}));

vi.mock("@/services/staffAccounts", () => ({
  reactivateStaffAccount: (...args: unknown[]) => mocks.reactivateStaffAccount(...args),
}));

import ReactivateDialog from "./ReactivateDialog";

const USER_ID = "55555555-5555-4555-8555-555555555555";

const ACCOUNT: AccountView = {
  userId: USER_ID,
  fullName: "Ada Obi",
  role: "guest",
  adminAccess: false,
  adminPermanent: false,
  email: "ada@example.com",
  status: "disabled",
  statusDetail: "by_admin",
  disablePartial: false,
  invitedAt: null,
  emailConfirmedAt: "2026-09-01T10:00:00.000Z",
  lastSignInAt: null,
  passwordSetAt: null,
  createdAt: "2026-09-01T09:00:00.000Z",
  createdVia: "users_screen",
  createdByName: "Admin One",
  disabledAt: "2026-09-10T09:00:00.000Z",
  disabledByName: "Admin One",
};

const OVERVIEW = {
  roles: ["volunteer", "nurse", "doctor", "pharmacist"],
  adminRoleNeedsPermanent: true,
  caller: { userId: "99999999-9999-4999-8999-999999999999", adminPermanent: false },
};

const ROLE_NEEDED = {
  ok: false,
  failure: "refused",
  code: "role_needed",
  message: "Choose the role they should have.",
  body: {
    fn: "staff-admin",
    success: false,
    error: "role_needed",
    message: "Choose the role they should have.",
  },
};

function renderDialog() {
  const onClose = vi.fn();
  const onReactivated = vi.fn();
  render(
    <ReactivateDialog
      account={ACCOUNT}
      overview={OVERVIEW}
      onClose={onClose}
      onReactivated={onReactivated}
    />,
  );
  return { onClose, onReactivated };
}

function confirmButton() {
  return screen.getByRole("button", { name: "Reactivate" }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reactivateStaffAccount.mockReset();
  mocks.reactivateStaffAccount.mockResolvedValue({
    ok: true,
    data: { status: "active", role: "nurse" },
  });
});

describe("ReactivateDialog", () => {
  it("asks the server to restore their earlier role first", async () => {
    const { onReactivated, onClose } = renderDialog();
    expect(screen.queryByLabelText("Role")).toBeNull();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(onReactivated).toHaveBeenCalledTimes(1));
    expect(mocks.reactivateStaffAccount).toHaveBeenCalledWith(USER_ID, undefined);
    const message = onReactivated.mock.calls[0][0] as { body: string };
    expect(message.body).toBe("Ada Obi is active again.");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a role picker when the server has no role to restore", async () => {
    mocks.reactivateStaffAccount.mockResolvedValueOnce(ROLE_NEEDED);
    const { onReactivated } = renderDialog();
    fireEvent.click(confirmButton());

    const role = (await screen.findByLabelText("Role")) as HTMLSelectElement;
    expect(onReactivated).not.toHaveBeenCalled();
    expect(Array.from(role.options).map((o) => o.value)).not.toContain("admin");
    expect(confirmButton().disabled).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(role));
    expect(screen.getByRole("status")).toHaveTextContent("Choose the role they should have.");

    fireEvent.change(role, { target: { value: "nurse" } });
    expect(confirmButton().disabled).toBe(false);
    fireEvent.click(confirmButton());

    await waitFor(() => expect(onReactivated).toHaveBeenCalledTimes(1));
    expect(mocks.reactivateStaffAccount).toHaveBeenLastCalledWith(USER_ID, "nurse");
  });

  it("shows any other refusal in the dialog", async () => {
    mocks.reactivateStaffAccount.mockResolvedValueOnce({
      ok: false,
      failure: "refused",
      code: "already_active",
      message: "This account is already active.",
      body: null,
    });
    const { onReactivated, onClose } = renderDialog();
    fireEvent.click(confirmButton());

    expect(await screen.findByText("This account is already active.")).toBeInTheDocument();
    expect(onReactivated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
