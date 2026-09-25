import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getPortalStatus: vi.fn(),
    sendPortalInvitation: vi.fn(),
    enablePortalAccess: vi.fn(),
    disablePortalAccess: vi.fn(),
    pushToast: vi.fn(),
    serverState: "available" as "available" | "offline" | "not-configured",
  },
}));

vi.mock("@/services/portalEnrollment", () => ({
  getPortalStatus: (...args: unknown[]) => mocks.getPortalStatus(...args),
  sendPortalInvitation: (...args: unknown[]) =>
    mocks.sendPortalInvitation(...args),
  enablePortalAccess: (...args: unknown[]) => mocks.enablePortalAccess(...args),
  disablePortalAccess: (...args: unknown[]) =>
    mocks.disablePortalAccess(...args),
}));

vi.mock("@/stores/toast", () => ({
  useToast: () => ({ push: mocks.pushToast }),
}));

vi.mock("@/stores/auth", () => {
  const state = { currentUser: { role: "nurse" } };
  const useAuthStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

vi.mock("@/db", () => ({ generateId: () => "toast-id" }));

vi.mock("@/features/admin/useServerStatus", () => ({
  useServerStatus: () => ({
    state: mocks.serverState,
    available: mocks.serverState === "available",
    label: "",
    detail: "",
  }),
}));

import { PortalStatusCard } from "./PortalStatusCard";

const disabledStatus = {
  enabled: false,
  verified: false,
  contactMethod: "phone" as const,
  inviteCount: 0,
  canResend: false,
};

function renderCard() {
  return render(
    <PortalStatusCard patientId="p1" patientName="Ada Obi" />,
  );
}

async function openEnableDialog() {
  renderCard();
  const toggle = await screen.findByRole("switch");
  fireEvent.click(toggle);
  return screen.getByRole("alertdialog");
}

function lastToastBody(): string {
  const calls = mocks.pushToast.mock.calls;
  return (calls[calls.length - 1]?.[0] as { body: string }).body;
}

async function turnOn() {
  await openEnableDialog();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /has agreed to use the patient portal/i }),
  );
  fireEvent.click(screen.getByRole("button", { name: /turn on access/i }));
  await waitFor(() => expect(mocks.pushToast).toHaveBeenCalled());
}

describe("PortalStatusCard turning access on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverState = "available";
    mocks.getPortalStatus.mockResolvedValue(disabledStatus);
    mocks.enablePortalAccess.mockResolvedValue({ success: true });
  });

  it("asks for the patient's agreement with an unticked box first", async () => {
    await openEnableDialog();

    const agreed = screen.getByRole("checkbox", {
      name: /ada has agreed to use the patient portal/i,
    }) as HTMLInputElement;
    expect(agreed.checked).toBe(false);
    expect(
      (screen.getByRole("button", { name: /turn on access/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.enablePortalAccess).not.toHaveBeenCalled();
  });

  it("does not turn access on until the box is ticked", async () => {
    await openEnableDialog();

    fireEvent.click(screen.getByRole("button", { name: /turn on access/i }));
    expect(mocks.enablePortalAccess).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("checkbox", { name: /has agreed to use the patient portal/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /turn on access/i }));

    await waitFor(() =>
      expect(mocks.enablePortalAccess).toHaveBeenCalledWith("p1", {
        termsAccepted: true,
      }),
    );
  });

  it("starts unticked again after cancelling", async () => {
    await openEnableDialog();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /has agreed to use the patient portal/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("switch"));
    const agreed = screen.getByRole("checkbox", {
      name: /has agreed to use the patient portal/i,
    }) as HTMLInputElement;
    expect(agreed.checked).toBe(false);
    expect(mocks.enablePortalAccess).not.toHaveBeenCalled();
  });
});

describe("PortalStatusCard says where portal access was saved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverState = "available";
    mocks.getPortalStatus.mockResolvedValue(disabledStatus);
  });

  it("does not promise online access in the dialog", async () => {
    const dialog = await openEnableDialog();

    expect(dialog.textContent).not.toMatch(/online\./i);
    expect(dialog.textContent).toMatch(/if the server does not take it/i);
  });

  it("says the device is offline in the dialog when it is", async () => {
    mocks.serverState = "offline";
    const dialog = await openEnableDialog();

    expect(dialog.textContent).toMatch(/saved on this device only/i);
    expect(dialog.textContent).not.toMatch(/sent to the server/i);
  });

  it("says so when the server took the change", async () => {
    mocks.enablePortalAccess.mockResolvedValue({ success: true, server: "updated" });

    await turnOn();

    expect(lastToastBody()).toMatch(/on this device and on the server/i);
  });

  it("says only this device changed when the server did not take it", async () => {
    mocks.enablePortalAccess.mockResolvedValue({
      success: true,
      server: "not-updated",
    });

    await turnOn();

    expect(lastToastBody()).toMatch(/saved on this device only/i);
    expect(lastToastBody()).toMatch(/not be uploaded yet/i);
  });

  it("says only this device changed when offline", async () => {
    mocks.enablePortalAccess.mockResolvedValue({ success: true, server: "offline" });

    await turnOn();

    expect(lastToastBody()).toMatch(/this device only.*offline/i);
  });

  it("says whether turning access off reached the server", async () => {
    mocks.getPortalStatus.mockResolvedValue({ ...disabledStatus, enabled: true });
    mocks.disablePortalAccess.mockResolvedValue({
      success: true,
      server: "not-updated",
    });
    renderCard();
    fireEvent.click(await screen.findByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /turn off access/i }));

    await waitFor(() => expect(mocks.disablePortalAccess).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalled());
    expect(lastToastBody()).toMatch(/turned off on this device only/i);
    expect(lastToastBody()).toMatch(/online portal account may still work/i);
  });
});
