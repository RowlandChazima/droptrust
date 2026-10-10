"use client";

import React, { useActionState } from "react";
import Link from "next/link";
import { signupAction } from "@/app/auth/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { UserPlus, AlertCircle, CheckCircle2 } from "lucide-react";

export default function SignupPage() {
  const [state, formAction, isPending] = useActionState(signupAction, null);

  return (
    <Card className="flex flex-col gap-6">
      {/* Title & Description */}
      <div className="flex flex-col gap-1 text-center sm:text-left">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--color-ink-primary)]">
          Register Merchant
        </h1>
        <p className="text-sm font-medium text-[var(--color-ink-secondary)]">
          Set up your DropTrust store ledger and start capturing orders.
        </p>
      </div>

      {/* Success Notification */}
      {state?.success && (
        <div
          role="status"
          className="p-3.5 rounded-xl border-2 border-[var(--color-status-confirmed-border)] bg-[var(--color-status-confirmed-bg)] text-[var(--color-status-confirmed-text)] text-xs font-semibold flex items-start gap-2.5 shadow-[0_2px_0_#9FD1AB]"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex flex-col">
            <span className="font-bold">Registration Successful</span>
            <span>{state.message}</span>
            <Link
              href="/login"
              className="mt-2 font-bold underline underline-offset-2 hover:opacity-80"
            >
              Proceed to Sign In &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {state?.error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl border-2 border-[var(--color-brand-crimson)] bg-[#FDF0F3] text-[var(--color-brand-crimson)] text-xs font-semibold flex items-start gap-2.5 shadow-[0_2px_0_#9A1436]"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex flex-col">
            <span className="font-bold">Registration error</span>
            <span>{state.error}</span>
          </div>
        </div>
      )}

      {/* Signup Form */}
      {!state?.success && (
        <form action={formAction} className="flex flex-col gap-4">
          <Input
            id="businessName"
            name="businessName"
            type="text"
            label="Business / Store Name"
            placeholder="e.g. Nairobi Crafts, Mama Grace Organics"
            required
            autoComplete="organization"
            disabled={isPending}
            error={state?.fieldErrors?.businessName?.[0]}
          />

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
            placeholder="At least 6 characters"
            required
            autoComplete="new-password"
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
              <UserPlus className="w-4 h-4" />
              <span>Create Merchant Account</span>
            </Button>
          </div>
        </form>
      )}

      {/* Switch to Login */}
      <div className="border-t-2 border-[var(--color-paper-stone)] pt-4 text-center">
        <p className="text-xs font-medium text-[var(--color-ink-secondary)]">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-bold text-[var(--color-ink-primary)] underline decoration-2 underline-offset-4 hover:text-[var(--color-brand-crimson)] transition-colors"
          >
            Sign in to existing store
          </Link>
        </p>
      </div>
    </Card>
  );
}
