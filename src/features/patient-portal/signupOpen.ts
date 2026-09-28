import { env } from "@/config/env";
import { isSupabaseEnabled } from "@/lib/supabaseClient";

/**
 * Whether the portal offers self sign-up. Online, only when the deployment
 * says sign-ups are open (Supabase Auth refuses them otherwise); offline
 * devices make accounts locally, so they always can.
 */
export function portalSignupOpen(): boolean {
  if (!isSupabaseEnabled) return true;
  return env.VITE_PORTAL_SIGNUP_OPEN.trim().toLowerCase() === "true";
}
