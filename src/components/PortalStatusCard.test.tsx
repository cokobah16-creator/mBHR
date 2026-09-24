import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getPortalStatus: vi.fn(),
    sendPortalInvitation: vi.fn(),
    enablePortalAccess: vi.fn(),
    disablePortalAccess: vi.fn(),
    pushToast: vi.fn(),
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
    state: "online",
    available: true,
    label: "Online",
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

describe("PortalStatusCard turning access on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
