/**
 * PayPal REST API Integration for DropTrust Capture.
 *
 * Handles server-side OAuth2 authentication, order creation, capture
 * execution, and order retrieval via PayPal Orders v2 REST API (Sandbox by default).
 *
 * Security & Financial Constraints:
 * - Credentials (PAYPAL_CLIENT_SECRET) never leave the server.
 * - Raw PayPal response bodies are never exposed in error.message.
 * - PayPal REST APIs reject KES transactions; all PayPal orders must be USD.
 * - All decimal conversions strictly preserve integer cents precision.
 */

export class PayPalApiError extends Error {
  constructor(status, body = null, debugId = null) {
    const message = `PayPal API error (HTTP ${status})${debugId ? ` [debug_id: ${debugId}]` : ""}`;
    super(message);
    this.name = "PayPalApiError";
    this.status = status;
    this.body = body;
    this.debugId = debugId || null;
  }
}

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Returns the configured PayPal API base URL (defaults to Sandbox).
 */
export function getPayPalBaseUrl() {
  return process.env.PAYPAL_API_BASE_URL || "https://api-m.sandbox.paypal.com";
}

/**
 * Parses response error details safely and throws a PayPalApiError.
 */
async function throwPayPalError(response) {
  const debugId = response.headers.get("paypal-debug-id") || null;
  let body = null;
  try {
    const text = await response.text();
    if (text) {
      body = JSON.parse(text);
    }
  } catch {
    body = null;
  }
  throw new PayPalApiError(response.status, body, debugId);
}

/**
 * Determines whether a PayPal capture failure is due to ORDER_ALREADY_CAPTURED.
 */
export function isAlreadyCaptured(err) {
  return (
    err instanceof PayPalApiError &&
    err.status === 422 &&
    Array.isArray(err.body?.details) &&
    err.body.details.some((d) => d.issue === "ORDER_ALREADY_CAPTURED")
  );
}

/**
 * Obtains and caches a server-to-server OAuth2 access token using client credentials.
 */
export async function getPayPalAccessToken() {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing PayPal credentials: NEXT_PUBLIC_PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be configured in environment."
    );
  }

  const now = Date.now();
  // Reuse token if valid for at least another 60 seconds
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  const baseUrl = getPayPalBaseUrl();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    await throwPayPalError(response);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

/**
 * Fetches an existing order from PayPal Orders v2 REST API.
 *
 * @param {string} paypalOrderId - PayPal Order ID
 */
export async function getPayPalOrder(paypalOrderId) {
  if (!paypalOrderId || typeof paypalOrderId !== "string") {
    throw new Error("Valid PayPal order ID is required");
  }

  const accessToken = await getPayPalAccessToken();
  const baseUrl = getPayPalBaseUrl();

  const response = await fetch(
    `${baseUrl}/v2/checkout/orders/${encodeURIComponent(paypalOrderId.trim())}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    await throwPayPalError(response);
  }

  return await response.json();
}

/**
 * Fetches an existing capture from PayPal Payments REST API.
 *
 * @param {string} captureId - PayPal Capture ID
 */
export async function getPayPalCapture(captureId) {
  if (!captureId || typeof captureId !== "string") {
    throw new Error("Valid PayPal capture ID is required");
  }

  const accessToken = await getPayPalAccessToken();
  const baseUrl = getPayPalBaseUrl();

  const response = await fetch(
    `${baseUrl}/v2/payments/captures/${encodeURIComponent(captureId.trim())}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    await throwPayPalError(response);
  }

  return await response.json();
}

/**
 * Creates a PayPal v2 checkout order for the specified internal order.
 *
 * @param {Object} params
 * @param {string} params.orderId - Internal DropTrust UUID
 * @param {number} params.amountCents - Total in minor units (integer cents)
 * @param {string} params.currency - Must be 'USD'
 * @param {string} params.orderReference - Human readable reference (e.g. DT-2026-0001)
 * @param {string} [params.requestId] - Optional idempotent request ID (max 128 characters)
 */
