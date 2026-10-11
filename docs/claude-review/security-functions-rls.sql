-- ==============================================================================
-- 
--

--
-- v3.1 changes in this file
--   * Payment provenance : cash functions/events label MERCHANT_REPORTED,
--                          PayPal ones PROVIDER_CONFIRMED (columns are GENERATED
--                          in file A/B; nothing here can forge them).
--   * Event provenance   : order_events.origin set by trigger from the caller's
--                          role; client events narrowed to notes only; order
--                          changes are audited automatically by a trigger.
--   * Post-payment rules : confirmed_at server-set; agreed_terms and customer
--                          snapshots frozen; forward-only status; audited
--                          correct_order_details() for typo fixes.
--   * Refunds            : refund_records ledger + record_paypal_refund() and
--                          record_cash_refund() (full refunds only).
-- ==============================================================================

-- ASSUMPTIONS
--   * Migrations run as the table/function owner (Supabase: postgres).
--   * Untrusted users reach the database ONLY through PostgREST (supabase-js).
--     Nobody untrusted holds a direct Postgres connection. (Two safeguards below
--     rely on this: the current_user check in the order guard, and the
--     transaction-local setting used by the correction function.)
--   * SECURITY DEFINER functions run as the owner, which bypasses RLS.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. PRECONDITIONS (fail loudly if A or B has not been applied)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.orders') IS NULL OR to_regclass('public.payment_records') IS NULL
     OR to_regclass('public.order_items') IS NULL OR to_regclass('public.order_events') IS NULL THEN
    RAISE EXCEPTION 'DropTrust tables not found. Run m1_v3_1_a_fresh_schema.sql (fresh) or m1_v3_1_b_upgrade_existing_schema.sql (upgrade) first.';
  END IF;

  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'total_cents') IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION 'orders.total_cents is not BIGINT. Apply file B (upgrade) before file C.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_paypal_requires_usd')
     OR to_regclass('public.ux_payment_records_one_completed_per_order') IS NULL THEN
    RAISE EXCEPTION 'v3 constraints/indexes missing. Apply file A (fresh) or file B (upgrade) before file C.';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.refund_records') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='payment_verification')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_records' AND column_name='verification')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='order_events' AND column_name='origin') THEN
    RAISE EXCEPTION 'v3.1 schema additions missing (refund_records / verification columns / order_events.origin). Apply file A (fresh) or file B (upgrade) from the v3.1 set before file C.';
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 1. HELPER: "has payment started?"
--    Single definition used everywhere. Payment has started once the order is
--    anything other than UNPAID, or a PayPal order id has been attached (the
--    PayPal order was created for a specific amount).
--    Pure and harmless, so it is executable by the roles that call it from
--    invoker-rights triggers (see privileges section).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_payment_started(p_payment_status TEXT, p_paypal_order_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_payment_status <> 'UNPAID' OR p_paypal_order_id IS NOT NULL;
$$;

-- ------------------------------------------------------------------------------
-- 2. ORDERS: protected-column guard (+ derived total, server-set confirmed_at,
--    frozen history fields, forward-only status), delete guard, change audit
--
-- Security problem: RLS limits which ROWS a merchant touches, not which COLUMNS,
-- and a merchant is the party with the most to gain from rewriting history.
-- Column GRANTs (section 9) are the first line; this trigger is the second.
--
-- Runs with INVOKER rights on purpose: current_user is the role PostgREST
-- switched to (authenticated/anon). service_role, postgres and SECURITY DEFINER
-- functions (current_user = owner) are not treated as clients.
--
-- Rules for CLIENT roles:
--   INSERT : payment state / PayPal fields / subtotal not allowed; status must
--            start as DRAFT or CONFIRMED.
--   confirmed_at is SERVER-SET (all roles): stamped when status first reaches a
--            confirmed state. Client values are discarded; the column is not
--            grantable either.
--   agreed_terms  : frozen once status leaves DRAFT OR payment has started.
--   customer_*_snapshot : frozen once payment has started.
--   amounts / currency / payment_method : frozen once payment has started.
--   fulfillment_status : forward-only (DRAFT < CONFIRMED < PROCESSING < READY <
--            DISPATCHED < DELIVERED; steps may be skipped). DELIVERED and
--            CANCELLED are terminal. CANCELLED is only allowed while
--            payment_status is UNPAID or REFUND_RECORDED (a paid order needs a
--            recorded refund first).
-- total_cents is DERIVED here for every role.
-- Trusted roles are not subject to the client rules; their changes are still
-- recorded by orders_audit_changes (below).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_order_protected_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_client BOOLEAN := current_user IN ('authenticated', 'anon');
  v_old_rank INT;
  v_new_rank INT;
  v_was_confirmed BOOLEAN;
BEGIN
  IF v_client THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.payment_status <> 'UNPAID'
         OR NEW.paypal_order_id IS NOT NULL
         OR NEW.paypal_capture_id IS NOT NULL
         OR NEW.subtotal_cents <> 0 THEN
        RAISE EXCEPTION 'Clients cannot set payment state, PayPal fields or subtotal on new orders';
      END IF;
      IF NEW.fulfillment_status NOT IN ('DRAFT', 'CONFIRMED') THEN
        RAISE EXCEPTION 'New orders must start as DRAFT or CONFIRMED';
      END IF;
      NEW.confirmed_at := NULL;
    ELSE
      IF NEW.payment_status     IS DISTINCT FROM OLD.payment_status
         OR NEW.paypal_order_id   IS DISTINCT FROM OLD.paypal_order_id
         OR NEW.paypal_capture_id IS DISTINCT FROM OLD.paypal_capture_id
         OR NEW.public_token      IS DISTINCT FROM OLD.public_token
         OR NEW.order_reference   IS DISTINCT FROM OLD.order_reference
         OR NEW.subtotal_cents    IS DISTINCT FROM OLD.subtotal_cents THEN
        RAISE EXCEPTION 'Protected order column cannot be changed by client';
      END IF;

      IF public.order_payment_started(OLD.payment_status, OLD.paypal_order_id) AND (
           NEW.delivery_fee_cents IS DISTINCT FROM OLD.delivery_fee_cents
        OR NEW.total_cents        IS DISTINCT FROM OLD.total_cents
        OR NEW.currency           IS DISTINCT FROM OLD.currency
        OR NEW.payment_method     IS DISTINCT FROM OLD.payment_method
      ) THEN
        RAISE EXCEPTION 'Order amounts are locked once payment has started';
      END IF;

      IF NEW.agreed_terms IS DISTINCT FROM OLD.agreed_terms
         AND (OLD.fulfillment_status <> 'DRAFT'
              OR public.order_payment_started(OLD.payment_status, OLD.paypal_order_id)) THEN
        RAISE EXCEPTION 'agreed_terms are frozen once the order is confirmed or payment has started';
      END IF;

      IF public.order_payment_started(OLD.payment_status, OLD.paypal_order_id) AND (
           NEW.customer_name_snapshot    IS DISTINCT FROM OLD.customer_name_snapshot
        OR NEW.customer_phone_snapshot   IS DISTINCT FROM OLD.customer_phone_snapshot
        OR NEW.customer_address_snapshot IS DISTINCT FROM OLD.customer_address_snapshot
      ) THEN
        RAISE EXCEPTION 'Customer details are frozen once payment has started';
      END IF;

      IF NEW.fulfillment_status IS DISTINCT FROM OLD.fulfillment_status THEN
        IF OLD.fulfillment_status IN ('DELIVERED', 'CANCELLED') THEN
          RAISE EXCEPTION 'Order is % and its status can no longer change', OLD.fulfillment_status;
        END IF;
        IF NEW.fulfillment_status = 'CANCELLED' THEN
          IF OLD.payment_status NOT IN ('UNPAID', 'REFUND_RECORDED') THEN
            RAISE EXCEPTION 'Cannot cancel an order whose payment is %; record a refund first', OLD.payment_status;
          END IF;
        ELSE
          v_old_rank := CASE OLD.fulfillment_status
            WHEN 'DRAFT' THEN 1 WHEN 'CONFIRMED' THEN 2 WHEN 'PROCESSING' THEN 3
            WHEN 'READY' THEN 4 WHEN 'DISPATCHED' THEN 5 END;
          v_new_rank := CASE NEW.fulfillment_status
            WHEN 'DRAFT' THEN 1 WHEN 'CONFIRMED' THEN 2 WHEN 'PROCESSING' THEN 3
            WHEN 'READY' THEN 4 WHEN 'DISPATCHED' THEN 5 WHEN 'DELIVERED' THEN 6 END;
          IF v_new_rank <= v_old_rank THEN
            RAISE EXCEPTION 'Order status can only move forward (% -> % is not allowed)', OLD.fulfillment_status, NEW.fulfillment_status;
          END IF;
        END IF;
      END IF;

      NEW.confirmed_at := OLD.confirmed_at;
    END IF;
  END IF;

  -- Server-set confirmed_at (all roles): only on the transition INTO a
  -- confirmed state, and never overwriting an existing value.
  IF TG_OP = 'INSERT' THEN
    v_was_confirmed := FALSE;
  ELSE
    v_was_confirmed := OLD.fulfillment_status IN ('CONFIRMED', 'PROCESSING', 'READY', 'DISPATCHED', 'DELIVERED');
  END IF;
  IF NEW.confirmed_at IS NULL AND NOT v_was_confirmed
     AND NEW.fulfillment_status IN ('CONFIRMED', 'PROCESSING', 'READY', 'DISPATCHED', 'DELIVERED') THEN
    NEW.confirmed_at := NOW();
  END IF;

  NEW.total_cents := NEW.subtotal_cents + NEW.delivery_fee_cents;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_guard_protected_columns ON public.orders;
CREATE TRIGGER orders_guard_protected_columns
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_protected_columns();

-- Security problem: deleting an order cascades to order_items, which would be a
-- back door around the item-history lock. Orders whose payment has started can
-- never be deleted by anyone (cancel them instead).
CREATE OR REPLACE FUNCTION public.guard_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF public.order_payment_started(OLD.payment_status, OLD.paypal_order_id) THEN
    RAISE EXCEPTION 'Order % cannot be deleted: payment has started. Cancel it instead.', OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS orders_guard_delete ON public.orders;
CREATE TRIGGER orders_guard_delete
  BEFORE DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_delete();

-- Pseudonymised hash used in audit events so the immutable log never holds
-- customer personal data. Salted with the order id and field name (defeats
-- cross-order rainbow tables). LIMIT: this is pseudonymisation, not anonymity.
-- Low-entropy values (a phone number) can be brute-forced by anyone who holds
-- the log and wants to; the hash proves "this value changed / matches", it does
-- not hide a guessable value from a determined reader of the log.
CREATE OR REPLACE FUNCTION public.pii_hash(p_order_id UUID, p_field TEXT, p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_value IS NULL THEN NULL
    ELSE pg_catalog.encode(
           pg_catalog.sha256(pg_catalog.convert_to(p_order_id::TEXT || ':' || p_field || ':' || p_value, 'UTF8')),
           'hex')
  END;
$$;

-- Automatic audit of changes to evidence fields. SECURITY DEFINER so the events
-- are written regardless of who made the change; the origin trigger then marks
-- them SYSTEM. actor = MERCHANT when the change came through an authenticated
-- merchant session (auth.uid() set), otherwise SYSTEM.
-- Not audited here (they have their own dedicated events): payment_status,
-- paypal_*, subtotal/total, public_token, confirmed_at.
CREATE OR REPLACE FUNCTION public.audit_order_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor TEXT := CASE WHEN auth.uid() IS NOT NULL THEN 'MERCHANT' ELSE 'SYSTEM' END;
BEGIN
  IF NEW.fulfillment_status IS DISTINCT FROM OLD.fulfillment_status THEN
    INSERT INTO public.order_events (order_id, event_type, actor, details)
    VALUES (NEW.id, 'ORDER_UPDATED', v_actor,
      jsonb_build_object('field', 'fulfillment_status', 'old', OLD.fulfillment_status, 'new', NEW.fulfillment_status));
  END IF;
  IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
    INSERT INTO public.order_events (order_id, event_type, actor, details)
    VALUES (NEW.id, 'ORDER_UPDATED', v_actor,
      jsonb_build_object('field', 'payment_method', 'old', OLD.payment_method, 'new', NEW.payment_method));
  END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    INSERT INTO public.order_events (order_id, event_type, actor, details)
    VALUES (NEW.id, 'ORDER_UPDATED', v_actor,
      jsonb_build_object('field', 'currency', 'old', OLD.currency, 'new', NEW.currency));
  END IF;
  IF NEW.delivery_fee_cents IS DISTINCT FROM OLD.delivery_fee_cents THEN
    INSERT INTO public.order_events (order_id, event_type, actor, details)
    VALUES (NEW.id, 'ORDER_UPDATED', v_actor,
      jsonb_build_object('field', 'delivery_fee_cents', 'old', OLD.delivery_fee_cents, 'new', NEW.delivery_fee_cents));
  END IF;
  IF NEW.agreed_terms IS DISTINCT FROM OLD.agreed_terms THEN
    INSERT INTO public.order_events (order_id, event_type, actor, details)
    VALUES (NEW.id, 'ORDER_UPDATED', v_actor,
      jsonb_build_object('field', 'agreed_terms', 'old', OLD.agreed_terms, 'new', NEW.agreed_terms));
  END IF;
  IF NEW.is_receipt_active IS DISTINCT FROM OLD.is_receipt_active THEN
    INSERT INTO public.order_events (order_id, event_type, actor, details)
    VALUES (NEW.id, 'ORDER_UPDATED', v_actor,
      jsonb_build_object('field', 'is_receipt_active', 'old', OLD.is_receipt_active, 'new', NEW.is_receipt_active));
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    INSERT INTO public.order_events (order_id, event_type, actor, details)
    VALUES (NEW.id, 'ORDER_UPDATED', v_actor,
      jsonb_build_object('field', 'customer_id', 'old', OLD.customer_id, 'new', NEW.customer_id));
  END IF;
  -- Personal data: hashes only, never the values.
  IF NEW.customer_name_snapshot IS DISTINCT FROM OLD.customer_name_snapshot THEN
    INSERT INTO public.order_events (order_id, event_type, actor, details)
    VALUES (NEW.id, 'ORDER_UPDATED', v_actor,
      jsonb_build_object('field', 'customer_name_snapshot',
        'old_sha256', public.pii_hash(NEW.id, 'customer_name_snapshot', OLD.customer_name_snapshot),
        'new_sha256', public.pii_hash(NEW.id, 'customer_name_snapshot', NEW.customer_name_snapshot)));
  END IF;
  IF NEW.customer_phone_snapshot IS DISTINCT FROM OLD.customer_phone_snapshot THEN
    INSERT INTO public.order_events (order_id, event_type, actor, details)
    VALUES (NEW.id, 'ORDER_UPDATED', v_actor,
      jsonb_build_object('field', 'customer_phone_snapshot',
        'old_sha256', public.pii_hash(NEW.id, 'customer_phone_snapshot', OLD.customer_phone_snapshot),
        'new_sha256', public.pii_hash(NEW.id, 'customer_phone_snapshot', NEW.customer_phone_snapshot)));
  END IF;
  IF NEW.customer_address_snapshot IS DISTINCT FROM OLD.customer_address_snapshot THEN
    INSERT INTO public.order_events (order_id, event_type, actor, details)
    VALUES (NEW.id, 'ORDER_UPDATED', v_actor,
      jsonb_build_object('field', 'customer_address_snapshot',
        'old_sha256', public.pii_hash(NEW.id, 'customer_address_snapshot', OLD.customer_address_snapshot),
        'new_sha256', public.pii_hash(NEW.id, 'customer_address_snapshot', NEW.customer_address_snapshot)));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS orders_audit_changes ON public.orders;
CREATE TRIGGER orders_audit_changes
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_order_changes();

-- ------------------------------------------------------------------------------
-- 3. ORDER_ITEMS: history lock + commit-time total verification
-- ------------------------------------------------------------------------------

-- 3a. History lock. Applies to EVERY role (including service_role and owner).
--     * Items can never move between orders.
--     * Once payment has started, items cannot be inserted/updated/deleted,
--       except inside public.correct_paid_order_items(), which sets a
--       transaction-local token naming exactly that order.
--     * The order row is locked FOR UPDATE, so an item edit and a payment-state
--       change on the same order serialise (no "edit while payment starts" race).
--     SECURITY DEFINER so the order lookup works regardless of caller privileges.
CREATE OR REPLACE FUNCTION public.guard_order_items_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target UUID;
  v_status TEXT;
  v_paypal TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'Order items cannot be moved between orders';
  END IF;

  v_target := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;

  SELECT o.payment_status, o.paypal_order_id
    INTO v_status, v_paypal
    FROM public.orders o
   WHERE o.id = v_target
     FOR UPDATE;

  IF NOT FOUND THEN
    -- Cascade from an order delete that already passed guard_order_delete.
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Order % not found', v_target;
  END IF;

  IF public.order_payment_started(v_status, v_paypal)
     AND current_setting('droptrust.item_correction_order', true) IS DISTINCT FROM v_target::TEXT THEN
    RAISE EXCEPTION 'Order % items are locked: payment has started', v_target;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_items_guard_history ON public.order_items;
CREATE TRIGGER order_items_guard_history
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_items_history();

-- 3b. Invariant: orders.subtotal_cents = SUM(order_items.line_total_cents).
--     A cross-table CHECK is not possible, so this is a DEFERRED constraint
--     trigger: evaluated at COMMIT, after all statements of the transaction,
--     for every role. Multi-statement writes (delete items, insert items,
--     update subtotal) are therefore fine as long as the end state is consistent.
CREATE OR REPLACE FUNCTION public.verify_order_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order_id UUID;
  v_subtotal BIGINT;
  v_sum BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    v_order_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_order_id := OLD.order_id;
  ELSE
    v_order_id := NEW.order_id;
  END IF;

  SELECT o.subtotal_cents INTO v_subtotal FROM public.orders o WHERE o.id = v_order_id;
  IF NOT FOUND THEN
    RETURN NULL;  -- order was deleted in this transaction
  END IF;

  SELECT COALESCE(SUM(i.line_total_cents), 0) INTO v_sum
    FROM public.order_items i WHERE i.order_id = v_order_id;

  IF v_subtotal <> v_sum THEN
    RAISE EXCEPTION 'Order % subtotal (%) does not equal the sum of its items (%)', v_order_id, v_subtotal, v_sum;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS order_items_verify_totals ON public.order_items;
CREATE CONSTRAINT TRIGGER order_items_verify_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.order_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.verify_order_totals();

DROP TRIGGER IF EXISTS orders_verify_totals ON public.orders;
CREATE CONSTRAINT TRIGGER orders_verify_totals
  AFTER INSERT OR UPDATE OF subtotal_cents, delivery_fee_cents, total_cents ON public.orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.verify_order_totals();

-- ------------------------------------------------------------------------------
-- 4. APPEND-ONLY ENFORCEMENT (payment_records, order_events) — all roles
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS payment_records_append_only ON public.payment_records;
CREATE TRIGGER payment_records_append_only
  BEFORE UPDATE OR DELETE ON public.payment_records
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

DROP TRIGGER IF EXISTS payment_records_no_truncate ON public.payment_records;
CREATE TRIGGER payment_records_no_truncate
  BEFORE TRUNCATE ON public.payment_records
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_mutation();

DROP TRIGGER IF EXISTS order_events_append_only ON public.order_events;
CREATE TRIGGER order_events_append_only
  BEFORE UPDATE OR DELETE ON public.order_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

DROP TRIGGER IF EXISTS order_events_no_truncate ON public.order_events;
CREATE TRIGGER order_events_no_truncate
  BEFORE TRUNCATE ON public.order_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_mutation();

DROP TRIGGER IF EXISTS refund_records_append_only ON public.refund_records;
CREATE TRIGGER refund_records_append_only
  BEFORE UPDATE OR DELETE ON public.refund_records
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

DROP TRIGGER IF EXISTS refund_records_no_truncate ON public.refund_records;
CREATE TRIGGER refund_records_no_truncate
  BEFORE TRUNCATE ON public.refund_records
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_mutation();

-- Event provenance. The caller can never choose origin: it is derived from the
-- role that performs the INSERT (invoker rights, so current_user is the
-- PostgREST role). Client roles -> CLIENT_REPORTED. Everything else (definer
-- functions, service_role, owner) -> SYSTEM. Rows written before v3.1 are LEGACY.
CREATE OR REPLACE FUNCTION public.set_event_origin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.origin := CASE WHEN current_user IN ('authenticated', 'anon') THEN 'CLIENT_REPORTED' ELSE 'SYSTEM' END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_events_set_origin ON public.order_events;
CREATE TRIGGER order_events_set_origin
  BEFORE INSERT ON public.order_events
  FOR EACH ROW EXECUTE FUNCTION public.set_event_origin();

-- ------------------------------------------------------------------------------
-- 5. INTERNAL HELPER: validate + write a full item list, return the subtotal
--    Not callable by any API role (see privileges). Only the SECURITY DEFINER
--    RPCs below call it. Totals are computed here from validated numbers; the
--    caller never supplies line totals.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.write_order_items(
  p_order_id UUID,
  p_business_id UUID,
  p_items JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_item JSONB;
  v_unit BIGINT;
  v_qty INT;
  v_product UUID;
  v_name TEXT;
  v_subtotal BIGINT := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a JSON array';
  END IF;
  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'too many items (max 200)';
  END IF;

  DELETE FROM public.order_items WHERE order_id = p_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'each item must be a JSON object';
    END IF;
    IF COALESCE(v_item->>'unit_price_cents', '') !~ '^[0-9]{1,12}$' THEN
      RAISE EXCEPTION 'unit_price_cents must be a non-negative integer (max 12 digits)';
    END IF;
    IF COALESCE(v_item->>'quantity', '') !~ '^[0-9]{1,5}$' THEN
      RAISE EXCEPTION 'quantity must be a positive integer';
    END IF;

    v_unit := (v_item->>'unit_price_cents')::BIGINT;
    v_qty := (v_item->>'quantity')::INT;
    IF v_qty < 1 OR v_qty > 10000 THEN
      RAISE EXCEPTION 'quantity must be between 1 and 10000';
    END IF;

    v_name := btrim(COALESCE(v_item->>'product_name', ''));
    IF v_name = '' THEN
      RAISE EXCEPTION 'product_name is required';
    END IF;

    v_product := NULL;
    IF v_item->>'product_id' IS NOT NULL THEN
      v_product := (v_item->>'product_id')::UUID;
      IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = v_product AND p.business_id = p_business_id) THEN
        RAISE EXCEPTION 'product % does not belong to this business', v_product;
      END IF;
    END IF;

    INSERT INTO public.order_items (
      order_id, product_id, product_name_snapshot, variant_name_snapshot,
      unit_price_cents, quantity, line_total_cents
    ) VALUES (
      p_order_id, v_product, v_name,
      NULLIF(btrim(COALESCE(v_item->>'variant_name', '')), ''),
      v_unit, v_qty, v_unit * v_qty
    );

    v_subtotal := v_subtotal + v_unit * v_qty;
  END LOOP;

  RETURN v_subtotal;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6a. set_order_items — the ONLY client path to change an order's items.
--     Atomically replaces the item list, recomputes subtotal (and optionally the
--     delivery fee) and lets the BEFORE trigger derive total. Refuses once
--     payment has started. Callable by the authenticated owner only.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_order_items(
  p_order_id UUID,
  p_items JSONB,
  p_delivery_fee_cents BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_subtotal BIGINT;
  v_total BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_delivery_fee_cents IS NOT NULL AND p_delivery_fee_cents < 0 THEN
    RAISE EXCEPTION 'delivery fee cannot be negative';
  END IF;

  SELECT o.* INTO v_order
    FROM public.orders o
    JOIN public.businesses b ON b.id = o.business_id
   WHERE o.id = p_order_id AND b.owner_user_id = auth.uid()
     FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF public.order_payment_started(v_order.payment_status, v_order.paypal_order_id) THEN
    RAISE EXCEPTION 'Order % items are locked: payment has started. Cancel and reissue the order, or use the audited correction process.', p_order_id;
  END IF;
  IF v_order.fulfillment_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Order % is cancelled', p_order_id;
  END IF;

  v_subtotal := public.write_order_items(p_order_id, v_order.business_id, p_items);

  UPDATE public.orders
     SET subtotal_cents = v_subtotal,
         delivery_fee_cents = COALESCE(p_delivery_fee_cents, delivery_fee_cents),
         updated_at = NOW()
   WHERE id = p_order_id
  RETURNING total_cents INTO v_total;

  INSERT INTO public.order_events (order_id, event_type, actor, details)
  VALUES (
    p_order_id, 'ORDER_ITEMS_REPLACED', 'MERCHANT',
    jsonb_build_object('item_count', jsonb_array_length(p_items), 'subtotal_cents', v_subtotal, 'total_cents', v_total)
  );

  RETURN jsonb_build_object('success', true, 'subtotal_cents', v_subtotal, 'total_cents', v_total);
END;
$$;

-- ------------------------------------------------------------------------------
-- 6b. correct_paid_order_items — the audited, service-role-only correction path.
--
--     POLICY: money never changes after payment starts. This function can fix
--     NON-MONETARY errors (a misspelt product name, a wrong variant label, a
--     re-split of lines) but the new item list must produce EXACTLY the same
--     subtotal; otherwise the whole call rolls back. Anything that changes what
--     was charged is handled as: cancel the order -> record the refund through
--     the payment provider and your refund process -> create a new order.
--     Every correction writes an audit event containing the full previous item
--     list, the reason and the actor.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_paid_order_items(
  p_order_id UUID,
  p_items JSONB,
  p_reason TEXT,
  p_actor TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_old JSONB;
  v_new_subtotal BIGINT;
BEGIN
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A correction reason of at least 10 characters is required';
  END IF;
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'The acting operator must be identified';
  END IF;

  SELECT o.* INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF NOT public.order_payment_started(v_order.payment_status, v_order.paypal_order_id) THEN
    RAISE EXCEPTION 'Payment has not started for order %; merchants edit it with set_order_items', p_order_id;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(oi) ORDER BY oi.id), '[]'::JSONB) INTO v_old
    FROM public.order_items oi WHERE oi.order_id = p_order_id;

  -- Transaction-local token naming exactly this order; lifts the history lock
  -- for this order only, only inside this function.
  PERFORM pg_catalog.set_config('droptrust.item_correction_order', p_order_id::TEXT, TRUE);
  v_new_subtotal := public.write_order_items(p_order_id, v_order.business_id, p_items);
  PERFORM pg_catalog.set_config('droptrust.item_correction_order', '', TRUE);

  IF v_new_subtotal <> v_order.subtotal_cents THEN
    RAISE EXCEPTION 'Correction would change the subtotal (% -> %). Money-changing corrections require cancel + refund + new order.',
      v_order.subtotal_cents, v_new_subtotal;
  END IF;

  INSERT INTO public.order_events (order_id, event_type, actor, details)
  VALUES (
    p_order_id, 'ORDER_ITEMS_CORRECTED', 'ADMIN_CORRECTION',
    jsonb_build_object('operator', btrim(p_actor), 'reason', btrim(p_reason),
                       'previous_items', v_old, 'subtotal_cents', v_new_subtotal)
  );

  RETURN jsonb_build_object('success', true, 'subtotal_cents', v_new_subtotal);
END;
$$;

-- ------------------------------------------------------------------------------
-- 6c. record_cash_payment — merchant records cash collected. Safe to retry.
--     * Exact retry (same order, same amount) returns the ORIGINAL result and
--       writes nothing.
--     * Conflicting retry (different amount, or paid by another method) raises.
--     * Concurrent double-submit serialises on the order row lock; the unique
--       partial index guarantees at most one COMPLETED payment per order.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_cash_payment(
  p_order_id UUID,
  p_amount_cents BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_rec public.payment_records%ROWTYPE;
  v_ref TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_order_id IS NULL OR p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'An order id and a positive amount are required';
  END IF;

  SELECT o.* INTO v_order
    FROM public.orders o
    JOIN public.businesses b ON b.id = o.business_id
   WHERE o.id = p_order_id AND b.owner_user_id = auth.uid()
     FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.payment_status = 'PAID' THEN
    SELECT r.* INTO v_rec
      FROM public.payment_records r
     WHERE r.order_id = p_order_id AND r.status = 'COMPLETED';

    IF FOUND
       AND v_rec.provider = 'CASH'
       AND v_rec.amount_cents = p_amount_cents
       AND v_rec.amount_cents = v_order.total_cents
       AND v_rec.currency = v_order.currency THEN
      RETURN jsonb_build_object(
        'success', true, 'payment_status', 'PAID', 'reference', v_rec.provider_reference,
        'amount_cents', v_rec.amount_cents, 'verification', 'MERCHANT_REPORTED', 'already_processed', true);
    END IF;
    RAISE EXCEPTION 'Order % is already paid and this request does not match the recorded payment', p_order_id;
  END IF;

  IF v_order.payment_method <> 'CASH_ON_DELIVERY' THEN
    RAISE EXCEPTION 'Order % is not a cash-on-delivery order', p_order_id;
  END IF;
  IF v_order.payment_status <> 'UNPAID' THEN
    RAISE EXCEPTION 'Order % is not awaiting payment (status: %)', p_order_id, v_order.payment_status;
  END IF;
  IF v_order.fulfillment_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Order % is cancelled', p_order_id;
  END IF;
  IF v_order.total_cents <= 0 OR p_amount_cents <> v_order.total_cents THEN
    RAISE EXCEPTION 'Amount % does not match order total %', p_amount_cents, v_order.total_cents;
  END IF;

  v_ref := 'CASH-' || gen_random_uuid()::TEXT;

  UPDATE public.orders
     SET payment_status = 'PAID', updated_at = NOW()
   WHERE id = p_order_id;

  INSERT INTO public.payment_records (order_id, provider, provider_reference, amount_cents, currency, status)
  VALUES (p_order_id, 'CASH', v_ref, v_order.total_cents, v_order.currency, 'COMPLETED');

  INSERT INTO public.order_events (order_id, event_type, actor, details)
  VALUES (
    p_order_id, 'CASH_PAYMENT_RECORDED', 'MERCHANT',
    jsonb_build_object('amount_cents', v_order.total_cents, 'currency', v_order.currency, 'reference', v_ref,
                       'verification', 'MERCHANT_REPORTED')
  );

  RETURN jsonb_build_object(
    'success', true, 'payment_status', 'PAID', 'reference', v_ref,
    'amount_cents', v_order.total_cents, 'verification', 'MERCHANT_REPORTED', 'already_processed', false);
END;
$$;

-- ------------------------------------------------------------------------------
-- 6d. assign_paypal_order — PayPal CHECKOUT SETUP (service_role only)
--
--     Order of operations in the trusted backend (e.g. a Next.js route handler
--     using the service-role key; never expose that key to the browser):
--       1. Authenticate the merchant/customer request and authorise it.
--       2. READ the order from the database (total_cents, currency). Never take
--          the amount from the request body.
--       3. Require orders.payment_method = 'PAYPAL' and currency = 'USD'.
--          PayPal does not settle KES, so these orders are priced in USD.
--          Any KES->USD conversion is the app's job, done BEFORE the order is
--          priced, and is never done silently at checkout. Convert cents to
--          PayPal's decimal string with integer math (cents/100, 2 decimals),
--          never floating point.
--       4. Call PayPal "create order" with exactly that amount + 'USD'.
--       5. Call this function with the returned PayPal order id. Only now does
--          orders.paypal_order_id get set and payment_status become 'PENDING'.
--
--     Authenticated clients cannot do step 5: they have no UPDATE grant on
--     paypal_order_id / payment_status, the guard trigger rejects them, and
--     EXECUTE on this function is granted to service_role only.
--
--     Re-assigning while still PENDING is allowed (customer abandoned checkout
--     and a new PayPal order is created); the previous id is kept in the audit
--     event. A capture for a superseded PayPal order will be rejected by
--     record_verified_paypal_capture, so the backend must void/refund it at PayPal.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_paypal_order(
  p_order_id UUID,
  p_paypal_order_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF p_order_id IS NULL OR p_paypal_order_id IS NULL OR btrim(p_paypal_order_id) = '' THEN
    RAISE EXCEPTION 'order id and PayPal order id are required and must be non-empty';
  END IF;

  SELECT o.* INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  IF v_order.payment_method <> 'PAYPAL' THEN
    RAISE EXCEPTION 'Order % is not a PayPal order', p_order_id;
  END IF;
  IF v_order.currency <> 'USD' THEN
    RAISE EXCEPTION 'PayPal orders must be priced in USD (order currency is %)', v_order.currency;
  END IF;
  IF v_order.fulfillment_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Order % is cancelled', p_order_id;
  END IF;
  IF v_order.total_cents <= 0 THEN
    RAISE EXCEPTION 'Order % has no payable total', p_order_id;
  END IF;
  IF v_order.payment_status NOT IN ('UNPAID', 'PENDING') THEN
    RAISE EXCEPTION 'Order % cannot start PayPal checkout (status: %)', p_order_id, v_order.payment_status;
  END IF;

  IF v_order.payment_status = 'PENDING' AND v_order.paypal_order_id = p_paypal_order_id THEN
    RETURN jsonb_build_object('success', true, 'payment_status', 'PENDING', 'already_assigned', true);
  END IF;

  UPDATE public.orders
     SET paypal_order_id = p_paypal_order_id,
         payment_status = 'PENDING',
         updated_at = NOW()
   WHERE id = p_order_id;

  INSERT INTO public.order_events (order_id, event_type, actor, details)
  VALUES (
    p_order_id, 'PAYPAL_ORDER_ASSIGNED', 'PAYPAL_SYSTEM',
    jsonb_build_object('paypal_order_id', p_paypal_order_id,
                       'previous_paypal_order_id', v_order.paypal_order_id,
                       'amount_cents', v_order.total_cents, 'currency', v_order.currency)
  );

  RETURN jsonb_build_object('success', true, 'payment_status', 'PENDING', 'already_assigned', false);
END;
$$;

-- ------------------------------------------------------------------------------
-- 6e. record_verified_paypal_capture (service_role only)
--
--     TRUST BOUNDARY — READ THIS: this function CANNOT verify that a capture is
--     real. The database has no way to talk to PayPal. The trusted backend MUST,
--     BEFORE calling it, fetch the capture/order from PayPal's REST API
--     (server-to-server, with your client secret; and/or a verified webhook
--     signature) and confirm ALL of:
--       * the PayPal order status is COMPLETED and the capture status is COMPLETED
--       * the capture id belongs to that PayPal order
--       * amount.value (converted to integer cents) and currency_code ('USD')
--         match what PayPal returned, which must match our order
--       * the payee/merchant id is YOUR PayPal account
--     and then pass PayPal's values (never browser-supplied values) here. This
--     function then enforces consistency with OUR records and idempotency.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_verified_paypal_capture(
  p_order_id UUID,
  p_paypal_order_id TEXT,
  p_capture_id TEXT,
  p_amount_cents BIGINT,
  p_currency TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_rec public.payment_records%ROWTYPE;
BEGIN
  IF p_order_id IS NULL
     OR p_paypal_order_id IS NULL OR btrim(p_paypal_order_id) = ''
     OR p_capture_id IS NULL OR btrim(p_capture_id) = ''
     OR p_currency IS NULL THEN
    RAISE EXCEPTION 'order id, PayPal order id and capture id are required and must be non-empty';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Captured amount must be positive';
  END IF;
  IF p_currency <> 'USD' THEN
    RAISE EXCEPTION 'PayPal captures are only accepted in USD (got %)', p_currency;
  END IF;

  SELECT o.* INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;
  IF v_order.payment_method <> 'PAYPAL' THEN
    RAISE EXCEPTION 'Order % is not a PayPal order', p_order_id;
  END IF;

  -- Strict idempotency: a replay succeeds ONLY if the order AND the stored
  -- payment record both agree with every field of this request.
  IF v_order.payment_status = 'PAID' THEN
    SELECT r.* INTO v_rec
      FROM public.payment_records r
     WHERE r.provider = 'PAYPAL' AND r.provider_reference = p_capture_id;

    IF FOUND
       AND v_rec.order_id = p_order_id
       AND v_rec.status = 'COMPLETED'
       AND v_rec.amount_cents = p_amount_cents
       AND v_rec.amount_cents = v_order.total_cents
       AND v_rec.currency = p_currency
       AND v_rec.currency = v_order.currency
       AND v_order.paypal_capture_id = p_capture_id
       AND v_order.paypal_order_id = p_paypal_order_id THEN
      RETURN jsonb_build_object('success', true, 'payment_status', 'PAID', 'already_processed', true);
    END IF;

    RAISE EXCEPTION 'Order % is already paid and this capture request does not match the recorded payment', p_order_id;
  END IF;

  IF v_order.payment_status <> 'PENDING' THEN
    RAISE EXCEPTION 'Order % is not awaiting a PayPal capture (status: %)', p_order_id, v_order.payment_status;
  END IF;
  IF v_order.fulfillment_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Order % is cancelled and cannot be paid', p_order_id;
  END IF;
  IF v_order.paypal_order_id IS DISTINCT FROM p_paypal_order_id THEN
    RAISE EXCEPTION 'PayPal Order ID mismatch: expected %, got %', v_order.paypal_order_id, p_paypal_order_id;
  END IF;
  IF v_order.total_cents <> p_amount_cents OR v_order.currency <> p_currency THEN
    RAISE EXCEPTION 'Captured amount (% %) does not match order (% %)',
      p_amount_cents, p_currency, v_order.total_cents, v_order.currency;
  END IF;

  UPDATE public.orders
     SET payment_status = 'PAID', paypal_capture_id = p_capture_id, updated_at = NOW()
   WHERE id = p_order_id;

  -- idempotency_key = PayPal order id: one capture per PayPal order, enforced by UNIQUE.
  INSERT INTO public.payment_records (
    order_id, provider, provider_reference, amount_cents, currency, status, idempotency_key
  ) VALUES (
    p_order_id, 'PAYPAL', p_capture_id, p_amount_cents, p_currency, 'COMPLETED', p_paypal_order_id
  );

  INSERT INTO public.order_events (order_id, event_type, actor, details)
  VALUES (
    p_order_id, 'PAYMENT_CAPTURED', 'PAYPAL_SYSTEM',
    jsonb_build_object('capture_id', p_capture_id, 'paypal_order_id', p_paypal_order_id,
                       'amount_cents', p_amount_cents, 'currency', p_currency,
                       'verification', 'PROVIDER_CONFIRMED')
  );

  RETURN jsonb_build_object('success', true, 'payment_status', 'PAID', 'already_processed', false);
END;
$$;

-- ------------------------------------------------------------------------------
-- 6f. correct_order_details — audited correction of customer-detail TYPOS after
--     payment has started (service_role only). Only the three customer snapshot
--     fields can be corrected. agreed_terms and confirmed_at can NEVER be
--     corrected: a different agreement means a new order. The event stores
--     hashes (not values), the reason and the operator.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_order_details(
  p_order_id UUID,
  p_changes JSONB,
  p_reason TEXT,
  p_actor TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_key TEXT;
  v_fields JSONB := '{}'::JSONB;
BEGIN
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A correction reason of at least 10 characters is required';
  END IF;
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'The acting operator must be identified';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::JSONB THEN
    RAISE EXCEPTION 'p_changes must be a non-empty JSON object';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_changes) LOOP
    IF v_key NOT IN ('customer_name_snapshot', 'customer_phone_snapshot', 'customer_address_snapshot') THEN
      RAISE EXCEPTION 'Field % cannot be corrected (only customer name/phone/address)', v_key;
    END IF;
    IF jsonb_typeof(p_changes->v_key) <> 'string'
       OR char_length(btrim(p_changes->>v_key)) NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'Field % must be a string of 1 to 500 characters', v_key;
    END IF;
  END LOOP;

  SELECT o.* INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF NOT public.order_payment_started(v_order.payment_status, v_order.paypal_order_id) THEN
    RAISE EXCEPTION 'Payment has not started for order %; merchants edit customer details directly', p_order_id;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_changes) LOOP
    v_fields := v_fields || jsonb_build_object(v_key, jsonb_build_object(
      'old_sha256', public.pii_hash(p_order_id, v_key, to_jsonb(v_order)->>v_key),
      'new_sha256', public.pii_hash(p_order_id, v_key, btrim(p_changes->>v_key))));
  END LOOP;

  UPDATE public.orders
     SET customer_name_snapshot    = CASE WHEN p_changes ? 'customer_name_snapshot'    THEN btrim(p_changes->>'customer_name_snapshot')    ELSE customer_name_snapshot END,
         customer_phone_snapshot   = CASE WHEN p_changes ? 'customer_phone_snapshot'   THEN btrim(p_changes->>'customer_phone_snapshot')   ELSE customer_phone_snapshot END,
         customer_address_snapshot = CASE WHEN p_changes ? 'customer_address_snapshot' THEN btrim(p_changes->>'customer_address_snapshot') ELSE customer_address_snapshot END,
         updated_at = NOW()
   WHERE id = p_order_id;

  INSERT INTO public.order_events (order_id, event_type, actor, details)
  VALUES (p_order_id, 'ORDER_DETAILS_CORRECTED', 'ADMIN_CORRECTION',
          jsonb_build_object('operator', btrim(p_actor), 'reason', btrim(p_reason), 'fields', v_fields));

  RETURN jsonb_build_object('success', true, 'corrected_fields', (SELECT jsonb_agg(k) FROM jsonb_object_keys(v_fields) k));
END;
$$;

-- ------------------------------------------------------------------------------
-- 6g. REFUNDS (full refunds only). A refund is recorded in its own immutable
--     ledger (refund_records) and moves the order to REFUND_RECORDED, which is
--     terminal. Items stay locked. A customer who wants the goods again gets a
--     NEW order. Cancelling a refunded order is a separate merchant action
--     (allowed by the status guard once REFUND_RECORDED).
-- ------------------------------------------------------------------------------

-- record_paypal_refund (service_role only).
-- TRUST BOUNDARY: like captures, the database cannot verify a refund with
-- PayPal. The trusted backend MUST first fetch the refund from PayPal's API
-- (server-to-server) and confirm: refund status COMPLETED, the refund belongs to
-- this capture, amount and currency match what PayPal returned, then pass
-- PayPal's values here. Idempotent: a replay succeeds only if the order, the
-- original payment record and the stored refund all agree on every field.
CREATE OR REPLACE FUNCTION public.record_paypal_refund(
  p_order_id UUID,
  p_paypal_refund_id TEXT,
  p_capture_id TEXT,
  p_amount_cents BIGINT,
  p_currency TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_pay public.payment_records%ROWTYPE;
  v_ref public.refund_records%ROWTYPE;
BEGIN
  IF p_order_id IS NULL
     OR p_paypal_refund_id IS NULL OR btrim(p_paypal_refund_id) = ''
     OR p_capture_id IS NULL OR btrim(p_capture_id) = ''
     OR p_currency IS NULL THEN
    RAISE EXCEPTION 'order id, PayPal refund id and capture id are required and must be non-empty';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be positive';
  END IF;
  IF p_currency <> 'USD' THEN
    RAISE EXCEPTION 'PayPal refunds are only accepted in USD (got %)', p_currency;
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A refund reason of at least 10 characters is required';
  END IF;

  SELECT o.* INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;
  IF v_order.payment_method <> 'PAYPAL' THEN
    RAISE EXCEPTION 'Order % is not a PayPal order', p_order_id;
  END IF;

  SELECT r.* INTO v_pay
    FROM public.payment_records r
   WHERE r.order_id = p_order_id AND r.provider = 'PAYPAL'
     AND r.provider_reference = p_capture_id AND r.status = 'COMPLETED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No completed PayPal payment with capture id % exists for order %', p_capture_id, p_order_id;
  END IF;

  IF v_order.payment_status = 'REFUND_RECORDED' THEN
    SELECT f.* INTO v_ref
      FROM public.refund_records f
     WHERE f.provider = 'PAYPAL' AND f.provider_reference = p_paypal_refund_id;
    IF FOUND
       AND v_ref.order_id = p_order_id
       AND v_ref.payment_record_id = v_pay.id
       AND v_ref.status = 'COMPLETED'
       AND v_ref.amount_cents = p_amount_cents
       AND v_ref.amount_cents = v_pay.amount_cents
       AND v_ref.currency = p_currency
       AND v_ref.currency = v_pay.currency THEN
      RETURN jsonb_build_object('success', true, 'payment_status', 'REFUND_RECORDED',
                                'verification', v_ref.verification, 'already_processed', true);
    END IF;
    RAISE EXCEPTION 'Order % is already refunded and this request does not match the recorded refund', p_order_id;
  END IF;

  IF v_order.payment_status <> 'PAID' THEN
    RAISE EXCEPTION 'Order % is not in a refundable state (status: %)', p_order_id, v_order.payment_status;
  END IF;
  IF p_amount_cents <> v_pay.amount_cents OR p_currency <> v_pay.currency THEN
    RAISE EXCEPTION 'Only full refunds are supported (paid % %, refund % %)',
      v_pay.amount_cents, v_pay.currency, p_amount_cents, p_currency;
  END IF;

  INSERT INTO public.refund_records (
    order_id, payment_record_id, provider, provider_reference, amount_cents, currency, status, reason, recorded_by
  ) VALUES (
    p_order_id, v_pay.id, 'PAYPAL', p_paypal_refund_id, p_amount_cents, p_currency, 'COMPLETED', btrim(p_reason), 'PAYPAL_SYSTEM'
  );

  UPDATE public.orders SET payment_status = 'REFUND_RECORDED', updated_at = NOW() WHERE id = p_order_id;

  INSERT INTO public.order_events (order_id, event_type, actor, details)
  VALUES (p_order_id, 'REFUND_RECORDED', 'PAYPAL_SYSTEM',
          jsonb_build_object('refund_id', p_paypal_refund_id, 'capture_id', p_capture_id,
                             'amount_cents', p_amount_cents, 'currency', p_currency,
                             'verification', 'PROVIDER_CONFIRMED', 'reason', btrim(p_reason)));

  RETURN jsonb_build_object('success', true, 'payment_status', 'REFUND_RECORDED',
                            'verification', 'PROVIDER_CONFIRMED', 'already_processed', false);
END;
$$;

-- record_cash_refund (authenticated order owner). MERCHANT_REPORTED: the
-- database only knows the merchant says cash was handed back. Safe to retry: an
-- exact retry (same amount) returns the ORIGINAL reference; a different amount
-- is rejected. (The reason text of a retry is not compared.)
CREATE OR REPLACE FUNCTION public.record_cash_refund(
  p_order_id UUID,
  p_amount_cents BIGINT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_pay public.payment_records%ROWTYPE;
  v_ref public.refund_records%ROWTYPE;
  v_new_ref TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_order_id IS NULL OR p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'An order id and a positive amount are required';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A refund reason of at least 10 characters is required';
  END IF;

  SELECT o.* INTO v_order
    FROM public.orders o
    JOIN public.businesses b ON b.id = o.business_id
   WHERE o.id = p_order_id AND b.owner_user_id = auth.uid()
     FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.payment_method <> 'CASH_ON_DELIVERY' THEN
    RAISE EXCEPTION 'Order % is not a cash-on-delivery order', p_order_id;
  END IF;

  SELECT r.* INTO v_pay
    FROM public.payment_records r
   WHERE r.order_id = p_order_id AND r.provider = 'CASH' AND r.status = 'COMPLETED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % has no completed cash payment to refund', p_order_id;
  END IF;

  IF v_order.payment_status = 'REFUND_RECORDED' THEN
    SELECT f.* INTO v_ref
      FROM public.refund_records f
     WHERE f.order_id = p_order_id AND f.provider = 'CASH';
    IF FOUND
       AND v_ref.payment_record_id = v_pay.id
       AND v_ref.amount_cents = p_amount_cents
       AND v_ref.amount_cents = v_pay.amount_cents
       AND v_ref.currency = v_pay.currency THEN
      RETURN jsonb_build_object('success', true, 'payment_status', 'REFUND_RECORDED',
                                'reference', v_ref.provider_reference, 'amount_cents', v_ref.amount_cents,
                                'verification', v_ref.verification, 'already_processed', true);
    END IF;
    RAISE EXCEPTION 'Order % is already refunded and this request does not match the recorded refund', p_order_id;
  END IF;

  IF v_order.payment_status <> 'PAID' THEN
    RAISE EXCEPTION 'Order % is not in a refundable state (status: %)', p_order_id, v_order.payment_status;
  END IF;
  IF p_amount_cents <> v_pay.amount_cents THEN
    RAISE EXCEPTION 'Only full refunds are supported (paid %, refund %)', v_pay.amount_cents, p_amount_cents;
  END IF;

  v_new_ref := 'CASHREF-' || gen_random_uuid()::TEXT;

  INSERT INTO public.refund_records (
    order_id, payment_record_id, provider, provider_reference, amount_cents, currency, status, reason, recorded_by
  ) VALUES (
    p_order_id, v_pay.id, 'CASH', v_new_ref, v_pay.amount_cents, v_pay.currency, 'COMPLETED', btrim(p_reason), 'MERCHANT'
  );

  UPDATE public.orders SET payment_status = 'REFUND_RECORDED', updated_at = NOW() WHERE id = p_order_id;

  INSERT INTO public.order_events (order_id, event_type, actor, details)
  VALUES (p_order_id, 'REFUND_RECORDED', 'MERCHANT',
          jsonb_build_object('reference', v_new_ref, 'amount_cents', v_pay.amount_cents, 'currency', v_pay.currency,
                             'verification', 'MERCHANT_REPORTED', 'reason', btrim(p_reason)));

  RETURN jsonb_build_object('success', true, 'payment_status', 'REFUND_RECORDED',
                            'reference', v_new_ref, 'amount_cents', v_pay.amount_cents,
                            'verification', 'MERCHANT_REPORTED', 'already_processed', false);
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. SIGNUP PROVISIONING TRIGGER (duplicate-safe; now with an empty search_path)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_merchant_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.businesses (owner_user_id, name, currency)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'business_name', 'My Store'),
    'KES'
  )
  ON CONFLICT (owner_user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_merchant_user();

-- ------------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY — tenant isolation (unchanged in intent from v2)
--    Note: order_items INSERT/UPDATE/DELETE policies are kept as defence in
--    depth, but clients no longer hold those privileges (section 9); item
--    writes go through set_order_items().
-- ------------------------------------------------------------------------------
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_records ENABLE ROW LEVEL SECURITY;

-- BUSINESSES
DROP POLICY IF EXISTS "businesses_select" ON public.businesses;
CREATE POLICY "businesses_select" ON public.businesses FOR SELECT
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "businesses_insert" ON public.businesses;
CREATE POLICY "businesses_insert" ON public.businesses FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "businesses_update" ON public.businesses;
CREATE POLICY "businesses_update" ON public.businesses FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "businesses_delete" ON public.businesses;
CREATE POLICY "businesses_delete" ON public.businesses FOR DELETE
  USING (owner_user_id = auth.uid());

-- CUSTOMERS
DROP POLICY IF EXISTS "customers_select" ON public.customers;
CREATE POLICY "customers_select" ON public.customers FOR SELECT
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "customers_insert" ON public.customers;
CREATE POLICY "customers_insert" ON public.customers FOR INSERT
  WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "customers_update" ON public.customers;
CREATE POLICY "customers_update" ON public.customers FOR UPDATE
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()))
  WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "customers_delete" ON public.customers;
CREATE POLICY "customers_delete" ON public.customers FOR DELETE
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()));

-- PRODUCTS
DROP POLICY IF EXISTS "products_select" ON public.products;
CREATE POLICY "products_select" ON public.products FOR SELECT
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "products_insert" ON public.products;
CREATE POLICY "products_insert" ON public.products FOR INSERT
  WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "products_update" ON public.products;
CREATE POLICY "products_update" ON public.products FOR UPDATE
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()))
  WITH CHECK (business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "products_delete" ON public.products;
CREATE POLICY "products_delete" ON public.products FOR DELETE
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()));

