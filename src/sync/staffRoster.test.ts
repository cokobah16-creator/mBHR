import { describe, it, expect, vi, beforeEach } from "vitest";

const { rows, mockSelect } = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  mockSelect: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: mockSelect }),
    auth: { signOut: vi.fn() },
  },
}));

vi.mock("@/db", () => ({
  db: {
    transaction: async (_mode: string, _table: unknown, cb: () => Promise<void>) => cb(),
    users: {
      get: async (id: string) => rows.get(id),
      put: async (row: Record<string, unknown>) => {
        rows.set(String(row.id), row);
      },
      update: async (id: string, changes: Record<string, unknown>) => {
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, ...changes });
      },
      filter: (predicate: (row: Record<string, unknown>) => boolean) => ({
        toArray: async () => [...rows.values()].filter(predicate),
      }),
    },
  },
  generateId: () => "generated-id",
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

import { pullStaffRoster, staffFromServerRow } from "./staffRoster";

beforeEach(() => {
  rows.clear();
  mockSelect.mockReset();
});

describe("staffFromServerRow", () => {
  it("brings identity, role and active status, never PIN fields", () => {
    const staff = staffFromServerRow({
      id: "u1",
      full_name: "Ada Okafor",
      role: "doctor",
      email: "ada@clinic.ng",
      pin_hash: "server-should-not-have-this",
    });
    expect(staff).toMatchObject({
      id: "u1",
      fullName: "Ada Okafor",
      role: "doctor",
      email: "ada@clinic.ng",
      isActive: 1,
    });
    expect(staff).not.toHaveProperty("pinHash");
    expect(staff).not.toHaveProperty("pinSalt");
    expect(staff).not.toHaveProperty("pinEnrolledAt");
  });

  it("marks a switched-off account inactive", () => {
    expect(staffFromServerRow({ id: "u1", role: "nurse", is_active: false }).isActive).toBe(0);
  });

  it("marks an account with no known role inactive, as the database does", () => {
    expect(staffFromServerRow({ id: "u1", role: "guest" }).isActive).toBe(0);
    expect(staffFromServerRow({ id: "u1", role: "janitor" }).isActive).toBe(0);
  });
});

describe("pullStaffRoster", () => {
  it("adds new staff without a PIN and keeps an existing device PIN", async () => {
    rows.set("u1", {
      id: "u1",
      fullName: "Ada",
      role: "nurse",
      pinHash: "local-hash",
      pinSalt: "local-salt",
      isActive: 1,
    });
    mockSelect.mockResolvedValue({
      data: [
        { id: "u1", full_name: "Ada Okafor", role: "doctor" },
        { id: "u2", full_name: "Chidi Eze", role: "pharmacist" },
      ],
      error: null,
    });

    const result = await pullStaffRoster();

    expect(result).toEqual({ ok: true, staff: 2, deactivated: 0 });
    expect(rows.get("u1")).toMatchObject({
      fullName: "Ada Okafor",
      role: "doctor",
      pinHash: "local-hash",
      pinSalt: "local-salt",
    });
    expect(rows.get("u2")).toMatchObject({
      fullName: "Chidi Eze",
      role: "pharmacist",
      isActive: 1,
      pinHash: "",
      pinSalt: "",
    });
  });

  it("switches off synced staff the server no longer lists, not local-only ones", async () => {
    rows.set("gone", { id: "gone", fullName: "Left", isActive: 1, _syncedAt: "2026-09-01" });
    rows.set("local", { id: "local", fullName: "Local admin", isActive: 1 });
    mockSelect.mockResolvedValue({
      data: [
        { id: "u1", full_name: "Ada Okafor", role: "doctor" },
        { id: "u2", full_name: "Chidi Eze", role: "pharmacist" },
      ],
      error: null,
    });

    const result = await pullStaffRoster();

    expect(result).toEqual({ ok: true, staff: 2, deactivated: 1 });
    expect(rows.get("gone")?.isActive).toBe(0);
    expect(rows.get("local")?.isActive).toBe(1);
  });

  it("switches nobody off when the server shows only the signed-in person", async () => {
    rows.set("other", { id: "other", fullName: "Chidi", isActive: 1, _syncedAt: "2026-09-01" });
    mockSelect.mockResolvedValue({
      data: [{ id: "me", full_name: "Ada Okafor", role: "doctor" }],
      error: null,
    });

    expect(await pullStaffRoster()).toEqual({ ok: true, staff: 1, deactivated: 0 });
    expect(rows.get("other")?.isActive).toBe(1);
  });

  it("changes nothing when the server returns no rows", async () => {
    rows.set("u1", { id: "u1", fullName: "Ada", isActive: 1, _syncedAt: "2026-09-01" });
    mockSelect.mockResolvedValue({ data: [], error: null });

    expect(await pullStaffRoster()).toEqual({ ok: true, staff: 0, deactivated: 0 });
    expect(rows.get("u1")?.isActive).toBe(1);
  });

  it("reports a failed download without throwing", async () => {
    mockSelect.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await pullStaffRoster()).toEqual({ ok: false, reason: "error" });
  });
});
