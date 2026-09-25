import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { mockLimit, mockBulkEnroll } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockBulkEnroll: vi.fn(),
}));

// from("patients").select(...).or(...).eq(...).order(...).limit(...)
vi.mock("@/lib/supabase", () => {
  const query = {
    select: () => query,
    or: () => query,
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
    render(
      <MemoryRouter>
        <BulkPortalMigration />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Ada Obi")).toBeInTheDocument();
    expect(screen.queryByText("Chidi Obi")).toBeNull();
    expect(
      screen.getByText(/patients under 18 are not listed/i),
    ).toBeInTheDocument();
  });
});
