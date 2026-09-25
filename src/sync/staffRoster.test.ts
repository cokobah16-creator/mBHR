import { describe, it, expect, vi, beforeEach } from "vitest";

const { rows, mockSelect, signedIn } = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  mockSelect: vi.fn(),
  // The online account the server answers for.
  signedIn: { id: "u1" as string | null },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: mockSelect }),
    auth: {
      signOut: vi.fn(),
      getSession: async () => ({
        data: { session: signedIn.id ? { user: { id: signedIn.id } } : null },
        error: null,
      }),
    },
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

import {
  isFullStaffDirectory,
  keepLocalRevocation,
  pullStaffRoster,
  staffFromServerRow,
} from "./staffRoster";

beforeEach(() => {
  rows.clear();
  mockSelect.mockReset();
  signedIn.id = "u1";
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
      count: 2,
      error: null,
    });

    const result = await pullStaffRoster();

    expect(result).toEqual({ ok: true, staff: 2, deactivated: 1 });
    expect(rows.get("gone")?.isActive).toBe(0);
    expect(rows.get("local")?.isActive).toBe(1);
  });

  it("switches nobody off when the server cut the directory short", async () => {
    rows.set("u3", { id: "u3", fullName: "Past the limit", isActive: 1, _syncedAt: "2026-09-01" });
    mockSelect.mockResolvedValue({
      data: [
        { id: "u1", full_name: "Ada Okafor", role: "doctor" },
        { id: "u2", full_name: "Chidi Eze", role: "pharmacist" },
      ],
      count: 3,
      error: null,
    });

    expect(await pullStaffRoster()).toEqual({ ok: true, staff: 2, deactivated: 0 });
    expect(rows.get("u3")?.isActive).toBe(1);
  });

  it("switches nobody off when the answer is not an active staff member's view", async () => {
    rows.set("other", { id: "other", fullName: "Chidi", isActive: 1, _syncedAt: "2026-09-01" });
    const answer = (callerRole: string) => ({
      data: [
        { id: "u1", full_name: "Signed in", role: callerRole },
        { id: "u2", full_name: "Ngozi", role: "nurse" },
      ],
      count: 2,
      error: null,
    });

    // The signed-in account has no staff role.
    mockSelect.mockResolvedValue(answer("guest"));
    expect(await pullStaffRoster()).toMatchObject({ ok: true, deactivated: 0 });
    // The signed-in account is not in the answer, or not known.
    mockSelect.mockResolvedValue(answer("doctor"));
    signedIn.id = "someone-else";
    expect(await pullStaffRoster()).toMatchObject({ ok: true, deactivated: 0 });
    signedIn.id = null;
    expect(await pullStaffRoster()).toMatchObject({ ok: true, deactivated: 0 });

    expect(rows.get("other")?.isActive).toBe(1);
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

  it("never reactivates someone deactivated on this device; flags them for review", async () => {
    rows.set("u1", {
      id: "u1",
      fullName: "Ada",
      role: "doctor",
      isActive: 0,
      disabledLocallyAt: new Date("2026-09-20"),
      pinHash: "h",
      pinSalt: "s",
    });
    mockSelect.mockResolvedValue({
      data: [
        { id: "u1", full_name: "Ada Okafor", role: "doctor" },
        { id: "u2", full_name: "Chidi Eze", role: "pharmacist" },
      ],
      error: null,
    });

    await pullStaffRoster();

    expect(rows.get("u1")).toMatchObject({ isActive: 0, accessConflict: 1, fullName: "Ada Okafor" });
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

describe("isFullStaffDirectory", () => {
  const two = [
    { id: "u1", role: "doctor" },
    { id: "u2", role: "nurse" },
  ];

  it("accepts every counted row, including the caller as active staff", () => {
    expect(isFullStaffDirectory(two, 2, "u1")).toBe(true);
  });

  it("refuses one row, a short or uncounted page, and an unknown caller", () => {
    expect(isFullStaffDirectory([two[0]], 1, "u1")).toBe(false);
    expect(isFullStaffDirectory(two, 1000, "u1")).toBe(false);
    expect(isFullStaffDirectory(two, null, "u1")).toBe(false);
    expect(isFullStaffDirectory(two, 2, null)).toBe(false);
    expect(isFullStaffDirectory(two, 2, "u9")).toBe(false);
  });

  it("refuses an answer to a caller who is switched off or not staff", () => {
    expect(isFullStaffDirectory([{ ...two[0], is_active: false }, two[1]], 2, "u1")).toBe(false);
    expect(isFullStaffDirectory([{ ...two[0], role: "guest" }, two[1]], 2, "u1")).toBe(false);
  });
});

describe("keepLocalRevocation", () => {
  it("leaves a server change alone when nothing was deactivated here", () => {
    expect(keepLocalRevocation({ isActive: 0 }, { isActive: 1 })).toEqual({ isActive: 1 });
  });

  it("keeps a server deactivation", () => {
    expect(
      keepLocalRevocation({ isActive: 0, disabledLocallyAt: new Date() }, { isActive: 0 }),
    ).toEqual({ isActive: 0 });
  });
});
