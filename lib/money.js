/**
 * DropTrust Capture — Strict Minor-Unit (Cents) Money Utilities
 *
 * Prevents floating-point precision hazards by enforcing integer-only
 * arithmetic for all financial calculations and database storage.
 */

/**
 * Parses user input (string or number) into integer cents.
 * Rejects negative values, non-numeric values, or values with >2 decimal places.
 *
 * @param {string|number} input - e.g. "19.99", "5", 19.99, "0.50"
 * @returns {number} Non-negative integer cents (e.g. 1999)
 * @throws {Error} If input is invalid, negative, or malformed
 */
export function parseToCents(input) {
  if (input === null || input === undefined || input === "") {
    throw new Error("Amount is required");
  }

  // Convert to clean trimmed string
  let str = String(input).trim();

  // Strip optional currency prefix ($ or KES) if user pasted it
  str = str.replace(/^(USD|\$|KES|KSh)\s*/i, "").trim();

  // Validate format: positive integers with at most 2 decimal digits
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    throw new Error(
      `Invalid money format: "${input}". Must be a non-negative number with at most 2 decimal places.`
    );
  }

  const [wholePart, fractionalPart = ""] = str.split(".");
  const paddedFraction = fractionalPart.padEnd(2, "0");

  const whole = Number.parseInt(wholePart, 10);
  const cents = Number.parseInt(paddedFraction, 10);

  if (Number.isNaN(whole) || Number.isNaN(cents) || whole < 0) {
    throw new Error(`Failed to parse amount: "${input}"`);
  }

  const totalCents = whole * 100 + cents;

  if (!Number.isSafeInteger(totalCents)) {
    throw new Error(`Amount exceeds safe integer limits: "${input}"`);
  }

  return totalCents;
}

/**
 * Safely converts integer cents into a two-decimal string.
 * e.g. 1999 -> "19.99", 500 -> "5.00", 0 -> "0.00"
 *
 * @param {number|bigint} cents
 * @returns {string}
 */
export function centsToDecimalString(cents) {
  const c = Math.max(0, Number(cents) || 0);
  const whole = Math.floor(c / 100);
  const frac = c % 100;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

/**
 * Formats integer cents into a localized display currency string.
 *
 * @param {number|bigint} cents - Integer minor units
 * @param {string} currency - e.g. "USD", "KES"
 * @returns {string} e.g. "$19.99", "KES 1,500.00"
 */
export function formatMoney(cents, currency = "USD") {
  const c = Math.max(0, Number(cents) || 0);
  const amount = c / 100;
  const curr = (currency || "USD").toUpperCase();

  if (curr === "KES") {
    return `KES ${amount.toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Calculates a line item total in integer cents.
 *
 * @param {number} unitPriceCents - e.g. 1999
 * @param {number} quantity - e.g. 2
 * @returns {number} e.g. 3998
 */
export function calculateLineTotal(unitPriceCents, quantity) {
  const price = Math.max(0, Math.floor(Number(unitPriceCents) || 0));
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  return price * qty;
}