-- ORDERS (column protection: grants in section 9 + guard trigger in section 2)
DROP POLICY IF EXISTS "orders_select" ON public.orders;
CREATE POLICY "orders_select" ON public.orders FOR SELECT
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "orders_insert" ON public.orders;
CREATE POLICY "orders_insert" ON public.orders FOR INSERT
  WITH CHECK (
    business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()) AND
    (customer_id IS NULL OR customer_id IN (SELECT id FROM public.customers WHERE business_id = orders.business_id))
  );

DROP POLICY IF EXISTS "orders_update" ON public.orders;
CREATE POLICY "orders_update" ON public.orders FOR UPDATE
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()))
  WITH CHECK (
    business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()) AND
    (customer_id IS NULL OR customer_id IN (SELECT id FROM public.customers WHERE business_id = orders.business_id))
  );

DROP POLICY IF EXISTS "orders_delete" ON public.orders;
CREATE POLICY "orders_delete" ON public.orders FOR DELETE
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_user_id = auth.uid()));

-- ORDER_ITEMS
DROP POLICY IF EXISTS "order_items_select" ON public.order_items;
CREATE POLICY "order_items_select" ON public.order_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = order_items.order_id AND b.owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "order_items_insert" ON public.order_items;
CREATE POLICY "order_items_insert" ON public.order_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id
      WHERE o.id = order_items.order_id AND b.owner_user_id = auth.uid() AND
      (order_items.product_id IS NULL OR order_items.product_id IN (SELECT p.id FROM public.products p WHERE p.business_id = b.id))
    )
  );

