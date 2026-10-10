"use client";

import React, { useActionState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { loginAction } from "@/app/auth/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { LogIn, AlertCircle } from "lucide-react";

function LoginForm() {
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const [state, formAction, isPending] = useActionState(loginAction, null);

  const displayError = state?.error || urlError;

  return (
    <Card className="flex flex-col gap-6">
      {/* Title & Description */}
      <div className="flex flex-col gap-1 text-center sm:text-left">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--color-ink-primary)]">
          Merchant Sign In
        </h1>
        <p className="text-sm font-medium text-[var(--color-ink-secondary)]">
          Access your DropTrust order ledger and verify transactions.
        </p>
      </div>

      {/* Error Alert */}
      {displayError && (
        <div
          role="alert"
          className="p-3.5 rounded-xl border-2 border-[var(--color-brand-crimson)] bg-[#FDF0F3] text-[var(--color-brand-crimson)] text-xs font-semibold flex items-start gap-2.5 shadow-[0_2px_0_#9A1436]"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex flex-col">
            <span className="font-bold">Authentication failed</span>
            <span>{displayError}</span>
          </div>
        </div>
      )}

      {/* Login Form */}
      <form action={formAction} className="flex flex-col gap-4">
        <Input
          id="email"
          name="email"
          type="email"
          label="Merchant Email"
          placeholder="merchant@example.com"
          required
          autoComplete="email"
          disabled={isPending}
          error={state?.fieldErrors?.email?.[0]}
        />

        <Input
          id="password"
          name="password"
          type="password"
          label="Password"
          placeholder="••••••••"
          required
          autoComplete="current-password"
          disabled={isPending}
          error={state?.fieldErrors?.password?.[0]}
        />

        <div className="pt-2">
          <Button
            type="submit"
            variant="gold"
            loading={isPending}
            disabled={isPending}
            className="w-full flex items-center justify-center gap-2 py-3"
          >
            <LogIn className="w-4 h-4" />
            <span>Sign In</span>
          </Button>
        </div>
      </form>

      {/* Switch to Signup */}
      <div className="border-t-2 border-[var(--color-paper-stone)] pt-4 text-center">
        <p className="text-xs font-medium text-[var(--color-ink-secondary)]">
          Don&apos;t have a merchant account?{" "}
          <Link
            href="/signup"
            className="font-bold text-[var(--color-ink-primary)] underline decoration-2 underline-offset-4 hover:text-[var(--color-brand-crimson)] transition-colors"
          >
            Register your store
          </Link>
        </p>
      </div>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <Card className="flex items-center justify-center p-12 text-sm font-bold text-[var(--color-ink-secondary)]">
          Loading sign in...
        </Card>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
