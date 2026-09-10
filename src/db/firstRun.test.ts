import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createFirstAdmin,
  needsFirstRunSetup,
  FIRST_ADMIN_EXISTS_MESSAGE,
} from "./firstRun";

const { mockUsers, mockTransaction } = vi.hoisted(() => ({
  mockUsers: {
    count: vi.fn(),
    add: vi.fn(),
  },
  mockTransaction: vi.fn(),
}));

vi.mock("./index", () => ({
  db: {
    users: mockUsers,
    transaction: mockTransaction,
  },
  generateId: () => "generated-id",
}));

vi.mock("@/utils/pin", () => ({
  derivePinHash: vi.fn(async (pin: string, salt: string) => `${pin}@${salt}`),
  newSaltB64: vi.fn(() => "fixed-salt"),
}));

const validInput = {
  fullName: "  Amina Bello  ",
  pin: "482913",
  confirmPin: "482913",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUsers.count.mockResolvedValue(0);
  mockUsers.add.mockResolvedValue(undefined);
  // Dexie runs the callback with the transaction open; the tables argument is
  // irrelevant to what we are asserting.
  mockTransaction.mockImplementation(
    async (_mode: string, _table: unknown, cb: () => Promise<void>) => cb(),
  );
});

describe("needsFirstRunSetup", () => {
  it("is true when the device has no staff account", async () => {
    mockUsers.count.mockResolvedValue(0);
    await expect(needsFirstRunSetup()).resolves.toBe(true);
  });

  it("is false once any staff account exists", async () => {
    mockUsers.count.mockResolvedValue(1);
    await expect(needsFirstRunSetup()).resolves.toBe(false);
  });
});

describe("createFirstAdmin", () => {
  it("creates a permanent, active admin with a hashed PIN", async () => {
    const user = await createFirstAdmin(validInput);

    expect(mockUsers.add).toHaveBeenCalledTimes(1);
    const written = mockUsers.add.mock.calls[0][0];

    expect(written).toMatchObject({
      id: "generated-id",
      fullName: "Amina Bello",
      role: "admin",
      pinHash: "482913@fixed-salt",
      pinSalt: "fixed-salt",
      adminAccess: true,
      adminPermanent: true,
      isActive: 1,
    });
    // The raw PIN must never reach the database.
    expect(JSON.stringify(written)).not.toContain('"482913"');
    expect(user).toEqual(written);
  });

  it("derives the PIN hash before opening the write transaction", async () => {
    const { derivePinHash } = await import("@/utils/pin");
    const order: string[] = [];

    vi.mocked(derivePinHash).mockImplementationOnce(async () => {
      order.push("derive");
      return "hash";
    });
    mockTransaction.mockImplementationOnce(
      async (_mode: string, _table: unknown, cb: () => Promise<void>) => {
        order.push("transaction");
        return cb();
      },
    );

    await createFirstAdmin(validInput);

    // crypto.subtle is not a Dexie operation: awaiting it inside a transaction
    // would let the transaction commit early.
    expect(order).toEqual(["derive", "transaction"]);
  });

  it("refuses when another tab created a user first", async () => {
    // The setup route rendered on a count of zero; by the time the write
    // transaction opens, another tab has already written an admin.
    mockUsers.count.mockResolvedValue(1);

    await expect(createFirstAdmin(validInput)).rejects.toThrow(
      FIRST_ADMIN_EXISTS_MESSAGE,
    );
    expect(mockUsers.add).not.toHaveBeenCalled();
  });

  it("rejects a blank full name", async () => {
    await expect(
      createFirstAdmin({ ...validInput, fullName: "   " }),
    ).rejects.toThrow("full name");
    expect(mockUsers.add).not.toHaveBeenCalled();
  });

  it.each(["12345", "1234567", "12a456", ""])(
    "rejects the malformed PIN %j",
    async (pin) => {
      await expect(
        createFirstAdmin({ ...validInput, pin, confirmPin: pin }),
      ).rejects.toThrow("6 digits");
      expect(mockUsers.add).not.toHaveBeenCalled();
    },
  );

  it("rejects mismatched PINs", async () => {
    await expect(
      createFirstAdmin({ ...validInput, confirmPin: "999999" }),
    ).rejects.toThrow("do not match");
    expect(mockUsers.add).not.toHaveBeenCalled();
  });
});
