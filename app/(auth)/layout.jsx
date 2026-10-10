import React from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/**
 * DropTrust Auth Layout (Design System v2)
 * Clean, warm cream canvas with central tactile parchment card and brand mark.
 */
export default function AuthLayout({ children }) {
  return (
    <div className="min-h-screen flex flex-col justify-between bg-[var(--color-paper-light)] text-[var(--color-ink-primary)] p-4 sm:p-6 md:p-8">
      {/* Brand Header */}
      <header className="max-w-md w-full mx-auto flex items-center justify-between py-4">
        <Link
          href="/"
          className="flex items-center gap-2 group focus:outline-none"
        >
          <div className="w-10 h-10 rounded-full bg-[var(--color-brand-gold)] border-2 border-[var(--color-ink-primary)] flex items-center justify-center shadow-[0_2px_0_#1E1218] transition-transform group-hover:scale-105">
            <ShieldCheck className="w-6 h-6 text-[var(--color-ink-primary)]" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold tracking-tight text-xl text-[var(--color-ink-primary)] leading-none">
              DropTrust
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
              Merchant Capture
            </span>
          </div>
        </Link>
      </header>

      {/* Main Form Container */}
      <main className="max-w-md w-full mx-auto my-auto py-8">
        {children}
      </main>

      {/* Footer Meta */}
      <footer className="max-w-md w-full mx-auto text-center py-4 text-xs font-medium text-[var(--color-ink-secondary)]">
        <p>DropTrust Capture &copy; 2026 &bull; Secure Micro-Merchant Verification</p>
      </footer>
    </div>
  );
}
