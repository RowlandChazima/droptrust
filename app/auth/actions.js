"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.string().email("Please provide a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
});

const signupSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, "Business name must be at least 2 characters.")
    .max(100, "Business name is too long."),
  email: z.string().email("Please provide a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
});

/**
 * Ensures a merchant has a business record with default currency 'KES'.
 * Safe against race conditions and duplicate calls.
 */
export async function ensureMerchantBusiness(supabase, user, fallbackName = "My Store") {
  if (!user || !user.id) return null;

  // 1. Check if business already exists
  const { data: existing } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_user_id", user.id)
    .maybeSingle();

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
    // If concurrent insert occurred or constraint triggered, refetch existing
    const { data: retryData } = await supabase
      .from("businesses")
      .select("*")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (retryData) return retryData;

    console.error("Failed to provision business record:", insertError);
  }

  return created;
}

/**
 * Merchant Login Server Action
 */
export async function loginAction(prevState, formData) {
  const rawData = {
    email: formData.get("email"),
    password: formData.get("password"),
  };

  const validation = loginSchema.safeParse(rawData);
  if (!validation.success) {
    return {
      error: validation.error.issues[0]?.message || "Invalid form data.",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  const { email, password } = validation.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  // Ensure business record exists
  if (data?.user) {
    await ensureMerchantBusiness(supabase, data.user);
  }

  redirect("/");
}

/**
 * Merchant Signup Server Action
 */
export async function signupAction(prevState, formData) {
  const rawData = {
    businessName: formData.get("businessName"),
    email: formData.get("email"),
    password: formData.get("password"),
  };

  const validation = signupSchema.safeParse(rawData);
  if (!validation.success) {
    return {
      error: validation.error.issues[0]?.message || "Invalid form data.",
      fieldErrors: validation.error.flatten().fieldErrors,
    };
  }

  const { businessName, email, password } = validation.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        business_name: businessName,
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  // If user signed up with immediate session
  if (data?.session && data?.user) {
    await ensureMerchantBusiness(supabase, data.user, businessName);
    redirect("/");
  }

  // If email confirmation is required by Supabase project settings
  return {
    success: true,
    message:
      "Account registered! If confirmation is required, please check your email inbox to verify your account before logging in.",
  };
}

/**
 * Merchant Logout Server Action
 */
export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
