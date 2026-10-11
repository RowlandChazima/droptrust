import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureMerchantBusiness, logoutAction } from "@/app/auth/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  ShieldCheck,
  Store,
  Mail,
  Coins,
  Calendar,
  Lock,
  LogOut,
  Layers,
  ArrowRight,
  Loader2,
  AlertCircle,
} from "lucide-react";

async function MerchantDashboard() {
  const supabase = await createClient();

  // Strict server-side authentication check
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Query business record with distinct error handling
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  // Handle genuine database or permission errors
  if (businessError) {
    console.error("[Dashboard] Database error loading merchant business:", {
      userId: user.id,
      code: businessError.code,
      message: businessError.message,
    });

    return (
      <Card className="border-2 border-[var(--color-brand-crimson)] bg-[#FDF0F3] p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-[var(--color-brand-crimson)] shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <h2 className="font-bold text-lg text-[var(--color-brand-crimson)]">
              Database Connection Error
            </h2>
            <p className="text-sm text-[var(--color-ink-primary)]">
              Could not query merchant store records. Please verify database connectivity or try again shortly.
            </p>
            <span className="text-xs font-mono text-[var(--color-ink-secondary)] mt-2">
              Reference Code: {businessError.code || "DB_UNAVAILABLE"}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // If no record exists, attempt duplicate-safe provisioning
  let activeBusiness = business;
  if (!activeBusiness) {
    activeBusiness = await ensureMerchantBusiness(supabase, user);
  }

  // Handle missing record if provisioning also could not locate/create it
  if (!activeBusiness) {
    return (
      <Card className="border-2 border-[var(--color-brand-gold)] bg-[#FFFDF5] p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-[var(--color-brand-gold)] shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <h2 className="font-bold text-lg text-[var(--color-ink-primary)]">
              Store Setup Required
            </h2>
            <p className="text-sm text-[var(--color-ink-secondary)]">
              No store profile was found for this merchant account. Refresh or contact support to initialize your store ledger.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      {/* Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-2xl bg-[var(--color-brand-gold)] border-2 border-[var(--color-ink-primary)] shadow-[0_6px_0_#1E1218]">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Badge status="CONFIRMED" label="AUTHENTICATED" />
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
              Milestone 1 Active
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--color-ink-primary)]">
            {activeBusiness.name}
          </h1>
          <p className="text-sm font-medium text-[var(--color-ink-primary)] opacity-90">
            Merchant session active &bull; Operating currency KES &bull; Database configuration active
          </p>
        </div>
      </div>

      {/* Dashboard Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
        {/* Business Profile Details */}
        <Card className="flex flex-col gap-5">
          <div className="flex items-center justify-between border-b-2 border-[var(--color-paper-stone)] pb-3">
            <h2 className="text-lg font-bold flex items-center gap-2 text-[var(--color-ink-primary)]">
              <Store className="w-5 h-5 text-[var(--color-brand-crimson)]" />
              <span>Merchant Business Profile</span>
            </h2>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-[var(--color-paper-stone)] text-[var(--color-ink-primary)]">
              ACTIVE
            </span>
          </div>

          <div className="flex flex-col gap-3.5 text-sm">
            <div className="flex items-center justify-between py-1 border-b border-[var(--color-paper-stone)]">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)] flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5" /> Business Name
              </span>
              <span className="font-bold text-[var(--color-ink-primary)]">
                {activeBusiness.name}
              </span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-[var(--color-paper-stone)]">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)] flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Merchant Email
              </span>
              <span className="font-bold font-mono text-xs text-[var(--color-ink-primary)]">
                {user.email}
              </span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-[var(--color-paper-stone)]">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)] flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5" /> Operating Currency
              </span>
              <span className="font-bold px-2 py-0.5 rounded-full bg-[var(--color-brand-gold)] border border-[var(--color-ink-primary)] text-xs text-[var(--color-ink-primary)]">
                {activeBusiness.currency || "KES"} (Default)
              </span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-[var(--color-paper-stone)]">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)] flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> Member Since
              </span>
              <span className="font-bold text-xs text-[var(--color-ink-primary)]">
                {new Date(user.created_at).toLocaleDateString()}
              </span>
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)] flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" /> Tenancy ID
              </span>
              <span className="font-mono text-[11px] text-[var(--color-ink-secondary)] truncate max-w-[200px]">
                {activeBusiness.id}
              </span>
            </div>
          </div>
        </Card>

        {/* Security & System Readiness Status */}
        <Card className="flex flex-col gap-5">
          <div className="flex items-center justify-between border-b-2 border-[var(--color-paper-stone)] pb-3">
            <h2 className="text-lg font-bold flex items-center gap-2 text-[var(--color-ink-primary)]">
              <Layers className="w-5 h-5 text-[var(--color-brand-crimson)]" />
              <span>Milestone 1 Configuration Scope</span>
            </h2>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-[var(--color-paper-stone)] text-[var(--color-ink-primary)]">
              Configured
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div className="p-3 rounded-xl bg-[var(--color-paper-light)] border-2 border-[var(--color-paper-stone)] flex items-start gap-3">
              <div className="p-1 rounded bg-[var(--color-status-confirmed-bg)] border border-[var(--color-status-confirmed-border)] text-[var(--color-status-confirmed-text)] mt-0.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase text-[var(--color-ink-primary)]">
                  Tenancy Isolation &amp; Grants
                </h3>
                <p className="text-xs text-[var(--color-ink-secondary)]">
                  8 tables scoped to merchant business; financial fields restricted to stored procedures.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--color-paper-light)] border-2 border-[var(--color-paper-stone)] flex items-start gap-3">
              <div className="p-1 rounded bg-[var(--color-status-confirmed-bg)] border border-[var(--color-status-confirmed-border)] text-[var(--color-status-confirmed-text)] mt-0.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase text-[var(--color-ink-primary)]">
                  Duplicate-Safe Store Auto-Provisioning
                </h3>
                <p className="text-xs text-[var(--color-ink-secondary)]">
                  Guaranteed single business record per merchant with default currency KES.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--color-paper-light)] border-2 border-[var(--color-paper-stone)] flex items-start gap-3">
              <div className="p-1 rounded bg-[var(--color-status-confirmed-bg)] border border-[var(--color-status-confirmed-border)] text-[var(--color-status-confirmed-text)] mt-0.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase text-[var(--color-ink-primary)]">
                  Session Routing via proxy.js
                </h3>
                <p className="text-xs text-[var(--color-ink-secondary)]">
                  Server-side Next.js 16 session refresh and protected route redirects active.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t-2 border-[var(--color-paper-stone)] flex items-center justify-between text-xs text-[var(--color-ink-secondary)]">
            <span>Next Scope: Manual Orders &amp; Receipts</span>
            <span className="font-bold flex items-center gap-1 text-[var(--color-ink-primary)]">
              Milestone 2 <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </Card>
      </div>
    </>
  );
}

