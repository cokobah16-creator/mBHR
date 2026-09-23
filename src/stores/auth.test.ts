import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { accessFromAppUser, useAuthStore } from "./auth";

const { mockDbUsers, mockDbSessions, mockSupabase, mockFrom } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  return {
    mockDbUsers: {
      filter: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        first: vi.fn().mockResolvedValue(undefined),
      }),
      put: vi.fn().mockResolvedValue(undefined),
    },
    mockDbSessions: {
      add: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    mockFrom,
    mockSupabase: {
      auth: {
        signInWithPassword: vi.fn(),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
      from: mockFrom,
    },
  };
});

vi.mock("@/lib/supabase", () => ({ supabase: mockSupabase }));

vi.mock("@/db", () => ({
  db: {
    users: mockDbUsers,
    sessions: mockDbSessions,
  },
  generateId: () => "test-id-123",
}));

vi.mock("@/utils/pin", () => ({
  verifyPin: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

/** from("app_users").select().eq().maybeSingle() resolving to `result`. */
function appUsersLookup(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ select });
  return { select, eq };
}

const AUTH_USER = { id: "auth-uid-1", email: "ngozi@clinic.ng", user_metadata: {} };

describe("useAuthStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({
      currentUser: null,
      currentSession: null,
      isAuthenticated: false,
      failedAttempts: 0,
      lockoutUntil: null,
      sessionExpiresAt: null,
      lastActivityAt: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("should have correct initial state", () => {
      const state = useAuthStore.getState();
      expect(state.currentUser).toBeNull();
      expect(state.currentSession).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.failedAttempts).toBe(0);
      expect(state.lockoutUntil).toBeNull();
    });
  });

  describe("login validation", () => {
    it("should reject invalid PIN format", async () => {
      const result = await useAuthStore.getState().login("12345");
      expect(result).toBe(false);
      expect(useAuthStore.getState().failedAttempts).toBe(1);
    });

    it("should reject non-numeric PIN", async () => {
      const result = await useAuthStore.getState().login("abcdef");
      expect(result).toBe(false);
      expect(useAuthStore.getState().failedAttempts).toBe(1);
    });

    it("should reject PIN with spaces", async () => {
      const result = await useAuthStore.getState().login("123 45");
      expect(result).toBe(false);
    });
  });

  describe("failed attempts and lockout", () => {
    it("should increment failed attempts", () => {
      const store = useAuthStore.getState();
      expect(store.failedAttempts).toBe(0);

      store.incrementFailedAttempts();
      expect(useAuthStore.getState().failedAttempts).toBe(1);

      store.incrementFailedAttempts();
      expect(useAuthStore.getState().failedAttempts).toBe(2);
    });

    it("should trigger lockout after 5 failed attempts", () => {
      const store = useAuthStore.getState();

      for (let i = 0; i < 5; i++) {
        store.incrementFailedAttempts();
      }

      const state = useAuthStore.getState();
      expect(state.failedAttempts).toBe(5);
      expect(state.lockoutUntil).not.toBeNull();
    });

    it("should detect lockout correctly", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      useAuthStore.setState({
        lockoutUntil: now + 15 * 60 * 1000,
      });

      expect(useAuthStore.getState().checkLockout()).toBe(true);

      vi.advanceTimersByTime(16 * 60 * 1000);
      expect(useAuthStore.getState().checkLockout()).toBe(false);
    });

    it("should reset failed attempts after lockout expires", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      useAuthStore.setState({
        failedAttempts: 5,
        lockoutUntil: now + 15 * 60 * 1000,
      });

      vi.advanceTimersByTime(16 * 60 * 1000);
      useAuthStore.getState().checkLockout();

      const state = useAuthStore.getState();
      expect(state.failedAttempts).toBe(0);
      expect(state.lockoutUntil).toBeNull();
    });

    it("should reset failed attempts explicitly", () => {
      useAuthStore.setState({
        failedAttempts: 3,
        lockoutUntil: Date.now() + 1000,
      });

      useAuthStore.getState().resetFailedAttempts();

      const state = useAuthStore.getState();
      expect(state.failedAttempts).toBe(0);
      expect(state.lockoutUntil).toBeNull();
    });
  });

  describe("logout", () => {
    it("should clear authentication state", async () => {
      useAuthStore.setState({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentUser: { id: "user-1", fullName: "Test User" } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentSession: { id: "session-1" } as any,
        isAuthenticated: true,
        sessionExpiresAt: Date.now() + 1000000,
        lastActivityAt: Date.now(),
      });

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.currentUser).toBeNull();
      expect(state.currentSession).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.sessionExpiresAt).toBeNull();
      expect(state.lastActivityAt).toBeNull();
    });
  });

  describe("setCurrentUser", () => {
    it("should set current user", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = { id: "user-1", fullName: "Test User" } as any;

      useAuthStore.getState().setCurrentUser(user);

      expect(useAuthStore.getState().currentUser).toEqual(user);
    });

    it("should clear current user when set to null", () => {
      useAuthStore.setState({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentUser: { id: "user-1" } as any,
      });

      useAuthStore.getState().setCurrentUser(null);

      expect(useAuthStore.getState().currentUser).toBeNull();
    });
  });

  describe("session activity", () => {
    it("should update last activity time", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      useAuthStore.setState({
        sessionExpiresAt: now + 12 * 60 * 60 * 1000,
        lastActivityAt: now - 1000,
      });

      useAuthStore.getState().updateActivity();

      expect(useAuthStore.getState().lastActivityAt).toBe(now);
    });

    it("should extend session if less than 1 hour remaining", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      const thirtyMinutesFromNow = now + 30 * 60 * 1000;

      useAuthStore.setState({
        sessionExpiresAt: thirtyMinutesFromNow,
        lastActivityAt: now - 1000,
      });

      useAuthStore.getState().updateActivity();

      const state = useAuthStore.getState();
      expect(state.sessionExpiresAt).toBeGreaterThan(thirtyMinutesFromNow);
    });
  });

  describe("session expiry check", () => {
    it("should return false if not authenticated", () => {
      useAuthStore.setState({
        isAuthenticated: false,
        sessionExpiresAt: null,
      });

      expect(useAuthStore.getState().checkSessionExpiry()).toBe(false);
    });

    it("should return false if session not expired", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      useAuthStore.setState({
        isAuthenticated: true,
        sessionExpiresAt: now + 1000000,
      });

      expect(useAuthStore.getState().checkSessionExpiry()).toBe(false);
    });

    it("should return true and logout if session expired", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      useAuthStore.setState({
        isAuthenticated: true,
        sessionExpiresAt: now - 1000,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentUser: { id: "test" } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentSession: { id: "session" } as any,
      });

      const result = useAuthStore.getState().checkSessionExpiry();

      expect(result).toBe(true);
    });
  });

  describe("accessFromAppUser", () => {
    it("uses the role on the server staff record", () => {
      expect(accessFromAppUser({ role: "nurse", full_name: " Ngozi Eze " })).toEqual({
        role: "nurse",
        fullName: "Ngozi Eze",
      });
      expect(accessFromAppUser({ role: "lead_clinician" }).role).toBe("lead_clinician");
    });

    it("gives no access without a record, with an unknown role or when deactivated", () => {
      expect(accessFromAppUser(null).role).toBe("guest");
      expect(accessFromAppUser({ role: "chw" }).role).toBe("guest");
      expect(accessFromAppUser({ role: "doctor", is_active: false }).role).toBe("guest");
      expect(accessFromAppUser({ role: "doctor", is_active: 0 }).role).toBe("guest");
      expect(accessFromAppUser({ role: "doctor", disabled: true }).role).toBe("guest");
      expect(accessFromAppUser({ role: "doctor", deactivated_at: "2026-01-01" }).role).toBe("guest");
      expect(accessFromAppUser({ role: "doctor", is_active: true }).role).toBe("doctor");
    });
  });

  describe("loginOnline on a new device", () => {
    beforeEach(() => {
      mockSupabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: AUTH_USER },
        error: null,
      });
      mockDbUsers.filter.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        first: vi.fn().mockResolvedValue(undefined),
      });
    });

    it("takes the role from app_users (id = online user id), not staff_roles", async () => {
      const lookup = appUsersLookup({
        data: { id: AUTH_USER.id, role: "pharmacist", full_name: "Ngozi Eze" },
        error: null,
      });

      const ok = await useAuthStore.getState().loginOnline("Ngozi@clinic.ng", "secret");

      expect(ok).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith("app_users");
      expect(mockFrom).not.toHaveBeenCalledWith("staff_roles");
      expect(lookup.eq).toHaveBeenCalledWith("id", AUTH_USER.id);
      const user = useAuthStore.getState().currentUser;
      expect(user).toMatchObject({ id: AUTH_USER.id, role: "pharmacist", fullName: "Ngozi Eze" });
      expect(mockDbUsers.put).toHaveBeenCalledWith(
        expect.objectContaining({ id: AUTH_USER.id, role: "pharmacist", adminAccess: false }),
      );
    });

    it("gives no access (not volunteer) when there is no server staff record", async () => {
      appUsersLookup({ data: null, error: null });

      await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret");

      expect(useAuthStore.getState().currentUser?.role).toBe("guest");
    });

    it("gives no access when the staff record cannot be read", async () => {
      appUsersLookup({ data: null, error: { code: "42501" } });

      await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret");

      expect(useAuthStore.getState().currentUser?.role).toBe("guest");
    });

    it("follows a role change for an account created by an earlier online sign-in", async () => {
      const stored = {
        id: AUTH_USER.id,
        fullName: "Ngozi Eze",
        role: "volunteer",
        email: AUTH_USER.email,
        isActive: 1,
      };
      mockDbUsers.filter.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([stored]),
        first: vi.fn().mockResolvedValue(stored),
      });
      appUsersLookup({ data: { id: AUTH_USER.id, role: "nurse", full_name: "Ngozi Eze" }, error: null });

      await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret");

      expect(useAuthStore.getState().currentUser?.role).toBe("nurse");
    });

    it("keeps the stored role when the lookup fails for an existing account", async () => {
      const stored = {
        id: AUTH_USER.id,
        fullName: "Ngozi Eze",
        role: "nurse",
        email: AUTH_USER.email,
        isActive: 1,
      };
      mockDbUsers.filter.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([stored]),
        first: vi.fn().mockResolvedValue(stored),
      });
      appUsersLookup({ data: null, error: { code: "PGRST000" } });

      await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret");

      expect(useAuthStore.getState().currentUser?.role).toBe("nurse");
      expect(mockDbUsers.put).not.toHaveBeenCalled();
    });

    it("leaves a device-created account's role alone", async () => {
      const stored = {
        id: "local-ulid",
        fullName: "Ngozi Eze",
        role: "doctor",
        email: AUTH_USER.email,
        isActive: 1,
      };
      mockDbUsers.filter.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([stored]),
        first: vi.fn().mockResolvedValue(stored),
      });

      await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret");

      expect(mockFrom).not.toHaveBeenCalled();
      expect(useAuthStore.getState().currentUser?.role).toBe("doctor");
    });
  });
});
