import React, { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMerchantOrders } from "@/lib/actions/orders";
import { formatMoney } from "@/lib/money";
import { Navbar } from "@/components/layout/Navbar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  ShoppingBag,
  Plus,
  ArrowRight,
  Filter,
  User,
  Loader2,
} from "lucide-react";

export const metadata = {
  title: "Orders — DropTrust Capture",
  description: "View and manage merchant orders, receipts, and fulfillment status.",
};

const FILTER_OPTIONS = [
  { label: "All Orders", value: "ALL" },
  { label: "Confirmed", value: "CONFIRMED" },
  { label: "Processing", value: "PROCESSING" },
  { label: "Ready", value: "READY" },
  { label: "Dispatched", value: "DISPATCHED" },
  { label: "Delivered", value: "DELIVERED" },
];

async function OrdersContent({ searchParams }) {
  const resolvedParams = await searchParams;
  const status = resolvedParams?.status || "ALL";

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { orders = [] } = await getMerchantOrders(status);

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-2 border-[var(--color-paper-stone)] pb-5">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-[var(--color-brand-gold)] border border-[var(--color-ink-primary)] text-[var(--color-ink-primary)]">
              <ShoppingBag className="w-4 h-4" />
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
              Store Records
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--color-ink-primary)]">
            Customer Orders
          </h1>
          <p className="text-sm font-medium text-[var(--color-ink-secondary)]">
            Track customer commitments, fulfillment lifecycles, and cryptographic trust receipts.
          </p>
        </div>

        <Link href="/orders/new">
          <Button className="flex items-center gap-1.5 py-2.5 px-4 shadow-[0_3px_0_#1E1218]">
            <Plus className="w-4 h-4" />
            <span>New Order</span>
          </Button>
        </Link>
      </div>

      {/* Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <Filter className="w-3.5 h-3.5 text-[var(--color-ink-secondary)] shrink-0 ml-1" />
        {FILTER_OPTIONS.map((f) => {
          const isActive = (status || "ALL") === f.value;
          return (
            <Link
              key={f.value}
              href={f.value === "ALL" ? "/orders" : `/orders?status=${f.value}`}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all shrink-0 ${
                isActive
                  ? "bg-[var(--color-ink-primary)] text-[var(--color-paper-light)] shadow-[0_2px_0_#1E1218]"
                  : "bg-[var(--color-paper-card)] border-2 border-[var(--color-paper-stone)] text-[var(--color-ink-secondary)] hover:text-[var(--color-ink-primary)]"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {/* Orders Table or Empty State */}
      {orders.length === 0 ? (
        <Card className="p-12 text-center flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[var(--color-brand-gold)] border-2 border-[var(--color-ink-primary)] flex items-center justify-center shadow-[0_2px_0_#1E1218]">
            <ShoppingBag className="w-6 h-6 text-[var(--color-ink-primary)]" />
          </div>
          <div className="flex flex-col gap-1 max-w-sm">
            <h2 className="text-base font-bold text-[var(--color-ink-primary)]">
              No orders found
            </h2>
            <p className="text-xs text-[var(--color-ink-secondary)]">
              {status !== "ALL"
                ? `There are no orders with fulfillment status "${status}".`
                : "Start recording customer orders with itemized lines, frozen snapshots, and trust receipts."}
            </p>
          </div>
          <Link href="/orders/new">
            <Button size="sm" className="mt-2 flex items-center gap-1.5">
              <Plus className="w-4 h-4" />
              <span>Create Your First Order</span>
            </Button>
          </Link>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b-2 border-[var(--color-paper-stone)] bg-[var(--color-paper-light)] text-[var(--color-ink-secondary)] uppercase tracking-wider">
                  <th className="py-3 px-4 font-bold">Order Reference</th>
                  <th className="py-3 px-4 font-bold">Customer</th>
                  <th className="py-3 px-4 font-bold">Date</th>
                  <th className="py-3 px-4 font-bold">Status</th>
                  <th className="py-3 px-4 font-bold">Payment</th>
                  <th className="py-3 px-4 font-bold text-right">Total</th>
                  <th className="py-3 px-4 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-paper-stone)]">
                {orders.map((ord) => (
                  <tr
                    key={ord.id}
                    className="hover:bg-[var(--color-paper-light)] transition-colors group"
                  >
                    <td className="py-3 px-4">
                      <span className="font-mono font-bold text-xs text-[var(--color-ink-primary)] block">
                        {ord.order_reference}
                      </span>
                      <span className="text-[10px] text-[var(--color-ink-secondary)] font-mono">
                        Token: {ord.public_token.slice(0, 10)}...
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-bold text-xs text-[var(--color-ink-primary)] flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-[var(--color-brand-crimson)] shrink-0" />
                        {ord.customer_name_snapshot || "N/A"}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-[var(--color-ink-secondary)] font-medium">
                      {new Date(ord.created_at).toLocaleDateString()}
                    </td>

                    <td className="py-3 px-4">
                      <Badge status={ord.fulfillment_status} label={ord.fulfillment_status} />
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-0.5">
                        <Badge
                          status={ord.payment_status === "PAID" ? "CONFIRMED" : "PENDING"}
                          label={ord.payment_status}
                        />
                        <span className="text-[10px] text-[var(--color-ink-secondary)]">
                          {ord.payment_method === "PAYPAL" ? "PayPal" : "Cash on Del."}
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-4 font-mono font-extrabold text-sm text-right text-[var(--color-ink-primary)]">
                      {formatMoney(ord.total_cents, ord.currency)}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <Link href={`/orders/${ord.id}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="py-1 px-2.5 text-[11px] font-bold group-hover:border-[var(--color-ink-primary)]"
                        >
                          <span>View</span>
                          <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </main>
  );
}

function OrdersFallback() {
  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-16 flex flex-col items-center justify-center gap-3 text-center">
      <Loader2 className="w-8 h-8 animate-spin text-[var(--color-brand-crimson)]" />
      <span className="text-sm font-bold text-[var(--color-ink-primary)]">
        Loading merchant orders directory...
      </span>
    </main>
  );
}

export default function OrdersPage({ searchParams }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-paper-light)] text-[var(--color-ink-primary)]">
      <Navbar activePath="/orders" />
      <Suspense fallback={<OrdersFallback />}>
        <OrdersContent searchParams={searchParams} />
      </Suspense>
      <footer className="border-t-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-card)] py-4 text-center text-xs font-medium text-[var(--color-ink-secondary)]">
        <p>DropTrust Capture &bull; Milestone 2: Customer Orders Directory</p>
      </footer>
    </div>
  );
}
