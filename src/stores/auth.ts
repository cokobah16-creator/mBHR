import { create } from "zustand";
import { persist } from "zustand/middleware";
import { db, User, Session, generateId, type AuditLog, type AuthMode } from "@/db";
import { getDeviceId, knownDeviceId } from "@/db/deviceIdentity";
import { verifyPin } from "@/utils/pin";
import * as logger from "@/lib/logger";
import { supabase } from "@/lib/supabase";
import { rolePermissionMatrix, type Role } from "@/auth/roles";
import {
  clearStoredSupabaseAuth,
  isSupabaseAuthKey,
} from "@/lib/supabaseAuthStorage";
import { useSyncStore } from "@/stores/syncStore";

/**
 * Why the last online sign-in was refused although the email and password
 * were right. null when it was not refused for one of these reasons.
 */
export type SignInRefusal =
  /** An administrator deactivated the account on this device; only an
   * administrator can resolve it (Users), never a sign-in. */
  | "deactivated_on_device"
  /** The server has switched the account off. */
  | "deactivated";

interface AuthState {
  /**
   * The signed-in staff member. Their PIN hash and salt are never kept here
   * (this state is saved in localStorage): see sessionUser().
   */
  currentUser: User | null;
  currentSession: Session | null;
  isAuthenticated: boolean;
  /**
   * How this session was opened. Only "online" allows sync, and only while
   * the device's online sign-in is cloudUserId (src/lib/cloudSession.ts).
   * null when signed out, and for sessions saved before this was recorded
   * (they count as offline until the person signs in online again).
   */
  authMode: AuthMode | null;
  /** The online (Supabase) account this session signed in with. */
  cloudUserId: string | null;
  /** Set when the last online sign-in was refused (not saved). */
  signInRefusal: SignInRefusal | null;
  failedAttempts: number;
  lockoutUntil: number | null;
  sessionExpiresAt: number | null;
  lastActivityAt: number | null;

  // Actions
  /** Offline sign-in: the chosen account's PIN on this device. */
  login: (userId: string, pin: string) => Promise<boolean>;
  loginOnline: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setCurrentUser: (user: User | null) => void;
  incrementFailedAttempts: () => void;
  resetFailedAttempts: () => void;
  checkLockout: () => boolean;
  updateActivity: () => void;
  checkSessionExpiry: () => boolean;
}

/**
 * Stands in for a PIN hash and salt in the signed-in user kept in app state.
 * It only says "this person has a PIN on this device" (hasDevicePin); the
 * real values stay in the device database, which is the only place a PIN
 * is ever checked (login below reads the record fresh).
 */
export const PIN_ON_DEVICE = "on-device";

/**
 * The signed-in user as app state keeps it: the device record without its
 * PIN hash and salt, so they are never copied into localStorage.
 */
export function sessionUser(user: User): User {
  return {
    ...user,
    pinHash: user.pinHash ? PIN_ON_DEVICE : "",
    pinSalt: user.pinSalt ? PIN_ON_DEVICE : "",
  };
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

/**
 * A PIN opens this device's records only: it must never carry on an online
 * sign-in, so sync stays off until the person signs in online. Waits for the
 * last logout's online sign-out if it is still running, then ends any online
 * sign-in still stored here: one kept when a local session expired while the
 * app was closed, one whose logout could not finish (app closed straight
 * after), or another account's (the patient portal shares it). Each sign-out
 * takes at most CLOUD_SIGN_OUT_TIMEOUT_MS; usually there is nothing to end.
 * Never throws.
 */
async function endLeftoverCloudSignIn(): Promise<void> {
  if (cloudSignOutInFlight) await cloudSignOutInFlight;
  if (readStoredCloudSignIn()) {
    startCloudSignOut();
    await cloudSignOutInFlight;
  }
  // Removing a sign-in from storage directly (offline) sends no sign-out
  // event, so record it here: the sync status then says to sign in online.
  if (!readStoredCloudSignIn()) {
    useSyncStore.getState().setCloudSession("signed_out");
  }
}

/** Values that mean "switched off" in an app_users flag column. */
const OFF = new Set(["false", "0", "f", "no"]);
const ON = new Set(["true", "1", "t", "yes"]);
const flag = (value: unknown) =>
  value === null || value === undefined ? null : String(value).toLowerCase();

/** True when an app_users row marks the account as switched off. */
export function isDeactivatedAppUser(row: Record<string, unknown>): boolean {
  return (
    OFF.has(flag(row.is_active) ?? "") ||
    OFF.has(flag(row.active) ?? "") ||
    ON.has(flag(row.disabled) ?? "") ||
    ON.has(flag(row.deactivated) ?? "") ||
    (row.deactivated_at !== null && row.deactivated_at !== undefined) ||
    (row.disabled_at !== null && row.disabled_at !== undefined)
  );
}

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
  const deactivated = isDeactivatedAppUser(row);
  const knownRoles = Object.keys(rolePermissionMatrix().roles);
  const role = typeof row.role === "string" && knownRoles.includes(row.role) ? (row.role as Role) : "guest";
  return { role: deactivated ? "guest" : role, fullName };
}

