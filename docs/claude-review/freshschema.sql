-- ==============================================================================

-- FRESH-DATABASE SCHEMA

-- v3.1 additions over v3 (all in this file):
--   * payment_records.verification, orders.payment_verification
--       GENERATED columns (cannot be written by anyone, cannot drift):
--       PAYPAL -> PROVIDER_CONFIRMED, CASH -> MERCHANT_REPORTED.
--   * order_events.origin  SYSTEM | CLIENT_REPORTED | LEGACY (set by trigger in C).
--   * refund_records       append-only refund ledger (full refunds only).
--
-- This file uses plain CREATE TABLE on purpose. "CREATE TABLE IF NOT EXISTS"
-- never alters an existing table, so it can silently skip new columns/types/
-- constraints. The guard below makes this file fail loudly if any DropTrust
-- table already exists.
-- ==============================================================================

DO $$
BEGIN
  IF to_regclass('public.businesses')         IS NOT NULL
  OR to_regclass('public.customers')          IS NOT NULL
  OR to_regclass('public.products')           IS NOT NULL
  OR to_regclass('public.orders')             IS NOT NULL
  OR to_regclass('public.order_items')        IS NOT NULL
  OR to_regclass('public.extraction_records') IS NOT NULL
  OR to_regclass('public.order_events')       IS NOT NULL
  OR to_regclass('public.payment_records')    IS NOT NULL
  OR to_regclass('public.refund_records')     IS NOT NULL THEN
    RAISE EXCEPTION
      'Existing DropTrust tables detected. File A is the FRESH-DATABASE migration. '
      'Run m1_v3_1_b_upgrade_existing_schema.sql then m1_v3_1_c_security_and_functions.sql instead.';
  END IF;
END $$;

-- BUSINESSES
CREATE TABLE public.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT businesses_owner_user_id_key UNIQUE (owner_user_id),
  CONSTRAINT businesses_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

-- CUSTOMERS
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PRODUCTS
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  default_price_cents BIGINT NOT NULL CHECK (default_price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT products_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

-- ORDERS
-- public_token now has a DB-side default built from two gen_random_uuid() values
-- (CSPRNG, ~244 random bits) so clients never choose their own receipt token.
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  order_reference TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE
    DEFAULT replace(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT, '-', ''),
  fulfillment_status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (fulfillment_status IN ('DRAFT', 'CONFIRMED', 'PROCESSING', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED')),
  payment_status TEXT NOT NULL DEFAULT 'UNPAID'
    CHECK (payment_status IN ('UNPAID', 'PENDING', 'PAID', 'REFUND_RECORDED')),
  payment_method TEXT NOT NULL DEFAULT 'CASH_ON_DELIVERY'
    CHECK (payment_method IN ('PAYPAL', 'CASH_ON_DELIVERY')),
  subtotal_cents BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  delivery_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  total_cents BIGINT NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Provenance of the settled payment, derived (never stored by a caller).
  -- NULL until payment settles. payment_method is frozen once payment starts,
  -- and each payment function requires the matching method, so this cannot be
  -- steered by a merchant.
  payment_verification TEXT GENERATED ALWAYS AS (
    CASE WHEN payment_status IN ('PAID', 'REFUND_RECORDED')
         THEN CASE WHEN payment_method = 'PAYPAL' THEN 'PROVIDER_CONFIRMED' ELSE 'MERCHANT_REPORTED' END
    END
  ) STORED,
  -- Row-local arithmetic. (subtotal = SUM(items) is cross-table and is enforced
  -- by the deferred constraint triggers in file C, not by a CHECK.)
  CONSTRAINT orders_total_consistency CHECK (total_cents = subtotal_cents + delivery_fee_cents),
  CONSTRAINT orders_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  -- PayPal does not settle KES. PayPal orders must be priced in USD explicitly.
  CONSTRAINT orders_paypal_requires_usd CHECK (payment_method <> 'PAYPAL' OR currency = 'USD'),
  CONSTRAINT orders_paypal_ids_nonempty CHECK (
    (paypal_order_id   IS NULL OR btrim(paypal_order_id)   <> '') AND
    (paypal_capture_id IS NULL OR btrim(paypal_capture_id) <> '')
  )
);

-- ORDER_ITEMS
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT,
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
  quantity INT NOT NULL CHECK (quantity >= 1 AND quantity <= 10000),
  line_total_cents BIGINT NOT NULL CHECK (line_total_cents >= 0),
  CONSTRAINT order_items_line_total_consistency CHECK (line_total_cents = unit_price_cents * quantity)
);

-- EXTRACTION_RECORDS
CREATE TABLE public.extraction_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  storage_file_path TEXT,
  status TEXT NOT NULL DEFAULT 'EXTRACTED',
  raw_model_output JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ORDER_EVENTS (append-only audit log; enforced by triggers in file C)
CREATE TABLE public.order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Who wrote the row. Set by the order_events_set_origin trigger (file C) from
  -- the caller's role; any value a caller supplies is overwritten. LEGACY marks
  -- rows that existed before v3.1 and cannot be classified.
  origin TEXT NOT NULL DEFAULT 'SYSTEM',
  CONSTRAINT order_events_origin_check CHECK (origin IN ('SYSTEM', 'CLIENT_REPORTED', 'LEGACY'))
);

