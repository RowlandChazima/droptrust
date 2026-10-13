import { NextResponse } from "next/server";
import { isValidReceiptToken } from "@/lib/privacy";
import { createAdminClient } from "@/lib/supabase/admin";
import { capturePayPalOrder, parseCaptureResult } from "@/lib/paypal";

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

export async function POST(request, { params }) {
  try {
    const { token } = await params;

    if (!isValidReceiptToken(token)) {
      return NextResponse.json({ error: "Invalid receipt token" }, { status: 404, headers: PRIVATE_HEADERS });
    }

    const body = await request.json().catch(() => ({}));
    const { paypalOrderId } = body;

    if (!paypalOrderId || typeof paypalOrderId !== "string") {
      return NextResponse.json(
        { error: "Valid paypalOrderId is required in request body" },
        { status: 400, headers: PRIVATE_HEADERS }
      );
    }

    const supabase = createAdminClient();

    const { data: order, error } = await supabase
      .from("orders")
      .select("id, order_reference, fulfillment_status, payment_status, payment_method, currency, total_cents, paypal_order_id, paypal_capture_id, is_receipt_active")
      .eq("public_token", token)
      .maybeSingle();

    if (error) {
      console.error("[PayPal Capture] Database lookup error:", error);
      return NextResponse.json({ error: "Order lookup failed" }, { status: 500, headers: PRIVATE_HEADERS });
    }

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404, headers: PRIVATE_HEADERS });
    }

    if (!order.is_receipt_active) {
      return NextResponse.json({ error: "Receipt link has been revoked" }, { status: 410, headers: PRIVATE_HEADERS });
    }

    // Fast-path idempotency: if order is already PAID under this exact PayPal order
    if (order.payment_status === "PAID" && order.paypal_order_id === paypalOrderId) {
      return NextResponse.json(
        {
          success: true,
          paymentStatus: "PAID",
          captureId: order.paypal_capture_id,
          alreadyProcessed: true,
        },
        { status: 200, headers: PRIVATE_HEADERS }
      );
    }

    if (order.payment_method !== "PAYPAL") {
      return NextResponse.json(
        { error: "Order is not configured for PayPal payment" },
        { status: 400, headers: PRIVATE_HEADERS }
      );
    }

    if (order.fulfillment_status === "CANCELLED") {
      return NextResponse.json({ error: "Order is cancelled" }, { status: 400, headers: PRIVATE_HEADERS });
    }

    // 1. Capture payment via PayPal REST API
    const captureResponse = await capturePayPalOrder(paypalOrderId);
    const parsed = parseCaptureResult(captureResponse);

    if (parsed.status !== "COMPLETED") {
      return NextResponse.json(
        {
          error: `PayPal capture status is ${parsed.status}, expected COMPLETED`,
          captureId: parsed.captureId,
        },
        { status: 400, headers: PRIVATE_HEADERS }
      );
    }

    // 2. Call hardened atomic stored procedure to record capture, update order, and insert payment_records & order_events
    const { data: rpcData, error: rpcError } = await supabase.rpc("record_verified_paypal_capture", {
      p_order_id: order.id,
      p_paypal_order_id: paypalOrderId,
      p_capture_id: parsed.captureId,
      p_amount_cents: Number(order.total_cents),
      p_currency: "USD",
    });

    if (rpcError) {
      console.error("[PayPal Capture] record_verified_paypal_capture failed:", rpcError);
      return NextResponse.json({ error: rpcError.message }, { status: 500, headers: PRIVATE_HEADERS });
    }

    return NextResponse.json(
      {
        success: true,
        paymentStatus: "PAID",
        captureId: parsed.captureId,
        details: rpcData,
      },
      { status: 200, headers: PRIVATE_HEADERS }
    );
  } catch (err) {
    console.error("[PayPal Capture] Exception:", err);
    return NextResponse.json(
      { error: err.message || "Failed to capture PayPal payment" },
      { status: 500, headers: PRIVATE_HEADERS }
    );
  }
}
