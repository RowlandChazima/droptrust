import React, { Suspense } from "react";
import { getPublicReceipt } from "@/lib/receipts";
import { ReceiptCard } from "@/components/receipt/ReceiptCard";
import { Card } from "@/components/ui/Card";
import {
  ShieldCheck,
  AlertCircle,
  Ban,
  Clock,
  Loader2,
} from "lucide-react";

export async function generateMetadata() {
  return {
    title: "Trust Receipt — DropTrust",
    description: "Verifiable transaction receipt and order terms certificate.",
    robots: {
      index: false,
      follow: false,
    },
    referrer: "no-referrer",
  };
}

async function ReceiptContent({ params }) {
  const { token } = await params;
  const result = await getPublicReceipt(token);

  if (result.status === "ok") {
    return <ReceiptCard receipt={result.receipt} token={token} />;
  }

  if (result.status === "revoked") {
    return (
      <Card className="max-w-md w-full mx-auto p-8 text-center flex flex-col items-center gap-4 border-2 border-red-300 bg-red-50/50">
        <div className="w-12 h-12 rounded-full bg-red-100 border-2 border-red-300 flex items-center justify-center text-red-700">
          <Ban className="w-6 h-6" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-bold text-[var(--color-ink-primary)]">
            Receipt Link Revoked
          </h1>
          <p className="text-xs text-[var(--color-ink-secondary)] leading-relaxed">
            The merchant has revoked access to this digital receipt link. If you have questions about your order, please reach out to the seller directly.
          </p>
        </div>
      </Card>
    );
  }

  if (result.status === "unconfirmed") {
    return (
      <Card className="max-w-md w-full mx-auto p-8 text-center flex flex-col items-center gap-4 border-2 border-amber-300 bg-amber-50/50">
        <div className="w-12 h-12 rounded-full bg-amber-100 border-2 border-amber-300 flex items-center justify-center text-amber-700">
          <Clock className="w-6 h-6" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-bold text-[var(--color-ink-primary)]">
            Order Pending Confirmation
          </h1>
          <p className="text-xs text-[var(--color-ink-secondary)] leading-relaxed">
            This order is currently being drafted by the merchant and has not yet been confirmed into an active customer receipt.
          </p>
        </div>
      </Card>
    );
  }

  if (result.status === "error") {
    return (
      <Card className="max-w-md w-full mx-auto p-8 text-center flex flex-col items-center gap-4 border-2 border-[var(--color-brand-crimson)] bg-[#FDF0F3]">
        <div className="w-12 h-12 rounded-full bg-red-100 border-2 border-[var(--color-brand-crimson)] flex items-center justify-center text-[var(--color-brand-crimson)]">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-bold text-[var(--color-brand-crimson)]">
            Service Temporarily Unavailable
          </h1>
          <p className="text-xs text-[var(--color-ink-secondary)] leading-relaxed">
            We were unable to load the trust receipt at this time. Please refresh the page or try again shortly.
          </p>
        </div>
      </Card>
    );
  }

  // Fallback: not_found
  return (
    <Card className="max-w-md w-full mx-auto p-8 text-center flex flex-col items-center gap-4 border-2 border-[var(--color-paper-stone)] bg-[var(--color-paper-card)]">
      <div className="w-12 h-12 rounded-full bg-[var(--color-brand-gold)] border-2 border-[var(--color-ink-primary)] flex items-center justify-center shadow-[0_2px_0_#1E1218]">
        <ShieldCheck className="w-6 h-6 text-[var(--color-ink-primary)]" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-bold text-[var(--color-ink-primary)]">
          Receipt Not Found
        </h1>
        <p className="text-xs text-[var(--color-ink-secondary)] leading-relaxed">
          We could not find a verified trust receipt matching this link. Please check the URL you received or contact the merchant.
        </p>
      </div>
    </Card>
  );
}

function ReceiptFallback() {
  return (
    <div className="max-w-md w-full mx-auto p-12 text-center flex flex-col items-center justify-center gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-[var(--color-brand-crimson)]" />
      <span className="text-sm font-bold text-[var(--color-ink-primary)]">
        Verifying digital trust receipt...
      </span>
    </div>
  );
}

export default function PublicReceiptPage({ params }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-paper-light)] text-[var(--color-ink-primary)]">
      {/* Public Header */}
      <header className="border-b-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-card)] py-3 px-4 print:hidden">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[var(--color-brand-gold)] border border-[var(--color-ink-primary)] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-[var(--color-ink-primary)]" />
            </div>
            <span className="font-extrabold text-sm tracking-tight text-[var(--color-ink-primary)]">
              DropTrust
            </span>
          </div>

          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
            Verified Receipt
          </span>
        </div>
      </header>

      {/* Main Receipt Content */}
      <main className="flex-1 max-w-xl w-full mx-auto px-4 py-8 sm:py-12 flex flex-col items-center justify-center">
        <Suspense fallback={<ReceiptFallback />}>
          <ReceiptContent params={params} />
        </Suspense>
      </main>

      {/* Public Footer */}
      <footer className="border-t-2 border-[var(--color-paper-stone)] py-4 text-center text-[11px] text-[var(--color-ink-secondary)] print:hidden">
        <p>DropTrust Capture &bull; Cryptographically verified transaction certificates for small businesses</p>
      </footer>
    </div>
  );
}
