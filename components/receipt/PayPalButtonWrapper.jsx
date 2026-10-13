"use client";

import React, { useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, ShieldCheck, CreditCard } from "lucide-react";
import { formatMoney } from "@/lib/money";

export function PayPalButtonWrapper({
  token,
  totalCents,
  currency,
  orderReference,
  onPaymentSuccess,
}) {
  const containerRef = useRef(null);
  const [loadingScript, setLoadingScript] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

  useEffect(() => {
    if (!clientId) {
      setLoadingScript(false);
      return;
    }

    let isMounted = true;
    const scriptId = "paypal-sdk-script";

    const loadButtons = () => {
      if (!window.paypal || !containerRef.current || !isMounted) return;

      // Clear previous buttons if re-rendering
      containerRef.current.innerHTML = "";

      try {
        window.paypal
          .Buttons({
            style: {
              layout: "vertical",
              color: "gold",
              shape: "rect",
              label: "paypal",
              height: 42,
            },
            createOrder: async () => {
              setErrorMessage("");
              const res = await fetch(`/api/public/receipt/${token}/paypal/create`, {
                method: "POST",
              });
              const data = await res.json();
              if (!res.ok) {
                const msg = data.error || "Failed to initiate PayPal checkout";
                setErrorMessage(msg);
                throw new Error(msg);
              }
              return data.paypalOrderId;
            },
            onApprove: async (data) => {
              setIsProcessing(true);
              setErrorMessage("");
              try {
                const res = await fetch(`/api/public/receipt/${token}/paypal/capture`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ paypalOrderId: data.orderID }),
                });
                const result = await res.json();
                if (!res.ok) {
                  throw new Error(result.error || "Failed to finalize PayPal capture");
                }
                if (onPaymentSuccess) {
                  onPaymentSuccess(result);
                } else if (typeof window !== "undefined") {
                  window.location.reload();
                }
              } catch (err) {
                console.error("[PayPal SDK] onApprove error:", err);
                setErrorMessage(err.message || "Payment verification failed. Please contact the seller.");
              } finally {
                setIsProcessing(false);
              }
            },
            onError: (err) => {
              console.error("[PayPal SDK] onError:", err);
              setErrorMessage("PayPal checkout encountered an error. Please try again.");
              setIsProcessing(false);
            },
            onCancel: () => {
              setIsProcessing(false);
            },
          })
          .render(containerRef.current)
          .then(() => {
            if (isMounted) setLoadingScript(false);
          })
          .catch((err) => {
            console.error("[PayPal SDK] Render error:", err);
            if (isMounted) {
              setErrorMessage("Could not load PayPal buttons.");
              setLoadingScript(false);
            }
          });
      } catch (err) {
        console.error("[PayPal SDK] Initialization error:", err);
        if (isMounted) {
          setErrorMessage(err.message || "Could not initialize PayPal buttons");
          setLoadingScript(false);
        }
      }
    };

    if (window.paypal) {
      loadButtons();
      return () => {
        isMounted = false;
      };
    }

    let script = document.getElementById(scriptId);
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD&intent=capture`;
      script.async = true;
      script.onload = () => {
        if (isMounted) loadButtons();
      };
      script.onerror = () => {
        if (isMounted) {
          setErrorMessage("Failed to load PayPal payment SDK. Please refresh or try again.");
          setLoadingScript(false);
        }
      };
      document.body.appendChild(script);
    } else {
      script.addEventListener("load", loadButtons);
    }

    return () => {
      isMounted = false;
    };
  }, [clientId, token, onPaymentSuccess]);

  if (!clientId) {
    return (
      <div className="p-4 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 text-xs text-amber-900 flex flex-col gap-2">
        <div className="flex items-center gap-2 font-bold">
          <CreditCard className="w-4 h-4 text-amber-700" />
          <span>PayPal Sandbox Checkout Available</span>
        </div>
        <p className="text-[11px] text-amber-800 leading-relaxed">
          To complete payment via PayPal Sandbox, add your sandbox Client ID to{" "}
          <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[10px]">
            NEXT_PUBLIC_PAYPAL_CLIENT_ID
          </code>{" "}
          in your environment.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-3">
      {errorMessage && (
        <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {isProcessing && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-center justify-center gap-2 font-bold">
          <Loader2 className="w-4 h-4 animate-spin text-amber-700" />
          <span>Verifying payment with PayPal and securing cryptographic receipt...</span>
        </div>
      )}

      {loadingScript && !isProcessing && (
        <div className="py-6 flex flex-col items-center justify-center gap-2 text-xs text-[var(--color-ink-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--color-brand-crimson)]" />
          <span>Loading secure PayPal checkout...</span>
        </div>
      )}

      <div
        ref={containerRef}
        className={`w-full transition-opacity ${loadingScript || isProcessing ? "opacity-30 pointer-events-none" : "opacity-100"}`}
      />

      <div className="flex items-center justify-center gap-1.5 text-[10px] text-[var(--color-ink-secondary)]">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
        <span>256-bit encrypted checkout &bull; Protected by DropTrust ledger audit</span>
      </div>
    </div>
  );
}
