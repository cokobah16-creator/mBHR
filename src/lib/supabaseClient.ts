/**
 * Supabase singleton client.
 *
 * Import from here everywhere in the app so there is only ever one instance.
 * Falls back to null when env vars are missing so offline mode still works.
 */
import { createClient, SupabaseClient, Session, User } from "@supabase/supabase-js";

const url  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function buildClient(): SupabaseClient | null {
  if (!url || !key) return null;
  if (url === "your_supabase_project_url_here") return null;
  try {
    return createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch {
    return null;
  }
}

export const supabase: SupabaseClient | null = buildClient();
export const isSupabaseEnabled = supabase !== null;

export type { Session, User };
