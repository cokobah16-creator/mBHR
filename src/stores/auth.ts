import { create } from "zustand";
import { persist } from "zustand/middleware";
import { db, User, Session, generateId } from "@/db";
import { verifyPin } from "@/utils/pin";
import * as logger from "@/lib/logger";
import { supabase } from "@/lib/supabase";
import { rolePermissionMatrix, type Role } from "@/auth/roles";
import {
  clearStoredSupabaseAuth,
  isSupabaseAuthKey,
} from "@/lib/supabaseAuthStorage";

interface AuthState {
  currentUser: User | null;
  currentSession: Session | null;
  isAuthenticated: boolean;
  failedAttempts: number;
  lockoutUntil: number | null;
  sessionExpiresAt: number | null;
  lastActivityAt: number | null;

  // Actions
  login: (pin: string) => Promise<boolean>;
  loginOnline: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setCurrentUser: (user: User | null) => void;
  incrementFailedAttempts: () => void;
  resetFailedAttempts: () => void;
  checkLockout: () => boolean;
  updateActivity: () => void;
  checkSessionExpiry: () => boolean;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const STAFF_SESSION_DURATION = 12 * 60 * 60 * 1000; // 12 hours
/** How long logout waits for the online sign-out before clearing it locally. */
const CLOUD_SIGN_OUT_TIMEOUT_MS = 5000;

/**
 * The online (Supabase) sign-in stored in this browser, with its auth user id
 * ("" when it cannot be read), or null when there is certainly none. Every
 * Supabase client in the app, staff and patient portal alike, keeps its
 * sign-in under the same "sb-<project>-auth-token" key, so there is at most
 * one.
 */
function readStoredCloudSignIn(): { userId: string } | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isSupabaseAuthKey(key) || key.endsWith("-code-verifier")) {
        continue;
      }
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      let userId = "";
      try {
        const parsed: unknown = JSON.parse(raw);
        const user =
          parsed && typeof parsed === "object"
            ? (parsed as { user?: { id?: unknown } }).user
            : undefined;
        if (typeof user?.id === "string") userId = user.id;
      } catch {
        // Unreadable, but still a stored sign-in.
      }
      return { userId };
    }
  } catch {
    // Storage blocked: supabase-js may hold the sign-in elsewhere, so treat
    // it as present and let signOut() decide.
    return { userId: "" };
  }
  return null;
}

/**
 * End this device's online sign-in when a staff member logs out, so the next
 * person on a shared tablet cannot sync or write to the cloud under the
 * previous person's account. Best effort: never throws, and the local logout
 * never waits for it.
 *
 * scope "local" ends only this device's sign-in; the staff member stays
 * signed in on their other devices. Offline, signOut() cannot reach the
 * server and keeps the stored sign-in, so it is then removed from this device
 * directly (as the patient portal's own sign-out does), unless someone else
 * has signed in since.
 */
async function endCloudSignIn(): Promise<void> {
  const client = supabase;
  if (!client) return;
  const before = readStoredCloudSignIn();
  if (!before) return;

  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), CLOUD_SIGN_OUT_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([
      client.auth.signOut({ scope: "local" }),
      timedOut,
    ]);
    if (result === "timeout") {
      logger.warn("[Auth] Online sign-out timed out");
    } else if (result.error) {
      logger.warn("[Auth] Online sign-out failed:", result.error.name);
    } else {
      ended = true;
    }
  } catch (error) {
    logger.warn(
      "[Auth] Online sign-out failed:",
      error instanceof Error ? error.name : typeof error,
    );
  } finally {
    clearTimeout(timer);
  }
  if (ended) return;

  const now = readStoredCloudSignIn();
  if (now && now.userId === before.userId) {
    clearStoredSupabaseAuth();
    logger.info("[Auth] Removed the online sign-in from this device");
  }
}

/** The online sign-out started by the last logout, while it is still running. */
let cloudSignOutInFlight: Promise<void> | null = null;

