import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findAdminByPin, wipeDevice } from "./deviceReset";

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

const { appDatabases, mockClearApiCaches } = vi.hoisted(() => ({
  appDatabases: ["mbhr_v5", "mbhr", "mbhr_outbox", "gamification_db"].map(
    (name) => ({ name, delete: vi.fn(async () => undefined) }),
  ),
  mockClearApiCaches: vi.fn(async () => undefined),
}));

vi.mock("./appDatabases", () => ({ APP_DATABASES: appDatabases }));
vi.mock("@/services/clearApiCaches", () => ({
  clearApiCaches: mockClearApiCaches,
}));

/** indexedDB.deleteDatabase stand-in that answers with the given outcome. */
function deleteRequest(outcome: "onsuccess" | "onerror" | "onblocked") {
  const request: Record<string, unknown> = {
    error: outcome === "onerror" ? new DOMException("failed", "UnknownError") : null,
  };
  queueMicrotask(() => (request[outcome] as (() => void) | undefined)?.());
  return request;
}

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

describe("wipeDevice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("erases every app database, those left by earlier versions, cached server answers and the session", async () => {
    const deletedByName: string[] = [];
    vi.stubGlobal("indexedDB", {
      databases: async () => [
        { name: "mbhr_v5", version: 180 },
        { name: "mbhr_v4", version: 90 },
        { name: "keyval-store", version: 1 },
      ],
      deleteDatabase: (name: string) => {
        deletedByName.push(name);
        return deleteRequest("onsuccess");
      },
    });
    localStorage.setItem("mbhr-auth", "{}");
    sessionStorage.setItem("patient_session_token", "token");

    await wipeDevice();

    for (const database of appDatabases) {
      expect(database.delete).toHaveBeenCalledTimes(1);
    }
    expect(deletedByName).toEqual(["mbhr_v4", "keyval-store"]);
    expect(mockClearApiCaches).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("does not wait for a window that still holds a leftover database open", async () => {
    vi.stubGlobal("indexedDB", {
      databases: async () => [{ name: "workbox-expiration", version: 1 }],
      deleteDatabase: () => deleteRequest("onblocked"),
    });

    await wipeDevice();

    expect(appDatabases[0].delete).toHaveBeenCalledTimes(1);
  });

  it("fails before touching the app databases when a leftover cannot be deleted", async () => {
    vi.stubGlobal("indexedDB", {
      databases: async () => [{ name: "mbhr_v4", version: 90 }],
      deleteDatabase: () => deleteRequest("onerror"),
    });
    localStorage.setItem("mbhr-auth", "{}");

    await expect(wipeDevice()).rejects.toBeInstanceOf(DOMException);

    for (const database of appDatabases) {
      expect(database.delete).not.toHaveBeenCalled();
    }
    expect(localStorage.getItem("mbhr-auth")).toBe("{}");
  });

  it("still erases the app databases where the browser cannot list databases", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await wipeDevice();

    for (const database of appDatabases) {
      expect(database.delete).toHaveBeenCalledTimes(1);
    }
  });
});
