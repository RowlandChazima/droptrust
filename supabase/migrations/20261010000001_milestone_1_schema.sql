-- ==============================================================================
-- DropTrust Capture — Milestone 1: Core Database Schema & RLS Policies
-- Migration: 20261010000001_milestone_1_schema.sql
-- Approved v8 Architecture Blueprint
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. BUSINESSES
CREATE TABLE IF NOT EXISTS public.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT businesses_owner_user_id_key UNIQUE (owner_user_id)
);

-- 3. CUSTOMERS
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. PRODUCTS
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  default_price_cents INT NOT NULL CHECK (default_price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. ORDERS
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  order_reference TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  fulfillment_status TEXT NOT NULL DEFAULT 'DRAFT' 
    CHECK (fulfillment_status IN ('DRAFT', 'CONFIRMED', 'PROCESSING', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED')),
  payment_status TEXT NOT NULL DEFAULT 'UNPAID' 
    CHECK (payment_status IN ('UNPAID', 'PENDING', 'PAID', 'REFUND_RECORDED')),
  payment_method TEXT NOT NULL DEFAULT 'CASH_ON_DELIVERY' 
    CHECK (payment_method IN ('PAYPAL', 'CASH_ON_DELIVERY')),
  subtotal_cents INT NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  delivery_fee_cents INT NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  total_cents INT NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  customer_name_snapshot TEXT,
  customer_phone_snapshot TEXT,
  customer_address_snapshot TEXT,
  agreed_terms TEXT,
  paypal_order_id TEXT UNIQUE,
  paypal_capture_id TEXT UNIQUE,
  is_receipt_active BOOLEAN NOT NULL DEFAULT TRUE,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. ORDER_ITEMS
CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT,
  unit_price_cents INT NOT NULL CHECK (unit_price_cents >= 0),
  quantity INT NOT NULL CHECK (quantity >= 1 AND quantity <= 10000),
  line_total_cents INT NOT NULL CHECK (line_total_cents >= 0)
);

-- 7. EXTRACTION_RECORDS
CREATE TABLE IF NOT EXISTS public.extraction_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  storage_file_path TEXT,
  status TEXT NOT NULL DEFAULT 'EXTRACTED',
  raw_model_output JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. ORDER_EVENTS (Audit log with ON DELETE RESTRICT)
CREATE TABLE IF NOT EXISTS public.order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. PAYMENT_RECORDS (Immutable Financial Log)
CREATE TABLE IF NOT EXISTS public.payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('PAYPAL', 'CASH')),
  provider_reference TEXT NOT NULL UNIQUE,
  amount_cents INT NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  status TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- INDEXES FOR PERFORMANCE & LOOKUPS
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_businesses_owner_user_id ON public.businesses(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_customers_business_id ON public.customers(business_id);
CREATE INDEX IF NOT EXISTS idx_products_business_id ON public.products(business_id);
CREATE INDEX IF NOT EXISTS idx_orders_business_id ON public.orders(business_id);
CREATE INDEX IF NOT EXISTS idx_orders_public_token ON public.orders(public_token);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_extraction_records_order_id ON public.extraction_records(order_id);
CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON public.order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_order_id ON public.payment_records(order_id);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;

-- 1. BUSINESSES RLS
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

-- 2. CUSTOMERS RLS
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

-- 3. PRODUCTS RLS
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

-- 4. ORDERS RLS (Validates customer_id belongs to same business)
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

-- 5. ORDER_ITEMS RLS (Validates product_id belongs to same business)
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

-- 6. EXTRACTION_RECORDS RLS
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

-- 7. ORDER_EVENTS RLS (Strictly append-only: No UPDATE or DELETE policies)
DROP POLICY IF EXISTS "order_events_select" ON public.order_events;
CREATE POLICY "order_events_select" ON public.order_events FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = order_events.order_id AND b.owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "order_events_insert" ON public.order_events;
CREATE POLICY "order_events_insert" ON public.order_events FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = order_events.order_id AND b.owner_user_id = auth.uid()));

-- 8. PAYMENT_RECORDS RLS (Direct client insert strictly limited to CASH payments)
DROP POLICY IF EXISTS "payment_records_select" ON public.payment_records;
CREATE POLICY "payment_records_select" ON public.payment_records FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = payment_records.order_id AND b.owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "payment_records_insert_cash_only" ON public.payment_records;
CREATE POLICY "payment_records_insert_cash_only" ON public.payment_records FOR INSERT 
  WITH CHECK (
    provider = 'CASH' AND
    EXISTS (SELECT 1 FROM public.orders o JOIN public.businesses b ON o.business_id = b.id WHERE o.id = payment_records.order_id AND b.owner_user_id = auth.uid())
  );

-- ==============================================================================
-- HARDENED ATOMIC PAYPAL STORED PROCEDURE
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.record_verified_paypal_capture(
  p_order_id UUID,
  p_paypal_order_id TEXT,
  p_capture_id TEXT,
  p_amount_cents INT,
  p_currency TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  -- 1. Row-level lock to prevent concurrent capture race conditions
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  -- 2. Strict Idempotency Check:
  IF v_order.payment_status = 'PAID' THEN
    IF v_order.paypal_capture_id = p_capture_id THEN
      RETURN jsonb_build_object('success', true, 'payment_status', 'PAID', 'already_processed', true);
    ELSE
      RAISE EXCEPTION 'Order % is already paid under a different capture ID %', p_order_id, v_order.paypal_capture_id;
    END IF;
  END IF;

  -- 3. Verify internal order association and financial integrity
  IF v_order.paypal_order_id IS DISTINCT FROM p_paypal_order_id THEN
    RAISE EXCEPTION 'PayPal Order ID mismatch: expected %, got %', v_order.paypal_order_id, p_paypal_order_id;
  END IF;

  IF v_order.total_cents != p_amount_cents OR v_order.currency != p_currency THEN
    RAISE EXCEPTION 'Captured amount (% %) does not match order (% %)', p_amount_cents, p_currency, v_order.total_cents, v_order.currency;
  END IF;

  -- 4. Atomically update order state
  UPDATE public.orders
  SET 
    payment_status = 'PAID',
    paypal_capture_id = p_capture_id,
    updated_at = NOW()
  WHERE id = p_order_id;

  -- 5. Insert immutable payment record
  INSERT INTO public.payment_records (
    order_id,
    provider,
    provider_reference,
    amount_cents,
    currency,
    status,
    idempotency_key
  ) VALUES (
    p_order_id,
    'PAYPAL',
    p_capture_id,
    p_amount_cents,
    p_currency,
    'COMPLETED',
    p_paypal_order_id
  );

  -- 6. Insert audit event
  INSERT INTO public.order_events (
    order_id,
    event_type,
    actor,
    details
  ) VALUES (
    p_order_id,
    'PAYMENT_CAPTURED',
    'PAYPAL_SYSTEM',
    jsonb_build_object('capture_id', p_capture_id, 'amount_cents', p_amount_cents, 'currency', p_currency)
  );

  RETURN jsonb_build_object('success', true, 'payment_status', 'PAID', 'already_processed', false);
END;
$$;

-- Restrict execution exclusively to service_role (trusted server)
REVOKE ALL ON FUNCTION public.record_verified_paypal_capture FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_paypal_capture TO service_role;

-- ==============================================================================
-- AUTOMATIC BUSINESS PROVISIONING TRIGGER (DUPLICATE-SAFE)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_merchant_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
