import { create } from "zustand";
import { persist } from "zustand/middleware";
import { db, User, Session, generateId } from "@/db";
import { verifyPin } from "@/utils/pin";
import * as logger from "@/lib/logger";
import { supabase } from "@/lib/supabase";
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

const STAFF_ROLES: ReadonlyArray<User["role"]> = [
  "admin",
  "doctor",
  "nurse",
  "pharmacist",
  "volunteer",
  "guest",
];

function asStaffRole(value: unknown): User["role"] | undefined {
  return STAFF_ROLES.find((role) => role === value);
}

interface StaffProfile {
  fullName?: string;
  role?: User["role"];
  adminAccess?: boolean;
  adminPermanent?: boolean;
}

/**
 * What the server knows about a staff member, for a device that has no local
 * record of them yet. `app_users` is the staff directory (its id is the
 * Supabase auth user id and every staff member can read it); `staff_roles`
 * only holds the role and is kept as a fallback for accounts that predate
 * the directory. Best effort: a failed read just leaves the field unset.
 */
async function readStaffProfile(
  client: NonNullable<typeof supabase>,
  authUserId: string,
): Promise<StaffProfile> {
  const profile: StaffProfile = {};

  try {
    const { data } = await client
      .from("app_users")
      .select("full_name, role, admin_access, admin_permanent")
      .eq("id", authUserId)
      .maybeSingle();
    if (data) {
      if (typeof data.full_name === "string" && data.full_name.trim()) {
        profile.fullName = data.full_name.trim();
      }
      profile.role = asStaffRole(data.role);
      if (typeof data.admin_access === "boolean") {
        profile.adminAccess = data.admin_access;
      }
      if (typeof data.admin_permanent === "boolean") {
        profile.adminPermanent = data.admin_permanent;
      }
    }
  } catch (error) {
    logger.warn(
      "[Auth] Could not read the staff directory:",
      error instanceof Error ? error.name : typeof error,
    );
  }

  if (!profile.role) {
    try {
      const { data } = await client
        .from("staff_roles")
        .select("role")
        .eq("auth_user_id", authUserId)
        .maybeSingle();
      profile.role = asStaffRole(data?.role);
    } catch (error) {
      logger.warn(
        "[Auth] Could not read the staff role:",
        error instanceof Error ? error.name : typeof error,
      );
    }
  }

  return profile;
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

          // Not on this device yet (a new device, or a colleague's tablet):
          // create the local record from the staff directory so the person
          // can work here. They have no PIN on this device until they choose
          // one (the login page offers that right after this sign-in).
          if (!user) {
            const profile = await readStaffProfile(supabase, data.user.id);
            const role = profile.role ?? "volunteer";

            const newUser: User = {
              id: data.user.id,
              fullName:
                profile.fullName ??
                data.user.user_metadata?.full_name ??
                email.split("@")[0],
              role,
              email: data.user.email ?? email,
              pinHash: "",
              pinSalt: "",
              adminAccess: profile.adminAccess ?? role === "admin",
              adminPermanent: profile.adminPermanent ?? false,
              isActive: 1,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            await db.users.put(newUser);
            user = newUser;
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
