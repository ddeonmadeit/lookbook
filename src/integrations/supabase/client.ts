import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { cookieStorage } from './cookieStorage';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Cookies instead of localStorage: the admin session survives more
    // reliably across app/in-app-browser storage clearing, so signing in
    // once keeps you signed in.
    storage: cookieStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});