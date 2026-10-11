import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Creates a trusted Supabase administrative client using the Service Role Key.
 *
 * SECURITY NOTICE:
 * This client bypasses Row Level Security (RLS) and has full database superuser privileges.
 * - MUST ONLY be called from secure server-side environments (webhooks, trusted server procedures).
 * - NEVER import or call this function in browser / client code.
 * - NEVER pass the client instance to client-rendered components.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "SECURITY VIOLATION: createAdminClient() cannot be called in client-side / browser code."
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase admin environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be defined."
    );
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
