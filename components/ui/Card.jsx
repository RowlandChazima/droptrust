import React from "react";

/**
 * DropTrust Tactile Card (Design System v2)
 * Features parchment background, solid 2px ink border, and warm offset shadow.
 */
export function Card({ children, className = "", ...props }) {
  return (
    <div className={`card-tactile p-6 sm:p-8 ${className}`} {...props}>
      {children}
    </div>
  );
}
