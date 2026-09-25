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
    cloudSession: "signed_in" as "unknown" | "signed_in" | "signed_out",
    role: "registration_lead",
    // What useLiveQuery returns: the patient row and its queued commands.
    // Kept as stable objects: the card reloads when the patient changes.
    patient: { portalEnabled: 0, portalPending: 0 } as Record<string, unknown>,
    commands: [] as unknown[],
  },
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (_query: unknown, _deps: unknown, defaultValue?: unknown) =>
    defaultValue === undefined ? mocks.patient : mocks.commands,
}));

vi.mock("@/services/portalEnrollment", () => ({
  getPortalStatus: (...args: unknown[]) => mocks.getPortalStatus(...args),
  sendPortalInvitation: (...args: unknown[]) => mocks.sendPortalInvitation(...args),
  enablePortalAccess: (...args: unknown[]) => mocks.enablePortalAccess(...args),
  disablePortalAccess: (...args: unknown[]) => mocks.disablePortalAccess(...args),
  INVITE_NOT_SENT_REASONS: {
    noServer: "not_sent_no_server",
    serviceFailed: "not_sent_service_failed",
    demoMode: "not_sent_demo_mode",
  },
}));

vi.mock("@/services/portalAccess", () => ({
  listPortalAccessCommands: vi.fn(),
}));

vi.mock("@/stores/toast", () => ({
  useToast: () => ({ push: mocks.pushToast }),
}));

vi.mock("@/stores/auth", () => {
  const useAuthStore = (selector: (s: { currentUser: { role: string } }) => unknown) =>
    selector({ currentUser: { role: mocks.role } });
  useAuthStore.getState = () => ({ currentUser: { role: mocks.role } });
  return { useAuthStore };
});

vi.mock("@/db", () => ({ db: {}, generateId: () => "toast-id" }));

vi.mock("@/features/admin/useServerStatus", () => ({
  useServerStatus: () => ({
    state: mocks.serverState,
    available: mocks.serverState === "available",
    label: "",
    detail: "",
  }),
}));

vi.mock("@/lib/cloudSession", () => ({
  ONLINE_SIGN_IN_HINT: "On the sign-in screen, choose Online and use your email and password.",
  useCloudSession: () => mocks.cloudSession,
}));

import { PortalStatusCard } from "./PortalStatusCard";
import { MINOR_PORTAL_ACCESS_MESSAGE } from "@/pages/legal/policyMeta";

const OFF = { portalEnabled: 0, portalPending: 0 };
const ON = { portalEnabled: 1, portalPending: 0 };

const baseStatus = {
  enabled: false,
  pending: false,
  verified: false,
  contactMethod: "email" as const,
  inviteCount: 0,
  canResend: false,
  minor: false,
};

function renderCard() {
  return render(<PortalStatusCard patientId="p1" patientName="Ada Obi" />);
}

async function openEnableDialog() {
  renderCard();
  fireEvent.click(await screen.findByRole("switch"));
  return screen.getByRole("alertdialog");
}

function lastToastBody(): string {
  const calls = mocks.pushToast.mock.calls;
  return (calls[calls.length - 1]?.[0] as { body: string }).body;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serverState = "available";
  mocks.cloudSession = "signed_in";
  mocks.role = "registration_lead";
  mocks.patient = OFF;
  mocks.commands = [];
  mocks.getPortalStatus.mockResolvedValue(baseStatus);
  mocks.enablePortalAccess.mockResolvedValue({ success: true, pending: true, deviceOnly: false });
  mocks.disablePortalAccess.mockResolvedValue({ success: true, pending: true, deviceOnly: false });
});

