import React, { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrder } from "@/lib/actions/orders";
import { formatMoney } from "@/lib/money";
import { Navbar } from "@/components/layout/Navbar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { OrderDetailClient } from "@/components/orders/OrderDetailClient";
import {
  ArrowLeft,
  Calendar,
  User,
  ShieldCheck,
  Package,
  History,
  CheckCircle2,
  Lock,
  Loader2,
} from "lucide-react";

export async function generateMetadata({ params }) {
  const { id } = await params;
  return {
    title: `Order Details — DropTrust Capture`,
    description: `Order records and audit evidence for order ${id}`,
  };
}

async function OrderDetailContent({ params }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { success, order, items, events, error } = await getOrder(id);

  if (!success || !order) {
    return (
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-12 flex flex-col items-center justify-center gap-4 text-center">
        <Card className="p-8 max-w-md w-full flex flex-col items-center gap-4">
          <h1 className="text-xl font-bold text-[var(--color-ink-primary)]">
            Order Not Found
          </h1>
          <p className="text-sm text-[var(--color-ink-secondary)]">
            {error || "The requested order record does not exist or you do not have permission to view it."}
          </p>
          <Link href="/orders">
            <Button size="sm">
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              <span>Return to Orders</span>
            </Button>
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex flex-col gap-6">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link
          href="/orders"
          className="text-xs font-bold text-[var(--color-ink-secondary)] hover:text-[var(--color-ink-primary)] flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Orders</span>
        </Link>

        <span className="text-xs font-mono font-bold text-[var(--color-ink-secondary)]">
          ID: {order.id.slice(0, 8)}...
        </span>
      </div>

      {/* Order Reference & Status Header */}
      <div className="p-6 rounded-2xl bg-[var(--color-paper-card)] border-2 border-[var(--color-ink-primary)] shadow-[0_4px_0_#1E1218] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[var(--color-brand-gold)] border border-[var(--color-ink-primary)] text-[var(--color-ink-primary)] font-mono">
              {order.order_reference}
            </span>
            <Badge status={order.fulfillment_status} label={order.fulfillment_status} />
            <Badge
              status={order.payment_status === "PAID" ? "CONFIRMED" : "PENDING"}
              label={order.payment_status}
            />
            {order.payment_verification && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                {order.payment_verification}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-[var(--color-ink-secondary)]">
            <span className="flex items-center gap-1 font-medium">
              <Calendar className="w-3.5 h-3.5" />
              Created {new Date(order.created_at).toLocaleString()}
            </span>
            {order.confirmed_at && (
              <span className="flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Confirmed {new Date(order.confirmed_at).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        <div className="text-left sm:text-right">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)] block">
            Grand Total
          </span>
          <span className="text-2xl font-black font-mono text-[var(--color-brand-crimson)]">
            {formatMoney(order.total_cents, order.currency)}
          </span>
        </div>
      </div>

      {/* Interactive Client Hub (Copy Receipt Link, Advance Status) */}
      <OrderDetailClient order={order} />

      {/* Content Grid: Line Items & Customer Snapshot vs Financials & Audit */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Line Items & Customer Details */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Line Items Card */}
          <Card className="flex flex-col gap-5 p-6">
            <div className="flex items-center justify-between border-b-2 border-[var(--color-paper-stone)] pb-3">
              <h2 className="font-bold text-base flex items-center gap-2 text-[var(--color-ink-primary)]">
                <Package className="w-5 h-5 text-[var(--color-brand-crimson)]" />
                <span>Purchased Line Items</span>
              </h2>
              <span className="text-xs font-mono font-bold text-[var(--color-ink-secondary)]">
                {items.length} {items.length === 1 ? "Item" : "Items"}
              </span>
            </div>

            {/* Items Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b-2 border-[var(--color-paper-stone)] text-[var(--color-ink-secondary)] uppercase tracking-wider">
                    <th className="py-2 pr-4 font-bold">Item &amp; Description</th>
                    <th className="py-2 px-4 font-bold text-center">Qty</th>
                    <th className="py-2 px-4 font-bold text-right">Unit Price</th>
                    <th className="py-2 pl-4 font-bold text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-paper-stone)]">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-[var(--color-paper-light)] transition-colors">
                      <td className="py-3 pr-4">
                        <span className="font-bold text-sm text-[var(--color-ink-primary)] block">
                          {item.product_name_snapshot}
                        </span>
                        {item.variant_name_snapshot && (
                          <span className="text-[11px] text-[var(--color-ink-secondary)]">
                            Variant: {item.variant_name_snapshot}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-center text-[var(--color-ink-primary)]">
                        {item.quantity}
                      </td>
                      <td className="py-3 px-4 font-mono text-right text-[var(--color-ink-secondary)]">
                        {formatMoney(item.unit_price_cents, order.currency)}
                      </td>
                      <td className="py-3 pl-4 font-mono font-bold text-right text-[var(--color-ink-primary)]">
                        {formatMoney(item.line_total_cents, order.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Calculation Breakdown */}
            <div className="p-4 rounded-xl bg-[var(--color-paper-light)] border-2 border-[var(--color-paper-stone)] flex flex-col gap-2 text-xs ml-auto w-full sm:max-w-xs">
              <div className="flex justify-between items-center text-[var(--color-ink-secondary)]">
                <span>Items Subtotal</span>
                <span className="font-mono font-bold text-[var(--color-ink-primary)]">
                  {formatMoney(order.subtotal_cents, order.currency)}
                </span>
              </div>
              <div className="flex justify-between items-center text-[var(--color-ink-secondary)]">
                <span>Delivery Fee</span>
                <span className="font-mono font-bold text-[var(--color-ink-primary)]">
                  {formatMoney(order.delivery_fee_cents, order.currency)}
                </span>
              </div>
              <div className="border-t-2 border-[var(--color-paper-stone)] pt-2 flex justify-between items-center">
                <span className="font-bold text-sm text-[var(--color-ink-primary)]">
                  Order Total
                </span>
                <span className="font-mono font-black text-base text-[var(--color-brand-crimson)]">
                  {formatMoney(order.total_cents, order.currency)}
                </span>
              </div>
            </div>
          </Card>

          {/* Frozen Customer Snapshot Card */}
          <Card className="flex flex-col gap-5 p-6">
            <div className="flex items-center justify-between border-b-2 border-[var(--color-paper-stone)] pb-3">
              <h2 className="font-bold text-base flex items-center gap-2 text-[var(--color-ink-primary)]">
                <User className="w-5 h-5 text-[var(--color-brand-crimson)]" />
                <span>Frozen Customer Snapshot</span>
              </h2>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--color-paper-stone)] text-[var(--color-ink-secondary)] flex items-center gap-1">
                <Lock className="w-3 h-3" /> Immutable Evidence
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="flex flex-col gap-1 p-3 rounded-xl bg-[var(--color-paper-light)] border border-[var(--color-paper-stone)]">
                <span className="font-bold text-[var(--color-ink-secondary)] uppercase text-[10px]">
                  Customer Name
                </span>
                <span className="font-bold text-sm text-[var(--color-ink-primary)]">
                  {order.customer_name_snapshot || "N/A"}
                </span>
              </div>

              <div className="flex flex-col gap-1 p-3 rounded-xl bg-[var(--color-paper-light)] border border-[var(--color-paper-stone)]">
                <span className="font-bold text-[var(--color-ink-secondary)] uppercase text-[10px]">
                  Phone Contact
                </span>
                <span className="font-bold text-sm text-[var(--color-ink-primary)]">
                  {order.customer_phone_snapshot || "No phone provided"}
                </span>
              </div>

              <div className="sm:col-span-2 flex flex-col gap-1 p-3 rounded-xl bg-[var(--color-paper-light)] border border-[var(--color-paper-stone)]">
                <span className="font-bold text-[var(--color-ink-secondary)] uppercase text-[10px]">
                  Delivery Address / Drop Location
                </span>
                <span className="font-medium text-xs text-[var(--color-ink-primary)]">
                  {order.customer_address_snapshot || "Local pickup / no address specified"}
                </span>
              </div>

              <div className="sm:col-span-2 flex flex-col gap-1 p-3 rounded-xl bg-[var(--color-paper-light)] border border-[var(--color-paper-stone)]">
                <span className="font-bold text-[var(--color-ink-secondary)] uppercase text-[10px]">
                  Agreed Terms &amp; Conditions
                </span>
                <span className="font-medium text-xs text-[var(--color-ink-primary)]">
                  {order.agreed_terms || "Standard delivery terms apply."}
                </span>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Security Ledger & Audit Events */}
        <div className="flex flex-col gap-6">
          {/* Payment & Security Metadata */}
          <Card className="flex flex-col gap-4 p-6">
            <h2 className="font-bold text-base flex items-center gap-2 border-b-2 border-[var(--color-paper-stone)] pb-3 text-[var(--color-ink-primary)]">
              <ShieldCheck className="w-5 h-5 text-[var(--color-brand-crimson)]" />
              <span>Financial &amp; Trust State</span>
            </h2>

            <div className="flex flex-col gap-3 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-[var(--color-paper-stone)]">
                <span className="text-[var(--color-ink-secondary)] font-bold">Payment Method</span>
                <span className="font-bold text-[var(--color-ink-primary)]">
                  {order.payment_method === "PAYPAL" ? "PayPal (Online)" : "Cash on Delivery"}
                </span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-[var(--color-paper-stone)]">
                <span className="text-[var(--color-ink-secondary)] font-bold">Settlement Currency</span>
                <span className="font-bold px-2 py-0.5 rounded-full bg-[var(--color-brand-gold)] border border-[var(--color-ink-primary)] text-[11px] text-[var(--color-ink-primary)]">
                  {order.currency}
                </span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-[var(--color-paper-stone)]">
                <span className="text-[var(--color-ink-secondary)] font-bold">Receipt URL Token</span>
                <span className="font-mono text-[11px] text-[var(--color-ink-secondary)] truncate max-w-[140px]">
                  {order.public_token}
                </span>
              </div>

              <div className="flex justify-between items-center py-1">
                <span className="text-[var(--color-ink-secondary)] font-bold">Public Receipt State</span>
                <span className="font-bold text-xs text-emerald-800">
                  {order.is_receipt_active ? "Active & Accessible" : "Revoked"}
                </span>
              </div>
            </div>
          </Card>

          {/* Audit Log Timeline (Append-Only order_events) */}
          <Card className="flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between border-b-2 border-[var(--color-paper-stone)] pb-3">
              <h2 className="font-bold text-base flex items-center gap-2 text-[var(--color-ink-primary)]">
                <History className="w-5 h-5 text-[var(--color-brand-crimson)]" />
                <span>Audit Event Log</span>
              </h2>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
                Append-Only
              </span>
            </div>

            {events.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--color-ink-secondary)]">
                No events recorded yet.
              </div>
            ) : (
              <div className="flex flex-col gap-3 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-[var(--color-paper-stone)]">
                {events.map((ev) => (
                  <div key={ev.id} className="flex items-start gap-3 relative pl-6">
                    <div className="absolute left-1.5 top-1.5 w-3 h-3 rounded-full bg-[var(--color-brand-gold)] border-2 border-[var(--color-ink-primary)]" />
                    <div className="flex-1 p-2.5 rounded-lg bg-[var(--color-paper-light)] border border-[var(--color-paper-stone)] text-xs">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-[11px] text-[var(--color-ink-primary)]">
                          {ev.event_type}
                        </span>
                        <span className="text-[10px] text-[var(--color-ink-secondary)]">
                          {new Date(ev.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-[var(--color-ink-secondary)] block">
                        Actor: {ev.actor}
                      </span>
                      {ev.details && Object.keys(ev.details).length > 0 && (
                        <div className="mt-1 pt-1 border-t border-[var(--color-paper-stone)] text-[10px] text-[var(--color-ink-secondary)] truncate">
                          {JSON.stringify(ev.details)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}

function OrderDetailFallback() {
  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-16 flex flex-col items-center justify-center gap-3 text-center">
      <Loader2 className="w-8 h-8 animate-spin text-[var(--color-brand-crimson)]" />
      <span className="text-sm font-bold text-[var(--color-ink-primary)]">
        Loading order evidence records...
      </span>
    </main>
  );
}

export default function OrderDetailPage({ params }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-paper-light)] text-[var(--color-ink-primary)]">
      <Navbar activePath="/orders" />
      <Suspense fallback={<OrderDetailFallback />}>
        <OrderDetailContent params={params} />
      </Suspense>
      <footer className="border-t-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-card)] py-4 text-center text-xs font-medium text-[var(--color-ink-secondary)]">
        <p>DropTrust Capture &bull; Milestone 2: Order Detail &amp; Snapshot Audit</p>
      </footer>
    </div>
  );
}