DROP POLICY IF EXISTS "order_items_update" ON public.order_items;
CREATE POLICY "order_items_update" ON public.order_items FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = order_items.order_id AND b.owner_user_id = auth.uid()))
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id
      WHERE o.id = order_items.order_id AND b.owner_user_id = auth.uid() AND
      (order_items.product_id IS NULL OR order_items.product_id IN (SELECT p.id FROM public.products p WHERE p.business_id = b.id))
    )
  );

DROP POLICY IF EXISTS "order_items_delete" ON public.order_items;
CREATE POLICY "order_items_delete" ON public.order_items FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = order_items.order_id AND b.owner_user_id = auth.uid()));

-- EXTRACTION_RECORDS
DROP POLICY IF EXISTS "extraction_records_select" ON public.extraction_records;
CREATE POLICY "extraction_records_select" ON public.extraction_records FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = extraction_records.order_id AND b.owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "extraction_records_insert" ON public.extraction_records;
CREATE POLICY "extraction_records_insert" ON public.extraction_records FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = extraction_records.order_id AND b.owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "extraction_records_update" ON public.extraction_records;
CREATE POLICY "extraction_records_update" ON public.extraction_records FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = extraction_records.order_id AND b.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = extraction_records.order_id AND b.owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "extraction_records_delete" ON public.extraction_records;
CREATE POLICY "extraction_records_delete" ON public.extraction_records FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = extraction_records.order_id AND b.owner_user_id = auth.uid()));

