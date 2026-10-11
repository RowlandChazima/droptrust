# DropTrust Capture — Database Setup Guide (Milestone 1 v3.1)

This document contains instructions for setting up the Supabase database for DropTrust Capture Milestone 1 using the hardened v3.1 schema and security layer.

> **Rule from AGENTS.md:** We do not automatically execute migrations against your remote Supabase project. You can review the migration files in `supabase/migrations/` and run them via the Supabase Dashboard SQL Editor or Supabase CLI (`supabase db push`).

---

## 1. Apply Schema and Security Migrations

For a fresh Supabase database, execute the two migration files in sequential order:

### Step A: Core Tables, Constraints & Types
1. Open your project on [Supabase Dashboard](https://supabase.com/dashboard).
2. Navigate to **SQL Editor** in the left sidebar.
3. Click **New query**.
4. Paste the complete contents of [`supabase/migrations/20261010000001_fresh_schema.sql`](file:///c:/Users/Rowland%20Chazima/MYWORK/droptrust/supabase/migrations/20261010000001_fresh_schema.sql).
5. Click **Run**.

### Step B: Hardened Functions, Triggers, RLS & Least-Privilege Grants
1. Click **New query**.
2. Paste the complete contents of [`supabase/migrations/20261010000002_security_functions_rls.sql`](file:///c:/Users/Rowland%20Chazima/MYWORK/droptrust/supabase/migrations/20261010000002_security_functions_rls.sql).
3. Click **Run**.

---

## 2. Key Architecture & Security Passes in v3.1

- **Core Tables & Ledgers:**
  - `businesses`: Merchant business profile with unique `owner_user_id` constraint, default currency `KES`, ISO currency validation (`currency ~ '^[A-Z]{3}$'`).
  - `customers`: Merchant customer registry.
  - `products`: Product catalog with 64-bit integer (`BIGINT`) `default_price_cents`.
  - `orders`: Master order ledger with CSPRNG `public_token` (~244 random bits, server-generated default), derived `total_cents`, server-set `confirmed_at`, and generated `payment_verification` (`PROVIDER_CONFIRMED` or `MERCHANT_REPORTED`).
  - `order_items`: Line items with 64-bit pricing, deferred consistency trigger (`subtotal_cents = SUM(line_total_cents)`), and item history locking.
  - `extraction_records`: AI OCR extraction logs.
  - `order_events`: Append-only audit log with role-derived `origin` (`SYSTEM`, `CLIENT_REPORTED`, `LEGACY`). Clients can only append notes (`NOTE_ADDED`, `RECEIPT_SHARED`) up to 1000 characters; all transactional and financial events are stamped `SYSTEM`.
  - `payment_records`: Append-only financial ledger with unique completed payment index (`ux_payment_records_one_completed_per_order`).
  - `refund_records`: Append-only full refund ledger linked to original payment records.

- **Least-Privilege Database Grants:**
  - `anon`: Zero table access (`REVOKE ALL`).
  - `authenticated`: Column-restricted `UPDATE` on `orders` (non-financial columns only). Read-only access to `payment_records`, `refund_records`, and `order_events`.
  - Financial field mutations (`payment_status`, `paypal_capture_id`, etc.) and payment insertions are restricted exclusively to `SECURITY DEFINER` stored procedures.

- **Hardened Stored Procedures (`SET search_path = ''`):**
  - `record_cash_payment(UUID, BIGINT)`: Merchant records actual physical cash collection on a `CASH_ON_DELIVERY` order; idempotent replay verification against existing payment records.
  - `assign_paypal_order(UUID, TEXT)`: Trusted backend assigns PayPal order ID during checkout setup; transitions order to `PENDING`.
  - `record_verified_paypal_capture(UUID, TEXT, TEXT, BIGINT, TEXT)`: Trusted backend records verified PayPal capture; enforces capture matching and idempotency.
  - `set_order_items(UUID, JSONB, BIGINT)`: Replaces items before payment starts; recomputes subtotal and triggers total derivation.
  - `correct_paid_order_items(UUID, JSONB, TEXT, TEXT)`: Service-role only non-monetary correction with full audit logging.
  - `record_cash_refund` & `record_paypal_refund`: Full refund recording into `refund_records`.
  - `handle_new_merchant_user`: Duplicate-safe auto-provisioning trigger on `auth.users` insert.

---

## 3. Private Storage Setup (Milestone 2 Preparation)

When moving to receipt upload (Milestone 2), create a private storage bucket:
1. Navigate to **Storage** -> **Create a new bucket**.
2. Name: `order-sources`.
3. Set **Public bucket** to **OFF** (Private).
4. Storage policies will restrict access so merchants can only read/upload/delete within their own business folder (`{business_id}/*`).

---

## 4. Environment Variables

Create `.env.local` in your project root using the template in `.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```
