import type { SupabaseClient } from "@supabase/supabase-js";
import { clearApiCaches } from "@/services/clearApiCaches";
import {
  clearPortalSession,
  clearStoredSupabaseAuth,
} from "../portalSession";
import { clearMessageQueue } from "../messageQueue";

const SIGN_OUT_EVERYWHERE_TIMEOUT_MS = 10000;

type AuthClient = Pick<SupabaseClient, "auth">;

/**
 * Ends every sign-in to this account, on every phone and computer, then
 * clears this device. Returns false, and leaves this device signed in, when
 * the server did not confirm: the other devices are then still signed in,
 * and the page must say so rather than look finished.
 */
export async function signOutEverywhere(
  client: AuthClient,
  timeoutMs = SIGN_OUT_EVERYWHERE_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      client.auth.signOut({ scope: "global" }),
      new Promise<{ error: Error }>((resolve) => {
        timer = setTimeout(
          () => resolve({ error: new Error("timeout") }),
          timeoutMs,
        );
      }),
    ]);
    if (result?.error) return false;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
  clearPortalSession();
  clearMessageQueue();
  clearStoredSupabaseAuth();
  void clearApiCaches();
  return true;
}
