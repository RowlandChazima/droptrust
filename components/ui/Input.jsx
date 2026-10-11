import React from "react";

/**
 * DropTrust Tactile Input Field (Design System v2)
 * Features tactile pill container, clear label, error message, and vibrant coral focus indicator.
 */
export function Input({
  label,
  id,
  name,
  type = "text",
  placeholder,
  value,
  defaultValue,
  onChange,
  error,
  required = false,
  disabled = false,
  autoComplete,
  className = "",
  ...props
}) {
  return (
    <div className={`flex flex-col gap-1.5 w-full ${className}`}>
      {label && (
        <label
          htmlFor={id || name}
          className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-primary)]"
        >
          {label} {required && <span className="text-[var(--color-brand-crimson)]">*</span>}
        </label>
      )}
      <input
        id={id || name}
        name={name}
        type={type}
        placeholder={placeholder}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        className={`input-tactile ${error ? "input-tactile-error" : ""}`}
        {...props}
      />
      {error && (
        <span className="text-xs font-semibold text-[var(--color-brand-crimson)] mt-0.5">
          {error}
        </span>
      )}
    </div>
  );
}