-- PAYMENT_RECORDS (append-only financial log; enforced by triggers in file C)
CREATE TABLE public.payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('PAYPAL', 'CASH')),
  provider_reference TEXT NOT NULL UNIQUE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  status TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification TEXT GENERATED ALWAYS AS (
    CASE WHEN provider = 'PAYPAL' THEN 'PROVIDER_CONFIRMED' ELSE 'MERCHANT_REPORTED' END
  ) STORED,
  CONSTRAINT payment_records_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payment_records_paypal_usd CHECK (provider <> 'PAYPAL' OR currency = 'USD'),
  CONSTRAINT payment_records_reference_nonempty CHECK (btrim(provider_reference) <> '')
);

-- At most ONE completed payment per order, enforced by the database. This is the
-- hard backstop behind the idempotent payment functions: even a buggy caller
-- cannot record two completed payments (cash + PayPal, or two captures).
CREATE UNIQUE INDEX ux_payment_records_one_completed_per_order
  ON public.payment_records(order_id) WHERE status = 'COMPLETED';

-- REFUND_RECORDS (append-only refund ledger; enforced by triggers in file C)
-- Full refunds only: payment_record_id is UNIQUE, and the refund functions
-- require amount = the original payment. Kept separate from payment_records so
-- the "one COMPLETED payment per order" index is untouched.
CREATE TABLE public.refund_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_record_id UUID NOT NULL UNIQUE REFERENCES public.payment_records(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('PAYPAL', 'CASH')),
  provider_reference TEXT NOT NULL UNIQUE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'COMPLETED'),
  reason TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification TEXT GENERATED ALWAYS AS (
    CASE WHEN provider = 'PAYPAL' THEN 'PROVIDER_CONFIRMED' ELSE 'MERCHANT_REPORTED' END
  ) STORED,
  CONSTRAINT refund_records_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT refund_records_paypal_usd CHECK (provider <> 'PAYPAL' OR currency = 'USD'),
  CONSTRAINT refund_records_reference_nonempty CHECK (btrim(provider_reference) <> ''),
  CONSTRAINT refund_records_reason_len CHECK (char_length(btrim(reason)) >= 10)
);

-- INDEXES
CREATE INDEX idx_businesses_owner_user_id ON public.businesses(owner_user_id);
CREATE INDEX idx_customers_business_id ON public.customers(business_id);
CREATE INDEX idx_products_business_id ON public.products(business_id);
CREATE INDEX idx_orders_business_id ON public.orders(business_id);
CREATE INDEX idx_orders_public_token ON public.orders(public_token);
CREATE INDEX idx_orders_payment_status ON public.orders(payment_status);
CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX idx_extraction_records_order_id ON public.extraction_records(order_id);
CREATE INDEX idx_order_events_order_id ON public.order_events(order_id);
CREATE INDEX idx_payment_records_order_id ON public.payment_records(order_id);
CREATE INDEX idx_refund_records_order_id ON public.refund_records(order_id);