/**
 * Start ending the online sign-in in the background. The tracked promise
 * never rejects (an unhandled rejection would surface as an app error), and
 * loginOnline waits for it so a new online sign-in is not removed by the
 * previous person's sign-out finishing late.
 */
function startCloudSignOut(): void {
  const run: Promise<void> = endCloudSignIn()
    .catch(() => undefined)
    .finally(() => {
      if (cloudSignOutInFlight === run) cloudSignOutInFlight = null;
    });
  cloudSignOutInFlight = run;
}

/** Values that mean "switched off" in an app_users flag column. */
const OFF = new Set(["false", "0", "f", "no"]);
const ON = new Set(["true", "1", "t", "yes"]);
const flag = (value: unknown) =>
  value === null || value === undefined ? null : String(value).toLowerCase();

/**
 * The access an app_users row (public.app_users, id = online user id) gives,
 * following the database's own rule (public.app_current_role): an unknown
 * role, a missing row or a deactivated account gives no access ("guest"),
 * never a default clinical role.
 */
export function accessFromAppUser(row: Record<string, unknown> | null | undefined): {
  role: Role;
  fullName?: string;
} {
  if (!row) return { role: "guest" };
  const fullName =
    typeof row.full_name === "string" && row.full_name.trim() ? row.full_name.trim() : undefined;
  const deactivated =
    OFF.has(flag(row.is_active) ?? "") ||
    OFF.has(flag(row.active) ?? "") ||
    ON.has(flag(row.disabled) ?? "") ||
    ON.has(flag(row.deactivated) ?? "") ||
    (row.deactivated_at !== null && row.deactivated_at !== undefined) ||
    (row.disabled_at !== null && row.disabled_at !== undefined);
  const knownRoles = Object.keys(rolePermissionMatrix().roles);
  const role = typeof row.role === "string" && knownRoles.includes(row.role) ? (row.role as Role) : "guest";
  return { role: deactivated ? "guest" : role, fullName };
}

type ServerStaffAccount =
  | { status: "found"; role: Role; fullName?: string }
  | { status: "missing" }
  | { status: "error" };

/**
 * The signed-in person's staff record on the server (their own app_users
 * row, which the database uses for every access decision). Never throws.
 */