type ServerStaffAccount =
  | { status: "found"; role: Role; fullName?: string; deactivated: boolean }
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
    const row = data as Record<string, unknown>;
    return { status: "found", ...accessFromAppUser(row), deactivated: isDeactivatedAppUser(row) };
  } catch (error) {
    logger.error(
      "[Auth] Could not read the staff record:",
      error instanceof Error ? error.name : typeof error,
    );
    return { status: "error" };
  }
}

/**
 * Records a sign-in event in this device's audit log. Never records a PIN or
 * password. Best effort: never throws.
 */
async function auditSignIn(
  action: string,
  userId: string,
  actorRole: string,
): Promise<void> {
  try {
    await db.auditLogs.add({
      id: generateId(),
      actorRole,
      action,
      entity: "user",
      entityId: userId,
      at: new Date(),
    });
  } catch {
    // Audit storage unavailable: the sign-in itself is unaffected.
  }
}

/** This device's id for a new session; never throws. */
async function deviceIdForSession(): Promise<string | undefined> {
  try {
    return await getDeviceId();
  } catch {
    return undefined;
  }
}

/**
 * Records that the server has just confirmed this person (an online
 * sign-in): shown as "Last verified online" when they later sign in offline.
 * Device-local fields, never uploaded. Best effort: never throws.
 */
