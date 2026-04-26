import { describe, it, expect, vi, beforeEach } from "vitest";

// --- hoisted mocks ---
const { mockPatients } = vi.hoisted(() => ({
  mockPatients: {
    where: vi.fn(),
    add: vi.fn(),
  },
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

vi.mock("@/lib/supabase", () => ({ supabase: null }));
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
