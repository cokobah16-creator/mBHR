import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PIN_ON_DEVICE,
  accessFromAppUser,
  endSessionIfRevoked,
  isDeactivatedAppUser,
  revalidateOnlineSession,
  useAuthStore,
} from "./auth";
import { verifyPin } from "@/utils/pin";

const { mockDbUsers, mockDbSessions, mockSupabase, mockFrom } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  return {
    mockDbUsers: {
      filter: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        first: vi.fn().mockResolvedValue(undefined),
      }),
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(1),
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
      lockedAt: null,
      authMode: null,
      cloudUserId: null,
      signInRefusal: null,
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
      const result = await useAuthStore.getState().login("u1", "12345");
      expect(result).toBe(false);
      expect(useAuthStore.getState().failedAttempts).toBe(1);
    });

    it("should reject non-numeric PIN", async () => {
      const result = await useAuthStore.getState().login("u1", "abcdef");
      expect(result).toBe(false);
      expect(useAuthStore.getState().failedAttempts).toBe(1);
    });

    it("should reject PIN with spaces", async () => {
      const result = await useAuthStore.getState().login("u1", "123 45");
      expect(result).toBe(false);
    });
  });

  describe("name-first PIN sign-in", () => {
    const ada = {
      id: "u-ada",
      fullName: "Ada Okafor",
      role: "doctor",
      pinHash: "hash-ada",
      pinSalt: "salt-ada",
      isActive: 1,
    };

    it("checks only the chosen account's PIN", async () => {
      mockDbUsers.get.mockResolvedValue(ada);
      vi.mocked(verifyPin).mockResolvedValue(true);

      const ok = await useAuthStore.getState().login("u-ada", "482913");

      expect(ok).toBe(true);
      expect(mockDbUsers.get).toHaveBeenCalledWith("u-ada");
      expect(verifyPin).toHaveBeenCalledTimes(1);
      expect(verifyPin).toHaveBeenCalledWith("482913", "hash-ada", "salt-ada");
      // The PIN hash and salt stay in the device database only.
      expect(useAuthStore.getState().currentUser).toEqual({
        ...ada,
        pinHash: PIN_ON_DEVICE,
        pinSalt: PIN_ON_DEVICE,
      });
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().authMode).toBe("offline");
      expect(useAuthStore.getState().cloudUserId).toBeNull();
      expect(mockDbSessions.add).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u-ada", authMode: "offline" }),
      );
      expect(localStorage.getItem("mbhr-auth")).not.toContain("hash-ada");
      expect(localStorage.getItem("mbhr-auth")).not.toContain("salt-ada");
    });

    it("refuses a wrong PIN and counts the attempt", async () => {
      mockDbUsers.get.mockResolvedValue(ada);
      vi.mocked(verifyPin).mockResolvedValue(false);

      const ok = await useAuthStore.getState().login("u-ada", "111111");

      expect(ok).toBe(false);
      expect(useAuthStore.getState().failedAttempts).toBe(1);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it("refuses an account without a PIN on this device", async () => {
      mockDbUsers.get.mockResolvedValue({ ...ada, pinHash: "", pinSalt: "" });

      const ok = await useAuthStore.getState().login("u-ada", "482913");

      expect(ok).toBe(false);
      expect(verifyPin).not.toHaveBeenCalled();
    });

    it("refuses a deactivated account", async () => {
      mockDbUsers.get.mockResolvedValue({ ...ada, isActive: 0 });
      vi.mocked(verifyPin).mockResolvedValue(true);

      const ok = await useAuthStore.getState().login("u-ada", "482913");

      expect(ok).toBe(false);
    });

    it("refuses an account without a staff role, even with a PIN", async () => {
      mockDbUsers.get.mockResolvedValue({ ...ada, role: "guest" });
      vi.mocked(verifyPin).mockResolvedValue(true);

      const ok = await useAuthStore.getState().login("u-ada", "482913");

      expect(ok).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(mockDbSessions.add).not.toHaveBeenCalled();
    });
  });

  describe("isDeactivatedAppUser", () => {
    it("reads the server's switched-off flags", () => {
      expect(isDeactivatedAppUser({ is_active: false })).toBe(true);
      expect(isDeactivatedAppUser({ deactivated_at: "2026-09-01T00:00:00Z" })).toBe(true);
      expect(isDeactivatedAppUser({ is_active: true })).toBe(false);
      expect(isDeactivatedAppUser({ role: "nurse" })).toBe(false);
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

      expect(useAuthStore.getState().currentUser).toMatchObject(user);
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
      mockDbUsers.get.mockResolvedValue(undefined);
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

    it("refuses an online account with no server staff record: no session, no local record", async () => {
      appUsersLookup({ data: null, error: null });

      const ok = await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret");

      expect(ok).toBe(false);
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.currentUser).toBeNull();
      expect(state.authMode).toBeNull();
      expect(state.cloudUserId).toBeNull();
      expect(state.signInRefusal).toBe("not_staff");
      expect(mockDbUsers.put).not.toHaveBeenCalled();
      expect(mockDbSessions.add).not.toHaveBeenCalled();
    });

    it("refuses a server staff record with an unknown role", async () => {
      appUsersLookup({ data: { id: AUTH_USER.id, role: "chw" }, error: null });

      expect(await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret")).toBe(false);
      expect(useAuthStore.getState().signInRefusal).toBe("not_staff");
      expect(mockDbUsers.put).not.toHaveBeenCalled();
      expect(mockDbSessions.add).not.toHaveBeenCalled();
    });

    it("refuses when the staff record cannot be read and this device does not know the account", async () => {
      appUsersLookup({ data: null, error: { code: "42501" } });

      expect(await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret")).toBe(false);
      expect(useAuthStore.getState().signInRefusal).toBe("staff_check_failed");
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(mockDbUsers.put).not.toHaveBeenCalled();
      expect(mockDbSessions.add).not.toHaveBeenCalled();
    });

    it("switches off offline access for a same-id record whose server staff record is gone", async () => {
      const stored = {
        id: AUTH_USER.id,
        fullName: "Ngozi Eze",
        role: "nurse",
        email: AUTH_USER.email,
        pinHash: "hash",
        pinSalt: "salt",
        isActive: 1,
      };
      mockDbUsers.get.mockResolvedValue(stored);
      appUsersLookup({ data: null, error: null });

      expect(await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret")).toBe(false);

      expect(useAuthStore.getState().signInRefusal).toBe("not_staff");
      expect(mockDbUsers.update).toHaveBeenCalledWith(
        AUTH_USER.id,
        expect.objectContaining({ isActive: 0, pinHash: "", pinSalt: "" }),
      );
      expect(mockDbUsers.put).not.toHaveBeenCalled();
      expect(mockDbSessions.add).not.toHaveBeenCalled();
    });

    it("refuses an email-matched device record when the server has no staff record", async () => {
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
      appUsersLookup({ data: null, error: null });

      expect(await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret")).toBe(false);
      expect(useAuthStore.getState().signInRefusal).toBe("not_staff");
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      // A device-created record under another id is left for an administrator.
      expect(mockDbUsers.update).not.toHaveBeenCalled();
    });

    it("refuses a guest record kept on this device when the server cannot be asked", async () => {
      mockDbUsers.get.mockResolvedValue({
        id: AUTH_USER.id,
        fullName: "Ngozi Eze",
        role: "guest",
        email: AUTH_USER.email,
        isActive: 1,
      });
      appUsersLookup({ data: null, error: { code: "PGRST000" } });

      expect(await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret")).toBe(false);
      expect(useAuthStore.getState().signInRefusal).toBe("not_staff");
      expect(mockDbSessions.add).not.toHaveBeenCalled();
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

      appUsersLookup({ data: { id: AUTH_USER.id, role: "nurse" }, error: null });

      await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret");

      expect(useAuthStore.getState().currentUser?.role).toBe("doctor");
    });
  });
  describe("online and offline sessions are different", () => {
    beforeEach(() => {
      mockSupabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: AUTH_USER },
        error: null,
      });
      mockDbUsers.get.mockResolvedValue(undefined);
      mockDbUsers.filter.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        first: vi.fn().mockResolvedValue(undefined),
      });
    });

    it("an online sign-in records the online session and its account", async () => {
      appUsersLookup({ data: { id: AUTH_USER.id, role: "nurse", is_active: true }, error: null });

      expect(await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret")).toBe(true);

      const state = useAuthStore.getState();
      expect(state.authMode).toBe("online");
      expect(state.cloudUserId).toBe(AUTH_USER.id);
      expect(state.signInRefusal).toBeNull();
      expect(mockDbSessions.add).toHaveBeenCalledWith(
        expect.objectContaining({ authMode: "online" }),
      );
    });

    it("logout clears the session type", async () => {
      appUsersLookup({ data: { id: AUTH_USER.id, role: "nurse" }, error: null });
      await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret");

      await useAuthStore.getState().logout();

      expect(useAuthStore.getState().authMode).toBeNull();
      expect(useAuthStore.getState().cloudUserId).toBeNull();
    });

    it("refuses an account an administrator switched off on this device, and keeps it off", async () => {
      const disabled = {
        id: AUTH_USER.id,
        fullName: "Ngozi Eze",
        role: "nurse",
        email: AUTH_USER.email,
        isActive: 0,
        disabledLocallyAt: new Date("2026-09-24T08:00:00Z"),
        accessConflict: 1,
      };
      mockDbUsers.get.mockResolvedValue(disabled);
      appUsersLookup({ data: { id: AUTH_USER.id, role: "nurse", is_active: true }, error: null });

      expect(await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret")).toBe(false);

      expect(useAuthStore.getState().signInRefusal).toBe("deactivated_on_device");
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      // Not written over with a fresh active record.
      expect(mockDbUsers.put).not.toHaveBeenCalled();
      expect(mockDbSessions.add).not.toHaveBeenCalled();
    });

    it("refuses an account the server has deactivated", async () => {
      appUsersLookup({
        data: { id: AUTH_USER.id, role: "nurse", is_active: false },
        error: null,
      });

      expect(await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret")).toBe(false);

      expect(useAuthStore.getState().signInRefusal).toBe("deactivated");
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(mockDbSessions.add).not.toHaveBeenCalled();
    });

    it("keeps an account the staff directory switched off when the server cannot confirm it", async () => {
      mockDbUsers.get.mockResolvedValue({
        id: AUTH_USER.id,
        fullName: "Ngozi Eze",
        role: "nurse",
        email: AUTH_USER.email,
        isActive: 0,
      });
      appUsersLookup({ data: null, error: { code: "PGRST000" } });

      expect(await useAuthStore.getState().loginOnline("ngozi@clinic.ng", "secret")).toBe(false);
      expect(useAuthStore.getState().signInRefusal).toBe("deactivated");
    });
  });

  describe("endSessionIfRevoked", () => {
    const signedIn = {
      id: "u-ada",
      fullName: "Ada Okafor",
      role: "doctor",
      pinHash: PIN_ON_DEVICE,
      pinSalt: PIN_ON_DEVICE,
      isActive: 1,
    };

    it("ends the session when the signed-in person was switched off on this device", async () => {
      useAuthStore.setState({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentUser: signedIn as any,
        isAuthenticated: true,
        authMode: "offline",
      });
      mockDbUsers.get.mockResolvedValue({ ...signedIn, isActive: 0 });

      expect(await endSessionIfRevoked()).toBe(true);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it("keeps the session and picks up a role change", async () => {
      useAuthStore.setState({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentUser: signedIn as any,
        isAuthenticated: true,
        authMode: "offline",
      });
      mockDbUsers.get.mockResolvedValue({ ...signedIn, role: "nurse", pinHash: "h", pinSalt: "s" });

      expect(await endSessionIfRevoked()).toBe(false);
      expect(useAuthStore.getState().currentUser).toMatchObject({
        role: "nurse",
        pinHash: PIN_ON_DEVICE,
      });
    });
  });

  describe("idle lock", () => {
    const ada = {
      id: "u-ada",
      fullName: "Ada Okafor",
      role: "doctor",
      pinHash: "hash-ada",
      pinSalt: "salt-ada",
      isActive: 1,
    };

    function signedInAndLocked(extra: Record<string, unknown> = {}) {
      useAuthStore.setState({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentUser: { ...ada, pinHash: PIN_ON_DEVICE, pinSalt: PIN_ON_DEVICE } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentSession: { id: "s1", userId: ada.id } as any,
        isAuthenticated: true,
        authMode: "offline",
        sessionExpiresAt: Date.now() + 60 * 60 * 1000,
        lastActivityAt: Date.now() - 11 * 60 * 1000,
        ...extra,
      });
      useAuthStore.getState().lockSession();
      mockDbUsers.get.mockResolvedValue(ada);
    }

    it("locks, ignores activity, and unlocks only with the same person's PIN", async () => {
      signedInAndLocked();
      const lockedAt = useAuthStore.getState().lockedAt;
      expect(lockedAt).not.toBeNull();

      const before = useAuthStore.getState().lastActivityAt;
      useAuthStore.getState().updateActivity();
      expect(useAuthStore.getState().lastActivityAt).toBe(before);

      vi.mocked(verifyPin).mockResolvedValue(false);
      expect(await useAuthStore.getState().unlockSession("111111")).toBe(false);
      expect(useAuthStore.getState()).toMatchObject({ lockedAt, failedAttempts: 1 });
      expect(mockDbUsers.get).toHaveBeenCalledWith("u-ada");

      vi.mocked(verifyPin).mockResolvedValue(true);
      expect(await useAuthStore.getState().unlockSession("482913")).toBe(true);
      expect(verifyPin).toHaveBeenLastCalledWith("482913", "hash-ada", "salt-ada");
      expect(useAuthStore.getState()).toMatchObject({
        isAuthenticated: true,
        lockedAt: null,
        failedAttempts: 0,
      });
    });

    it("signs out after too many wrong PINs on the lock screen", async () => {
      signedInAndLocked({ failedAttempts: 4 });
      vi.mocked(verifyPin).mockResolvedValue(false);

      expect(await useAuthStore.getState().unlockSession("111111")).toBe(false);

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().lockoutUntil).not.toBeNull();
    });

    it("signs out when the account was switched off while locked", async () => {
      signedInAndLocked();
      mockDbUsers.get.mockResolvedValue({ ...ada, isActive: 0 });
      vi.mocked(verifyPin).mockResolvedValue(true);

      expect(await useAuthStore.getState().unlockSession("482913")).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it("refuses an unlock while the device is locked out, without checking the PIN", async () => {
      signedInAndLocked({ lockoutUntil: Date.now() + 60_000 });
      vi.mocked(verifyPin).mockResolvedValue(true);

      expect(await useAuthStore.getState().unlockSession("482913")).toBe(false);
      expect(verifyPin).not.toHaveBeenCalled();
      expect(useAuthStore.getState().lockedAt).not.toBeNull();
    });

    it("the PIN sign-in is refused during a lockout without checking the PIN", async () => {
      useAuthStore.setState({ lockoutUntil: Date.now() + 60_000 });
      mockDbUsers.get.mockResolvedValue(ada);
      vi.mocked(verifyPin).mockResolvedValue(true);

      expect(await useAuthStore.getState().login("u-ada", "482913")).toBe(false);
      expect(verifyPin).not.toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe("a session restored when the app starts", () => {
    function storeSession(state: Record<string, unknown>) {
      localStorage.setItem(
        "mbhr-auth",
        JSON.stringify({
          state: {
            failedAttempts: 0,
            lockoutUntil: null,
            currentSession: { id: "s1", userId: "u-ada" },
            isAuthenticated: true,
            authMode: "online",
            cloudUserId: "u-ada",
            sessionExpiresAt: Date.now() + 60 * 60 * 1000,
            ...state,
          },
          version: 0,
        }),
      );
    }
    const withPin = {
      id: "u-ada",
      fullName: "Ada Okafor",
      role: "doctor",
      pinHash: PIN_ON_DEVICE,
      pinSalt: PIN_ON_DEVICE,
      isActive: 1,
    };

    it("is never an online sign-in whose device PIN was not chosen yet", async () => {
      storeSession({
        currentUser: { ...withPin, pinHash: "", pinSalt: "" },
        lastActivityAt: Date.now(),
      });

      await useAuthStore.persist.rehydrate();

      expect(useAuthStore.getState()).toMatchObject({
        isAuthenticated: false,
        currentUser: null,
        authMode: null,
        cloudUserId: null,
      });
    });

    it("opens locked when it was left idle, so a reload does not reset the clock", async () => {
      storeSession({ currentUser: withPin, lastActivityAt: Date.now() - 20 * 60 * 1000 });

      await useAuthStore.persist.rehydrate();

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().lockedAt).not.toBeNull();
    });

    it("opens unlocked when it was in use a moment ago", async () => {
      storeSession({ currentUser: withPin, lastActivityAt: Date.now() - 60 * 1000, lockedAt: null });

      await useAuthStore.persist.rehydrate();

      expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, lockedAt: null });
    });
  });

  describe("revalidateOnlineSession", () => {
    const online = {
      id: AUTH_USER.id,
      fullName: "Ngozi Obi",
      role: "nurse",
      pinHash: PIN_ON_DEVICE,
      pinSalt: PIN_ON_DEVICE,
      isActive: 1,
    };

    function signedInOnline(authMode: "online" | "offline" = "online") {
      useAuthStore.setState({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentUser: online as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentSession: { id: "s1", userId: online.id } as any,
        isAuthenticated: true,
        authMode,
        cloudUserId: authMode === "online" ? AUTH_USER.id : null,
      });
    }

    it("ends the session and switches the record off when the server staff record is gone", async () => {
      signedInOnline();
      appUsersLookup({ data: null, error: null });

      expect(await revalidateOnlineSession()).toBe(true);

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(mockDbUsers.update).toHaveBeenCalledWith(
        AUTH_USER.id,
        expect.objectContaining({ isActive: 0 }),
      );
    });

    it("ends the session when the server has switched the account off", async () => {
      signedInOnline();
      appUsersLookup({ data: { id: AUTH_USER.id, role: "nurse", is_active: false }, error: null });

      expect(await revalidateOnlineSession()).toBe(true);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it("keeps the session for active staff, and when the server cannot be asked", async () => {
      signedInOnline();
      appUsersLookup({ data: { id: AUTH_USER.id, role: "nurse" }, error: null });
      expect(await revalidateOnlineSession()).toBe(false);

      appUsersLookup({ data: null, error: { code: "PGRST000" } });
      expect(await revalidateOnlineSession()).toBe(false);

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(mockDbUsers.update).not.toHaveBeenCalled();
    });

    it("asks nothing for a PIN session", async () => {
      signedInOnline("offline");

      expect(await revalidateOnlineSession()).toBe(false);
      expect(mockFrom).not.toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });
  });
});
