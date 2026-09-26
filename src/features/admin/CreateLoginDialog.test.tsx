import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    createLoginForStaffRecord: vi.fn(),
  },
}));

vi.mock("@/services/staffAccounts", () => ({
  createLoginForStaffRecord: (...args: unknown[]) => mocks.createLoginForStaffRecord(...args),
}));

import CreateLoginDialog from "./CreateLoginDialog";

const USER_ID = "33333333-3333-4333-8333-333333333333";

function renderDialog() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <CreateLoginDialog
      userId={USER_ID}
      fullName="Ada Obi"
      inviteLifetimeSeconds={3600}
      onClose={onClose}
      onCreated={onCreated}
    />,
  );
  return { onClose, onCreated };
}

function fillIn(name: string, email: string) {
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Create login and send invitation" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createLoginForStaffRecord.mockReset();
  mocks.createLoginForStaffRecord.mockResolvedValue({
    ok: true,
    data: { userId: USER_ID, status: "invited", invitation: { sent: true, via: "invite" } },
  });
});

describe("CreateLoginDialog", () => {
  it("asks for the person's full name to be typed, not filled in", () => {
    renderDialog();
    expect(screen.getByText("Type Ada Obi's full name to confirm, and the email they'll use.")).toBeInTheDocument();
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("");
  });

  it("does nothing until the typed name matches their staff record", async () => {
    const { onCreated } = renderDialog();
    fillIn("Ada", "ada@example.com");
    submit();

    expect(await screen.findByText("What you typed doesn't match their name.")).toBeInTheDocument();
    expect(mocks.createLoginForStaffRecord).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("needs a valid email as well", async () => {
    renderDialog();
    fillIn("Ada Obi", "not-an-email");
    submit();

    expect(await screen.findByText("Enter an email address like name@example.com.")).toBeInTheDocument();
    expect(mocks.createLoginForStaffRecord).not.toHaveBeenCalled();
  });

  it("accepts the name in any case and spacing, then reports and closes", async () => {
    const { onCreated, onClose } = renderDialog();
    fillIn("  ada   OBI ", " ada@example.com ");
    submit();

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mocks.createLoginForStaffRecord).toHaveBeenCalledWith({
      userId: USER_ID,
      email: "ada@example.com",
      confirmFullName: "ada OBI",
    });
    const message = onCreated.mock.calls[0][0] as { tone: string; title: string; body: string };
    expect(message.tone).toBe("success");
    expect(message.title).toBe("Login created");
    expect(message.body).toMatch(/We've emailed ada@example.com a link to set their password/);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server's refusal and stays open", async () => {
    mocks.createLoginForStaffRecord.mockResolvedValueOnce({
      ok: false,
      failure: "refused",
      code: "confirm_mismatch",
      message: "What you typed doesn't match this account.",
      body: {
        fn: "staff-admin",
        success: false,
        error: "confirm_mismatch",
        field: "confirmFullName",
        message: "What you typed doesn't match this account.",
      },
    });
    const { onCreated, onClose } = renderDialog();
    fillIn("Ada Obi", "ada@example.com");
    submit();

    expect(await screen.findByText("What you typed doesn't match this account.")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(["unreachable", "server_error"])(
    "asks to check the list after a %s reply, and refreshes it on close",
    async (failure) => {
      mocks.createLoginForStaffRecord.mockResolvedValueOnce({
        ok: false,
        failure,
        message: "Couldn't reach the server. Try again.",
        body: null,
      });
      const onClose = vi.fn();
      const onCreated = vi.fn();
      const onMaybeCreated = vi.fn();
      render(
        <CreateLoginDialog
          userId={USER_ID}
          fullName="Ada Obi"
          inviteLifetimeSeconds={3600}
          onClose={onClose}
          onCreated={onCreated}
          onMaybeCreated={onMaybeCreated}
        />,
      );
      fillIn("Ada Obi", "ada@example.com");
      submit();

      expect(
        await screen.findByText(
          "We couldn't confirm the login was created. Close this and check the list before trying again.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText("Couldn't reach the server. Try again.")).toBeNull();
      expect(onCreated).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onMaybeCreated).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it("does not refresh on close when nothing was sent", () => {
    const onClose = vi.fn();
    const onMaybeCreated = vi.fn();
    render(
      <CreateLoginDialog
        userId={USER_ID}
        fullName="Ada Obi"
        inviteLifetimeSeconds={3600}
        onClose={onClose}
        onCreated={vi.fn()}
        onMaybeCreated={onMaybeCreated}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onMaybeCreated).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
