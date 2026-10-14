"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseToCents } from "@/lib/money";

// Zod schema for manual order creation
const ManualOrderItemSchema = z.object({
  productName: z.string().trim().min(1, "Product name is required"),
  variantName: z.string().trim().optional().nullable(),
  unitPrice: z.union([z.string(), z.number()]).refine((val) => {
    try {
      const cents = parseToCents(val);
      return cents >= 0;
    } catch {
      return false;
    }
  }, "Invalid unit price. Must be a non-negative amount with at most 2 decimal places."),
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number")
    .min(1, "Quantity must be at least 1")
    .max(10000, "Quantity cannot exceed 10,000"),
});

const CreateManualOrderSchema = z
  .object({
    customerName: z.string().trim().min(1, "Customer name is required"),
    customerPhone: z.string().trim().optional().nullable(),
    customerEmail: z
      .string()
      .trim()
      .email("Invalid email")
      .optional()
      .nullable()
      .or(z.literal("")),
    customerAddress: z.string().trim().optional().nullable(),
    agreedTerms: z.string().trim().optional().nullable(),
    paymentMethod: z.enum(["CASH_ON_DELIVERY", "PAYPAL"]),
    currency: z.enum(["KES", "USD"]),
    deliveryFee: z.union([z.string(), z.number()]).optional().default("0"),
    items: z
      .array(ManualOrderItemSchema)
      .min(1, "At least one item is required"),
  })
  .refine(
    (data) => {
      if (data.paymentMethod === "PAYPAL" && data.currency !== "USD") {
        return false;
      }
      return true;
    },
    {
      message:
        "PayPal transactions must be priced in USD (KES is not supported by PayPal REST API).",
      path: ["paymentMethod"],
    },
  );

/**
 * Generates an order reference, e.g. ORD-20261011-9A4F
 */