function DashboardFallback() {
  return (
    <Card className="flex flex-col items-center justify-center p-16 gap-3 text-center">
      <Loader2 className="w-8 h-8 animate-spin text-[var(--color-brand-crimson)]" />
      <span className="text-sm font-bold text-[var(--color-ink-primary)]">
        Loading merchant dashboard...
      </span>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-paper-light)] text-[var(--color-ink-primary)]">
      {/* Top Navigation */}
      <header className="border-b-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-card)] shadow-[0_2px_0_#1E1218]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--color-brand-gold)] border-2 border-[var(--color-ink-primary)] flex items-center justify-center shadow-[0_2px_0_#1E1218]">
              <ShieldCheck className="w-6 h-6 text-[var(--color-ink-primary)]" />
            </div>
            <div>
              <span className="font-extrabold tracking-tight text-xl text-[var(--color-ink-primary)] leading-none block">
                DropTrust
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
                Merchant Portal
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <form action={logoutAction}>
              <Button
                type="submit"
                variant="outline"
                className="py-1.5 px-3 text-xs flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </Button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex flex-col gap-8">
        <Suspense fallback={<DashboardFallback />}>
          <MerchantDashboard />
        </Suspense>
      </main>

      {/* Footer */}
      <footer className="border-t-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-card)] py-4 text-center text-xs font-medium text-[var(--color-ink-secondary)]">
        <p>DropTrust Capture &bull; Built with Next.js 16, Supabase PostgreSQL, and Design System v2</p>
      </footer>
    </div>
  );
}
