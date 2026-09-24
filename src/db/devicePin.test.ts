import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PIN_IN_USE_MESSAGE,
  pinInUseOnDevice,
  setDevicePin,
} from "./devicePin";

// db.users.filter(...) → a Dexie Collection whose toArray() the code awaits.
const { mockUsers, mockRows } = vi.hoisted(() => {
  const mockRows: Array<Record<string, unknown>> = [];
  return {
    mockRows,
    mockUsers: {
      get: vi.fn(),
      update: vi.fn(),
      filter: vi.fn((predicate: (row: Record<string, unknown>) => boolean) => ({
        toArray: async () => mockRows.filter(predicate),
      })),
    },
  };
});

vi.mock("./index", () => ({
  db: {
    users: mockUsers,
  },
}));

vi.mock("@/utils/pin", () => ({
  derivePinHash: vi.fn(async (pin: string, salt: string) => `${pin}@${salt}`),
  newSaltB64: vi.fn(() => "fixed-salt"),
  // Hashes in these tests are "<pin>@<salt>", so verifying is a string check.
  verifyPin: vi.fn(
    async (pin: string, hash: string, salt: string) =>
      hash === `${pin}@${salt}`,
  ),
}));

const me = {
  id: "me",
  fullName: "Amina Bello",
  role: "nurse",
  pinHash: "",
  pinSalt: "",
  isActive: 1,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const colleague = {
  id: "colleague",
  fullName: "Chidi Okafor",
  role: "doctor",
  pinHash: "111111@their-salt",
  pinSalt: "their-salt",
  isActive: 1,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRows.splice(0, mockRows.length, me, colleague);
  mockUsers.get.mockImplementation(async (id: string) =>
    mockRows.find((row) => row.id === id),
  );
  mockUsers.update.mockResolvedValue(1);
});

describe("pinInUseOnDevice", () => {
  it("finds another account that signs in with the PIN", async () => {
    expect(await pinInUseOnDevice("111111")).toBe(true);
    expect(await pinInUseOnDevice("222222")).toBe(false);
  });

  it("ignores the account being given the PIN", async () => {
    expect(await pinInUseOnDevice("111111", "colleague")).toBe(false);
  });
});

describe("setDevicePin", () => {
  it("stores a salted hash on the account and returns the updated user", async () => {
    const updated = await setDevicePin({
      userId: "me",
      pin: "482913",
      confirmPin: "482913",
    });

    expect(mockUsers.update).toHaveBeenCalledWith("me", {
      pinHash: "482913@fixed-salt",
      pinSalt: "fixed-salt",
      updatedAt: expect.any(Date),
    });
    expect(updated).toMatchObject({
      id: "me",
      fullName: "Amina Bello",
      pinHash: "482913@fixed-salt",
      pinSalt: "fixed-salt",
    });
  });

  it("refuses a PIN another account on the device already uses", async () => {
    await expect(
      setDevicePin({ userId: "me", pin: "111111", confirmPin: "111111" }),
    ).rejects.toThrow(PIN_IN_USE_MESSAGE);
    expect(mockUsers.update).not.toHaveBeenCalled();
  });

  it("rejects a PIN that is not 6 digits", async () => {
    await expect(
      setDevicePin({ userId: "me", pin: "12345", confirmPin: "12345" }),
    ).rejects.toThrow("exactly 6 digits");
    expect(mockUsers.update).not.toHaveBeenCalled();
  });

  it("rejects mismatched PINs", async () => {
    await expect(
      setDevicePin({ userId: "me", pin: "482913", confirmPin: "482914" }),
    ).rejects.toThrow("do not match");
    expect(mockUsers.update).not.toHaveBeenCalled();
  });

  it("refuses an account that is not on this device", async () => {
    await expect(
      setDevicePin({ userId: "nobody", pin: "482913", confirmPin: "482913" }),
    ).rejects.toThrow("not on this device");
    expect(mockUsers.update).not.toHaveBeenCalled();
  });
});