async function readServerStaffAccount(authUserId: string): Promise<ServerStaffAccount> {
  if (!supabase) return { status: "error" };
  try {
    const { data, error } = await supabase
      .from("app_users")
      .select("*")
      .eq("id", authUserId)
      .maybeSingle();
    if (error) {
      logger.error("[Auth] Could not read the staff record:", error.code ?? "unknown");
      return { status: "error" };
    }
    if (!data) return { status: "missing" };
    return { status: "found", ...accessFromAppUser(data as Record<string, unknown>) };
  } catch (error) {
    logger.error(
      "[Auth] Could not read the staff record:",
      error instanceof Error ? error.name : typeof error,
    );
    return { status: "error" };
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      currentSession: null,
      isAuthenticated: false,
      failedAttempts: 0,
      lockoutUntil: null,
      sessionExpiresAt: null,
      lastActivityAt: null,

      login: async (pin: string) => {
        const state = get();

        // Check lockout
        if (state.checkLockout()) {
          return false;
        }

        if (!/^\d{6}$/.test(pin)) {
          state.incrementFailedAttempts();
          return false;
        }

        try {
          // Get all active users
          const users = await db.users
            .filter((u) => u.isActive === 1)
            .toArray();

          for (const user of users) {
            if (user.pinHash && user.pinSalt) {
              const isValid = await verifyPin(pin, user.pinHash, user.pinSalt);

              if (isValid) {
                // Create session
                const session: Session = {
                  id: generateId(),
                  userId: user.id,
                  createdAt: new Date(),
                  deviceKey: generateId(),
                  lastSeenAt: new Date(),
                };

                await db.sessions.add(session);

                const now = Date.now();
                const expiresAt = now + STAFF_SESSION_DURATION;

                set({
                  currentUser: user,
                  currentSession: session,
                  isAuthenticated: true,
                  failedAttempts: 0,
                  lockoutUntil: null,
                  sessionExpiresAt: expiresAt,
                  lastActivityAt: now,
                });

                return true;
              }
            }
          }

          // PIN not found - increment failed attempts
          state.incrementFailedAttempts();
          return false;
        } catch (error) {
          logger.error(
            "Login error:",
            error instanceof Error ? error.name : typeof error,
          );
          state.incrementFailedAttempts();
          return false;
        }
      },

      loginOnline: async (email: string, password: string) => {
        const state = get();

        if (state.checkLockout()) return false;
        if (!supabase) {
          logger.error("Supabase not configured");
          return false;
        }

        try {
          // Let the previous person's online sign-out finish first (at most
          // a few seconds), so it cannot remove this new sign-in.
          if (cloudSignOutInFlight) await cloudSignOutInFlight;

          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (error || !data.user) {
            logger.error("Online login error:", error?.name ?? "no user");
            state.incrementFailedAttempts();
            return false;
          }

          // Find the matching staff user record by email (case-insensitive)
          const normalizedEmail = email.toLowerCase();
          let user = await db.users
            .filter(
              (u) =>
                u.isActive === 1 && u.email?.toLowerCase() === normalizedEmail,
            )
            .first();

          // A new device (no local record) builds one from the server's
          // staff record, app_users, which the database uses for every
          // access decision. A record created that way earlier (same id as
          // the online account) follows later role changes. Without a server
          // record the account gets no access, never a default role.
          // (User["role"] lists the roles created on devices; auditor and
          // lead_clinician accounts come from the server.)
          if (!user || user.id === data.user.id) {
            const account = await readServerStaffAccount(data.user.id);
            if (!user) {
              const access =
                account.status === "found" ? account : { role: "guest" as Role };
              const newUser: User = {
                id: data.user.id,
                fullName:
                  (account.status === "found" ? account.fullName : undefined) ??
                  data.user.user_metadata?.full_name ??
                  email.split("@")[0],
                role: access.role as User["role"],
                email: data.user.email ?? email,
                pinHash: "",
                pinSalt: "",
                adminAccess: access.role === "admin",
                adminPermanent: false,
                isActive: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
              };
              await db.users.put(newUser);
              user = newUser;
            } else if (account.status !== "error") {
              // A failed lookup keeps the stored role; a missing or
              // deactivated server record removes access.
              const role = (account.status === "found" ? account.role : "guest") as User["role"];
              const fullName =
                (account.status === "found" ? account.fullName : undefined) ?? user.fullName;
              if (role !== user.role || fullName !== user.fullName) {
                const refreshed: User = {
                  ...user,
                  role,
                  fullName,
                  adminAccess: role === "admin",
                  updatedAt: new Date(),
                };
                await db.users.put(refreshed);
                user = refreshed;
              }
            }
          }

          const session: Session = {
            id: generateId(),
            userId: user.id,
            createdAt: new Date(),
            deviceKey: generateId(),
            lastSeenAt: new Date(),
          };
          await db.sessions.add(session);

          const now = Date.now();
          set({
            currentUser: user,
            currentSession: session,
            isAuthenticated: true,
            failedAttempts: 0,
            lockoutUntil: null,
            sessionExpiresAt: now + STAFF_SESSION_DURATION,
            lastActivityAt: now,
          });

          return true;
        } catch (error) {
          logger.error(
            "Online login error:",
            error instanceof Error ? error.name : typeof error,
          );
          state.incrementFailedAttempts();
          return false;
        }
      },

      logout: async () => {
        const state = get();

        if (state.currentSession) {
          try {
            await db.sessions.delete(state.currentSession.id);
          } catch (error) {
            // A leftover session row must not keep this person signed in.
            logger.error(
              "[Auth] Could not remove the session record:",
              error instanceof Error ? error.name : typeof error,
            );
          }
        }

        set({
          currentUser: null,
          currentSession: null,
          isAuthenticated: false,
          sessionExpiresAt: null,
          lastActivityAt: null,
        });

        // Also end the online sign-in, in the background: the local logout
        // above is already complete and never waits for the network.
        startCloudSignOut();
      },

      setCurrentUser: (user: User | null) => {
        set({ currentUser: user });
      },

      incrementFailedAttempts: () => {
        const state = get();
        const newAttempts = state.failedAttempts + 1;

        let lockoutUntil = null;
        if (newAttempts >= MAX_FAILED_ATTEMPTS) {
          lockoutUntil = Date.now() + LOCKOUT_DURATION;
        }

        set({
          failedAttempts: newAttempts,
          lockoutUntil,
        });
      },

      resetFailedAttempts: () => {
        set({
          failedAttempts: 0,
          lockoutUntil: null,
        });
      },

      checkLockout: () => {
        const state = get();
        if (state.lockoutUntil && Date.now() < state.lockoutUntil) {
          return true;
        }

        if (state.lockoutUntil && Date.now() >= state.lockoutUntil) {
          // Lockout expired, reset
          set({
            failedAttempts: 0,
            lockoutUntil: null,
          });
        }

        return false;
      },

      updateActivity: () => {
        const state = get();
        const now = Date.now();

        // Extend session if still valid
        if (state.sessionExpiresAt && now < state.sessionExpiresAt) {
          // Calculate time remaining
          const timeRemaining = state.sessionExpiresAt - now;

          // If less than 1 hour remaining, extend the session
          if (timeRemaining < 60 * 60 * 1000) {
            const newExpiresAt = now + STAFF_SESSION_DURATION;
            set({
              lastActivityAt: now,
              sessionExpiresAt: newExpiresAt,
            });
            logger.info("[Auth] Session extended due to activity");
          } else {
            set({ lastActivityAt: now });
          }
        } else {
          set({ lastActivityAt: now });
        }
      },

      checkSessionExpiry: () => {
        const state = get();
        if (!state.sessionExpiresAt || !state.isAuthenticated) {
          return false;
        }

        const now = Date.now();
        if (now >= state.sessionExpiresAt) {
          // Session expired
          logger.info("[Auth] Session expired");
          state.logout();
          return true;
        }

        return false;
      },
    }),
    {
      name: "mbhr-auth",
      partialize: (state) => ({
        failedAttempts: state.failedAttempts,
        lockoutUntil: state.lockoutUntil,
        currentUser: state.currentUser,
        currentSession: state.currentSession,
        isAuthenticated: state.isAuthenticated,
        sessionExpiresAt: state.sessionExpiresAt,
        lastActivityAt: state.lastActivityAt,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Check if session is expired on rehydration
        if (state.sessionExpiresAt && state.isAuthenticated) {
          const now = Date.now();
          const timeRemaining = state.sessionExpiresAt - now;

          // Only expire if truly expired (not just old timestamp)
          if (timeRemaining < -300000) {
            // 5 minutes grace period
            // Session expired - clear auth state
            logger.info(
              "[Auth] Session expired on rehydration (grace period exceeded)",
            );
            state.currentUser = null;
            state.currentSession = null;
            state.isAuthenticated = false;
            state.sessionExpiresAt = null;
            state.lastActivityAt = null;
          } else if (timeRemaining < 0) {
            // Slightly expired but within grace period - renew it
            logger.info("[Auth] Session within grace period, extending");
            state.sessionExpiresAt = now + STAFF_SESSION_DURATION;
            state.lastActivityAt = now;
          } else {
            // Session still valid - update last activity
            state.lastActivityAt = now;
            logger.info(
              "[Auth] Session restored successfully",
              `Time remaining: ${Math.floor(timeRemaining / 60000)} minutes`,
            );
          }
        }
      },
    },
  ),
);
