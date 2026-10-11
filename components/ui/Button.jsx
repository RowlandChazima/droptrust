import React from "react";
import { Loader2 } from "lucide-react";

/**
 * DropTrust Tactile 3D Pill Button (Design System v2)
 * Features tactile lift on hover, compression on click, and accessible focus/disabled states.
 */
export function Button({
  children,
  variant = "gold",
  type = "button",
  disabled = false,
  loading = false,
  className = "",
  onClick,
  ...props
}) {
  const variantClasses = {
    gold: "btn-tactile-gold",
    crimson: "btn-tactile-crimson",
    outline: "btn-tactile-outline",
  }[variant] || "btn-tactile-gold";

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`btn-tactile ${variantClasses} ${className}`}
      {...props}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-current" />
          <span>Processing...</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
