import type { SupabaseClient } from "@supabase/supabase-js";
import { clearApiCaches } from "@/services/clearApiCaches";
import {
  clearPortalSession,
  clearStoredSupabaseAuth,
} from "../portalSession";
import { clearMessageQueue } from "../messageQueue";

const SIGN_OUT_EVERYWHERE_TIMEOUT_MS = 10000;

type AuthClient = Pick<SupabaseClient, "auth">;

function clearThisDevice(): void {
  clearPortalSession();
  clearMessageQueue();
  clearStoredSupabaseAuth();
  void clearApiCaches();
}

/**
 * Ends every sign-in to this account, on every phone and computer, then
 * clears this device. Returns false, and leaves this device signed in, when
 * the server did not confirm in time: the page must then say the logout is
 * not confirmed rather than look finished. A request that times out keeps
 * running, so if the server confirms it later this device is cleared then.
 */
export async function signOutEverywhere(
  client: AuthClient,
  timeoutMs = SIGN_OUT_EVERYWHERE_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let request: ReturnType<AuthClient["auth"]["signOut"]>;
  try {
    request = client.auth.signOut({ scope: "global" });
  } catch {
    return false;
  }
  // If the answer comes after the timeout, finish the job here.
  void Promise.resolve(request)
    .then((late) => {
      if (timedOut && !late?.error) clearThisDevice();
    })
    .catch(() => {});
  try {
    const result = await Promise.race([
      request,
      new Promise<{ error: Error }>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve({ error: new Error("timeout") });
        }, timeoutMs);
      }),
    ]);
    if (result?.error) return false;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
  clearThisDevice();
  return true;
}
