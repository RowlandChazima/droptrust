"use client";

import React, { useState, useTransition } from "react";
import {
  Copy,
  Check,
  ArrowRight,
  Loader2,
  Share2,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { updateFulfillmentStatus } from "@/lib/actions/orders";
import { Button } from "@/components/ui/Button";

// Next valid status mapping according to the database state machine
const NEXT_STATUS_MAP = {
  DRAFT: "CONFIRMED",
  CONFIRMED: "PROCESSING",
  PROCESSING: "READY",
  READY: "DISPATCHED",
  DISPATCHED: "DELIVERED",
};

export function OrderDetailClient({ order }) {
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState("");

  const publicUrl = typeof window !== "undefined"
    ? `${window.location.origin}/r/${order.public_token}`
    : `/r/${order.public_token}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const nextStatus = NEXT_STATUS_MAP[order.fulfillment_status];

  const handleAdvanceStatus = () => {
    if (!nextStatus) return;
    setErrorMsg("");

    startTransition(async () => {
      const res = await updateFulfillmentStatus(order.id, nextStatus);
      if (!res.success) {
        setErrorMsg(res.error || "Failed to advance order status.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {errorMsg && (
        <div className="p-3 rounded-xl border border-[var(--color-brand-crimson)] bg-[#FDF0F3] text-xs text-[var(--color-brand-crimson)] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Shareable Receipt Link Card */}
      <div className="p-4 rounded-xl border-2 border-[var(--color-ink-primary)] bg-[var(--color-brand-gold)] shadow-[0_3px_0_#1E1218] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[var(--color-paper-card)] border border-[var(--color-ink-primary)] flex items-center justify-center shrink-0">
            <Share2 className="w-4 h-4 text-[var(--color-ink-primary)]" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-[var(--color-ink-primary)]">
              Customer Trust Receipt Link
            </span>
            <span className="text-[11px] font-mono text-[var(--color-ink-secondary)] truncate max-w-xs sm:max-w-md">
              /r/{order.public_token}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyLink}
            className="flex-1 sm:flex-none text-xs flex items-center justify-center gap-1.5 py-1.5 px-3 bg-white"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-700" />
                <span className="text-green-800 font-bold">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Link</span>
              </>
            )}
          </Button>

          <a
            href={`/r/${order.public_token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg border-2 border-[var(--color-ink-primary)] bg-white text-[var(--color-ink-primary)] hover:bg-[var(--color-paper-light)] transition-colors"
            title="Preview Customer Receipt (Milestone 3)"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Fulfillment Status Advance Action */}
      {nextStatus && (
        <div className="flex items-center justify-between p-3.5 rounded-xl border-2 border-[var(--color-paper-stone)] bg-[var(--color-paper-light)]">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-secondary)]">
              Next Stage in Lifecycle
            </span>
            <span className="text-xs font-bold text-[var(--color-ink-primary)]">
              Move to &ldquo;{nextStatus}&rdquo;
            </span>
          </div>

          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={handleAdvanceStatus}
            className="text-xs flex items-center gap-1.5 py-1.5 px-3"
          >
            {isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <span>Mark as {nextStatus}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