async function markVerifiedOnline(user: User, roleFromServer: boolean): Promise<User> {
  const now = new Date();
  const fields: Partial<User> = { lastOnlineVerifiedAt: now };
  if (roleFromServer) fields.permissionsCachedAt = now;
  try {
    await db.users.update(user.id, fields);
  } catch (error) {
    logger.warn(
      "[Auth] Could not record the online verification:",
      error instanceof Error ? error.name : typeof error,
    );
  }
  return { ...user, ...fields };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      currentSession: null,
      isAuthenticated: false,
      authMode: null,
      cloudUserId: null,
      signInRefusal: null,
      failedAttempts: 0,
      lockoutUntil: null,
      sessionExpiresAt: null,
      lastActivityAt: null,

      login: async (userId: string, pin: string) => {
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
          // Only the chosen person's PIN is checked, so two people who
          // happen to pick the same PIN are never mistaken for each other.
          const user = await db.users.get(userId);

          if (
            user &&
            user.isActive === 1 &&
            user.pinHash &&
            user.pinSalt &&
            (await verifyPin(pin, user.pinHash, user.pinSalt))
          ) {
            // Offline sign-in never gives a cloud session: end any online
            // sign-in left on this device before opening the workspace.
            await endLeftoverCloudSignIn();

            const session: Session = {
              id: generateId(),
              userId: user.id,
              createdAt: new Date(),
              deviceKey: generateId(),
              lastSeenAt: new Date(),
              authMode: "offline",
              deviceId: await deviceIdForSession(),
            };

            await db.sessions.add(session);

            const now = Date.now();
            const expiresAt = now + STAFF_SESSION_DURATION;

            set({
              currentUser: sessionUser(user),
              currentSession: session,
              isAuthenticated: true,
              authMode: "offline",
              cloudUserId: null,
              signInRefusal: null,
              failedAttempts: 0,
              lockoutUntil: null,
              sessionExpiresAt: expiresAt,
              lastActivityAt: now,
            });

            await auditSignIn("sign_in_offline", user.id, user.role);
            return true;
          }

          state.incrementFailedAttempts();
          // Each failed attempt, and a lockout, is recorded against the
          // account that was chosen. The PIN typed is never recorded.
          await auditSignIn("offline_pin_failed", userId, user?.role ?? "unknown");
          if (get().lockoutUntil) {
            await auditSignIn("offline_pin_lockout", userId, user?.role ?? "unknown");
          }
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

        set({ signInRefusal: null });
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

          const cloudUserId = data.user.id;

          // This device's record for the person: the one with the online
          // account's id (synced from the server directory or created by an
          // earlier online sign-in), else an active one with the same email.
          const normalizedEmail = email.toLowerCase();
          let user =
            (await db.users.get(cloudUserId)) ??
            (await db.users
              .filter(
                (u) =>
                  u.isActive === 1 && u.email?.toLowerCase() === normalizedEmail,
              )
              .first());

          const refuse = async (reason: SignInRefusal): Promise<false> => {
            // The password was right, but this account may not work here:
            // end the online sign-in it just created.
            startCloudSignOut();
            await cloudSignOutInFlight;
            set({ signInRefusal: reason });
            await auditSignIn(
              reason === "deactivated" ? "sign_in_refused_deactivated" : "sign_in_refused_deactivated_on_device",
              user?.id ?? cloudUserId,
              user?.role ?? "unknown",
            );
            return false;
          };

          // Switched off on this device by an administrator: an online
          // sign-in does not switch it back on. Only an administrator can,
          // under Users (an offline disable beats an online re-enable).
          if (user && user.isActive !== 1 && (user.disabledLocallyAt || user.accessConflict === 1)) {
            return await refuse("deactivated_on_device");
          }

          // The server's staff record decides who the person is, whether
          // they are active and what they may do.
          const account = await readServerStaffAccount(cloudUserId);

          // Switched off on the server: no session, and no offline sign-in
          // on this device either (offlineSignInState lists active staff only).
          if (account.status === "found" && account.deactivated) {
            if (user) {
              try {
                await db.users.update(user.id, { isActive: 0, updatedAt: new Date() });
              } catch {
                // The roster pull switches it off at the next sync too.
              }
            }
            return await refuse("deactivated");
          }

          // Switched off here by a staff directory download (the server
          // stopped listing them) and the server cannot confirm them now:
          // stay off. A server record that lists them as active switches
          // them back on below.
          if (user && user.isActive !== 1 && account.status !== "found") {
            return await refuse("deactivated");
          }

          // A new device (no local record) builds one from the server's
          // staff record. A record created that way earlier (same id as
          // the online account) follows later role changes. Without a server
          // record the account gets no access, never a default role.
          // (User["role"] lists the roles created on devices; auditor and
          // lead_clinician accounts come from the server.)
          if (!user) {
            const access =
              account.status === "found" ? account : { role: "guest" as Role };
            const newUser: User = {
              id: cloudUserId,
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
          } else if (user.id === cloudUserId && account.status !== "error") {
            // A failed lookup keeps the stored role; a missing server
            // record removes access.
            const role = (account.status === "found" ? account.role : "guest") as User["role"];
            const fullName =
              (account.status === "found" ? account.fullName : undefined) ?? user.fullName;
            if (role !== user.role || fullName !== user.fullName || user.isActive !== 1) {
              const refreshed: User = {
                ...user,
                role,
                fullName,
                adminAccess: role === "admin",
                // The server lists them as active (checked above), and this
                // device did not switch them off: a record the roster pull
                // switched off comes back on.
                isActive: account.status === "found" ? 1 : user.isActive,
                updatedAt: new Date(),
              };
              await db.users.put(refreshed);
              user = refreshed;
            }
          }

          user = await markVerifiedOnline(
            user,
            account.status === "found" && user.id === cloudUserId,
          );

          const session: Session = {
            id: generateId(),
            userId: user.id,
            createdAt: new Date(),
            deviceKey: generateId(),
            lastSeenAt: new Date(),
            authMode: "online",
            deviceId: await deviceIdForSession(),
          };
          await db.sessions.add(session);

          const now = Date.now();
          set({
            currentUser: sessionUser(user),
            currentSession: session,
            isAuthenticated: true,
            authMode: "online",
            cloudUserId,
            signInRefusal: null,
            failedAttempts: 0,
            lockoutUntil: null,
            sessionExpiresAt: now + STAFF_SESSION_DURATION,
            lastActivityAt: now,
          });
          // The sign-in event fired before this session existed, so it was
          // not yet counted as this staff member's: it is now.
          useSyncStore.getState().setCloudSession("signed_in");

          await auditSignIn("sign_in_online", user.id, user.role);
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
          authMode: null,
          cloudUserId: null,
          sessionExpiresAt: null,
          lastActivityAt: null,
        });

        // Also end the online sign-in, in the background: the local logout
        // above is already complete and never waits for the network.
        startCloudSignOut();
      },

      setCurrentUser: (user: User | null) => {
        set({ currentUser: user ? sessionUser(user) : null });
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
        authMode: state.authMode,
        cloudUserId: state.cloudUserId,
        sessionExpiresAt: state.sessionExpiresAt,
        lastActivityAt: state.lastActivityAt,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Saved before PIN material was kept out of app state: drop it.
        if (state.currentUser) state.currentUser = sessionUser(state.currentUser);
        // Saved before the session type was recorded: offline until the
        // person signs in online again.
        state.authMode = state.authMode ?? null;
        state.cloudUserId = state.cloudUserId ?? null;

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
            state.authMode = null;
            state.cloudUserId = null;
            state.sessionExpiresAt = null;
            state.lastActivityAt = null;
            // Its online sign-in ends too, as a logout would: the next
            // person on this device must not sync under it.
            startCloudSignOut();
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

/**
 * Ends the current session when the server or an administrator has
 * switched the signed-in person off on this device (for example after a
 * staff directory download), and picks up a role change from the server.
 * Returns true when the session was ended. Never throws.
 */
export async function endSessionIfRevoked(): Promise<boolean> {
  const { isAuthenticated, currentUser } = useAuthStore.getState();
  if (!isAuthenticated || !currentUser) return false;
  let record: User | undefined;
  try {
    record = await db.users.get(currentUser.id);
  } catch {
    return false;
  }
  if (record && record.isActive === 1) {
    if (record.role !== currentUser.role || record.fullName !== currentUser.fullName) {
      useAuthStore.getState().setCurrentUser(record);
    }
    return false;
  }
  logger.info("[Auth] Signed-in account was switched off; ending the session");
  await auditSignIn("session_ended_deactivated", currentUser.id, currentUser.role);
  await useAuthStore.getState().logout();
  return true;
}

/**
 * Every audit row records who did it, on which device and how they were
 * signed in, unless the writer set those itself. Installed on the audit
 * table once; test doubles of the database without hooks are skipped.
 */
function stampAuditRow(row: AuditLog): void {
  const { isAuthenticated, currentUser, authMode } = useAuthStore.getState();
  const signedIn = isAuthenticated && currentUser ? currentUser : null;
  if (row.userId === undefined) row.userId = signedIn ? signedIn.id : null;
  if (row.sessionType === undefined) {
    row.sessionType = signedIn ? (authMode ?? "offline") : "none";
  }
  if (row.deviceId === undefined) row.deviceId = knownDeviceId();
}

try {
  const auditTable = (db as unknown as { auditLogs?: { hook?: unknown } } | undefined)?.auditLogs;
  if (auditTable && typeof auditTable.hook === "function") {
    (auditTable.hook as (event: "creating", fn: (key: unknown, row: AuditLog) => void) => void)(
      "creating",
      (_key, row) => stampAuditRow(row),
    );
  }
} catch {
  // A database double without hooks (tests): rows are written unstamped.
}
