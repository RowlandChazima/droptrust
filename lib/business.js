/**
 * Internal business and merchant profile management.
 *
 * Server-only helper (not an action), safe from client-side network exposure.
 */

/**
 * Ensures a merchant has a business record with default currency 'KES'.
 * Safe against race conditions and duplicate calls.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {import('@supabase/supabase-js').User} user
 * @param {string} [fallbackName="My Store"]
 * @returns {Promise<Object|null>} The business record or null on failure
 */
export async function ensureMerchantBusiness(supabase, user, fallbackName = "My Store") {
  if (!user || !user.id) return null;

  // 1. Check if business already exists
  const { data: existing, error: selectError } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (selectError) {
    console.error("[Business] Error querying existing business:", selectError);
  }

  if (existing) {
    return existing;
  }

  // 2. Insert with duplicate-safe handling
  const businessName =
    user.user_metadata?.business_name || fallbackName || "My Store";

  const { data: created, error: insertError } = await supabase
    .from("businesses")
    .insert({
      owner_user_id: user.id,
      name: businessName,
      currency: "KES",
    })
    .select()
    .maybeSingle();

  if (insertError) {
    // If concurrent insert occurred or unique constraint triggered, refetch existing
    const { data: retryData } = await supabase
      .from("businesses")
      .select("*")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (retryData) return retryData;

    console.error("[Business] Failed to provision business record:", insertError);
    return null;
  }

  return created;
}
