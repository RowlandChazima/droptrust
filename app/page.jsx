import React, { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureMerchantBusiness } from "@/lib/business";
import { formatMoney } from "@/lib/money";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  ShieldCheck,
  Store,
  Mail,
  Coins,
  Lock,
  Layers,
  ArrowRight,
  Loader2,
  AlertCircle,
  Plus,
  ShoppingBag,
  DollarSign,
  Clock,
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

  // Query live merchant orders for metrics & recent orders
  const { data: recentOrders = [] } = await supabase
    .from("orders")
    .select(`
      id,
      order_reference,
      public_token,
      fulfillment_status,
      payment_status,
      payment_method,
      total_cents,
      currency,
      customer_name_snapshot,
      created_at
    `)
    .eq("business_id", activeBusiness.id)
    .order("created_at", { ascending: false })
    .limit(10);

  // Compute live overview metrics
  const totalOrdersCount = recentOrders.length;
  let confirmedSalesCents = 0;
  let unpaidBalanceCents = 0;

  recentOrders.forEach((o) => {
    if (o.payment_status === "PAID") {
      confirmedSalesCents += Number(o.total_cents) || 0;
    } else {
      unpaidBalanceCents += Number(o.total_cents) || 0;
    }
  });

  return (
    <>
      {/* Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-2xl bg-[var(--color-brand-gold)] border-2 border-[var(--color-ink-primary)] shadow-[0_6px_0_#1E1218]">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Badge status="CONFIRMED" label="ACTIVE MERCHANT" />
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
              Milestone 2 Active
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--color-ink-primary)]">
            {activeBusiness.name}
          </h1>
          <p className="text-sm font-medium text-[var(--color-ink-primary)] opacity-90">
            Manual order capture active &bull; Operating currency {activeBusiness.currency || "KES"} &bull; Minor-unit integer precision
          </p>
        </div>

        <Link href="/orders/new">
          <Button className="py-2.5 px-4 flex items-center gap-2 text-sm shadow-[0_4px_0_#1E1218]">
            <Plus className="w-4 h-4" />
            <span>Capture New Order</span>
          </Button>
        </Link>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        <Card className="p-5 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
              Total Orders
            </span>
            <div className="w-8 h-8 rounded-full bg-[var(--color-paper-light)] border border-[var(--color-paper-stone)] flex items-center justify-center">
              <ShoppingBag className="w-4 h-4 text-[var(--color-ink-primary)]" />
            </div>
          </div>
          <span className="text-3xl font-black text-[var(--color-ink-primary)]">
            {totalOrdersCount}
          </span>
          <span className="text-[11px] text-[var(--color-ink-secondary)]">
            Itemized records in store ledger
          </span>
        </Card>

        <Card className="p-5 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
              Settled Collections
            </span>
            <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-emerald-700" />
            </div>
          </div>
          <span className="text-3xl font-black font-mono text-emerald-800">
            {formatMoney(confirmedSalesCents, activeBusiness.currency || "KES")}
          </span>
          <span className="text-[11px] text-[var(--color-ink-secondary)]">
            Paid &amp; verified orders
          </span>
        </Card>

        <Card className="p-5 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
              Pending / Unpaid
            </span>
            <div className="w-8 h-8 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center">
              <Clock className="w-4 h-4 text-amber-700" />
            </div>
          </div>
          <span className="text-3xl font-black font-mono text-[var(--color-brand-crimson)]">
            {formatMoney(unpaidBalanceCents, activeBusiness.currency || "KES")}
          </span>
          <span className="text-[11px] text-[var(--color-ink-secondary)]">
            Awaiting cash or online payment
          </span>
        </Card>
      </div>

      {/* Recent Orders Section */}
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between border-b-2 border-[var(--color-paper-stone)] pb-3">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-[var(--color-brand-crimson)]" />
            <h2 className="text-lg font-bold text-[var(--color-ink-primary)]">
              Recent Store Orders
            </h2>
          </div>
          <Link
            href="/orders"
            className="text-xs font-bold text-[var(--color-ink-secondary)] hover:text-[var(--color-ink-primary)] flex items-center gap-1 transition-colors"
          >
            <span>View All</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {recentOrders.length === 0 ? (
          <div className="py-10 text-center flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-[var(--color-ink-secondary)]">
              No orders captured yet. Click below to create your first order record.
            </p>
            <Link href="/orders/new">
              <Button size="sm" className="flex items-center gap-1.5">
                <Plus className="w-4 h-4" />
                <span>Create Order</span>
              </Button>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--color-paper-stone)] text-[var(--color-ink-secondary)] uppercase tracking-wider">
                  <th className="py-2.5 px-3 font-bold">Reference</th>
                  <th className="py-2.5 px-3 font-bold">Customer</th>
                  <th className="py-2.5 px-3 font-bold">Status</th>
                  <th className="py-2.5 px-3 font-bold">Payment</th>
                  <th className="py-2.5 px-3 font-bold text-right">Total</th>
                  <th className="py-2.5 px-3 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-paper-stone)]">
                {recentOrders.slice(0, 5).map((o) => (
                  <tr key={o.id} className="hover:bg-[var(--color-paper-light)] transition-colors">
                    <td className="py-3 px-3 font-mono font-bold text-[var(--color-ink-primary)]">
                      {o.order_reference}
                    </td>
                    <td className="py-3 px-3 font-medium text-[var(--color-ink-primary)]">
                      {o.customer_name_snapshot || "N/A"}
                    </td>
                    <td className="py-3 px-3">
                      <Badge status={o.fulfillment_status} label={o.fulfillment_status} />
                    </td>
                    <td className="py-3 px-3">
                      <Badge
                        status={o.payment_status === "PAID" ? "CONFIRMED" : "PENDING"}
                        label={o.payment_status}
                      />
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-right text-[var(--color-ink-primary)]">
                      {formatMoney(o.total_cents, o.currency)}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <Link href={`/orders/${o.id}`}>
                        <Button variant="outline" size="sm" className="py-1 px-2.5 text-[11px]">
                          View
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Dashboard Grid: Store Profile & System Scope */}
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
                {activeBusiness.currency || "KES"}
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

        {/* Milestone 2 Invariants & Readiness */}
        <Card className="flex flex-col gap-5">
          <div className="flex items-center justify-between border-b-2 border-[var(--color-paper-stone)] pb-3">
            <h2 className="text-lg font-bold flex items-center gap-2 text-[var(--color-ink-primary)]">
              <Layers className="w-5 h-5 text-[var(--color-brand-crimson)]" />
              <span>Milestone 2 Invariants</span>
            </h2>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-[var(--color-paper-stone)] text-[var(--color-ink-primary)]">
              Operational
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div className="p-3 rounded-xl bg-[var(--color-paper-light)] border-2 border-[var(--color-paper-stone)] flex items-start gap-3">
              <div className="p-1 rounded bg-[var(--color-status-confirmed-bg)] border border-[var(--color-status-confirmed-border)] text-[var(--color-status-confirmed-text)] mt-0.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase text-[var(--color-ink-primary)]">
                  Strict Minor-Unit Integer Math
                </h3>
                <p className="text-xs text-[var(--color-ink-secondary)]">
                  All monetary calculations are performed in integer cents with zero floating-point math.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--color-paper-light)] border-2 border-[var(--color-paper-stone)] flex items-start gap-3">
              <div className="p-1 rounded bg-[var(--color-status-confirmed-bg)] border border-[var(--color-status-confirmed-border)] text-[var(--color-status-confirmed-text)] mt-0.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase text-[var(--color-ink-primary)]">
                  Two-Stage Order Creation Protocol
                </h3>
                <p className="text-xs text-[var(--color-ink-secondary)]">
                  Order row inserted with subtotal 0, then populated atomically via set_order_items RPC.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[var(--color-paper-light)] border-2 border-[var(--color-paper-stone)] flex items-start gap-3">
              <div className="p-1 rounded bg-[var(--color-status-confirmed-bg)] border border-[var(--color-status-confirmed-border)] text-[var(--color-status-confirmed-text)] mt-0.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase text-[var(--color-ink-primary)]">
                  Frozen Customer Evidence Snapshots
                </h3>
                <p className="text-xs text-[var(--color-ink-secondary)]">
                  Customer name, phone, address, and agreed terms frozen at capture time.
                </p>
              </div>
            </div>
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
      <Navbar activePath="/" />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex flex-col gap-8">
        <Suspense fallback={<DashboardFallback />}>
          <MerchantDashboard />
        </Suspense>
      </main>

      <footer className="border-t-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-card)] py-4 text-center text-xs font-medium text-[var(--color-ink-secondary)]">
        <p>DropTrust Capture &bull; Built with Next.js 16, Supabase PostgreSQL, and Design System v2</p>
      </footer>
    </div>
  );
}
