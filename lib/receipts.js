import { createAdminClient } from "@/lib/supabase/admin";
import {
  isValidReceiptToken,
  maskPhone,
  coarseAddress,
  shortName,
} from "@/lib/privacy";

/**
 * Server-only lookup for public Trust Receipts.
 *
 * Why the service-role client: the anon role has no table access at all (see
 * section 9 of the security migration), so a browser can never list or scan
 * receipts. This function is the single door: it needs the exact token, reads
 * an explicit column list, and returns a shape built field by field. Internal
 * ids, PayPal ids, the raw customer contact details and the token itself are
 * never included in what it returns.
 *
 * Result statuses:
 *   ok          - receipt is live; `receipt` holds the public fields
 *   not_found   - malformed token or no such order (indistinguishable on purpose)
 *   revoked     - the merchant withdrew this link
 *   unconfirmed - order is still a DRAFT, nothing has been agreed yet
 *   error       - configuration or database problem (details logged server-side)
 */
export async function getPublicReceipt(token) {
  if (!isValidReceiptToken(token)) {
    return { status: "not_found" };
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (err) {
    console.error("[Receipts] Admin client unavailable:", err.message);
    return { status: "error" };
  }

  const { data: order, error } = await supabase
    .from("orders")
    .select(
      `
      id,
      order_reference,
      fulfillment_status,
      payment_status,
      payment_method,
      payment_verification,
      currency,
      subtotal_cents,
      delivery_fee_cents,
      total_cents,
      customer_name_snapshot,
      customer_phone_snapshot,
      customer_address_snapshot,
      agreed_terms,
      is_receipt_active,
      confirmed_at,
      created_at,
      business:businesses ( name )
    `,
    )
    .eq("public_token", token)
    .maybeSingle();

  if (error) {
    console.error("[Receipts] Order lookup failed:", {
      code: error.code,
      message: error.message,
    });
    return { status: "error" };
  }

  if (!order) {
    return { status: "not_found" };
  }

  if (!order.is_receipt_active) {
    return { status: "revoked" };
  }

  if (order.fulfillment_status === "DRAFT") {
    return { status: "unconfirmed" };
  }

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select(
      "product_name_snapshot, variant_name_snapshot, unit_price_cents, quantity, line_total_cents",
    )
    .eq("order_id", order.id)
    .order("id", { ascending: true });

  if (itemsError) {
    console.error("[Receipts] Item lookup failed:", {
      code: itemsError.code,
      message: itemsError.message,
    });
    return { status: "error" };
  }

  // Built field by field: adding a column to the query above never exposes it
  // by accident.
  return {
    status: "ok",
    receipt: {
      businessName: order.business?.name || "Seller",
      orderReference: order.order_reference,
      fulfillmentStatus: order.fulfillment_status,
      paymentStatus: order.payment_status,
      paymentMethod: order.payment_method,
      paymentVerification: order.payment_verification,
      currency: order.currency,
      subtotalCents: Number(order.subtotal_cents),
      deliveryFeeCents: Number(order.delivery_fee_cents),
      totalCents: Number(order.total_cents),
      agreedTerms: order.agreed_terms,
      confirmedAt: order.confirmed_at,
      createdAt: order.created_at,
      customer: {
        name: shortName(order.customer_name_snapshot),
        phone: maskPhone(order.customer_phone_snapshot),
        area: coarseAddress(order.customer_address_snapshot),
      },
      items: (items || []).map((item) => ({
        name: item.product_name_snapshot,
        variant: item.variant_name_snapshot,
        unitPriceCents: Number(item.unit_price_cents),
        quantity: item.quantity,
        lineTotalCents: Number(item.line_total_cents),
      })),
    },
  };
}
