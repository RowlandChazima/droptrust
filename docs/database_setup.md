# DropTrust Capture — Database Setup Guide (Milestone 1)

This document contains instructions for setting up the Supabase database for DropTrust Capture Milestone 1.

> **Rule from AGENTS.md:** We do not automatically execute migrations against your remote Supabase project. You can review the migration file at `supabase/migrations/20261010000001_milestone_1_schema.sql` and run it via the Supabase Dashboard SQL Editor or Supabase CLI.

---

## 1. Apply Schema and RLS Policies

1. Open your project on [Supabase Dashboard](https://supabase.com/dashboard).
2. Navigate to **SQL Editor** in the left sidebar.
3. Click **New query**.
4. Paste the complete contents of `supabase/migrations/20261010000001_milestone_1_schema.sql`.
5. Click **Run**.

### What this migration creates:
- **8 Core Tables:**
  - `businesses`: Merchant business profile with unique `owner_user_id` constraint, default currency `KES`.
  - `customers`: Merchant customer registry.
  - `products`: Product catalog with non-negative prices in integer cents.
  - `orders`: Master orders table with fulfillment & payment statuses, public tokens, and snapshots.
  - `order_items`: Order line items with strict quantity bounds (`1..10000`) and non-negative line totals.
  - `extraction_records`: AI OCR extraction logs.
  - `order_events`: Immutable audit trail (`ON DELETE RESTRICT`, append-only RLS).
  - `payment_records`: Immutable payment transactions (`ON DELETE RESTRICT`).
- **Row Level Security (RLS) on all 8 tables:**
  - Every table enforces strict tenancy so merchants only ever see and edit their own business records.
  - Direct client payment insertions are restricted strictly to `provider = 'CASH'`.
  - Audit logs cannot be updated or deleted by any client.
- **Hardened Atomic PayPal Stored Procedure:**
  - `record_verified_paypal_capture`: Protected with `SET search_path = public, pg_temp;` and callable only by `service_role`.
- **Automatic Business Provisioning Trigger:**
  - `on_auth_user_created`: Duplicate-safe trigger that inserts a `businesses` record when a merchant registers, defaulting currency to `KES`.
  - *Note:* The application also includes an idempotent server-side check to guarantee business record presence even if triggers are disabled.

---

## 2. Private Storage Setup (Milestone 2 Preparation)

When moving to receipt upload (Milestone 2), create a private storage bucket:
1. Navigate to **Storage** -> **Create a new bucket**.
2. Name: `order-sources`.
3. Set **Public bucket** to **OFF** (Private).
4. Storage policies will restrict access so merchants can only read/upload/delete within their own business folder (`{business_id}/*`).

---

## 3. Environment Variables

Create `.env.local` in your project root using the template in `.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```