-- ORDER_EVENTS: append-only. v3.1: clients may only write NOTES
-- (NOTE_ADDED / RECEIPT_SHARED) whose details are nothing but {"note": text<=1000}.
-- Everything factual (creation, field changes, status changes, items, payments,
-- refunds, corrections) is written by triggers / SECURITY DEFINER functions /
-- service_role and is stamped origin = SYSTEM.
DROP POLICY IF EXISTS "order_events_select" ON public.order_events;
CREATE POLICY "order_events_select" ON public.order_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = order_events.order_id AND b.owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "order_events_insert" ON public.order_events;
CREATE POLICY "order_events_insert" ON public.order_events FOR INSERT
  WITH CHECK (
    actor = 'MERCHANT' AND
    event_type IN ('NOTE_ADDED', 'RECEIPT_SHARED') AND
    (details IS NULL OR (
       jsonb_typeof(details) = 'object' AND
       (details - 'note') = '{}'::JSONB AND
       (NOT (details ? 'note') OR (jsonb_typeof(details->'note') = 'string' AND char_length(details->>'note') <= 1000))
    )) AND
    EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = order_events.order_id AND b.owner_user_id = auth.uid())
  );

-- PAYMENT_RECORDS: SELECT only. No client INSERT policy exists.
DROP POLICY IF EXISTS "payment_records_select" ON public.payment_records;
CREATE POLICY "payment_records_select" ON public.payment_records FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = payment_records.order_id AND b.owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "payment_records_insert_cash_only" ON public.payment_records;

