/**
 * Privacy helpers for public Trust Receipts.
 *
 * Pure functions with no server or database imports, so they can run anywhere
 * and be tested in isolation. A receipt link can be forwarded to anyone, so
 * everything shown on it is reduced to what a customer needs to recognise
 * their own order.
 */

// public_token is built in the database from two UUIDs with the dashes removed:
// exactly 64 lowercase hex characters.
const RECEIPT_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function isValidReceiptToken(token) {
  return typeof token === "string" && RECEIPT_TOKEN_PATTERN.test(token);
}

/**
 * "+254 712 345 678" -> "+254 ••• ••78"
 * "0712345678"       -> "07 ••• ••78"
 * Anything with fewer than 6 digits is hidden completely.
 */
export function maskPhone(phone) {
  if (!phone || typeof phone !== "string") return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "•••";

  const hasPlus = phone.trim().startsWith("+");
  const prefix = hasPlus ? `+${digits.slice(0, 3)}` : digits.slice(0, 2);
  return `${prefix} ••• ••${digits.slice(-2)}`;
}

/**
 * Keeps only the broad area of an address: the first two comma-separated parts.
 * "Nairobi, Kilimani, Apt 4B, Ring Road" -> "Nairobi, Kilimani"
 * A single-part address could be a full street address, so it is hidden.
 */
export function coarseAddress(address) {
  if (!address || typeof address !== "string") return null;
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(0, 2).join(", ");
}

/**
 * "Mary Wanjiku Kamau" -> "Mary K."
 * "Mary"               -> "Mary"
 */
export function shortName(name) {
  if (!name || typeof name !== "string") return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}
