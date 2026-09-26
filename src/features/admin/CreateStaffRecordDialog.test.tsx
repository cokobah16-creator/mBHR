import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    createStaffRecordForLogin: vi.fn(),
  },
}));

vi.mock("@/services/staffAccounts", () => ({
  createStaffRecordForLogin: (...args: unknown[]) => mocks.createStaffRecordForLogin(...args),
}));

import CreateStaffRecordDialog from "./CreateStaffRecordDialog";

const USER_ID = "44444444-4444-4444-8444-444444444444";

const ITEM = {
  userId: USER_ID,
  email: "ada@example.com",
  emailMasked: "a***@example.com",
  fullName: "Ada Obi",
};

function renderDialog(item = ITEM) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <CreateStaffRecordDialog
      item={item}
      roles={["volunteer", "nurse", "doctor", "pharmacist", "admin"]}
      onClose={onClose}
      onCreated={onCreated}
    />,
  );
  return { onClose, onCreated };
}

function submitButton() {
  return screen.getByRole("button", { name: "Create staff record" }) as HTMLButtonElement;
}

function fillIn(email: string, role: string) {
  fireEvent.change(screen.getByLabelText("Their email (type it in full)"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: role } });
}

function tick() {
  fireEvent.click(
    screen.getByRole("checkbox", { name: "I know this person and they should have staff access" }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createStaffRecordForLogin.mockReset();
  mocks.createStaffRecordForLogin.mockResolvedValue({
    ok: true,
    data: { userId: USER_ID, status: "active" },
  });
});

describe("CreateStaffRecordDialog", () => {
  it("never offers the Administrator role", () => {
    renderDialog();
    const role = screen.getByLabelText("Role") as HTMLSelectElement;
    const values = Array.from(role.options).map((o) => o.value);
    expect(values).toEqual(["", "volunteer", "nurse", "doctor", "pharmacist"]);
    expect(screen.getByText("Administrator can't be chosen here.")).toBeInTheDocument();
  });

  it("starts with the box unticked and cannot be sent until it is ticked", () => {
    renderDialog();
    const box = screen.getByRole("checkbox", {
      name: "I know this person and they should have staff access",
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);

    fillIn("ada@example.com", "nurse");
    expect(submitButton().disabled).toBe(true);
    fireEvent.click(submitButton());
    expect(mocks.createStaffRecordForLogin).not.toHaveBeenCalled();

    tick();
    expect(submitButton().disabled).toBe(false);
  });

  it("needs the login's email typed in full", async () => {
    renderDialog();
    fillIn("ada@example.co", "nurse");
    tick();
    fireEvent.click(submitButton());

    expect(
      await screen.findByText("What you typed doesn't match this login's email."),
    ).toBeInTheDocument();
    expect(mocks.createStaffRecordForLogin).not.toHaveBeenCalled();
  });

  it("needs a role", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Their email (type it in full)"), {
      target: { value: "ada@example.com" },
    });
    tick();
    fireEvent.click(submitButton());

    expect(await screen.findByText("Choose one of the listed roles.")).toBeInTheDocument();
    expect(mocks.createStaffRecordForLogin).not.toHaveBeenCalled();
  });

  it("sends the typed email, name, role and the tick, then reports and closes", async () => {
    const { onCreated, onClose } = renderDialog();
    fillIn(" ADA@example.com ", "nurse");
    tick();
    fireEvent.click(submitButton());

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mocks.createStaffRecordForLogin).toHaveBeenCalledWith({
      userId: USER_ID,
      fullName: "Ada Obi",
      role: "nurse",
      confirmEmail: "ada@example.com",
      acknowledged: true,
    });
    const message = onCreated.mock.calls[0][0] as { title: string; body: string };
    expect(message.title).toBe("Staff record created");
    expect(message.body).toBe("Ada Obi now has a staff record.");
    expect(onClose).toHaveBeenCalled();
  });

  it("leaves the email check to the server when only a masked email is known", async () => {
    mocks.createStaffRecordForLogin.mockResolvedValueOnce({
      ok: false,
      failure: "refused",
      code: "confirm_mismatch",
      message: "What you typed doesn't match this account.",
      body: {
        fn: "staff-admin",
        success: false,
        error: "confirm_mismatch",
        field: "confirmEmail",
        message: "What you typed doesn't match this account.",
      },
    });
    const { onCreated } = renderDialog({ ...ITEM, email: null, fullName: null });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada Obi" } });
    fillIn("someone@example.com", "volunteer");
    tick();
    fireEvent.click(submitButton());

    expect(
      await screen.findByText("What you typed doesn't match this account."),
    ).toBeInTheDocument();
    expect(mocks.createStaffRecordForLogin).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("asks to check the list after a lost reply, and refreshes it on close", async () => {
    mocks.createStaffRecordForLogin.mockResolvedValueOnce({
      ok: false,
      failure: "unreachable",
      message: "Couldn't reach the server. Try again.",
      body: null,
    });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const onMaybeCreated = vi.fn();
    render(
      <CreateStaffRecordDialog
        item={ITEM}
        roles={["volunteer", "nurse"]}
        onClose={onClose}
        onCreated={onCreated}
        onMaybeCreated={onMaybeCreated}
      />,
    );
    fillIn("ada@example.com", "nurse");
    tick();
    fireEvent.click(submitButton());

    expect(
      await screen.findByText(
        "We couldn't confirm the staff record was created. Close this and check the list before trying again.",
      ),
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onMaybeCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