-- REFUND_RECORDS: SELECT only for the owner. No client write policy exists.
DROP POLICY IF EXISTS "refund_records_select" ON public.refund_records;
CREATE POLICY "refund_records_select" ON public.refund_records FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = refund_records.order_id AND b.owner_user_id = auth.uid()));

-- ------------------------------------------------------------------------------
-- 9. PRIVILEGES — least privilege, stated explicitly
--
-- Security problem: Supabase's default privileges grant ALL on new public
-- tables/functions to anon, authenticated and service_role, and Postgres grants
-- EXECUTE on new functions to PUBLIC. RLS only filters rows; it does not stop a
-- client writing any column it can see. So: wipe everything on these tables,
-- then grant back only what each role needs.
--
-- (Optional, project-wide, not done here because it affects unrelated tables:
--  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;)
-- ------------------------------------------------------------------------------

-- 9a. Tables
REVOKE ALL ON TABLE
  public.businesses, public.customers, public.products, public.orders,
  public.order_items, public.extraction_records, public.order_events, public.payment_records,
  public.refund_records
FROM PUBLIC, anon, authenticated, service_role;

-- anon: nothing. Public receipts must be served by a server route using
-- service_role that selects only the columns a receipt needs.

-- authenticated (merchants). RLS still applies on top of all of this.
GRANT SELECT ON TABLE
  public.businesses, public.customers, public.products, public.orders,
  public.order_items, public.extraction_records, public.order_events, public.payment_records,
  public.refund_records
