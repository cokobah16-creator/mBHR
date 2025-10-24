import { createClient } from '@supabase/supabase-js';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
let supabaseClient = null;
if (supabaseUrl && supabaseAnonKey && supabaseUrl !== 'your_supabase_project_url_here') {
    try {
        supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    }
    catch (error) {
        console.warn('Failed to initialize Supabase client:', error);
    }
}
export const supabase = supabaseClient;
