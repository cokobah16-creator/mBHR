import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

function initSupabase(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("Supabase credentials not configured");
    return null;
  }

  if (supabaseUrl === "your_supabase_project_url_here") {
    console.warn("Supabase URL is placeholder value");
    return null;
  }

  try {
    return createClient(supabaseUrl, supabaseAnonKey);
  } catch (error) {
    console.error("Failed to initialize Supabase client:", error);
    return null;
  }
}

export const supabase: SupabaseClient | null = initSupabase();
