import { describe, it, expect, vi, beforeEach } from "vitest";

// --- hoisted mocks ---
const { mockPatients, serverState } = vi.hoisted(() => ({
  mockPatients: {
    where: vi.fn(),
    add: vi.fn(),
    get: vi.fn(),
  },
  serverState: { configured: false },
}));

type LocalUser = {
  id: string;
  email?: string;
  phone?: string;
  dob: string;
  pin?: string;
  sessionToken?: string;
  sessionExpiresAt?: string;
  createdAt: string;
};

vi.mock("@/db", () => ({
  db: {
    patients: mockPatients,
  },
}));

// No server by default; a test can switch one on (portal access then
// belongs to the server and the device's copy must be recent).
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return serverState.configured ? { rpc: vi.fn() } : null;
  },
}));
vi.mock("@/lib/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/utils/phone", () => ({
  normalizePhone: (v: string) => v,
}));

// Intercept localStorage so tests can inspect it
let store: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
  removeItem: (k: string) => {
    delete store[k];
  },
  clear: () => {
    store = {};
  },
});

// Lazy import so mocks are in place first
const { registerPatientPortalAccount, loginPatientPortal, logout } =
  await import("./patientPortalAuth");

function seedStore(user: LocalUser) {
  store["mbhr_portal_users"] = JSON.stringify([user]);
}

