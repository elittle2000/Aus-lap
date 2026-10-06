import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Set in .env.local (local) or the hosting dashboard (live). The publishable key is
// safe to ship to phones: the database's access rules are what keep data private.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/** null when no database is configured: the app then runs on this device only. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } }) : null