TO authenticated;

GRANT INSERT (owner_user_id, name, currency, phone) ON TABLE public.businesses TO authenticated;
GRANT UPDATE (name, currency, phone)                ON TABLE public.businesses TO authenticated;
-- No DELETE on businesses: account/business deletion is an admin process.

GRANT INSERT (business_id, name, phone, email, address) ON TABLE public.customers TO authenticated;
GRANT UPDATE (name, phone, email, address)              ON TABLE public.customers TO authenticated;
GRANT DELETE ON TABLE public.customers TO authenticated;

GRANT INSERT (business_id, name, sku, default_price_cents, currency, is_active) ON TABLE public.products TO authenticated;
GRANT UPDATE (name, sku, default_price_cents, currency, is_active)              ON TABLE public.products TO authenticated;
GRANT DELETE ON TABLE public.products TO authenticated;

-- ORDERS: clients can NOT supply id, public_token, payment_status, subtotal_cents,
-- total_cents, paypal_order_id, paypal_capture_id, confirmed_at (server-set),
-- created_at on INSERT, and can
-- never UPDATE those (nor business_id / order_reference). DELETE is allowed but
-- the delete guard blocks it once payment has started.
GRANT INSERT (
  business_id, customer_id, order_reference, fulfillment_status, payment_method,
  delivery_fee_cents, currency, customer_name_snapshot, customer_phone_snapshot,
  customer_address_snapshot, agreed_terms, is_receipt_active
) ON TABLE public.orders TO authenticated;
GRANT UPDATE (
  customer_id, fulfillment_status, payment_method, delivery_fee_cents, currency,
  customer_name_snapshot, customer_phone_snapshot, customer_address_snapshot,
  agreed_terms, is_receipt_active, updated_at
) ON TABLE public.orders TO authenticated;
GRANT DELETE ON TABLE public.orders TO authenticated;

