import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { mockLimit, mockOr, mockBulkEnroll } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockOr: vi.fn(),
  mockBulkEnroll: vi.fn(),
}));

// from("patients").select(...).or(...).or(...).eq(...).order(...).limit(...)
vi.mock("@/lib/supabase", () => {
  const query = {
    select: () => query,
    or: (...a: unknown[]) => {
      mockOr(...a);
      return query;
    },
    eq: () => query,
    order: () => query,
    limit: (...a: unknown[]) => mockLimit(...a),
  };
  return { supabase: { from: () => query } };
});

vi.mock("@/services/unifiedPortalEnrollment", () => ({
  bulkEnrollPatients: (...a: unknown[]) => mockBulkEnroll(...a),
}));

vi.mock("@/features/admin/useServerStatus", () => ({
  useServerStatus: () => ({
    state: "available",
    available: true,
    label: "Online",
    detail: "",
  }),
}));

vi.mock("@/stores/auth", () => {
  const authState = { currentUser: { role: "admin" } };
  const useAuthStore = (selector: (state: typeof authState) => unknown) =>
    selector(authState);
  return { useAuthStore };
});

import { BulkPortalMigration } from "./BulkPortalMigration";

/** 1 January, ten years ago: someone under 18 whatever today's date is. */
function childDob(): string {
  return `${new Date().getFullYear() - 10}-01-01`;
}

const row = {
  email: null,
  phone: "08012345678",
  portal_enabled: false,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <BulkPortalMigration />
    </MemoryRouter>,
  );
}

describe("BulkPortalMigration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue({
      data: [
        {
          ...row,
          id: "adult",
          given_name: "Ada",
          family_name: "Obi",
          dob: "1990-01-01",
        },
        {
          ...row,
          id: "child",
          given_name: "Chidi",
          family_name: "Obi",
          dob: childDob(),
        },
      ],
      error: null,
    });
  });

  it("does not list patients under 18", async () => {
    renderPage();

    expect(await screen.findByText("Ada Obi")).toBeInTheDocument();
    expect(screen.queryByText("Chidi Obi")).toBeNull();
    expect(
      screen.getByText(/patients under 18 are not listed/i),
    ).toBeInTheDocument();
  });

  it("leaves children out on the server, before the 100-row limit", async () => {
    renderPage();

    await screen.findByText("Ada Obi");
    const filters = mockOr.mock.calls.map((c) => String(c[0]));
    const dobFilter = filters.find((f) => f.includes("dob.lte."));
    expect(dobFilter).toBeDefined();
    // Records with no date of birth are still listed.
    expect(dobFilter).toContain("dob.is.null");
    // Born on or before this day 18 years ago.
    const now = new Date();
    const cutoff = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(dobFilter).toContain(
      `dob.lte.${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`,
    );
  });

  it("says how patients sign in, without promising a one-time code", async () => {
    renderPage();

    await screen.findByText("Ada Obi");
    expect(screen.queryByText(/one-time code/i)).toBeNull();
    expect(
      screen.getByText(/sign in with their email and password/i),
    ).toBeInTheDocument();
    // The fixture's patients have only a phone number: say they must enter it.
    expect(screen.getByText(/only their phone number/i)).toBeInTheDocument();
  });
});
