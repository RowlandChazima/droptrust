-- ------------------------------------------------------------------------------
-- DropTrust Capture — Payment Reconciliation Issues Ledger
-- Service-role-only table to track PayPal captures that could not be reconciled
-- immediately with orders.
--
-- NOTE: Created for review only. Do not apply without explicit operator approval.
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payment_reconciliation_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  paypal_order_id TEXT,
  capture_id TEXT, -- Nullable when an uncertain capture occurs before capture ID is returned
  amount_cents BIGINT,
  currency TEXT NOT NULL DEFAULT 'USD',
  reason TEXT NOT NULL,
  details JSONB, -- Sanitized non-sensitive metadata only
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency constraints:
-- 1. If capture_id is known, ensure at most one issue entry per capture_id
CREATE UNIQUE INDEX IF NOT EXISTS ux_reconciliation_capture_id
  ON public.payment_reconciliation_issues (capture_id)
  WHERE capture_id IS NOT NULL;

-- 2. If capture_id is unknown, prevent duplicate open issues for the same paypal_order_id & reason
CREATE UNIQUE INDEX IF NOT EXISTS ux_reconciliation_order_reason_open
  ON public.payment_reconciliation_issues (paypal_order_id, reason)
  WHERE capture_id IS NULL AND status = 'OPEN';

-- Enable Row Level Security (RLS)
ALTER TABLE public.payment_reconciliation_issues ENABLE ROW LEVEL SECURITY;

-- Revoke all access from client roles; grant exclusively to service_role
REVOKE ALL ON TABLE public.payment_reconciliation_issues FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_reconciliation_issues TO service_role;

-- Service-role-only RPC to record reconciliation issues idempotently
CREATE OR REPLACE FUNCTION public.record_payment_reconciliation_issue(
  p_order_id UUID,
  p_paypal_order_id TEXT,
  p_capture_id TEXT,
  p_amount_cents BIGINT,
  p_currency TEXT,
  p_reason TEXT,
  p_details JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Idempotency check: return existing open issue if already logged
  IF p_capture_id IS NOT NULL THEN
    SELECT id INTO v_id
      FROM public.payment_reconciliation_issues
     WHERE capture_id = p_capture_id AND status = 'OPEN'
     LIMIT 1;
    IF FOUND THEN
      RETURN v_id;
    END IF;

    -- If an uncertain open issue was logged without capture_id, attach this capture_id
    IF p_paypal_order_id IS NOT NULL THEN
      SELECT id INTO v_id
        FROM public.payment_reconciliation_issues
       WHERE paypal_order_id = p_paypal_order_id AND capture_id IS NULL AND status = 'OPEN'
       LIMIT 1;
      IF FOUND THEN
        UPDATE public.payment_reconciliation_issues
           SET capture_id = p_capture_id,
               amount_cents = COALESCE(p_amount_cents, amount_cents),
               currency = COALESCE(p_currency, currency),
               details = COALESCE(p_details, details),
               updated_at = NOW()
         WHERE id = v_id;
        RETURN v_id;
      END IF;
    END IF;
  ELSIF p_paypal_order_id IS NOT NULL THEN
    SELECT id INTO v_id
      FROM public.payment_reconciliation_issues
     WHERE paypal_order_id = p_paypal_order_id AND reason = p_reason AND status = 'OPEN'
     LIMIT 1;
    IF FOUND THEN
      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO public.payment_reconciliation_issues (
    order_id, paypal_order_id, capture_id, amount_cents, currency, reason, details
  ) VALUES (
    p_order_id,
    p_paypal_order_id,
    p_capture_id,
    p_amount_cents,
    COALESCE(p_currency, 'USD'),
    p_reason,
    p_details
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    IF p_capture_id IS NOT NULL THEN
      SELECT id INTO v_id FROM public.payment_reconciliation_issues WHERE capture_id = p_capture_id LIMIT 1;
    ELSIF p_paypal_order_id IS NOT NULL THEN
      SELECT id INTO v_id FROM public.payment_reconciliation_issues WHERE paypal_order_id = p_paypal_order_id AND reason = p_reason LIMIT 1;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_payment_reconciliation_issue(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_reconciliation_issue(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, JSONB) TO service_role;

-- Service-role-only RPC to resolve a reconciliation issue once payment is recorded
CREATE OR REPLACE FUNCTION public.resolve_payment_reconciliation_issue(
  p_capture_id TEXT,
  p_resolution_details JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_capture_id IS NOT NULL AND btrim(p_capture_id) <> '' THEN
    UPDATE public.payment_reconciliation_issues
       SET status = 'RESOLVED',
           details = CASE
             WHEN p_resolution_details IS NOT NULL THEN
               COALESCE(details, '{}'::jsonb) || p_resolution_details
             ELSE details
           END,
           updated_at = NOW()
     WHERE capture_id = p_capture_id AND status = 'OPEN';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_payment_reconciliation_issue(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_payment_reconciliation_issue(TEXT, JSONB) TO service_role;