-- ORDER_ITEMS: read-only for clients. Writes go through set_order_items().

GRANT INSERT (order_id, storage_file_path, status, raw_model_output) ON TABLE public.extraction_records TO authenticated;
GRANT UPDATE (storage_file_path, status, raw_model_output)           ON TABLE public.extraction_records TO authenticated;
GRANT DELETE ON TABLE public.extraction_records TO authenticated;

-- ORDER_EVENTS: client INSERT of notes only (RLS policy enforces actor/type/details;
-- origin is not grantable and is set by trigger).
GRANT INSERT (order_id, event_type, actor, details) ON TABLE public.order_events TO authenticated;

-- PAYMENT_RECORDS: SELECT only (granted above). No client INSERT/UPDATE/DELETE.

-- service_role (trusted backend). It bypasses RLS, so its TABLE privileges are
-- the only brake on a backend bug or a leaked key. Reads everything; writes
-- only what the backend legitimately writes directly. Orders, items and
-- payments change ONLY through the SECURITY DEFINER functions below.
GRANT SELECT ON TABLE
  public.businesses, public.customers, public.products, public.orders,
  public.order_items, public.extraction_records, public.order_events, public.payment_records,
  public.refund_records
TO service_role;
GRANT INSERT, UPDATE ON TABLE public.extraction_records TO service_role;
GRANT INSERT ON TABLE public.order_events TO service_role;
-- Widen deliberately if your backend needs more, e.g.:
--   GRANT UPDATE (fulfillment_status) ON TABLE public.orders TO service_role;

