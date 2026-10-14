import { NextResponse } from "next/server";
import { isValidReceiptToken } from "@/lib/privacy";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  capturePayPalOrder,
  getPayPalOrder,
  parseCaptureResult,
  verifyPayPalMerchant,
  isAlreadyCaptured,
} from "@/lib/paypal";

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

function respond(body, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

async function logReconciliationIssue(supabase, {
  orderId,
  paypalOrderId,
  captureId,
  amountCents,
  currency,
  reason,
  details,
}) {
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

async function resolveReconciliationIssue(supabase, captureId) {
  if (!captureId) return;
  try {
    const { error } = await supabase.rpc("resolve_payment_reconciliation_issue", {
      p_capture_id: captureId,
      p_resolution_details: { resolved_at: new Date().toISOString() },
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

export async function POST(request, { params }) {
  let order = null;
  let paypalOrderId = null;
  let captureAttempted = false;
  let knownCaptureId = null;
  let supabase = null;

  try {
    const { token } = await params;

    if (!isValidReceiptToken(token)) {
      return respond({ error: "Invalid receipt token" }, 404);
    }

    const body = await request.json().catch(() => ({}));
    paypalOrderId = typeof body?.paypalOrderId === "string" ? body.paypalOrderId.trim() : null;
    const attemptId = typeof body?.attemptId === "string" ? body.attemptId.trim() : null;

    if (!paypalOrderId) {
      return respond(
        { error: "Valid paypalOrderId is required in request body" },
        400
      );
    }

    supabase = createAdminClient();

    const { data: dbOrder, error: orderError } = await supabase
      .from("orders")
      .select(
        "id, order_reference, fulfillment_status, payment_status, payment_method, currency, total_cents, paypal_order_id, paypal_capture_id, is_receipt_active"
      )
      .eq("public_token", token)
      .maybeSingle();

    if (orderError) {
      console.error("[PayPal Capture] Database lookup error:", orderError);
      return respond({ error: "Order lookup failed" }, 500);
    }

    if (!dbOrder) {
      return respond({ error: "Order not found" }, 404);
    }

    order = dbOrder;

    if (!order.is_receipt_active) {
      return respond({ error: "Receipt link has been revoked" }, 410);
    }

    // 1. Idempotency fast-path: already paid
    if (order.payment_status === "PAID") {
      if (order.paypal_order_id === paypalOrderId) {
        return respond({
          success: true,
          paymentStatus: "PAID",
          captureId: order.paypal_capture_id,
          alreadyProcessed: true,
        });
      }
      return respond({ error: "Order is already paid" }, 400);
    }

    if (order.payment_method !== "PAYPAL") {
      return respond(
        { error: "Order is not configured for PayPal payment" },
        400
      );
    }

    if (order.fulfillment_status === "CANCELLED") {
      return respond({ error: "Order is cancelled" }, 400);
    }

    if (order.currency !== "USD") {
      return respond({ error: "Order is not priced in USD" }, 400);
    }

    if (order.payment_status !== "PENDING") {
      return respond(
        { error: `Order cannot be captured in payment status: ${order.payment_status}` },
        400
      );
    }

    // 2. Strict order binding: verify this receipt was initialized for this PayPal order ID
    if (!order.paypal_order_id || order.paypal_order_id !== paypalOrderId) {
      console.warn(
        `[PayPal Capture] Order mismatch for ${order.order_reference}: got ${paypalOrderId}, expected ${order.paypal_order_id}`
      );
      return respond(
        {
          error: "This PayPal checkout is out of date. Please refresh the page and try again.",
        },
        400
      );
    }

    // 3. Pre-Capture Verification: fetch PayPal order and verify bindings
    const paypalOrder = await getPayPalOrder(paypalOrderId);

    // Verify payee merchant (fails closed in production)
    try {
      verifyPayPalMerchant(paypalOrder);
    } catch (merchantErr) {
      console.error("[PayPal Capture] Merchant verification failed:", merchantErr.message);
      return respond(
        { error: "Payee merchant verification failed. Please contact the seller." },
        403
      );
    }

    const unit = paypalOrder.purchase_units?.[0];
    if (!unit) {
      return respond({ error: "Invalid PayPal order structure: missing purchase unit" }, 400);
    }

    if (unit.custom_id !== order.id) {
      console.error("[PayPal Capture] custom_id mismatch:", {
        expected: order.id,
        received: unit.custom_id,
      });
      return respond(
        { error: "PayPal order custom_id does not match this receipt" },
        400
      );
    }

    if (unit.amount?.currency_code !== "USD") {
      return respond(
        { error: `PayPal order currency is ${unit.amount?.currency_code}, expected USD` },
        400
      );
    }

    const [dollarsStr = "0", centsStr = "00"] = (unit.amount?.value || "0").split(".");
    const preCaptureCents = parseInt(dollarsStr, 10) * 100 + parseInt(centsStr.padEnd(2, "0").slice(0, 2), 10);
    if (preCaptureCents !== Number(order.total_cents)) {
      console.error("[PayPal Capture] Pre-capture amount mismatch:", {
        expected: Number(order.total_cents),
        received: preCaptureCents,
      });
      return respond(
        { error: "PayPal order amount does not match receipt total" },
        400
      );
    }

    // 4. Capture execution or recovery
    let captureResponse;
    if (paypalOrder.status === "COMPLETED") {
      // Already captured previously at PayPal; recover capture details
      captureResponse = paypalOrder;
    } else if (paypalOrder.status === "APPROVED") {
      // Order is approved and ready for capture
      const requestId = attemptId
        ? `dt-cap-${order.id.slice(0, 8)}-${attemptId}`.slice(0, 128)
        : `dt-cap-${paypalOrderId}`.slice(0, 128);

      captureAttempted = true;
      try {
        captureResponse = await capturePayPalOrder(paypalOrderId, requestId);
      } catch (captureErr) {
        if (isAlreadyCaptured(captureErr)) {
          console.warn(`[PayPal Capture] Already captured at PayPal, recovering: ${paypalOrderId}`);
          captureResponse = await getPayPalOrder(paypalOrderId);
        } else {
          throw captureErr;
        }
      }
    } else {
      return respond(
        { error: `PayPal order status is ${paypalOrder.status}, expected APPROVED` },
        400
      );
    }

    const parsed = parseCaptureResult(captureResponse);
    knownCaptureId = parsed.captureId;

    // 5. Handle pending capture
    if (parsed.status === "PENDING") {
      console.warn(
        `[PayPal Capture] PENDING capture ${parsed.captureId} for ${order.order_reference}`
      );
      return respond(
        {
          success: false,
          pending: true,
          captureId: parsed.captureId,
          message:
            "Your payment is being processed by PayPal. This receipt will update once it clears.",
        },
        202
      );
    }

    if (parsed.status !== "COMPLETED") {
      return respond(
        {
          error: `PayPal capture status is ${parsed.status}, expected COMPLETED`,
          captureId: parsed.captureId,
        },
        400
      );
    }

    // 6. Post-Capture sanity checks
    if (
      parsed.currency !== "USD" ||
      parsed.amountCents !== Number(order.total_cents)
    ) {
      console.error(
        "[PayPal Capture] Critical mismatch: captured amounts do not match order",
        {
          orderId: order.id,
          captureId: parsed.captureId,
          expectedCents: Number(order.total_cents),
          capturedCents: parsed.amountCents,
          capturedCurrency: parsed.currency,
        }
      );

      await logReconciliationIssue(supabase, {
        orderId: order.id,
        paypalOrderId,
        captureId: parsed.captureId,
        amountCents: parsed.amountCents,
        currency: parsed.currency,
        reason: "CAPTURE_AMOUNT_MISMATCH",
        details: {
          expected_cents: Number(order.total_cents),
          captured_cents: parsed.amountCents,
        },
      });

      return respond(
        {
          error:
            "Payment could not be verified against this order. Please contact the seller.",
          captureId: parsed.captureId,
        },
        409
      );
    }

    // 7. Atomically record verified capture in Supabase
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "record_verified_paypal_capture",
      {
        p_order_id: order.id,
        p_paypal_order_id: paypalOrderId,
        p_capture_id: parsed.captureId,
        p_amount_cents: parsed.amountCents,
        p_currency: parsed.currency,
      }
    );

    if (rpcError) {
      console.error(
        "[PayPal Capture] record_verified_paypal_capture failed AFTER capture:",
        {
          orderId: order.id,
          captureId: parsed.captureId,
          error: rpcError,
        }
      );

      await logReconciliationIssue(supabase, {
        orderId: order.id,
        paypalOrderId,
        captureId: parsed.captureId,
        amountCents: parsed.amountCents,
        currency: parsed.currency,
        reason: "POST_CAPTURE_DB_FAILURE",
        details: {
          rpc_error_code: rpcError.code,
          rpc_error_message: rpcError.message,
        },
      });

      return respond(
        {
          error:
            "Your payment was received by PayPal but we could not update your receipt yet. Please do not pay again; refresh the page in a few moments or contact the seller with your capture ID.",
          captureId: parsed.captureId,
        },
        500
      );
    }

    // Mark any existing reconciliation issue for this capture as resolved
    await resolveReconciliationIssue(supabase, parsed.captureId);

    return respond({
      success: true,
      paymentStatus: "PAID",
      captureId: parsed.captureId,
      details: rpcData,
    });
  } catch (err) {
    console.error(
      "[PayPal Capture] Exception:",
      err?.message || err,
      err?.debugId ? `debug_id=${err.debugId}` : ""
    );

    if (captureAttempted && !knownCaptureId && order?.id && supabase) {
      await logReconciliationIssue(supabase, {
        orderId: order.id,
        paypalOrderId,
        captureId: null,
        amountCents: Number(order.total_cents),
        currency: order.currency || "USD",
        reason: "UNCERTAIN_CAPTURE_EXCEPTION",
        details: {
          error_message: err.message,
          error_status: err.status || null,
        },
      });
    }

    return respond(
      {
        error:
          "Unable to finalize PayPal payment. If your PayPal account was charged, please refresh the page in a moment.",
        captureId: knownCaptureId || undefined,
      },
      500
    );
  }
}