describe("PortalStatusCard turning access on (staff attestation)", () => {
  it("asks for the patient's agreement with an unticked box first", async () => {
    await openEnableDialog();

    const agreed = screen.getByRole("checkbox", {
      name: /ada has agreed to use the patient portal/i,
    }) as HTMLInputElement;
    expect(agreed.checked).toBe(false);
    expect(
      (screen.getByRole("button", { name: /turn on access/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(mocks.enablePortalAccess).not.toHaveBeenCalled();
  });

  it("turns access on only after the box is ticked, and passes the tick on", async () => {
    await openEnableDialog();

    fireEvent.click(screen.getByRole("button", { name: /turn on access/i }));
    expect(mocks.enablePortalAccess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: /has agreed to use the patient portal/i }));
    fireEvent.click(screen.getByRole("button", { name: /turn on access/i }));

    await waitFor(() =>
      expect(mocks.enablePortalAccess).toHaveBeenCalledWith("p1", { termsAccepted: true }),
    );
  });

  it("starts unticked again after cancelling", async () => {
    await openEnableDialog();
    fireEvent.click(screen.getByRole("checkbox", { name: /has agreed to use the patient portal/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("switch"));
    const agreed = screen.getByRole("checkbox", {
      name: /has agreed to use the patient portal/i,
    }) as HTMLInputElement;
    expect(agreed.checked).toBe(false);
    expect(mocks.enablePortalAccess).not.toHaveBeenCalled();
  });

  it("says the change is queued and the server decides", async () => {
    const dialog = await openEnableDialog();

    expect(dialog.textContent).toMatch(/queued for the clinic server, which decides/i);
    expect(dialog.textContent).toMatch(/once the server confirms/i);
  });
});

describe("PortalStatusCard when the staff member is not signed in online", () => {
  beforeEach(() => {
    mocks.cloudSession = "signed_out";
  });

  it("says turning access on is queued and sent when they sign in online", async () => {
    const dialog = await openEnableDialog();

    expect(dialog.textContent).toMatch(/queued/i);
    expect(dialog.textContent).toMatch(/sent to the server when you sign in online/i);
    expect(dialog.textContent).not.toMatch(/on this device only/i);
  });

  it("says the same after the change is saved", async () => {
    await openEnableDialog();
    fireEvent.click(screen.getByRole("checkbox", { name: /has agreed to use the patient portal/i }));
    fireEvent.click(screen.getByRole("button", { name: /turn on access/i }));

    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalled());
    expect(lastToastBody()).toMatch(/sent to the server when you sign in online/i);
  });

  it("says turning access off is queued and sent when they sign in online", async () => {
    mocks.patient = ON;
    mocks.getPortalStatus.mockResolvedValue({ ...baseStatus, enabled: true });
    renderCard();
    fireEvent.click(await screen.findByRole("switch"));
    const dialog = screen.getByRole("alertdialog");

    expect(dialog.textContent).toMatch(/sent to the server when you sign in online/i);
    expect(dialog.textContent).not.toMatch(/on this device only/i);
  });

  it("does not say so on a device with no server", async () => {
    mocks.serverState = "not-configured";
    const dialog = await openEnableDialog();

    expect(dialog.textContent).toMatch(/for this device only/i);
    expect(dialog.textContent).not.toMatch(/sign in online/i);
  });
});

describe("PortalStatusCard for a patient under 18", () => {
  it("does not open the turn-on dialog for a child's record", async () => {
    mocks.getPortalStatus.mockResolvedValue({ ...baseStatus, minor: true });
    renderCard();

    fireEvent.click(await screen.findByRole("switch"));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(lastToastBody()).toBe(MINOR_PORTAL_ACCESS_MESSAGE);
    expect(mocks.enablePortalAccess).not.toHaveBeenCalled();
  });

  it("never says a child can register, offers no invitation, and still turns access off", async () => {
    mocks.patient = ON;
    mocks.getPortalStatus.mockResolvedValue({
      ...baseStatus,
      enabled: true,
      minor: true,
      inviteCount: 1,
    });
    renderCard();

    expect(
      await screen.findByText(/portal accounts are for adults.*cannot register/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/can register and sign in/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /portal invitation/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /create registration link/i })).toBeNull();
    expect(screen.queryByText("What to tell the patient")).toBeNull();

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /turn off access/i }));
    await waitFor(() => expect(mocks.disablePortalAccess).toHaveBeenCalledWith("p1"));
  });

  it("offers invitations for an adult with access on", async () => {
    mocks.patient = ON;
    mocks.getPortalStatus.mockResolvedValue({ ...baseStatus, enabled: true });
    renderCard();

    expect(
      await screen.findByRole("button", { name: /send portal invitation/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/can register and sign in to the portal/i)).toBeInTheDocument();
  });
});

describe("PortalStatusCard registration instructions", () => {
  it("tells staff a phone-only record needs an email before the patient registers", async () => {
    mocks.patient = ON;
    mocks.getPortalStatus.mockResolvedValue({
      ...baseStatus,
      enabled: true,
      contactMethod: "phone",
      inviteCount: 1,
    });
    renderCard();

    expect(await screen.findByText("What to tell the patient")).toBeInTheDocument();
    expect(screen.getByText(/add the patient's email to their record/i)).toBeInTheDocument();
    expect(screen.queryByText(/enter your phone number and date of birth/i)).toBeNull();
  });

  it("tells an email patient to register with a password and sign in with it", async () => {
    mocks.patient = ON;
    mocks.getPortalStatus.mockResolvedValue({ ...baseStatus, enabled: true, inviteCount: 1 });
    renderCard();

    expect(await screen.findByText("What to tell the patient")).toBeInTheDocument();
    expect(screen.getByText(/sign in with your email and password/i)).toBeInTheDocument();
  });
});
