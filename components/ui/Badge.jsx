import React from "react";
import { CheckCircle2, AlertCircle, Clock } from "lucide-react";

/**
 * DropTrust Status Stamp Badge (Design System v2)
 * Pill shape with solid border and semantic coloring for transaction states.
 */
export function Badge({ status = "DRAFT", label, className = "" }) {
  const normalized = status.toUpperCase();

  const configs = {
    CONFIRMED: {
      bg: "bg-[var(--color-status-confirmed-bg)]",
      text: "text-[var(--color-status-confirmed-text)]",
      border: "border-[var(--color-status-confirmed-border)]",
      icon: <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />,
      defaultLabel: "CONFIRMED",
    },
    PAID: {
      bg: "bg-[var(--color-status-paid-bg)]",
      text: "text-[var(--color-status-paid-text)]",
      border: "border-[var(--color-status-paid-border)]",
      icon: <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />,
      defaultLabel: "PAID",
    },
    UNPAID: {
      bg: "bg-[var(--color-status-unpaid-bg)]",
      text: "text-[var(--color-status-unpaid-text)]",
      border: "border-[var(--color-status-unpaid-border)]",
      icon: <Clock className="w-3.5 h-3.5 inline mr-1" />,
      defaultLabel: "UNPAID",
    },
    "AI UNCERTAIN": {
      bg: "bg-[var(--color-status-uncertain-bg)]",
      text: "text-[var(--color-status-uncertain-text)]",
      border: "border-[var(--color-status-uncertain-border)]",
      icon: <AlertCircle className="w-3.5 h-3.5 inline mr-1" />,
      defaultLabel: "AI UNCERTAIN",
    },
    DRAFT: {
      bg: "bg-[var(--color-status-draft-bg)]",
      text: "text-[var(--color-status-draft-text)]",
      border: "border-[var(--color-status-draft-border)]",
      icon: null,
      defaultLabel: "DRAFT",
    },
  };

  const config = configs[normalized] || configs.DRAFT;

  return (
    <span
      className={`inline-flex items-center px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full border-2 ${config.bg} ${config.text} ${config.border} ${className}`}
    >
      {config.icon}
      {label || config.defaultLabel}
    </span>
  );
}
