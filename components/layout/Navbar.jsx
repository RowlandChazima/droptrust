import React from "react";
import Link from "next/link";
import { ShieldCheck, Plus, ShoppingBag, LayoutDashboard, LogOut } from "lucide-react";
import { logoutAction } from "@/app/auth/actions";
import { Button } from "@/components/ui/Button";

export function Navbar({ businessName, activePath = "/" }) {
  return (
    <header className="border-b-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-card)] shadow-[0_2px_0_#1E1218] sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-full bg-[var(--color-brand-gold)] border-2 border-[var(--color-ink-primary)] flex items-center justify-center shadow-[0_2px_0_#1E1218] transition-transform group-hover:scale-105">
              <ShieldCheck className="w-6 h-6 text-[var(--color-ink-primary)]" />
            </div>
            <div>
              <span className="font-extrabold tracking-tight text-xl text-[var(--color-ink-primary)] leading-none block">
                DropTrust
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
                {businessName || "Merchant Portal"}
              </span>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1.5 ml-4">
            <Link
              href="/"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activePath === "/"
                  ? "bg-[var(--color-brand-gold)] text-[var(--color-ink-primary)] border border-[var(--color-ink-primary)] shadow-[0_1px_0_#1E1218]"
                  : "text-[var(--color-ink-secondary)] hover:text-[var(--color-ink-primary)] hover:bg-[var(--color-paper-stone)]"
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Dashboard</span>
            </Link>

            <Link
              href="/orders"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activePath === "/orders"
                  ? "bg-[var(--color-brand-gold)] text-[var(--color-ink-primary)] border border-[var(--color-ink-primary)] shadow-[0_1px_0_#1E1218]"
                  : "text-[var(--color-ink-secondary)] hover:text-[var(--color-ink-primary)] hover:bg-[var(--color-paper-stone)]"
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Orders</span>
            </Link>

            <Link
              href="/orders/new"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activePath === "/orders/new"
                  ? "bg-[var(--color-brand-gold)] text-[var(--color-ink-primary)] border border-[var(--color-ink-primary)] shadow-[0_1px_0_#1E1218]"
                  : "text-[var(--color-ink-secondary)] hover:text-[var(--color-ink-primary)] hover:bg-[var(--color-paper-stone)]"
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Order</span>
            </Link>
          </nav>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Link href="/orders/new" className="md:hidden">
            <Button size="sm" className="px-2.5 py-1 text-xs">
              <Plus className="w-4 h-4 mr-1" />
              <span>New</span>
            </Button>
          </Link>

          <form action={logoutAction}>
            <Button
              type="submit"
              variant="outline"
              className="py-1.5 px-3 text-xs flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
