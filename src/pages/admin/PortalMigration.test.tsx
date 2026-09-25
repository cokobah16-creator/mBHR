import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

type SessionState = "unknown" | "signed_in" | "signed_out";

const { mockFindEligible, mockBulkEnable, session, server } = vi.hoisted(
  () => ({
    mockFindEligible: vi.fn(),
    mockBulkEnable: vi.fn(),
    session: { state: "signed_in" as SessionState },
    server: { available: true },
  }),
);

vi.mock("@/db", () => ({ db: {} }));

// The page follows the server's answers to its last run with live queries;
// none are needed here.
vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (_query: unknown, _deps: unknown, defaultValue?: unknown) => defaultValue,
}));

vi.mock("@/services/portalAccess", () => ({
  listPortalAccessCommandsFor: vi.fn(),
}));

vi.mock("@/services/portalEnrollment", () => ({
  findEligiblePatients: (...a: unknown[]) => mockFindEligible(...a),
  bulkEnablePortalAccess: (...a: unknown[]) => mockBulkEnable(...a),
}));

vi.mock("@/lib/cloudSession", () => ({
  ONLINE_SIGN_IN_HINT:
    "On the sign-in screen, choose Online and use your email and password.",
  useCloudSession: () => session.state,
}));

vi.mock("@/features/admin/useServerStatus", () => ({
  useServerStatus: () =>
    server.available
      ? { state: "available", available: true, label: "Online", detail: "" }
      : { state: "offline", available: false, label: "Offline", detail: "" },
}));

vi.mock("@/stores/auth", () => {
  const authState = { currentUser: { role: "admin" } };
  const useAuthStore = (selector: (state: typeof authState) => unknown) =>
    selector(authState);
  return { useAuthStore };
});

import { PortalMigration } from "./PortalMigration";

const patient = {
  id: "p1",
  givenName: "Ada",
  familyName: "Obi",
  dob: "1990-01-01",
  phone: "08012345678",
  email: "ada@example.com",
  state: "Lagos",
  createdAt: new Date("2026-01-01T10:00:00"),
};

async function renderWithOnePatientSelected() {
  render(
    <MemoryRouter>
      <PortalMigration />
    </MemoryRouter>,
  );
  const box = await screen.findByLabelText("Select Ada Obi");
  fireEvent.click(box);
}

describe("PortalMigration invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.state = "signed_in";
    server.available = true;
    mockFindEligible.mockResolvedValue([patient]);
    mockBulkEnable.mockResolvedValue({
      success: 1,
      failed: 0,
      errors: [],
      pending: 1,
      deviceOnly: 0,
    });
  });

  it("offers invitations when signed in online, only to patients the server confirmed", async () => {
    await renderWithOnePatientSelected();

    const invite = screen.getByRole("button", {
      name: "Enable and send invitations",
    });
    expect(invite).toBeEnabled();
    fireEvent.click(invite);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/only to patients whose access the server has confirmed/i);
    expect(dialog).not.toHaveTextContent(/each patient is sent an invitation/i);
  });

  it("says patients under 18 are not listed", async () => {
    await renderWithOnePatientSelected();

    expect(screen.getByText(/patients under 18 are not listed/i)).toBeInTheDocument();
  });

  it("turns invitations off after a PIN unlock and says why", async () => {
    session.state = "signed_out";
    await renderWithOnePatientSelected();

    expect(
      screen.getByRole("button", { name: "Enable and send invitations" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/you are not signed in online, so the server will not send invitations/i),
    ).toBeInTheDocument();
    // Enabling access alone does not need the server.
    expect(
      screen.getByRole("button", { name: "Enable access only" }),
    ).toBeEnabled();
  });

  it("still asks for access without invitations when not signed in online, and says it is queued", async () => {
    session.state = "signed_out";
    await renderWithOnePatientSelected();

    fireEvent.click(screen.getByRole("button", { name: "Enable access only" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/sent to the clinic server when you sign in online/i);
    fireEvent.click(screen.getByRole("button", { name: "Enable access for 1" }));

    await waitFor(() => expect(mockBulkEnable).toHaveBeenCalledTimes(1));
    expect(mockBulkEnable).toHaveBeenCalledWith(
      ["p1"],
      expect.objectContaining({ sendInvitations: false }),
    );
    const summary = await screen.findByText(/portal access asked for 1 of 1 patient/i);
    expect(summary).toHaveTextContent(/sent to the server when you sign in online/i);
    expect(summary).not.toHaveTextContent(/on this device only/i);
    expect(summary).not.toHaveTextContent(/undefined/);
  });

  it("does not block invitations while the sign-in check has not finished", async () => {
    session.state = "unknown";
    await renderWithOnePatientSelected();

    expect(
      screen.getByRole("button", { name: "Enable and send invitations" }),
    ).toBeEnabled();
  });
});
