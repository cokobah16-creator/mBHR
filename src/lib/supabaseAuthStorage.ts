/**
 * Helpers for the Supabase sign-in that supabase-js keeps in localStorage.
 * Shared by the staff auth store and the patient portal (both clients use
 * the default "sb-<project>-auth-token" key, so they share one sign-in).
 *
 * Kept in src/lib, not under a feature folder: the staff auth store loads
 * at startup, and vite.config.ts puts feature folders in separate chunks.
 */

/**
 * True for the keys supabase-js uses to keep a sign-in in this browser
 * ("sb-<project>-auth-token" and its PKCE "-code-verifier").
 */
export function isSupabaseAuthKey(key: string): boolean {
  return /^sb-.+-auth-token(-code-verifier)?$/.test(key);
}

/**
 * Remove any Supabase sign-in kept in this browser. `auth.signOut()` needs
 * the network: offline it returns an error and leaves the session on the
 * phone, so the next person could reopen this patient's records once online.
 */
export function clearStoredSupabaseAuth(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isSupabaseAuthKey(key)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage blocked: nothing we can clear.
  }
}
