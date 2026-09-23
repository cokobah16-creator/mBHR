import { describe, it, expect, vi, beforeEach } from "vitest";
import { findAdminByPin } from "./deviceReset";

// db.users.where("isActive").equals(1).filter(fn).toArray(): the mock applies
// the caller's filter so the admin-only rule is exercised, not assumed.
const { mockUsers, activeUsers } = vi.hoisted(() => {
  const activeUsers: Array<Record<string, unknown>> = [];
  return {
    activeUsers,
    mockUsers: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          filter: (fn: (u: Record<string, unknown>) => boolean) => ({
            toArray: async () => activeUsers.filter(fn),
          }),
        })),
      })),
    },
  };
});

vi.mock("./index", () => ({ db: { users: mockUsers } }));

vi.mock("@/utils/pin", () => ({
  verifyPin: vi.fn(
    async (pin: string, hash: string, salt: string) =>
      hash === `${pin}@${salt}`,
  ),
}));

function user(id: string, role: string, pin: string | null) {
  return {
    id,
    role,
    pinSalt: pin ? "salt" : "",
    pinHash: pin ? `${pin}@salt` : "",
  };
}

describe("findAdminByPin", () => {
  beforeEach(() => {
    activeUsers.length = 0;
    vi.clearAllMocks();
  });

  it("returns the administrator whose PIN matches", async () => {
    activeUsers.push(user("a1", "admin", "111111"));
    await expect(findAdminByPin("111111")).resolves.toMatchObject({
      id: "a1",
    });
  });

  it("rejects a correct PIN that belongs to a non-admin", async () => {
    activeUsers.push(user("n1", "nurse", "222222"));
    await expect(findAdminByPin("222222")).resolves.toBeNull();
  });

  it("rejects a wrong PIN", async () => {
    activeUsers.push(user("a1", "admin", "111111"));
    await expect(findAdminByPin("999999")).resolves.toBeNull();
  });

  it("never matches an admin without a PIN (online sign-in accounts)", async () => {
    activeUsers.push(user("a2", "admin", null));
    await expect(findAdminByPin("")).resolves.toBeNull();
    await expect(findAdminByPin("000000")).resolves.toBeNull();
  });

  it("rejects anything that is not six digits without a lookup", async () => {
    await expect(findAdminByPin("12345")).resolves.toBeNull();
    expect(mockUsers.where).not.toHaveBeenCalled();
  });
});
