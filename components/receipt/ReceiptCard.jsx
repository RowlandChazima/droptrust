"use client";

import React from "react";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  ShieldCheck,
  Printer,
  Calendar,
  User,
  Phone,
  MapPin,
  FileText,
  Package,
  CheckCircle2,
  Clock,
  Coins,
} from "lucide-react";

export function ReceiptCard({ receipt }) {
  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  const isPaid = receipt.paymentStatus === "PAID";

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col gap-6">
      {/* Printable Certificate Card */}
      <div className="receipt-certificate rounded-2xl bg-[var(--color-paper-card)] border-2 border-[var(--color-ink-primary)] shadow-[0_6px_0_#1E1218] p-6 sm:p-8 flex flex-col gap-6 relative overflow-hidden">
        {/* Certificate Decorative Top Border */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-[var(--color-brand-gold)] via-[var(--color-brand-crimson)] to-[var(--color-brand-gold)]" />

        {/* Certificate Header */}
        <div className="flex flex-col items-center text-center gap-2 pt-2 border-b-2 border-[var(--color-paper-stone)] pb-5">
          <div className="w-12 h-12 rounded-full bg-[var(--color-brand-gold)] border-2 border-[var(--color-ink-primary)] flex items-center justify-center shadow-[0_2px_0_#1E1218] mb-1">
            <ShieldCheck className="w-7 h-7 text-[var(--color-ink-primary)]" />
          </div>

          <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-ink-secondary)]">
            DropTrust Digital Trust Receipt
          </span>

          <h1 className="text-2xl sm:text-3xl font-black text-[var(--color-ink-primary)] tracking-tight">
            {receipt.businessName}
          </h1>

          <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
            <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-[var(--color-paper-light)] border border-[var(--color-ink-primary)] text-[var(--color-ink-primary)]">
              {receipt.orderReference}
            </span>
            <Badge
              status={isPaid ? "PAID" : "UNPAID"}
              label={receipt.paymentStatus}
            />
            <Badge
              status={receipt.fulfillmentStatus}
              label={receipt.fulfillmentStatus}
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[var(--color-ink-secondary)] mt-1">
            <Calendar className="w-3.5 h-3.5" />
            <span>
              Issued on{" "}
              {new Date(receipt.createdAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>

        {/* Verification Status Banner */}
        <div className={`p-3.5 rounded-xl border-2 flex items-center gap-3 text-xs ${
          isPaid
            ? "bg-emerald-50 border-emerald-300 text-emerald-900"
            : "bg-amber-50 border-amber-300 text-amber-900"
        }`}>
          {isPaid ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <Clock className="w-5 h-5 text-amber-600 shrink-0" />
          )}
          <div className="flex flex-col">
            <span className="font-bold">
              {isPaid
                ? receipt.paymentVerification === "PROVIDER_CONFIRMED"
                  ? "Provider Confirmed Payment"
                  : "Merchant Verified Settlement"
                : "Awaiting Settlement"}
            </span>
            <span className="text-[11px] opacity-90">
              {isPaid
                ? `Payment confirmed via ${receipt.paymentMethod === "PAYPAL" ? "PayPal Sandbox" : "Cash on Delivery"}.`
                : receipt.paymentMethod === "CASH_ON_DELIVERY"
                  ? "Cash on delivery: payment will be collected upon physical handover."
                  : "Online transaction pending customer checkout."}
            </span>
          </div>
        </div>

        {/* Masked Customer Identity Section */}
        <div className="p-4 rounded-xl bg-[var(--color-paper-light)] border border-[var(--color-paper-stone)] flex flex-col gap-2.5">
          <div className="flex items-center justify-between border-b border-[var(--color-paper-stone)] pb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
              Customer Information
            </span>
            <span className="text-[10px] font-medium text-[var(--color-ink-secondary)]">
              Privacy Masked
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {receipt.customer.name && (
              <div className="flex items-center gap-1.5 text-[var(--color-ink-primary)]">
                <User className="w-3.5 h-3.5 text-[var(--color-brand-crimson)] shrink-0" />
                <span className="font-semibold">{receipt.customer.name}</span>
              </div>
            )}
            {receipt.customer.phone && (
              <div className="flex items-center gap-1.5 text-[var(--color-ink-primary)]">
                <Phone className="w-3.5 h-3.5 text-[var(--color-brand-crimson)] shrink-0" />
                <span className="font-mono">{receipt.customer.phone}</span>
              </div>
            )}
            {receipt.customer.area && (
              <div className="sm:col-span-2 flex items-center gap-1.5 text-[var(--color-ink-secondary)]">
                <MapPin className="w-3.5 h-3.5 text-[var(--color-brand-crimson)] shrink-0" />
                <span>{receipt.customer.area}</span>
              </div>
            )}
          </div>
        </div>

        {/* Line Items Table */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-ink-primary)]">
            <Package className="w-4 h-4 text-[var(--color-brand-crimson)]" />
            <span>Order Line Items</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b-2 border-[var(--color-paper-stone)] text-[var(--color-ink-secondary)] uppercase tracking-wider text-[10px]">
                  <th className="py-2 pr-3 font-bold">Item</th>
                  <th className="py-2 px-3 font-bold text-center">Qty</th>
                  <th className="py-2 px-3 font-bold text-right">Price</th>
                  <th className="py-2 pl-3 font-bold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-paper-stone)]">
                {receipt.items.map((item, idx) => (
                  <tr key={idx} className="hover:bg-[var(--color-paper-light)]/50">
                    <td className="py-2.5 pr-3">
                      <span className="font-bold text-[var(--color-ink-primary)] block">
                        {item.name}
                      </span>
                      {item.variant && (
                        <span className="text-[10px] text-[var(--color-ink-secondary)]">
                          Variant: {item.variant}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-center text-[var(--color-ink-primary)]">
                      {item.quantity}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-right text-[var(--color-ink-secondary)]">
                      {formatMoney(item.unitPriceCents, receipt.currency)}
                    </td>
                    <td className="py-2.5 pl-3 font-mono font-bold text-right text-[var(--color-ink-primary)]">
                      {formatMoney(item.lineTotalCents, receipt.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals Summary */}
        <div className="p-3.5 rounded-xl bg-[var(--color-paper-light)] border border-[var(--color-paper-stone)] flex flex-col gap-2 text-xs ml-auto w-full sm:max-w-xs">
          <div className="flex justify-between items-center text-[var(--color-ink-secondary)]">
            <span>Subtotal</span>
            <span className="font-mono font-bold text-[var(--color-ink-primary)]">
              {formatMoney(receipt.subtotalCents, receipt.currency)}
            </span>
          </div>
          <div className="flex justify-between items-center text-[var(--color-ink-secondary)]">
            <span>Delivery Fee</span>
            <span className="font-mono font-bold text-[var(--color-ink-primary)]">
              {formatMoney(receipt.deliveryFeeCents, receipt.currency)}
            </span>
          </div>
          <div className="border-t-2 border-[var(--color-paper-stone)] pt-2 flex justify-between items-center">
            <span className="font-bold text-sm text-[var(--color-ink-primary)]">
              Total Amount
            </span>
            <span className="font-mono font-black text-base text-[var(--color-brand-crimson)]">
              {formatMoney(receipt.totalCents, receipt.currency)}
            </span>
          </div>
        </div>

        {/* Agreed Terms if Present */}
        {receipt.agreedTerms && (
          <div className="p-3 rounded-xl bg-[var(--color-paper-light)] border border-[var(--color-paper-stone)] text-xs flex flex-col gap-1">
            <div className="flex items-center gap-1.5 font-bold text-[var(--color-ink-primary)] text-[11px]">
              <FileText className="w-3.5 h-3.5 text-[var(--color-brand-crimson)]" />
              <span>Agreed Terms &amp; Conditions</span>
            </div>
            <p className="text-[11px] text-[var(--color-ink-secondary)] leading-relaxed">
              {receipt.agreedTerms}
            </p>
          </div>
        )}

        {/* Certificate Seal Footer */}
        <div className="border-t-2 border-[var(--color-paper-stone)] pt-4 flex flex-col items-center text-center gap-1 text-[10px] text-[var(--color-ink-secondary)]">
          <div className="flex items-center gap-1.5 font-bold text-[var(--color-ink-primary)]">
            <Coins className="w-3.5 h-3.5 text-[var(--color-brand-gold)]" />
            <span>DropTrust Verified Transaction Certificate</span>
          </div>
          <span>
            Operating in {receipt.currency} &bull; Immutable tamper-proof ledger record
          </span>
        </div>
      </div>

      {/* Action Bar (Hidden on Print) */}
      <div className="flex items-center justify-between gap-3 px-2 print:hidden">
        <span className="text-xs text-[var(--color-ink-secondary)]">
          Save or print this receipt for your records.
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handlePrint}
          className="flex items-center gap-1.5 text-xs bg-white"
        >
          <Printer className="w-3.5 h-3.5" />
          <span>Print / Save PDF</span>
        </Button>
      </div>
    </div>
  );
}
