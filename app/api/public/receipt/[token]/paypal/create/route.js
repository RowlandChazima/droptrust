import { NextResponse } from "next/server";
import { isValidReceiptToken } from "@/lib/privacy";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPayPalOrder } from "@/lib/paypal";

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

export async function POST(_request, { params }) {
  try {
    const { token } = await params;

    if (!isValidReceiptToken(token)) {
      return NextResponse.json({ error: "Invalid receipt token" }, { status: 404, headers: PRIVATE_HEADERS });
    }

    const supabase = createAdminClient();

    const { data: order, error } = await supabase
      .from("orders")
      .select("id, order_reference, fulfillment_status, payment_status, payment_method, currency, total_cents, is_receipt_active")
      .eq("public_token", token)
      .maybeSingle();

    if (error) {
      console.error("[PayPal Create] Database lookup error:", error);
      return NextResponse.json({ error: "Order lookup failed" }, { status: 500, headers: PRIVATE_HEADERS });
    }

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404, headers: PRIVATE_HEADERS });
    }

    if (!order.is_receipt_active) {
      return NextResponse.json({ error: "Receipt link has been revoked" }, { status: 410, headers: PRIVATE_HEADERS });
    }

    if (order.fulfillment_status === "CANCELLED") {
      return NextResponse.json({ error: "Order is cancelled" }, { status: 400, headers: PRIVATE_HEADERS });
    }

    if (order.fulfillment_status === "DRAFT") {
      return NextResponse.json({ error: "Order is still a draft and has not been confirmed" }, { status: 409, headers: PRIVATE_HEADERS });
    }

    if (order.payment_method !== "PAYPAL") {
      return NextResponse.json(
        { error: `Order payment method is ${order.payment_method}, not PAYPAL` },
        { status: 400, headers: PRIVATE_HEADERS }
      );
    }

    if (order.currency !== "USD") {
      return NextResponse.json(
        { error: `PayPal orders must be priced in USD (order currency is ${order.currency})` },
        { status: 400, headers: PRIVATE_HEADERS }
      );
    }

    if (order.payment_status === "PAID") {
      return NextResponse.json({ error: "Order is already paid" }, { status: 400, headers: PRIVATE_HEADERS });
    }

    if (order.payment_status !== "UNPAID" && order.payment_status !== "PENDING") {
      return NextResponse.json(
        { error: `Order cannot start PayPal checkout in payment status: ${order.payment_status}` },
        { status: 400, headers: PRIVATE_HEADERS }
      );
    }

    if (Number(order.total_cents) <= 0) {
      return NextResponse.json({ error: "Order has no payable total" }, { status: 400, headers: PRIVATE_HEADERS });
    }

    // 1. Create order at PayPal REST API
    const paypalOrder = await createPayPalOrder({
      orderId: order.id,
      amountCents: Number(order.total_cents),
      currency: "USD",
      orderReference: order.order_reference,
    });

    // 2. Call trusted stored procedure to assign PayPal order ID and transition to PENDING
    const { error: rpcError } = await supabase.rpc("assign_paypal_order", {
      p_order_id: order.id,
      p_paypal_order_id: paypalOrder.id,
    });

    if (rpcError) {
      console.error("[PayPal Create] assign_paypal_order procedure failed:", rpcError);
      return NextResponse.json({ error: rpcError.message }, { status: 500, headers: PRIVATE_HEADERS });
    }

    return NextResponse.json(
      { paypalOrderId: paypalOrder.id },
      { status: 200, headers: PRIVATE_HEADERS }
    );
  } catch (err) {
    console.error("[PayPal Create] Exception:", err);
    return NextResponse.json(
      { error: err.message || "Failed to create PayPal checkout order" },
      { status: 500, headers: PRIVATE_HEADERS }
    );
  }
}
