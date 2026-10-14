import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function sanitizeRedirectPath(path) {
  if (!path || typeof path !== "string") return "/";
  // Must start with a single slash and not double slash (//) to prevent protocol-relative open redirects
  if (path.startsWith("/") && !path.startsWith("//")) {
    return path;
  }
  return "/";
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const safeNext = sanitizeRedirectPath(next);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { ensureMerchantBusiness } = await import("@/app/auth/actions");
        await ensureMerchantBusiness(supabase, user);
      }

      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Authentication link expired or invalid.")}`
  );
}
