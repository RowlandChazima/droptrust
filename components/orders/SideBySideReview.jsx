"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  DollarSign,
  Package,
  User,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Eye,
} from "lucide-react";
import { ZoomableImageViewer } from "@/components/orders/ZoomableImageViewer";
import { createManualOrder } from "@/lib/actions/orders";
import { parseToCents, formatMoney, calculateLineTotal } from "@/lib/money";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

/**
 * SideBySideReview — Dual-Pane Multimodal AI Order Review Studio
 * Presents original document photo side-by-side with Gemini 3.8 Flash extracted fields.
 */
export function SideBySideReview({
  initialExtraction,
  imagePreviewUrl,
  storageFilePath,
  defaultCurrency = "USD",
  onDiscard,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");

  // Customer State
  const [customerName, setCustomerName] = useState(
    initialExtraction?.customerName || ""
  );
  const [customerPhone, setCustomerPhone] = useState(
    initialExtraction?.customerPhone || ""
  );
  const [customerEmail, setCustomerEmail] = useState(
    initialExtraction?.customerEmail || ""
  );
  const [customerAddress, setCustomerAddress] = useState(
    initialExtraction?.customerAddress || ""
  );
  const [agreedTerms, setAgreedTerms] = useState(
    initialExtraction?.agreedTerms || initialExtraction?.notes || ""
  );

  // Financial & Currency
  const [currency, setCurrency] = useState(
    initialExtraction?.currency === "KES" ? "KES" : defaultCurrency
  );
  const [paymentMethod, setPaymentMethod] = useState(
    currency === "USD" ? "PAYPAL" : "CASH_ON_DELIVERY"
  );
  const [deliveryFee, setDeliveryFee] = useState(
    initialExtraction?.deliveryFee || "0"
  );

  // Line items
  const [items, setItems] = useState(
    initialExtraction?.items?.length > 0
      ? initialExtraction.items
      : [
          {
            id: "item-1",
            productName: "",
            variantName: "",
            quantity: 1,
            unitPrice: "",
            confidenceScore: 1.0,
            needsReview: false,
            uncertaintyReason: null,
          },
        ]
  );

  const handleCurrencyChange = (newCurr) => {
    setCurrency(newCurr);
    if (newCurr !== "USD" && paymentMethod === "PAYPAL") {
      setPaymentMethod("CASH_ON_DELIVERY");
    }
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        productName: "",
        variantName: "",
        quantity: 1,
        unitPrice: "",
        confidenceScore: 1.0,
        needsReview: false,
        uncertaintyReason: null,
      },
    ]);
  };

  const removeItem = (id) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const updateItem = (id, field, value) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        return {
          ...item,
          [field]: value,
          // Once the merchant edits a field, clear the low-confidence flag
          needsReview: false,
          userEdited: true,
        };
      })
    );
  };

  // Safe Real-time Calculations
  let subtotalCents = 0;
  items.forEach((item) => {
    try {
      const priceCents = item.unitPrice ? parseToCents(item.unitPrice) : 0;
      subtotalCents += calculateLineTotal(priceCents, item.quantity);
    } catch {
      // Ignore during typing
    }
  });

  let deliveryFeeCents = 0;
  try {
    deliveryFeeCents = deliveryFee ? parseToCents(deliveryFee) : 0;
  } catch {
    // Ignore during typing
  }

  const grandTotalCents = subtotalCents + deliveryFeeCents;
  const lowConfidenceCount = items.filter((i) => i.needsReview).length;
  const overallConfidencePct = Math.round(
    (initialExtraction?.overallConfidence || 0.9) * 100
  );

  const handleSubmitOrder = (e) => {
    e.preventDefault();
    setErrorMessage("");

    if (!customerName.trim()) {
      setErrorMessage("Customer name is required.");
      return;
    }

    if (items.length === 0) {
      setErrorMessage("At least one line item is required.");
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.productName.trim()) {
        setErrorMessage(`Item #${i + 1} is missing a product title.`);
        return;
      }
      try {
        const c = parseToCents(it.unitPrice);
        if (c < 0) throw new Error();
      } catch {
        setErrorMessage(`Item #${i + 1} (${it.productName}) has an invalid unit price.`);
        return;
      }
      if (!it.quantity || it.quantity < 1) {
        setErrorMessage(`Item #${i + 1} (${it.productName}) quantity must be at least 1.`);
        return;
      }
    }

    startTransition(async () => {
      const payload = {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || null,
        customerEmail: customerEmail.trim() || null,
        customerAddress: customerAddress.trim() || null,
        agreedTerms: agreedTerms.trim() || null,
        currency,
        paymentMethod,
        deliveryFee: String(deliveryFee || "0"),
        items: items.map((it) => ({
          productName: it.productName.trim(),
          variantName: it.variantName?.trim() || null,
          unitPrice: String(it.unitPrice),
          quantity: parseInt(it.quantity, 10),
        })),
        // Link AI extraction metadata and image storage path
        storageFilePath: storageFilePath || null,
        rawModelOutput: initialExtraction?.rawModelOutput || null,
      };

      const result = await createManualOrder(payload);

      if (!result.success) {
        setErrorMessage(result.error || "Failed to commit verified order.");
      } else {
        router.push(`/orders/${result.orderId}`);
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Studio Header & Gemini Banner */}
      <div className="p-4 sm:p-5 rounded-2xl border-2 border-[var(--color-ink-primary)] bg-[var(--color-brand-gold)] shadow-[0_4px_0_#1E1218] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-paper-card)] border-2 border-[var(--color-ink-primary)] flex items-center justify-center shadow-[0_2px_0_#1E1218] shrink-0">
            <Sparkles className="w-5 h-5 text-[var(--color-brand-crimson)]" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold text-[var(--color-ink-primary)]">
                Gemini 3.8 Flash Multimodal OCR Review Studio
              </span>
              <span className="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded-full border border-[var(--color-ink-primary)] bg-[var(--color-paper-light)] text-[var(--color-ink-primary)]">
                Active
              </span>
            </div>
            <p className="text-xs font-medium text-[var(--color-ink-secondary)]">
              Inspect original document side-by-side with extracted line items. Review and edit values before confirming.
            </p>
          </div>
        </div>

        {/* Confidence Stats */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
              Overall Confidence
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-extrabold font-mono text-[var(--color-ink-primary)]">
                {overallConfidencePct}%
              </span>
              {overallConfidencePct >= 85 ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              )}
            </div>
          </div>

          {lowConfidenceCount > 0 ? (
            <div className="px-3 py-1.5 rounded-xl border border-amber-400 bg-amber-50 text-amber-900 text-xs font-bold flex items-center gap-1.5 shadow-sm">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{lowConfidenceCount} item{lowConfidenceCount > 1 ? "s" : ""} need review</span>
            </div>
          ) : (
            <div className="px-3 py-1.5 rounded-xl border border-emerald-400 bg-emerald-50 text-emerald-900 text-xs font-bold flex items-center gap-1.5 shadow-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>All items high certainty</span>
            </div>
          )}

          {onDiscard && (
            <button
              type="button"
              onClick={onDiscard}
              className="text-xs font-bold text-[var(--color-ink-secondary)] hover:text-[var(--color-brand-crimson)] underline decoration-dotted ml-2"
            >
              Discard
            </button>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="p-3.5 rounded-xl border border-[var(--color-brand-crimson)] bg-[#FDF0F3] text-xs font-bold text-[var(--color-brand-crimson)] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Split-Screen Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Interactive Zoomable Image Viewer (lg: 5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-3 lg:sticky lg:top-6">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)] flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" />
              <span>Source Document</span>
            </span>
            <span className="text-[11px] font-mono text-[var(--color-ink-faint)] truncate max-w-[200px]">
              {storageFilePath ? storageFilePath.split("/").pop() : "uploaded_receipt.jpg"}
            </span>
          </div>

          <ZoomableImageViewer src={imagePreviewUrl} alt="Uploaded order document" />
        </div>

        {/* Right Column: Editable Verified Order Form (lg: 7 cols) */}
        <form onSubmit={handleSubmitOrder} className="lg:col-span-7 flex flex-col gap-6">
          {/* Customer Details Card */}
          <Card className="p-5 border-2 border-[var(--color-ink-primary)] shadow-[0_4px_0_#1E1218] flex flex-col gap-4">
            <div className="flex items-center gap-2 border-b border-[var(--color-paper-stone)] pb-3">
              <User className="w-4 h-4 text-[var(--color-ink-secondary)]" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-ink-primary)]">
                Customer Snapshot
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-[var(--color-ink-primary)]">
                  Customer Name <span className="text-[var(--color-brand-crimson)]">*</span>
                </label>
                <Input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Sarah Jenkins"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-[var(--color-ink-primary)]">
                  Phone Number
                </label>
                <Input
                  type="text"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="e.g. +1 555 0192 or +254 700 123456"
                />
              </div>

              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-xs font-bold text-[var(--color-ink-primary)]">
                  Email Address
                </label>
                <Input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="e.g. customer@example.com"
                />
              </div>

              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-xs font-bold text-[var(--color-ink-primary)]">
                  Delivery Address / Location
                </label>
                <Input
                  type="text"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  placeholder="e.g. 742 Evergreen Terrace, Springfield or Kilimani, Nairobi"
                />
              </div>

              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-xs font-bold text-[var(--color-ink-primary)]">
                  Agreed Fulfillment Terms &amp; Delivery Notes
                </label>
                <Input
                  type="text"
                  value={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.value)}
                  placeholder="e.g. Deliver between 2-4 PM; fragile glass item"
                />
              </div>
            </div>
          </Card>

          {/* Payment & Currency Configuration Card */}
          <Card className="p-5 border-2 border-[var(--color-ink-primary)] shadow-[0_4px_0_#1E1218] flex flex-col gap-4">
            <div className="flex items-center gap-2 border-b border-[var(--color-paper-stone)] pb-3">
              <DollarSign className="w-4 h-4 text-[var(--color-ink-secondary)]" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-ink-primary)]">
                Payment &amp; Currency
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-[var(--color-ink-primary)]">
                  Currency
                </label>
                <select
                  value={currency}
                  onChange={(e) => handleCurrencyChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-light)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-coral)]"
                >
                  <option value="USD">USD ($) — PayPal Supported</option>
                  <option value="KES">KES (Ksh) — Cash on Delivery</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-[var(--color-ink-primary)]">
                  Payment Method
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-light)] text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-coral)]"
                >
                  {currency === "USD" ? (
                    <>
                      <option value="PAYPAL">PayPal Orders v2 Checkout</option>
                      <option value="CASH_ON_DELIVERY">Cash on Delivery</option>
                    </>
                  ) : (
                    <option value="CASH_ON_DELIVERY">Cash on Delivery (KES default)</option>
                  )}
                </select>
              </div>
            </div>
          </Card>

          {/* Extracted Line Items Card */}
          <Card className="p-5 border-2 border-[var(--color-ink-primary)] shadow-[0_4px_0_#1E1218] flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-[var(--color-paper-stone)] pb-3">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-[var(--color-ink-secondary)]" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-ink-primary)]">
                  Extracted Line Items ({items.length})
                </h2>
              </div>
              <button
                type="button"
                onClick={addItem}
                className="text-xs font-bold text-[var(--color-brand-crimson)] hover:underline flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item</span>
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {items.map((item, index) => {
                let itemTotalCents = 0;
                try {
                  const p = item.unitPrice ? parseToCents(item.unitPrice) : 0;
                  itemTotalCents = calculateLineTotal(p, item.quantity);
                } catch {
                  // Ignore during typing
                }

                return (
                  <div
                    key={item.id}
                    className={`p-3.5 rounded-xl border-2 transition-all flex flex-col gap-3 ${
                      item.needsReview
                        ? "border-amber-400 bg-amber-50/70"
                        : "border-[var(--color-paper-stone)] bg-[var(--color-paper-light)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold px-2 py-0.5 rounded border border-[var(--color-ink-primary)] bg-[var(--color-paper-card)] text-[var(--color-ink-primary)]">
                          #{index + 1}
                        </span>
                        {item.needsReview ? (
                          <span className="text-[10px] font-bold text-amber-800 bg-amber-200/80 px-2 py-0.5 rounded-full flex items-center gap-1 border border-amber-300">
                            <AlertTriangle className="w-3 h-3 text-amber-700 shrink-0" />
                            <span>Needs Verification: {item.uncertaintyReason || "Faint handwriting"}</span>
                          </span>
                        ) : item.userEdited ? (
                          <span className="text-[10px] font-bold text-blue-800 bg-blue-100 px-2 py-0.5 rounded-full border border-blue-200">
                            Edited by merchant
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>Gemini Verified ({Math.round(item.confidenceScore * 100)}%)</span>
                          </span>
                        )}
                      </div>

                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="text-stone-400 hover:text-[var(--color-brand-crimson)] p-1 rounded"
                          title="Remove item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-12 gap-3 items-center">
                      <div className="col-span-12 sm:col-span-6 flex flex-col gap-1">
                        <label className="text-[11px] font-bold text-[var(--color-ink-secondary)]">
                          Product Name <span className="text-[var(--color-brand-crimson)]">*</span>
                        </label>
                        <Input
                          type="text"
                          value={item.productName}
                          onChange={(e) => updateItem(item.id, "productName", e.target.value)}
                          placeholder="e.g. Leather Handbag"
                          required
                        />
                      </div>

                      <div className="col-span-6 sm:col-span-2 flex flex-col gap-1">
                        <label className="text-[11px] font-bold text-[var(--color-ink-secondary)]">
                          Qty
                        </label>
                        <Input
                          type="number"
                          min="1"
                          max="10000"
                          value={item.quantity}
                          onChange={(e) => updateItem(item.id, "quantity", e.target.value)}
                          required
                        />
                      </div>

                      <div className="col-span-6 sm:col-span-2 flex flex-col gap-1">
                        <label className="text-[11px] font-bold text-[var(--color-ink-secondary)]">
                          Price ({currency})
                        </label>
                        <Input
                          type="text"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(item.id, "unitPrice", e.target.value)}
                          placeholder="0.00"
                          required
                        />
                      </div>

                      <div className="col-span-12 sm:col-span-2 flex flex-col items-end justify-center pt-2 sm:pt-4">
                        <span className="text-[10px] uppercase font-bold text-[var(--color-ink-faint)]">
                          Line Total
                        </span>
                        <span className="text-sm font-extrabold font-mono text-[var(--color-ink-primary)]">
                          {formatMoney(itemTotalCents, currency)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Delivery Fee & Totals Breakdown */}
            <div className="mt-2 pt-4 border-t-2 border-[var(--color-paper-stone)] flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-[var(--color-ink-secondary)] font-medium">
                <span>Items Subtotal:</span>
                <span className="font-mono font-bold text-[var(--color-ink-primary)]">
                  {formatMoney(subtotalCents, currency)}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs text-[var(--color-ink-secondary)] font-medium">
                <span className="flex items-center gap-1">Delivery / Shipping Fee:</span>
                <div className="w-24">
                  <Input
                    type="text"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(e.target.value)}
                    placeholder="0.00"
                    className="text-right py-1 px-2 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-[var(--color-paper-stone)] flex items-center justify-between">
                <span className="text-base font-extrabold text-[var(--color-ink-primary)]">
                  Grand Total:
                </span>
                <span className="text-xl font-extrabold font-mono text-[var(--color-brand-crimson)]">
                  {formatMoney(grandTotalCents, currency)}
                </span>
              </div>
            </div>
          </Card>

          {/* Form Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
            {onDiscard && (
              <Button
                type="button"
                variant="outline"
                onClick={onDiscard}
                className="w-full sm:w-auto text-xs"
              >
                Cancel &amp; Re-upload
              </Button>
            )}

            <Button
              type="submit"
              disabled={isPending}
              className="w-full sm:w-auto flex items-center justify-center gap-2 py-3 px-6 shadow-[0_4px_0_#1E1218] bg-[var(--color-brand-gold)] text-[var(--color-ink-primary)] font-extrabold text-sm hover:brightness-105"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Recording Verified Order...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-[var(--color-brand-crimson)]" />
                  <span>Confirm Order &amp; Generate Trust Receipt</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
