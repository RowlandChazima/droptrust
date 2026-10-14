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

/**
 * Verifies that the PayPal order environment is consistent with the application environment.
 * In production, fails if the PayPal API URL or order resources indicate Sandbox.
 */
export function verifyPayPalEnvironment(paypalOrder) {
  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) {
    return { ok: true, isProduction: false };
  }

  const baseUrl = getPayPalBaseUrl();
  if (baseUrl.includes("sandbox")) {
    throw new Error("Production environment cannot use PayPal sandbox API URL");
  }

  const links = paypalOrder?.links || [];
  const hasSandboxLink = links.some((l) => l.href && l.href.includes("sandbox.paypal.com"));
  if (hasSandboxLink) {
    throw new Error("PayPal order originates from sandbox environment while server is in production mode");
  }

  return { ok: true, isProduction: true };
}

/**
 * Verifies a PayPal webhook signature using PayPal's /v1/notifications/verify-webhook-signature API.
 * In production, fails closed if PAYPAL_WEBHOOK_ID is unset.
 */
export async function verifyPayPalWebhookSignature({
  transmissionId,
  transmissionTime,
  transmissionSig,
  certUrl,
  authAlgo,
  webhookEvent,
}) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (!webhookId) {
    if (isProduction) {
      throw new Error("PAYPAL_WEBHOOK_ID must be configured in production environment");
    }
    console.warn(
      "[PayPal Webhook] Warning: PAYPAL_WEBHOOK_ID is not configured. Skipping signature verification in non-production."
    );
    return { ok: true, verified: false };
  }

  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    throw new Error("Missing required PayPal webhook signature headers");
  }

  // Security check: validate certUrl domain to prevent SSRF
  try {
    const parsedCertUrl = new URL(certUrl);
    if (
      parsedCertUrl.protocol !== "https:" ||
      !parsedCertUrl.hostname.endsWith(".paypal.com")
    ) {
      throw new Error(`Invalid PayPal certificate URL domain: ${parsedCertUrl.hostname}`);
    }
  } catch (urlErr) {
    throw new Error(`Malformed PayPal certificate URL: ${urlErr.message}`);
  }

  const accessToken = await getPayPalAccessToken();
  const baseUrl = getPayPalBaseUrl();

  const payload = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: webhookId,
    webhook_event: webhookEvent,
  };

  const response = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await throwPayPalError(response);
  }

  const data = await response.json();
  const isValid = data.verification_status === "SUCCESS";

  return {
    ok: isValid,
    verified: true,
    verificationStatus: data.verification_status,
  };
}

/**
 * Records an issue in the payment_reconciliation_issues ledger using service_role client.
 * Falls back to direct insert if the stored procedure has not yet been applied to the database.
 */
export async function logPaymentReconciliationIssue(supabase, {
  orderId,
  paypalOrderId,
  captureId,
  amountCents,
  currency,
  reason,
  details,
}) {
  if (!supabase) return;

  try {
    const { error } = await supabase.rpc("record_payment_reconciliation_issue", {
      p_order_id: orderId || null,
      p_paypal_order_id: paypalOrderId || null,
      p_capture_id: captureId || null,
      p_amount_cents: amountCents ? Number(amountCents) : null,
      p_currency: currency || "USD",
      p_reason: reason,
      p_details: details || null,
    });

    if (error) {
      console.warn("[Reconciliation Ledger] RPC fallback to direct insert:", error.message);
      await supabase.from("payment_reconciliation_issues").insert({
        order_id: orderId || null,
        paypal_order_id: paypalOrderId || null,
        capture_id: captureId || null,
        amount_cents: amountCents ? Number(amountCents) : null,
        currency: currency || "USD",
        reason,
        details: details || null,
      });
    }
  } catch (err) {
    console.error("[Reconciliation Ledger] Failed to record issue:", err.message);
  }
}

/**
 * Resolves an open reconciliation issue for a given capture ID.
 */
export async function resolvePaymentReconciliationIssue(supabase, captureId, resolutionDetails = null) {
  if (!supabase || !captureId) return;

  try {
    const { error } = await supabase.rpc("resolve_payment_reconciliation_issue", {
      p_capture_id: captureId,
      p_resolution_details: resolutionDetails || { resolved_at: new Date().toISOString() },
    });

    if (error) {
      await supabase
        .from("payment_reconciliation_issues")
        .update({ status: "RESOLVED", updated_at: new Date().toISOString() })
        .eq("capture_id", captureId)
        .eq("status", "OPEN");
    }
  } catch {
    // Non-blocking best-effort resolution
  }
}