export async function createPayPalOrder({ orderId, amountCents, currency, orderReference, requestId }) {
  if (currency !== "USD") {
    throw new Error(`PayPal checkout requires USD currency (received ${currency})`);
  }

  if (!amountCents || amountCents <= 0) {
    throw new Error("Order amount must be a positive number of cents");
  }

  const accessToken = await getPayPalAccessToken();
  const baseUrl = getPayPalBaseUrl();

  // Convert integer cents to two-decimal string: 1250 cents -> "12.50"
  const dollars = Math.floor(amountCents / 100);
  const cents = Math.abs(amountCents % 100);
  const formattedValue = `${dollars}.${String(cents).padStart(2, "0")}`;

  const payload = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: orderReference || orderId,
        custom_id: orderId,
        description: `DropTrust Verified Order ${orderReference || ""}`.trim(),
        amount: {
          currency_code: "USD",
          value: formattedValue,
        },
      },
    ],
  };

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  if (requestId && typeof requestId === "string") {
    // PayPal requires max 128 characters
    headers["PayPal-Request-Id"] = requestId.trim().slice(0, 128);
  }

  const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwPayPalError(response);
  }

  return await response.json();
}

/**
 * Captures an approved PayPal order.
 *
 * @param {string} paypalOrderId - PayPal Order ID (e.g. 5O190127TN364715T)
 * @param {string} [requestId] - Optional idempotent request ID (max 128 characters)
 */
export async function capturePayPalOrder(paypalOrderId, requestId = null) {
  if (!paypalOrderId || typeof paypalOrderId !== "string") {
    throw new Error("Valid PayPal order ID is required for capture");
  }

  const accessToken = await getPayPalAccessToken();
  const baseUrl = getPayPalBaseUrl();

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  if (requestId && typeof requestId === "string") {
    headers["PayPal-Request-Id"] = requestId.trim().slice(0, 128);
  }

  const response = await fetch(
    `${baseUrl}/v2/checkout/orders/${encodeURIComponent(paypalOrderId.trim())}/capture`,
    {
      method: "POST",
      headers,
    }
  );

  if (!response.ok) {
    await throwPayPalError(response);
  }

  return await response.json();
}

/**
 * Extracts and normalizes capture details from a PayPal order capture response.
 */
export function parseCaptureResult(captureData) {
  const unit = captureData.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];

  if (!capture) {
    throw new Error("No capture object returned in PayPal response");
  }

  const captureId = capture.id;
  const status = capture.status; // 'COMPLETED', 'PENDING', etc.
  const currency = capture.amount?.currency_code;
  const value = capture.amount?.value;

  // Convert decimal string to integer cents
  const [dollarsStr = "0", centsStr = "00"] = (value || "0").split(".");
  const dollars = parseInt(dollarsStr, 10);
  const cents = parseInt(centsStr.padEnd(2, "0").slice(0, 2), 10);
  const amountCents = dollars * 100 + cents;

  return {
    captureId,
    status,
    currency,
    amountCents,
  };
}

/**
 * Verifies that the payee merchant ID on a PayPal order matches PAYPAL_MERCHANT_ID.
 * In production, fails closed if PAYPAL_MERCHANT_ID is unset or mismatched.
 * In non-production, logs a warning if PAYPAL_MERCHANT_ID is unset.
 */
export function verifyPayPalMerchant(paypalOrder) {
  const configuredMerchantId = process.env.PAYPAL_MERCHANT_ID?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (!configuredMerchantId) {
    if (isProduction) {
      throw new Error("PAYPAL_MERCHANT_ID must be configured in production environment");
    }
    console.warn(
      "[PayPal] Warning: PAYPAL_MERCHANT_ID is not configured. Skipping payee verification in non-production."
    );
    return { ok: true, verified: false };
  }

  const payeeMerchantId = paypalOrder.purchase_units?.[0]?.payee?.merchant_id;
  if (!payeeMerchantId) {
    throw new Error("PayPal order does not contain purchase_units[0].payee.merchant_id");
  }

  if (payeeMerchantId !== configuredMerchantId) {
    throw new Error(`Payee merchant ID mismatch: expected ${configuredMerchantId}, received ${payeeMerchantId}`);
  }

  return { ok: true, verified: true, merchantId: payeeMerchantId };
}
