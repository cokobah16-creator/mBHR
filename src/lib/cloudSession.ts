/**
 * Tracks whether this device holds an online (Supabase) sign-in, so sync
 * entry points can refuse to start without one.
 *
 * Logging out ends the online sign-in. Unlocking with a PIN afterwards opens
 * the local workspace only: it must not recreate the online sign-in or start
 * a sync. Staff sign in online (email and password) to sync again.
 *
 * A stored online sign-in on its own is not enough: it counts only when it
 * belongs to the staff member signed in here, and that session was opened
 * online. Another account's sign-in in this browser (the patient portal
 * shares the same storage, or a previous person's that outlived their
 * session) never lets this session sync.
 */
import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useSyncStore, type CloudSessionState } from "@/stores/syncStore";
import { useAuthStore } from "@/stores/auth";

/** Status label shown wherever sync is blocked for lack of an online sign-in. */
export const NO_CLOUD_SESSION_LABEL = "Offline — sign in online to sync";

/** Plain explanation that goes with the label. */
export const NO_CLOUD_SESSION_DETAIL =
  "You are not signed in online, so this device is working offline and Sync now is off. Records you save are kept on this device. To sync, sign in online with your email and password.";

/** Where staff sign in online: the sign-in screen's Online option. */
export const ONLINE_SIGN_IN_PATH = "/login";

/** Link hint for the online sign-in screen. */
export const ONLINE_SIGN_IN_HINT =
  "On the sign-in screen, choose Online and use your email and password.";

/**
 * True when an online account id is the signed-in staff member's own, from
 * an online sign-in in this session (never a PIN session).
 */
export function isSignedInStaffAccount(cloudUserId: string | null | undefined): boolean {
  if (!cloudUserId) return false;
  const { isAuthenticated, currentUser, authMode, cloudUserId: sessionCloudId } =
    useAuthStore.getState();
  return (
    isAuthenticated &&
    !!currentUser &&
    authMode === "online" &&
    sessionCloudId === cloudUserId
  );
}

function publish(state: CloudSessionState): void {
  useSyncStore.getState().setCloudSession(state);
}

/**
 * Reads the stored online sign-in (no network call) and records the result.
 * Resolves false when cloud sync is not set up, there is no sign-in, the
 * sign-in could not be read, or it is not the signed-in staff member's own
 * online sign-in.
 */
export async function checkCloudSession(): Promise<boolean> {
  if (!supabase) {
    publish("signed_out");
    return false;
  }
  try {
    const { data } = await supabase.auth.getSession();
    const signedIn = isSignedInStaffAccount(data.session?.user?.id);
    publish(signedIn ? "signed_in" : "signed_out");
    return signedIn;
  } catch (error) {
    console.warn(
      "[sync] could not read the online sign-in:",
      error instanceof Error ? error.name : "unknown",
    );
    publish("signed_out");
    return false;
  }
}

let watching = false;

/**
 * Starts following online sign-in changes (sign-in, sign-out, expiry).
 * Safe to call many times; only the first call subscribes.
 */
export function watchCloudSession(): void {
  if (watching) return;
  watching = true;
  void checkCloudSession();
  if (!supabase) return;
  // Keep this callback synchronous: it must not call back into the auth
  // client.
  supabase.auth.onAuthStateChange((_event, session) => {
    publish(isSignedInStaffAccount(session?.user?.id) ? "signed_in" : "signed_out");
  });
}

/** The current online sign-in state; starts watching on first use. */
export function useCloudSession(): CloudSessionState {
  useEffect(() => {
    watchCloudSession();
  }, []);
  return useSyncStore((s) => s.cloudSession);
}
