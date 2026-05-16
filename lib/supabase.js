import { createClient } from '@supabase/supabase-js';

// Admin client — service_role key, bypasses RLS
// Never expose this key to the client
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// User-scoped client — respects RLS, bound to caller's JWT
export function supabaseForUser(token) {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}
