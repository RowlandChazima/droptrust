import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Navbar } from "@/components/layout/Navbar";
import { ManualOrderForm } from "@/components/orders/ManualOrderForm";
import { PlusCircle, Loader2 } from "lucide-react";

export const metadata = {
  title: "New Order — DropTrust Capture",
  description: "Capture verified manual orders with line items, frozen snapshots, and trust receipts.",
};

async function NewOrderContent() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("name, currency")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 flex flex-col gap-8">
      {/* Page Header */}
      <div className="flex flex-col gap-1 border-b-2 border-[var(--color-paper-stone)] pb-5">
        <div className="flex items-center gap-2">
          <span className="p-1 rounded bg-[var(--color-brand-gold)] border border-[var(--color-ink-primary)] text-[var(--color-ink-primary)]">
            <PlusCircle className="w-4 h-4" />
          </span>
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
            Order Capture Studio
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--color-ink-primary)]">
          Create Manual Order
        </h1>
        <p className="text-sm font-medium text-[var(--color-ink-secondary)] max-w-2xl">
          Record customer commitments, calculate strict line totals, and generate an immutable Trust Receipt certificate.
        </p>
      </div>

      {/* Order Form */}
      <ManualOrderForm defaultCurrency={business?.currency || "KES"} />
    </main>
  );
}

function NewOrderFallback() {
  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-16 flex flex-col items-center justify-center gap-3 text-center">
      <Loader2 className="w-8 h-8 animate-spin text-[var(--color-brand-crimson)]" />
      <span className="text-sm font-bold text-[var(--color-ink-primary)]">
        Initializing order capture studio...
      </span>
    </main>
  );
}

export default function NewOrderPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-paper-light)] text-[var(--color-ink-primary)]">
      <Navbar activePath="/orders/new" />
      <Suspense fallback={<NewOrderFallback />}>
        <NewOrderContent />
      </Suspense>
      <footer className="border-t-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-card)] py-4 text-center text-xs font-medium text-[var(--color-ink-secondary)]">
        <p>DropTrust Capture &bull; Milestone 2: Manual Order Creation &amp; Strict Minor-Unit Math</p>
      </footer>
    </div>
  );
}
