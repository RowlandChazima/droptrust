/**
 * PayPal REST API Integration for DropTrust Capture.
 *
 * Handles server-side OAuth2 authentication, order creation, and capture
 * execution via PayPal Orders v2 REST API (Sandbox by default).
 *
 * Security & Financial Constraints:
 * - Credentials (PAYPAL_CLIENT_SECRET) never leave the server.
 * - PayPal REST APIs reject KES transactions; all PayPal orders must be USD.
 * - All decimal conversions strictly preserve integer cents precision.
 */

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Returns the configured PayPal API base URL (defaults to Sandbox).
 */
export function getPayPalBaseUrl() {
  return process.env.PAYPAL_API_BASE_URL || "https://api-m.sandbox.paypal.com";
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
    const errorText = await response.text();
    throw new Error(`PayPal OAuth failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

/**
 * Creates a PayPal v2 checkout order for the specified internal order.
 *
 * @param {Object} params
 * @param {string} params.orderId - Internal DropTrust UUID
 * @param {number} params.amountCents - Total in minor units (integer cents)
 * @param {string} params.currency - Must be 'USD'
 * @param {string} params.orderReference - Human readable reference (e.g. DT-2026-0001)
 */
export async function createPayPalOrder({ orderId, amountCents, currency, orderReference }) {
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

  const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal create order failed (${response.status}): ${errorText}`);
  }

  return await response.json();
}

/**
 * Captures an approved PayPal order.
 *
 * @param {string} paypalOrderId - PayPal Order ID (e.g. 5O190127TN364715T)
 */
export async function capturePayPalOrder(paypalOrderId) {
  if (!paypalOrderId || typeof paypalOrderId !== "string") {
    throw new Error("Valid PayPal order ID is required for capture");
  }

  const accessToken = await getPayPalAccessToken();
  const baseUrl = getPayPalBaseUrl();

  const response = await fetch(`${baseUrl}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal capture order failed (${response.status}): ${errorText}`);
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
