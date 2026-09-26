import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AccountView, HealthItem } from "@/services/staffAccounts";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    createLoginForStaffRecord: vi.fn(),
    createStaffRecordForLogin: vi.fn(),
  },
}));

vi.mock("@/services/staffAccounts", () => ({
  createLoginForStaffRecord: (...args: unknown[]) => mocks.createLoginForStaffRecord(...args),
  createStaffRecordForLogin: (...args: unknown[]) => mocks.createStaffRecordForLogin(...args),
}));

import AccountHealthPanel from "./AccountHealthPanel";

const WITHOUT_LOGIN: HealthItem = {
  kind: "staff_without_login",
  userId: "66666666-6666-4666-8666-666666666666",
  email: null,
  emailMasked: null,
  fullName: "Ada Obi",
  createdAt: null,
  repair: "create_login",
};

const UNCONFIRMED: HealthItem = {
  kind: "unknown_login",
  userId: "77777777-7777-4777-8777-777777777777",
  email: null,
  emailMasked: "b***@example.com",
  fullName: null,
  createdAt: null,
  repair: null,
  blocked: "login_unconfirmed",
};

function overview(problems: HealthItem[]) {
  return {
    health: {
      problems,
      counts: { portalPatients: 3, portalSignups: 1, anonymous: 0 },
      truncated: false,
    },
    roles: ["volunteer", "nurse"],
    inviteLifetimeSeconds: 3600,
  };
}

function toggle(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AccountHealthPanel", () => {
  it("starts collapsed and counts the problems in its header", () => {
    render(
      <AccountHealthPanel
        overview={overview([WITHOUT_LOGIN, UNCONFIRMED])}
        deviceOnlyNames={["Old Record"]}
        canRepair
        onRepaired={vi.fn()}
      />,
    );
    const header = screen.getByRole("button", { name: "Account health (3 problems)" });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/has a staff record but can't sign in online/)).toBeNull();
  });

  it("lists each problem, why some can't be repaired, and the portal count", () => {
    render(
      <AccountHealthPanel
        overview={overview([WITHOUT_LOGIN, UNCONFIRMED])}
        deviceOnlyNames={["Old Record"]}
        canRepair
        onRepaired={vi.fn()}
      />,
    );
    toggle(/Account health/);

    expect(
      screen.getByText("Ada Obi has a staff record but can't sign in online."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Unknown login b***@example.com has no staff record, so it can't open the staff app.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This login was never confirmed. If they work here, add them with Add Staff."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Old Record exists on this device only/)).toBeInTheDocument();
    expect(
      screen.getByText("Patient portal logins: 4 (not staff, no action needed)."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Create login" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Create staff record" })).toBeNull();
  });

  it("says when nothing is wrong", () => {
    render(<AccountHealthPanel overview={overview([])} canRepair onRepaired={vi.fn()} />);
    toggle(/Account health/);
    expect(screen.getByText("No problems found.")).toBeInTheDocument();
  });

  it("opens the Create login confirmation from a problem's button", () => {
    render(
      <AccountHealthPanel overview={overview([WITHOUT_LOGIN])} canRepair onRepaired={vi.fn()} />,
    );
    toggle(/Account health/);
    fireEvent.click(screen.getByRole("button", { name: "Create login" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("Type Ada Obi's full name to confirm, and the email they'll use."),
    ).toBeInTheDocument();
    expect(mocks.createLoginForStaffRecord).not.toHaveBeenCalled();
  });

  it("offers no Create login for a record whose role can't be given here", () => {
    render(
      <AccountHealthPanel
        overview={{
          ...overview([WITHOUT_LOGIN]),
          accounts: [{ userId: WITHOUT_LOGIN.userId, role: "admin" } as AccountView],
        }}
        canRepair
        onRepaired={vi.fn()}
      />,
    );
    toggle(/Account health/);
    expect(screen.queryByRole("button", { name: "Create login" })).toBeNull();
    expect(
      screen.getByText(
        "Logins for administrators can't be added here yet. Ask whoever runs your server to add their login.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps repair buttons off while the server can't be used", () => {
    render(
      <AccountHealthPanel
        overview={overview([WITHOUT_LOGIN])}
        canRepair={false}
        onRepaired={vi.fn()}
      />,
    );
    toggle(/Account health/);
    const button = screen.getByRole("button", { name: "Create login" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const note = screen.getByText(
      "Repairs need an internet connection. Try again when the staff list has loaded.",
    );
    expect(button.getAttribute("aria-describedby")).toBe(note.id);
  });

  it("says nothing about repairs being off while they can run", () => {
    render(
      <AccountHealthPanel overview={overview([WITHOUT_LOGIN])} canRepair onRepaired={vi.fn()} />,
    );
    toggle(/Account health/);
    expect(screen.queryByText(/Repairs need an internet connection/)).toBeNull();
    expect(screen.getByRole("button", { name: "Create login" }).getAttribute("aria-describedby")).toBeNull();
  });
});
