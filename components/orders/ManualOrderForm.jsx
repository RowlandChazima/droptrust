"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  AlertCircle,
  Loader2,
  ShieldCheck,
  DollarSign,
  Package,
  User,
  FileText,
} from "lucide-react";
import { createManualOrder } from "@/lib/actions/orders";
import { parseToCents, formatMoney, calculateLineTotal } from "@/lib/money";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export function ManualOrderForm({ defaultCurrency = "KES" }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");

  // Order Details State
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [agreedTerms, setAgreedTerms] = useState("");

  // Payment & Currency
  const [currency, setCurrency] = useState(defaultCurrency);
  const [paymentMethod, setPaymentMethod] = useState(
    defaultCurrency === "USD" ? "PAYPAL" : "CASH_ON_DELIVERY"
  );
  const [deliveryFee, setDeliveryFee] = useState("0");

  // Dynamic Line Items State
  const [items, setItems] = useState([
    {
      id: "item-1",
      productName: "",
      variantName: "",
      quantity: 1,
      unitPrice: "",
    },
  ]);

  // Handle Currency change: PayPal is only allowed for USD
  const handleCurrencyChange = (newCurr) => {
    setCurrency(newCurr);
    if (newCurr !== "USD" && paymentMethod === "PAYPAL") {
      setPaymentMethod("CASH_ON_DELIVERY");
    }
  };

  // Item List Modifiers
  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        productName: "",
        variantName: "",
        quantity: 1,
        unitPrice: "",
      },
    ]);
  };

  const removeItem = (id) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const updateItem = (id, field, value) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
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

  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMessage("");

    // Basic client validation
    if (!customerName.trim()) {
      setErrorMessage("Please enter customer name.");
      return;
    }

    if (items.some((item) => !item.productName.trim())) {
      setErrorMessage("All line items must have a product name.");
      return;
    }

    if (
      items.some((item) => {
        try {
          const c = parseToCents(item.unitPrice);
          return c < 0;
        } catch {
          return true;
        }
      })
    ) {
      setErrorMessage("Please provide valid, non-negative unit prices for all items.");
      return;
    }

    startTransition(async () => {
      const payload = {
        customerName,
        customerPhone: customerPhone || null,
        customerEmail: customerEmail || null,
        customerAddress: customerAddress || null,
        agreedTerms: agreedTerms || null,
        paymentMethod,
        currency,
        deliveryFee: deliveryFee || "0",
        items: items.map((item) => ({
          productName: item.productName.trim(),
          variantName: item.variantName ? item.variantName.trim() : null,
          quantity: Number(item.quantity) || 1,
          unitPrice: item.unitPrice,
        })),
      };

      const result = await createManualOrder(payload);

      if (!result.success) {
        setErrorMessage(result.error || "Failed to create order.");
        return;
      }

      router.push(`/orders/${result.orderId}`);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      {errorMessage && (
        <Card className="border-2 border-[var(--color-brand-crimson)] bg-[#FDF0F3] p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-[var(--color-brand-crimson)] shrink-0 mt-0.5" />
          <div className="flex flex-col">
            <span className="font-bold text-sm text-[var(--color-brand-crimson)]">
              Order Validation Error
            </span>
            <span className="text-xs text-[var(--color-ink-primary)]">{errorMessage}</span>
          </div>
        </Card>
      )}

      {/* Grid: Left Column Customer & Items, Right Column Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column (2 Cols) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* 1. Customer Information Card */}
          <Card className="flex flex-col gap-5 p-6">
            <div className="flex items-center gap-2 border-b-2 border-[var(--color-paper-stone)] pb-3">
              <User className="w-5 h-5 text-[var(--color-brand-crimson)]" />
              <h2 className="font-bold text-base text-[var(--color-ink-primary)]">
                Customer Details
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Customer Full Name *"
                placeholder="e.g. Mary Wanjiku"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
              />
              <Input
                label="Phone Number"
                placeholder="e.g. +254 712 345 678"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Email Address (Optional)"
                type="email"
                placeholder="customer@example.com"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
              <Input
                label="Delivery Address / Neighborhood"
                placeholder="e.g. Nairobi, Kilimani, Apt 4B"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)] flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Agreed Terms or Delivery Notes
              </label>
              <textarea
                rows={2}
                placeholder="e.g. Pay on delivery via M-Pesa. Customer to inspect packaging before collection."
                value={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border-2 border-[var(--color-paper-stone)] bg-[var(--color-paper-card)] text-sm text-[var(--color-ink-primary)] focus:outline-none focus:border-[var(--color-ink-primary)] transition-colors placeholder:text-[var(--color-ink-secondary)]/60"
              />
            </div>
          </Card>

          {/* 2. Order Line Items Card */}
          <Card className="flex flex-col gap-5 p-6">
            <div className="flex items-center justify-between border-b-2 border-[var(--color-paper-stone)] pb-3">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-[var(--color-brand-crimson)]" />
                <h2 className="font-bold text-base text-[var(--color-ink-primary)]">
                  Order Line Items
                </h2>
              </div>
              <span className="text-xs font-mono font-bold text-[var(--color-ink-secondary)]">
                {items.length} {items.length === 1 ? "Item" : "Items"}
              </span>
            </div>

            {/* Line Items List */}
            <div className="flex flex-col gap-3">
              {items.map((item, index) => {
                let lineTotalStr = "0.00";
                try {
                  const p = item.unitPrice ? parseToCents(item.unitPrice) : 0;
                  lineTotalStr = formatMoney(calculateLineTotal(p, item.quantity), currency);
                } catch {
                  lineTotalStr = "—";
                }

                return (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl border-2 border-[var(--color-paper-stone)] bg-[var(--color-paper-light)] flex flex-col sm:flex-row items-stretch sm:items-end gap-3 transition-colors hover:border-[var(--color-paper-stone)]"
                  >
                    <div className="flex-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-secondary)] block mb-1">
                        Item #{index + 1} Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Leather Crossbody Bag"
                        value={item.productName}
                        onChange={(e) => updateItem(item.id, "productName", e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border-2 border-[var(--color-paper-stone)] bg-[var(--color-paper-card)] text-sm font-medium text-[var(--color-ink-primary)] focus:outline-none focus:border-[var(--color-ink-primary)]"
                      />
                    </div>

                    <div className="w-full sm:w-28">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-secondary)] block mb-1">
                        Variant
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Brown"
                        value={item.variantName}
                        onChange={(e) => updateItem(item.id, "variantName", e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border-2 border-[var(--color-paper-stone)] bg-[var(--color-paper-card)] text-sm font-medium text-[var(--color-ink-primary)] focus:outline-none focus:border-[var(--color-ink-primary)]"
                      />
                    </div>

                    <div className="w-24">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-secondary)] block mb-1">
                        Qty
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="10000"
                        required
                        value={item.quantity}
                        onChange={(e) => updateItem(item.id, "quantity", e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border-2 border-[var(--color-paper-stone)] bg-[var(--color-paper-card)] text-sm font-bold text-center text-[var(--color-ink-primary)] focus:outline-none focus:border-[var(--color-ink-primary)]"
                      />
                    </div>

                    <div className="w-32">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-secondary)] block mb-1">
                        Unit Price ({currency}) *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="0.00"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(item.id, "unitPrice", e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border-2 border-[var(--color-paper-stone)] bg-[var(--color-paper-card)] text-sm font-mono font-bold text-[var(--color-ink-primary)] focus:outline-none focus:border-[var(--color-ink-primary)]"
                      />
                    </div>

                    <div className="flex sm:flex-col items-center justify-between sm:justify-end gap-2 pb-1">
                      <span className="text-xs font-mono font-bold text-[var(--color-ink-primary)] sm:text-right w-24">
                        {lineTotalStr}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        disabled={items.length <= 1}
                        title="Remove Item"
                        className="p-1.5 text-[var(--color-ink-secondary)] hover:text-[var(--color-brand-crimson)] disabled:opacity-20 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={addItem}
              className="py-2 text-xs self-start flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Another Item</span>
            </Button>
          </Card>
        </div>

        {/* Right Column: Pricing & Payment Summary */}
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-5 p-6 sticky top-24">
            <div className="flex items-center gap-2 border-b-2 border-[var(--color-paper-stone)] pb-3">
              <DollarSign className="w-5 h-5 text-[var(--color-brand-crimson)]" />
              <h2 className="font-bold text-base text-[var(--color-ink-primary)]">
                Financials &amp; Terms
              </h2>
            </div>

            {/* Currency Selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
                Order Currency
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleCurrencyChange("KES")}
                  className={`py-2 px-3 rounded-xl border-2 text-xs font-bold transition-all ${
                    currency === "KES"
                      ? "border-[var(--color-ink-primary)] bg-[var(--color-brand-gold)] shadow-[0_2px_0_#1E1218] text-[var(--color-ink-primary)]"
                      : "border-[var(--color-paper-stone)] bg-[var(--color-paper-light)] text-[var(--color-ink-secondary)]"
                  }`}
                >
                  KES (Kenyan Shilling)
                </button>
                <button
                  type="button"
                  onClick={() => handleCurrencyChange("USD")}
                  className={`py-2 px-3 rounded-xl border-2 text-xs font-bold transition-all ${
                    currency === "USD"
                      ? "border-[var(--color-ink-primary)] bg-[var(--color-brand-gold)] shadow-[0_2px_0_#1E1218] text-[var(--color-ink-primary)]"
                      : "border-[var(--color-paper-stone)] bg-[var(--color-paper-light)] text-[var(--color-ink-secondary)]"
                  }`}
                >
                  USD (US Dollar)
                </button>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
                Intended Payment Method
              </label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl border-2 border-[var(--color-paper-stone)] cursor-pointer hover:bg-[var(--color-paper-light)]">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="CASH_ON_DELIVERY"
                    checked={paymentMethod === "CASH_ON_DELIVERY"}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="accent-[var(--color-brand-crimson)]"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-[var(--color-ink-primary)]">
                      Cash on Delivery / Direct
                    </span>
                    <span className="text-[11px] text-[var(--color-ink-secondary)]">
                      Buyer pays upon physical handover or merchant record.
                    </span>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-2.5 p-2.5 rounded-xl border-2 transition-opacity ${
                    currency === "USD"
                      ? "border-[var(--color-paper-stone)] cursor-pointer hover:bg-[var(--color-paper-light)]"
                      : "border-[var(--color-paper-stone)] opacity-50 cursor-not-allowed bg-stone-100"
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="PAYPAL"
                    disabled={currency !== "USD"}
                    checked={paymentMethod === "PAYPAL"}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="accent-[var(--color-brand-crimson)] mt-0.5"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-[var(--color-ink-primary)]">
                      PayPal Checkout (USD)
                    </span>
                    <span className="text-[11px] text-[var(--color-ink-secondary)]">
                      {currency === "USD"
                        ? "Generates an online digital PayPal payment link."
                        : "PayPal REST API requires USD pricing. Switch currency to USD to enable."}
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Delivery Fee Input */}
            <Input
              label={`Delivery / Dispatch Fee (${currency})`}
              placeholder="0.00"
              value={deliveryFee}
              onChange={(e) => setDeliveryFee(e.target.value)}
            />

            {/* Totals Breakdown */}
            <div className="p-4 rounded-xl bg-[var(--color-paper-light)] border-2 border-[var(--color-paper-stone)] flex flex-col gap-2.5 text-xs">
              <div className="flex justify-between items-center text-[var(--color-ink-secondary)]">
                <span>Items Subtotal</span>
                <span className="font-mono font-bold text-[var(--color-ink-primary)]">
                  {formatMoney(subtotalCents, currency)}
                </span>
              </div>
              <div className="flex justify-between items-center text-[var(--color-ink-secondary)]">
                <span>Delivery Fee</span>
                <span className="font-mono font-bold text-[var(--color-ink-primary)]">
                  {formatMoney(deliveryFeeCents, currency)}
                </span>
              </div>
              <div className="border-t-2 border-[var(--color-paper-stone)] pt-2 flex justify-between items-center">
                <span className="font-bold text-sm text-[var(--color-ink-primary)]">
                  Grand Total
                </span>
                <span className="font-mono font-extrabold text-base text-[var(--color-brand-crimson)]">
                  {formatMoney(grandTotalCents, currency)}
                </span>
              </div>
            </div>

            {/* Submit Action */}
            <Button
              type="submit"
              disabled={isPending || grandTotalCents <= 0}
              className="w-full py-3 flex items-center justify-center gap-2 text-sm shadow-[0_4px_0_#1E1218]"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Recording Order...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Create &amp; Confirm Order</span>
                </>
              )}
            </Button>

            <span className="text-[11px] text-center text-[var(--color-ink-secondary)]">
              Stores immutable customer snapshot and generates a unique tamper-proof Trust Receipt.
            </span>
          </Card>
        </div>
      </div>
    </form>
  );
}
