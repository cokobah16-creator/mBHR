import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    createStaffAccount: vi.fn(),
    newStaffId: vi.fn(),
  },
}));

vi.mock("@/services/staffAccounts", () => ({
  createStaffAccount: (...args: unknown[]) => mocks.createStaffAccount(...args),
  newStaffId: () => mocks.newStaffId(),
}));

import InviteStaffDialog from "./InviteStaffDialog";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

const OVERVIEW = {
  roles: ["volunteer", "nurse", "doctor", "pharmacist"],
  adminRoleNeedsPermanent: true,
  caller: { userId: "99999999-9999-4999-8999-999999999999", adminPermanent: false },
  inviteLifetimeSeconds: 3600,
};

const SENT = {
  ok: true,
  data: {
    userId: FIRST_ID,
    status: "invited",
    invitation: { sent: true, via: "invite" },
  },
};

function renderDialog() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<InviteStaffDialog overview={OVERVIEW} onClose={onClose} onCreated={onCreated} />);
  return { onClose, onCreated };
}

function fillIn(name: string, email: string, role: string) {
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: role } });
}

function send() {
  fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  const ids = [FIRST_ID, SECOND_ID];
  let next = 0;
  mocks.newStaffId.mockImplementation(() => ids[Math.min(next++, ids.length - 1)]);
  mocks.createStaffAccount.mockReset();
  mocks.createStaffAccount.mockResolvedValue(SENT);
});

describe("InviteStaffDialog", () => {
  it("has no PIN field and explains how offline access works", () => {
    renderDialog();
    expect(screen.queryByLabelText(/pin/i)).toBeNull();
    expect(
      screen.getByText(/the first time they sign in online on a device, they'll choose a PIN/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/aren't available yet/i)).toBeInTheDocument();
  });

  it("offers only the server's roles and says why Administrator is missing", () => {
    renderDialog();
    const role = screen.getByLabelText("Role") as HTMLSelectElement;
    const values = Array.from(role.options).map((o) => o.value);
    expect(values).toEqual(["", "volunteer", "nurse", "doctor", "pharmacist"]);
    expect(screen.getByText("Administrator accounts can't be added here yet.")).toBeInTheDocument();
  });

  it("asks for a name, an email and a role before sending anything", async () => {
    renderDialog();
    send();

    expect(await screen.findByText("Enter the person's full name.")).toBeInTheDocument();
    expect(
      screen.getByText("Enter their email address. Their invitation is sent there."),
    ).toBeInTheDocument();
    expect(screen.getByText("Choose one of the listed roles.")).toBeInTheDocument();
    expect(mocks.createStaffAccount).not.toHaveBeenCalled();
  });

  it("refuses an email address that doesn't look like one", async () => {
    renderDialog();
    fillIn("Ada Obi", "ada.example.com", "nurse");
    send();

    expect(await screen.findByText("Enter an email address like name@example.com.")).toBeInTheDocument();
    expect(mocks.createStaffAccount).not.toHaveBeenCalled();
  });

  it("sends the name, email and role with the form's id, then reports and closes", async () => {
    const { onClose, onCreated } = renderDialog();
    fillIn("  Ada   Obi ", " ada@example.com ", "nurse");
    send();

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mocks.createStaffAccount).toHaveBeenCalledWith({
      userId: FIRST_ID,
      fullName: "Ada Obi",
      email: "ada@example.com",
      role: "nurse",
    });
    const message = onCreated.mock.calls[0][0] as { tone: string; body: string };
    expect(message.tone).toBe("success");
    expect(message.body).toBe(
      "Account created for Ada Obi. We've emailed ada@example.com a link to set their password. The link works once and expires in about an hour.",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("sends the same id again after a reply was lost, so no duplicate is made", async () => {
    mocks.createStaffAccount.mockResolvedValueOnce({
      ok: false,
      failure: "unreachable",
      code: null,
      message: "Couldn't reach the server. Try again.",
      body: null,
    });
    const { onCreated } = renderDialog();
    fillIn("Ada Obi", "ada@example.com", "nurse");
    send();

    expect(
      await screen.findByText(/We couldn't confirm the account was created/),
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();

    send();
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const ids = mocks.createStaffAccount.mock.calls.map(
      (call: unknown[]) => (call[0] as { userId: string }).userId,
    );
    expect(ids).toEqual([FIRST_ID, FIRST_ID]);
  });

  it("asks for a refresh when closed after an unconfirmed attempt", async () => {
    mocks.createStaffAccount.mockResolvedValueOnce({
      ok: false,
      failure: "unreachable",
      code: null,
      message: "Couldn't reach the server. Try again.",
      body: null,
    });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const onMaybeCreated = vi.fn();
    render(
      <InviteStaffDialog
        overview={OVERVIEW}
        onClose={onClose}
        onCreated={onCreated}
        onMaybeCreated={onMaybeCreated}
      />,
    );
    fillIn("Ada Obi", "ada@example.com", "nurse");
    send();
    expect(
      await screen.findByText(/We couldn't confirm the account was created/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onMaybeCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("keeps the same id after a server error", async () => {
    mocks.createStaffAccount.mockResolvedValueOnce({
      ok: false,
      failure: "server_error",
      code: "partial_create",
      message:
        "The login was created but the staff record wasn't. Try Add Staff again with the same details.",
      body: null,
    });
    const { onCreated } = renderDialog();
    fillIn("Ada Obi", "ada@example.com", "nurse");
    send();
    expect(
      await screen.findByText(/The login was created but the staff record wasn't/),
    ).toBeInTheDocument();

    send();
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const ids = mocks.createStaffAccount.mock.calls.map(
      (call: unknown[]) => (call[0] as { userId: string }).userId,
    );
    expect(ids).toEqual([FIRST_ID, FIRST_ID]);
  });

  it("asks for a refresh when closed after a server error", async () => {
    mocks.createStaffAccount.mockResolvedValueOnce({
      ok: false,
      failure: "server_error",
      code: null,
      message: "The staff account service had an error. Check the list before trying again.",
      body: null,
    });
    const onClose = vi.fn();
    const onMaybeCreated = vi.fn();
    render(
      <InviteStaffDialog
        overview={OVERVIEW}
        onClose={onClose}
        onCreated={vi.fn()}
        onMaybeCreated={onMaybeCreated}
      />,
    );
    fillIn("Ada Obi", "ada@example.com", "nurse");
    send();
    expect(await screen.findByText(/The staff account service had an error/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onMaybeCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not ask for a refresh when closed with nothing sent", () => {
    const onClose = vi.fn();
    const onMaybeCreated = vi.fn();
    render(
      <InviteStaffDialog
        overview={OVERVIEW}
        onClose={onClose}
        onCreated={vi.fn()}
        onMaybeCreated={onMaybeCreated}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onMaybeCreated).not.toHaveBeenCalled();
  });

  it("shows the server's message beside the field it refused", async () => {
    mocks.createStaffAccount.mockResolvedValueOnce({
      ok: false,
      failure: "refused",
      code: "email_in_use_staff",
      message: "This email already belongs to a staff account. Find them in the list.",
      body: {
        fn: "staff-admin",
        success: false,
        error: "email_in_use_staff",
        field: "email",
        message: "This email already belongs to a staff account. Find them in the list.",
      },
    });
    const { onCreated, onClose } = renderDialog();
    fillIn("Ada Obi", "ada@example.com", "nurse");
    send();

    const error = await screen.findByText(
      "This email already belongs to a staff account. Find them in the list.",
    );
    expect(error.id).toBe("invite-staff-email-error");
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
