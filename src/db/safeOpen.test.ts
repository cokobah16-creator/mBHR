import { describe, it, expect, vi, beforeEach } from "vitest";

// The database as stored on the device, read by the recovery helpers
// through Dexie's dynamic mode (a stand-in below).
const { stored, mockOpen, mockWipe } = vi.hoisted(() => ({
  stored: {
    openError: null as unknown,
    tables: {} as Record<string, Record<string, unknown>[]>,
    closed: 0,
  },
  mockOpen: vi.fn(),
  mockWipe: vi.fn(),
}));

vi.mock("dexie", () => {
  const table = (name: string, rows: Record<string, unknown>[]) => ({
    name,
    filter: (keep: (row: Record<string, unknown>) => boolean) => ({
      count: async () => rows.filter(keep).length,
      toArray: async () => rows.filter(keep),
    }),
  });
  class StoredDatabase {
    static delete = vi.fn();
    async open() {
      if (stored.openError) throw stored.openError;
      return this;
    }
    close() {
      stored.closed += 1;
    }
    get tables() {
      return Object.keys(stored.tables).map((name) => table(name, stored.tables[name]));
    }
    table(name: string) {
      const rows = stored.tables[name];
      if (!rows) throw new Error("InvalidTableError");
      return table(name, rows);
    }
  }
  return { default: StoredDatabase };
});

vi.mock("./index", () => ({ db: { open: mockOpen }, DB_NAME: "mbhr_v5" }));
vi.mock("./deviceReset", () => ({ wipeDevice: mockWipe }));
vi.mock("@/utils/pin", () => ({
  verifyPin: vi.fn(async (pin: string, hash: string, salt: string) => hash === `${pin}@${salt}`),
}));

import Dexie from "dexie";
import {
  LocalDatabaseOpenError,
  countStoredUnsyncedRecords,
  isUnsyncedRow,
  safeOpenDb,
  storedAdminPinMatches,
} from "./safeOpen";

beforeEach(() => {
  vi.clearAllMocks();
  stored.openError = null;
  stored.tables = {};
  stored.closed = 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("safeOpenDb", () => {
  it("opens the database", async () => {
    mockOpen.mockResolvedValue(undefined);
    await expect(safeOpenDb()).resolves.toBeUndefined();
  });

  it("never deletes the database when an upgrade fails, and reports it for recovery", async () => {
    mockOpen.mockRejectedValue(Object.assign(new Error("upgrade"), { name: "UpgradeError" }));

    const failure = await safeOpenDb().catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(LocalDatabaseOpenError);
    expect((failure as LocalDatabaseOpenError).upgradeFailed).toBe(true);
    expect(Dexie.delete).not.toHaveBeenCalled();
    expect(mockWipe).not.toHaveBeenCalled();
  });

  it("recognises an upgrade failure that Dexie wrapped", async () => {
    mockOpen.mockRejectedValue({ name: "OpenFailedError", inner: { name: "SchemaError" } });
    const failure = await safeOpenDb().catch((e: unknown) => e);
    expect((failure as LocalDatabaseOpenError).upgradeFailed).toBe(true);
  });

  it("reports other failures without calling them a failed upgrade", async () => {
    mockOpen.mockRejectedValue(Object.assign(new Error("newer"), { name: "VersionError" }));
    const failure = await safeOpenDb().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(LocalDatabaseOpenError);
    expect((failure as LocalDatabaseOpenError).upgradeFailed).toBe(false);
    expect(mockWipe).not.toHaveBeenCalled();
  });
});

describe("isUnsyncedRow", () => {
  it("counts rows waiting to upload and commands the server has not answered", () => {
    expect(isUnsyncedRow("patients", { id: "p1", _dirty: 1 })).toBe(true);
    expect(isUnsyncedRow("patients", { id: "p1", _dirty: 0 })).toBe(false);
    expect(isUnsyncedRow("serverCommands", { id: "c1", status: "pending" })).toBe(true);
    expect(isUnsyncedRow("serverCommands", { id: "c2", status: "waiting_permission" })).toBe(true);
    expect(isUnsyncedRow("serverCommands", { id: "c3", status: "applied" })).toBe(false);
    expect(isUnsyncedRow("patients", null)).toBe(false);
  });
});

describe("countStoredUnsyncedRecords", () => {
  it("counts unsynced records in every stored table, then closes the database", async () => {
    stored.tables = {
      patients: [{ id: "p1", _dirty: 1 }, { id: "p2", _dirty: 0 }],
      vitals: [{ id: "v1", _dirty: 1 }],
      serverCommands: [{ id: "c1", status: "pending" }],
    };

    expect(await countStoredUnsyncedRecords()).toBe(3);
    expect(stored.closed).toBe(1);
  });

  it("says it does not know when the stored database cannot be read", async () => {
    stored.openError = Object.assign(new Error("broken"), { name: "UnknownError" });
    expect(await countStoredUnsyncedRecords()).toBeNull();
  });
});

describe("storedAdminPinMatches", () => {
  beforeEach(() => {
    stored.tables = {
      users: [
        { id: "a1", role: "admin", isActive: 1, pinHash: "135790@s1", pinSalt: "s1" },
        { id: "n1", role: "nurse", isActive: 1, pinHash: "246801@s2", pinSalt: "s2" },
        { id: "a2", role: "admin", isActive: 0, pinHash: "111111@s3", pinSalt: "s3" },
      ],
    };
  });

  it("accepts an active administrator's PIN only", async () => {
    expect(await storedAdminPinMatches("135790")).toBe(true);
    expect(await storedAdminPinMatches("246801")).toBe(false);
    expect(await storedAdminPinMatches("111111")).toBe(false);
    expect(await storedAdminPinMatches("12345")).toBe(false);
  });

  it("cannot check a PIN when the stored staff list cannot be read", async () => {
    stored.tables = {};
    expect(await storedAdminPinMatches("135790")).toBeNull();
  });
});