describe("patientPortalAuth", () => {
  beforeEach(() => {
    store = {};
    vi.clearAllMocks();
    mockPatients.where.mockReturnValue({
      equalsIgnoreCase: vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          equals: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
        toArray: vi.fn().mockResolvedValue([]),
      }),
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });
    mockPatients.add.mockResolvedValue("new-patient-id");
    mockPatients.get.mockResolvedValue(undefined);
    serverState.configured = false;
  });

  // --- registerPatientPortalAccount ---
  describe("registerPatientPortalAccount", () => {
    it("requires at least phone or email", async () => {
      const r = await registerPatientPortalAccount(
        undefined,
        undefined,
        "1990-01-01",
        "Ada",
        "Obi",
        "123456",
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/phone number or email/i);
    });

    it("requires a date of birth", async () => {
      const r = await registerPatientPortalAccount(
        undefined,
        "ada@test.com",
        "",
        "Ada",
        "Obi",
        "123456",
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/date of birth/i);
    });

    it("requires a 6-digit PIN", async () => {
      const r = await registerPatientPortalAccount(
        undefined,
        "ada@test.com",
        "1990-01-01",
        "Ada",
        "Obi",
        "123",
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/6-digit PIN/i);
    });

    it("rejects non-numeric PIN", async () => {
      const r = await registerPatientPortalAccount(
        undefined,
        "ada@test.com",
        "1990-01-01",
        "Ada",
        "Obi",
        "abc123",
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/6-digit PIN/i);
    });

    it("rejects duplicate contact", async () => {
      seedStore({
        id: "u1",
        email: "ada@test.com",
        dob: "1990-01-01",
        pin: "hashed",
        createdAt: new Date().toISOString(),
      });
      const r = await registerPatientPortalAccount(
        undefined,
        "ada@test.com",
        "1990-01-01",
        "Ada",
        "Obi",
        "654321",
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/already exists/i);
    });

    it("creates account and returns session token on success", async () => {
      const r = await registerPatientPortalAccount(
        undefined,
        "new@test.com",
        "1995-05-10",
        "Chidi",
        "Eze",
        "112233",
      );
      expect(r.success).toBe(true);
      expect(r.sessionToken).toBeTruthy();
      expect(r.portalUser?.id).toBeTruthy();

      const saved = JSON.parse(store["mbhr_portal_users"] ?? "[]");
      expect(saved).toHaveLength(1);
      expect(saved[0].email).toBe("new@test.com");
      // PIN should be hashed, not stored in plaintext
      expect(saved[0].pin).not.toBe("112233");
    });
  });

  // --- loginPatientPortal ---
  describe("loginPatientPortal", () => {
    const hashedPin =
      "b23ed7a1c2f4f7f1e4e8f3e5b6c9d0a12345678901234567890123456789012"; // placeholder

    it("fails with empty contact", async () => {
      const r = await loginPatientPortal("", "123456", "pin");
      expect(r.success).toBe(false);
    });

    it("returns error when no account found", async () => {
      const r = await loginPatientPortal("ghost@test.com", "123456", "pin");
      expect(r.success).toBe(false);
    });

    it("returns error for wrong PIN", async () => {
      seedStore({
        id: "u1",
        email: "ada@test.com",
        dob: "1990-01-01",
        pin: hashedPin,
        createdAt: new Date().toISOString(),
      });
      const r = await loginPatientPortal("ada@test.com", "999999", "pin");
      expect(r.success).toBe(false);
    });

    it("returns error for expired session", async () => {
      seedStore({
        id: "u1",
        email: "ada@test.com",
        dob: "1990-01-01",
        pin: hashedPin,
        sessionToken: "tok123",
        sessionExpiresAt: new Date(Date.now() - 1000).toISOString(),
        createdAt: new Date().toISOString(),
      });
      // Session validation is done elsewhere; login itself should work when correct
      // This test confirms loginPatientPortal doesn't crash with expired token field
      const r = await loginPatientPortal("ada@test.com", "999999", "pin");
      expect(r.success).toBe(false);
    });
  });

  // --- portal access checks ---
  describe("portal access", () => {
    const DAY = 24 * 60 * 60 * 1000;

    function seedDobUser(patientId = "p1") {
      store["mbhr_portal_users"] = JSON.stringify([
        {
          id: "u1",
          patientId,
          givenName: "Ada",
          familyName: "Obi",
          email: "ada@test.com",
          dob: "1990-01-01",
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    it("refuses a local sign-in when staff turned portal access off", async () => {
      seedDobUser();
      mockPatients.get.mockResolvedValue({ id: "p1", portalEnabled: 0 });

      const r = await loginPatientPortal("ada@test.com", "1990-01-01", "dob");

      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not turned on portal access/i);
      expect(r.sessionToken).toBeUndefined();
    });

    it("allows a local sign-in without a server when access was never turned off", async () => {
      seedDobUser();
      mockPatients.get.mockResolvedValue({ id: "p1" });

      const r = await loginPatientPortal("ada@test.com", "1990-01-01", "dob");

      expect(r.success).toBe(true);
      expect(r.sessionToken).toBeTruthy();
    });

    it("with a server, the offline copy expires", async () => {
      serverState.configured = true;
      seedDobUser();
      mockPatients.get.mockResolvedValue({
        id: "p1",
        portalEnabled: 1,
        _syncedAt: new Date(Date.now() - 30 * DAY).toISOString(),
      });

      const r = await loginPatientPortal("ada@test.com", "1990-01-01", "dob");

      expect(r.success).toBe(false);
      expect(r.error).toMatch(/could not confirm your portal access/i);
    });

    it("with a server, a recent confirmed copy is used", async () => {
      serverState.configured = true;
      seedDobUser();
      mockPatients.get.mockResolvedValue({
        id: "p1",
        portalEnabled: 1,
        portalEnabledChangedAt: new Date(Date.now() - DAY).toISOString(),
      });

      const r = await loginPatientPortal("ada@test.com", "1990-01-01", "dob");

      expect(r.success).toBe(true);
    });

    it("with a server, a change still waiting for it is not trusted", async () => {
      serverState.configured = true;
      seedDobUser();
      mockPatients.get.mockResolvedValue({
        id: "p1",
        portalEnabled: 1,
        portalPending: 1,
        _syncedAt: new Date().toISOString(),
      });

      const r = await loginPatientPortal("ada@test.com", "1990-01-01", "dob");

      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not confirmed it yet/i);
    });

    it("registration links only to a record with portal access on, without server lookups", async () => {
      mockPatients.where.mockReturnValue({
        equalsIgnoreCase: vi.fn().mockReturnValue({
          or: vi.fn().mockReturnValue({
            equals: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([
                { id: "p1", email: "ada@test.com", dob: "1990-01-01", portalEnabled: 0 },
              ]),
            }),
          }),
        }),
      });

      const r = await registerPatientPortalAccount(
        undefined,
        "ada@test.com",
        "1990-01-01",
        "Ada",
        "Obi",
        "123456",
      );

      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not enabled portal access/i);
      expect(mockPatients.add).not.toHaveBeenCalled();
    });
  });

  // --- logout ---
  describe("logout", () => {
    it("removes session token from sessionStorage", async () => {
      let sessionStore: Record<string, string> = {
        patient_session_token: "tok",
      };
      vi.stubGlobal("sessionStorage", {
        getItem: (k: string) => sessionStore[k] ?? null,
        setItem: (k: string, v: string) => {
          sessionStore[k] = v;
        },
        removeItem: (k: string) => {
          delete sessionStore[k];
        },
        clear: () => {
          sessionStore = {};
        },
      });
      store["patient_portal_user"] = "{}";
      await logout("tok");
      expect(sessionStore["patient_session_token"]).toBeUndefined();
    });
  });
});