-- 9b. Functions: revoke everything from everyone, then grant exactly what is needed.

-- Pure helper, called from invoker-rights triggers running as the client role.
REVOKE ALL ON FUNCTION public.order_payment_started(TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.order_payment_started(TEXT, TEXT) TO anon, authenticated, service_role;

-- Trigger functions and internal helper: no API role may execute them directly.
REVOKE ALL ON FUNCTION public.guard_order_protected_columns() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_order_delete()            FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_order_items_history()     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.verify_order_totals()           FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_mutation()              FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_new_merchant_user()      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.write_order_items(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;

-- Merchant-facing RPCs (they authenticate with auth.uid() and check ownership).
REVOKE ALL ON FUNCTION public.set_order_items(UUID, JSONB, BIGINT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_order_items(UUID, JSONB, BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.record_cash_payment(UUID, BIGINT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_cash_payment(UUID, BIGINT) TO authenticated;

-- Trusted-backend-only functions.
REVOKE ALL ON FUNCTION public.assign_paypal_order(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_paypal_order(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.record_verified_paypal_capture(UUID, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_verified_paypal_capture(UUID, TEXT, TEXT, BIGINT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.correct_paid_order_items(UUID, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_paid_order_items(UUID, JSONB, TEXT, TEXT) TO service_role;

-- v3.1 functions.
REVOKE ALL ON FUNCTION public.pii_hash(UUID, TEXT, TEXT)        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.audit_order_changes()             FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_event_origin()                FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_cash_refund(UUID, BIGINT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_cash_refund(UUID, BIGINT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.record_paypal_refund(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_paypal_refund(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.correct_order_details(UUID, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_order_details(UUID, JSONB, TEXT, TEXT) TO service_role;

-- Make PostgREST pick up the new functions and privileges immediately.
NOTIFY pgrst, 'reload schema';