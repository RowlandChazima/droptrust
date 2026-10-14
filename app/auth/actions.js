"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ensureMerchantBusiness } from "@/lib/business";

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
 * Merchant Login Server Action
 */
export async function loginAction(prevState, formData) {
  const rawData = {
    email: typeof formData.get("email") === "string" ? formData.get("email").trim().toLowerCase() : "",
    password: typeof formData.get("password") === "string" ? formData.get("password") : "",
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
    console.error("[Login] Authentication failure:", error.message);
    return { error: "Invalid email or password." };
  }

  // Ensure business record exists
  if (data?.user) {
    const business = await ensureMerchantBusiness(supabase, data.user);
    if (!business) {
      return { error: "Unable to initialize merchant store. Please try again or contact support." };
    }
  }

  redirect("/");
}

/**
 * Merchant Signup Server Action
 */
export async function signupAction(prevState, formData) {
  const rawData = {
    businessName: typeof formData.get("businessName") === "string" ? formData.get("businessName").trim() : "",
    email: typeof formData.get("email") === "string" ? formData.get("email").trim().toLowerCase() : "",
    password: typeof formData.get("password") === "string" ? formData.get("password") : "",
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
    console.error("[Signup] Registration failure:", error.message);
    return { error: "Unable to register account. If you already have an account, please log in." };
  }

  // If user signed up with immediate session
  if (data?.session && data?.user) {
    const business = await ensureMerchantBusiness(supabase, data.user, businessName);
    if (!business) {
      return { error: "Account created, but store setup failed. Please log in to complete setup." };
    }
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
