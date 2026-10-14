import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getPayPalOrder,
  getPayPalCapture,
  verifyPayPalMerchant,
  verifyPayPalEnvironment,
  verifyPayPalWebhookSignature,
  logPaymentReconciliationIssue,
  resolvePaymentReconciliationIssue,
} from "@/lib/paypal";

export async function POST(request) {
  let webhookEvent = null;
  let supabase = null;

  try {
    const transmissionId = request.headers.get("paypal-transmission-id");
    const transmissionTime = request.headers.get("paypal-transmission-time");
    const transmissionSig = request.headers.get("paypal-transmission-sig");
    const certUrl = request.headers.get("paypal-cert-url");
    const authAlgo = request.headers.get("paypal-auth-algo");

    webhookEvent = await request.json().catch(() => null);

    if (!webhookEvent) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    // 1. Verify webhook signature via PayPal REST API
    try {
      const sigResult = await verifyPayPalWebhookSignature({
        transmissionId,
        transmissionTime,
        transmissionSig,
        certUrl,
        authAlgo,
        webhookEvent,
      });

      if (!sigResult.ok) {
        console.error("[PayPal Webhook] Signature verification failed:", sigResult);
        return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
      }
    } catch (sigErr) {
      console.error("[PayPal Webhook] Signature verification error:", sigErr.message);
      return NextResponse.json({ error: sigErr.message || "Webhook verification failed" }, { status: 401 });
    }

    // 2. We handle PAYMENT.CAPTURE.COMPLETED
    if (webhookEvent.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return NextResponse.json(
        { status: "ignored", eventType: webhookEvent.event_type },
        { status: 200 }
      );
    }

    const capture = webhookEvent.resource;
    const captureId = capture?.id;

    if (!captureId || typeof captureId !== "string") {
      return NextResponse.json({ error: "Missing capture ID in resource" }, { status: 400 });
    }

    if (capture.status !== "COMPLETED") {
      console.log(`[PayPal Webhook] Capture ${captureId} status is ${capture.status}, skipping.`);
      return NextResponse.json(
        { status: "skipped", captureStatus: capture.status },
        { status: 200 }
      );
    }

    supabase = createAdminClient();

    // 3. Resolve associated PayPal order (Requirement 3)
    let paypalOrderId = capture.supplementary_data?.related_ids?.order_id;

    if (!paypalOrderId && Array.isArray(capture.links)) {
      const upLink = capture.links.find((l) => l.rel === "up");
      if (upLink?.href) {
        const match = upLink.href.match(/\/orders\/([A-Za-z0-9_-]+)/);
        if (match) paypalOrderId = match[1];
      }
    }

    if (!paypalOrderId) {
      try {
        const captureData = await getPayPalCapture(captureId);
        paypalOrderId = captureData?.supplementary_data?.related_ids?.order_id;
        if (!paypalOrderId && Array.isArray(captureData?.links)) {
          const upLink = captureData.links.find((l) => l.rel === "up");
          if (upLink?.href) {
            const match = upLink.href.match(/\/orders\/([A-Za-z0-9_-]+)/);
            if (match) paypalOrderId = match[1];
          }
        }
      } catch (capErr) {
        console.error(`[PayPal Webhook] Could not fetch capture details for ${captureId}:`, capErr.message);
      }
    }

    if (!paypalOrderId) {
      console.error(`[PayPal Webhook] Unresolvable PayPal order for capture ${captureId}`);
      await logPaymentReconciliationIssue(supabase, {
        orderId: null,
        paypalOrderId: null,
        captureId,
        amountCents: null,
        currency: capture.amount?.currency_code || "USD",
        reason: "WEBHOOK_CANNOT_RESOLVE_ORDER",
        details: { event_id: webhookEvent.id },
      });
      return NextResponse.json(
        { status: "reconciliation_issue_logged", reason: "Cannot resolve order" },
        { status: 200 }
      );
    }

    // 4. Fetch and verify the PayPal order
    const paypalOrder = await getPayPalOrder(paypalOrderId);

    // Verify environment and merchant payee
    try {
      verifyPayPalEnvironment(paypalOrder);
      verifyPayPalMerchant(paypalOrder);
    } catch (verifErr) {
      console.error(`[PayPal Webhook] Verification failure for order ${paypalOrderId}:`, verifErr.message);
      await logPaymentReconciliationIssue(supabase, {
        orderId: null,
        paypalOrderId,
        captureId,
        amountCents: null,
        currency: "USD",
        reason: "WEBHOOK_MERCHANT_OR_ENV_MISMATCH",
        details: { error: verifErr.message },
      });
      return NextResponse.json(
        { status: "reconciliation_issue_logged", reason: verifErr.message },
        { status: 200 }
      );
    }

    const internalOrderId = paypalOrder.purchase_units?.[0]?.custom_id;
    if (!internalOrderId) {
      console.error(`[PayPal Webhook] PayPal order ${paypalOrderId} has no custom_id`);
      await logPaymentReconciliationIssue(supabase, {
        orderId: null,
        paypalOrderId,
        captureId,
        amountCents: null,
        currency: "USD",
        reason: "WEBHOOK_MISSING_CUSTOM_ID",
        details: { paypal_order_id: paypalOrderId },
      });
      return NextResponse.json(
        { status: "reconciliation_issue_logged", reason: "Missing custom_id" },
        { status: 200 }
      );
    }

    // 5. Look up internal order in Supabase
    const { data: order, error: orderLookupError } = await supabase
      .from("orders")
      .select(
        "id, order_reference, fulfillment_status, payment_status, payment_method, currency, total_cents, paypal_order_id, paypal_capture_id"
      )
      .eq("id", internalOrderId)
      .maybeSingle();

    if (orderLookupError || !order) {
      console.error(`[PayPal Webhook] Order ${internalOrderId} not found in database:`, orderLookupError);
      await logPaymentReconciliationIssue(supabase, {
        orderId: null,
        paypalOrderId,
        captureId,
        amountCents: null,
        currency: "USD",
        reason: "WEBHOOK_ORDER_NOT_FOUND",
        details: { internal_order_id: internalOrderId },
      });
      return NextResponse.json(
        { status: "reconciliation_issue_logged", reason: "Order not found" },
        { status: 200 }
      );
    }

    // Idempotency: already paid with this capture
    if (order.payment_status === "PAID") {
      if (order.paypal_capture_id === captureId) {
        return NextResponse.json(
          { status: "already_processed", captureId },
          { status: 200 }
        );
      }
      console.warn(`[PayPal Webhook] Order ${order.id} already paid under capture ${order.paypal_capture_id}, received new capture ${captureId}`);
      await logPaymentReconciliationIssue(supabase, {
        orderId: order.id,
        paypalOrderId,
        captureId,
        amountCents: null,
        currency: "USD",
        reason: "MULTIPLE_CAPTURES_ON_ORDER",
        details: { existing_capture_id: order.paypal_capture_id },
      });
      return NextResponse.json(
        { status: "reconciliation_issue_logged", reason: "Already paid under different capture" },
        { status: 200 }
      );
    }

    if (order.fulfillment_status === "CANCELLED") {
      console.warn(`[PayPal Webhook] Order ${order.id} is CANCELLED but captured at PayPal`);
      await logPaymentReconciliationIssue(supabase, {
        orderId: order.id,
        paypalOrderId,
        captureId,
        amountCents: null,
        currency: "USD",
        reason: "WEBHOOK_ORDER_CANCELLED",
        details: { order_reference: order.order_reference },
      });
      return NextResponse.json(
        { status: "reconciliation_issue_logged", reason: "Order cancelled" },
        { status: 200 }
      );
    }

    // 6. Verify currency and transaction amount
    const [dollarsStr = "0", centsStr = "00"] = (capture.amount?.value || "0").split(".");
    const captureAmountCents =
      parseInt(dollarsStr, 10) * 100 +
      parseInt(centsStr.padEnd(2, "0").slice(0, 2), 10);
    const captureCurrency = capture.amount?.currency_code;

    if (
      captureCurrency !== "USD" ||
      order.currency !== "USD" ||
      captureAmountCents !== Number(order.total_cents)
    ) {
      console.error(`[PayPal Webhook] Amount or currency mismatch for ${order.id}:`, {
        order_cents: Number(order.total_cents),
        captured_cents: captureAmountCents,
        order_currency: order.currency,
        capture_currency: captureCurrency,
      });

      await logPaymentReconciliationIssue(supabase, {
        orderId: order.id,
        paypalOrderId,
        captureId,
        amountCents: captureAmountCents,
        currency: captureCurrency || "USD",
        reason: "WEBHOOK_AMOUNT_MISMATCH",
        details: {
          expected_cents: Number(order.total_cents),
          captured_cents: captureAmountCents,
        },
      });

      return NextResponse.json(
        { status: "reconciliation_issue_logged", reason: "Amount mismatch" },
        { status: 200 }
      );
    }

    // 7. Atomically record verified capture
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "record_verified_paypal_capture",
      {
        p_order_id: order.id,
        p_paypal_order_id: paypalOrderId,
        p_capture_id: captureId,
        p_amount_cents: captureAmountCents,
        p_currency: captureCurrency,
      }
    );

    if (rpcError) {
      console.error("[PayPal Webhook] record_verified_paypal_capture failed:", rpcError);

      await logPaymentReconciliationIssue(supabase, {
        orderId: order.id,
        paypalOrderId,
        captureId,
        amountCents: captureAmountCents,
        currency: captureCurrency,
        reason: "WEBHOOK_POST_CAPTURE_DB_FAILURE",
        details: {
          rpc_error_code: rpcError.code,
          rpc_error_message: rpcError.message,
        },
      });

      // Return 500 so PayPal webhooks infrastructure retries delivery
      return NextResponse.json(
        { error: "Database recording error. Webhook delivery will be retried." },
        { status: 500 }
      );
    }

    // Resolve any open reconciliation issue for this capture
    await resolvePaymentReconciliationIssue(supabase, captureId, {
      resolved_by: "PAYPAL_WEBHOOK",
      webhook_event_id: webhookEvent.id,
    });

    return NextResponse.json(
      {
        success: true,
        paymentStatus: "PAID",
        captureId,
        details: rpcData,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[PayPal Webhook] Unhandled exception:", err.message);
    return NextResponse.json(
      { error: "Internal webhook processing error" },
      { status: 500 }
    );
  }
}