function generateOrderReference() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${dateStr}-${rand}`;
}

/**
 * Creates a new manual order following the two-stage database security protocol:
 * 1. Inserts the order row with subtotal_cents = 0 and fulfillment_status = 'CONFIRMED'
 * 2. Invokes set_order_items RPC to write items, calculate subtotal, and satisfy total consistency
 */
export async function createManualOrder(rawInput) {
  try {
    const supabase = await createClient();

    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "Authentication required to create orders.",
      };
    }

    // 2. Fetch merchant's business
    const { data: business, error: bizError } = await supabase
      .from("businesses")
      .select("id, currency")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (bizError || !business) {
      return { success: false, error: "Merchant business profile not found." };
    }

    // 3. Validate form input
    const parseResult = CreateManualOrderSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const firstError =
        parseResult.error.issues[0]?.message || "Invalid form data.";
      return { success: false, error: firstError };
    }

    const {
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      agreedTerms,
      paymentMethod,
      currency,
      deliveryFee,
      items,
    } = parseResult.data;

    const deliveryFeeCents = parseToCents(deliveryFee || "0");
    const orderReference = generateOrderReference();

    // 4. Upsert/Find Customer Record
    let customerId = null;
    try {
      if (customerPhone || customerEmail) {
        let query = supabase
          .from("customers")
          .select("id")
          .eq("business_id", business.id);

        if (customerPhone) {
          query = query.eq("phone", customerPhone);
        } else if (customerEmail) {
          query = query.eq("email", customerEmail);
        }

        const { data: existingCustomer } = await query.maybeSingle();
        if (existingCustomer) {
          customerId = existingCustomer.id;
        }
      }

      if (!customerId) {
        const { data: newCustomer } = await supabase
          .from("customers")
          .insert({
            business_id: business.id,
            name: customerName,
            phone: customerPhone || null,
            email: customerEmail || null,
            address: customerAddress || null,
          })
          .select("id")
          .maybeSingle();

        if (newCustomer) {
          customerId = newCustomer.id;
        }
      }
    } catch (custErr) {
      console.warn(
        "[Orders] Customer record linking non-critical error:",
        custErr,
      );
    }

    // 5. Insert Order Row
    // Note: payment_status ('UNPAID') and subtotal_cents (0) default automatically at the DB level,
    // complying with least-privilege column grants for the authenticated role.
    const { data: newOrder, error: orderInsertError } = await supabase
      .from("orders")
      .insert({
        business_id: business.id,
        customer_id: customerId,
        order_reference: orderReference,
        fulfillment_status: "CONFIRMED",
        payment_method: paymentMethod,
        currency: currency,
        delivery_fee_cents: deliveryFeeCents,
        customer_name_snapshot: customerName,
        customer_phone_snapshot: customerPhone || null,
        customer_address_snapshot: customerAddress || null,
        agreed_terms: agreedTerms || null,
      })
      .select("id, order_reference, public_token")
      .single();

    if (orderInsertError || !newOrder) {
      console.error("[Orders] Failed to insert order:", orderInsertError);
      return {
        success: false,
        error: orderInsertError?.message || "Failed to create order record.",
      };
    }

    // 6. Invoke set_order_items RPC (Stage 2: writes items and updates subtotal_cents)
    const formattedItems = items.map((item) => ({
      product_name: item.productName,
      variant_name: item.variantName || null,
      unit_price_cents: String(parseToCents(item.unitPrice)),
      quantity: String(item.quantity),
    }));

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "set_order_items",
      {
        p_order_id: newOrder.id,
        p_items: formattedItems,
        p_delivery_fee_cents: deliveryFeeCents,
      },
    );

    if (rpcError) {
      console.error("[Orders] set_order_items RPC error:", rpcError);
      // Attempt cleanup of orphaned order
      await supabase.from("orders").delete().eq("id", newOrder.id);
      return {
        success: false,
        error: `Failed to record line items: ${rpcError.message}`,
      };
    }

    // 7. Revalidate and return success
    revalidatePath("/");
    revalidatePath("/orders");

    return {
      success: true,
      orderId: newOrder.id,
      orderReference: newOrder.order_reference,
      publicToken: newOrder.public_token,
      totals: rpcData,
    };
  } catch (err) {
    console.error("[Orders] Unexpected error in createManualOrder:", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "An unexpected server error occurred.",
    };
  }
}

/**
 * Retrieves a single order by ID with all items and immutable audit events
 */
export async function getOrder(orderId) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Not authenticated" };
    }

    // Fetch order joined with business to verify merchant ownership
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        `
        *,
        business:businesses (
          id,
          name,
          currency,
          phone
        )
      `,
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return {
        success: false,
        error: orderError?.message || "Order not found",
      };
    }

    // Fetch order items
    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", orderId)
      .order("id", { ascending: true });

    if (itemsError) {
      console.error("[Orders] Error fetching items:", itemsError);
    }

    // Fetch order audit events
    const { data: events, error: eventsError } = await supabase
      .from("order_events")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (eventsError) {
      console.error("[Orders] Error fetching events:", eventsError);
    }

    return {
      success: true,
      order,
      items: items || [],
      events: events || [],
    };
  } catch (err) {
    console.error("[Orders] getOrder exception:", err);
    return { success: false, error: err.message || "Failed to load order" };
  }
}

/**
 * Retrieves all orders for the authenticated merchant
 */
export async function getMerchantOrders(filterStatus = "ALL") {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Not authenticated", orders: [] };
    }

    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (!business) {
      return { success: true, orders: [] };
    }

    let query = supabase
      .from("orders")
      .select(
        `
        id,
        order_reference,
        public_token,
        fulfillment_status,
        payment_status,
        payment_method,
        total_cents,
        currency,
        customer_name_snapshot,
        created_at
      `,
      )
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });

    if (filterStatus && filterStatus !== "ALL") {
      query = query.eq("fulfillment_status", filterStatus);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error("[Orders] Error fetching merchant orders:", error);
      return { success: false, error: error.message, orders: [] };
    }

    return { success: true, orders: orders || [] };
  } catch (err) {
    console.error("[Orders] getMerchantOrders exception:", err);
    return { success: false, error: err.message, orders: [] };
  }
}

/**
 * Updates the order fulfillment status through allowed forward transitions
 */
export async function updateFulfillmentStatus(orderId, newStatus) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Not authenticated" };
    }

    const { data, error } = await supabase
      .from("orders")
      .update({ fulfillment_status: newStatus })
      .eq("id", orderId)
      .select("id, fulfillment_status")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders");
    revalidatePath("/");

    return { success: true, order: data };
  } catch (err) {
    return { success: false, error: err.message || "Failed to update status" };
  }
}

/**
 * Toggles whether an order's public trust receipt is accessible or revoked.
 * When is_receipt_active is false, public requests to /r/[token] return 410 Revoked.
 */
export async function toggleReceiptActiveAction(orderId, isActive) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Not authenticated" };
    }

    const { data, error } = await supabase
      .from("orders")
      .update({
        is_receipt_active: Boolean(isActive),
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .select("id, is_receipt_active")
      .single();

    if (error) {
      console.error("[Orders] toggleReceiptActiveAction error:", error);
      return { success: false, error: error.message };
    }

    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders");
    revalidatePath("/");

    return { success: true, order: data };
  } catch (err) {
    console.error("[Orders] toggleReceiptActiveAction exception:", err);
    return { success: false, error: err.message || "Failed to toggle receipt state" };
  }
}

/**
 * Records physical cash payment received for a CASH_ON_DELIVERY order.
 * Invokes the atomic public.record_cash_payment(p_order_id, p_amount_cents) stored procedure.
 */
export async function recordCashPaymentAction(orderId) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Not authenticated" };
    }

    // 1. Fetch order to verify payment method and get exact total_cents
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, total_cents, payment_method, payment_status")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return { success: false, error: orderError?.message || "Order not found" };
    }

    if (order.payment_method !== "CASH_ON_DELIVERY") {
      return { success: false, error: "Only Cash on Delivery orders can be recorded as cash payments" };
    }

    if (order.payment_status === "PAID") {
      return { success: true, message: "Order is already marked as paid" };
    }

    // 2. Call hardened atomic stored procedure
    const { data, error } = await supabase.rpc("record_cash_payment", {
      p_order_id: orderId,
      p_amount_cents: Number(order.total_cents),
    });

    if (error) {
      console.error("[Orders] recordCashPaymentAction rpc error:", error);
      return { success: false, error: error.message };
    }

    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders");
    revalidatePath("/");

    return { success: true, result: data };
  } catch (err) {
    console.error("[Orders] recordCashPaymentAction exception:", err);
    return { success: false, error: err.message || "Failed to record cash payment" };
  }
}

