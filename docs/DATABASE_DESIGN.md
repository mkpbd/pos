# Database Design

PostgreSQL 18 is the system of record. This document defines conventions (binding from Phase 1) and the target schema, which is built incrementally per phase. Tables are marked with the phase that introduces them.

## 1. Conventions

| Topic | Convention |
|-------|------------|
| Primary keys | `uuid`, generated as **UUIDv7** (time-ordered, index-friendly) by the application. Pure lookup/pivot tables may use composite keys. |
| Tenant keys | `organization_id uuid NOT NULL` on every tenant-owned table; `branch_id uuid` on branch-scoped tables. Both FK-constrained and leading columns of the main composite indexes. |
| Audit columns | `created_at`, `updated_at` (`timestamptz`), `created_by`, `updated_by` (`uuid` FK → users, nullable for system actions). |
| Soft deletes | `deleted_at timestamptz` on master data (products, customers, suppliers, users, branches). **Never** on transactional/ledger tables. Unique indexes on soft-deleted tables are partial: `WHERE deleted_at IS NULL`. |
| Money | `NUMERIC(18,2)`. Quantities `NUMERIC(18,3)`. Rates/percentages `NUMERIC(9,4)`. Unit costs `NUMERIC(18,4)`. `float`, `double precision` and `real` are forbidden. |
| Currency | `char(3)` ISO 4217 on documents; one base currency per organization in v1. |
| Enums | `varchar` + `CHECK` constraint (easier to migrate than native PG enums), mirrored by PHP backed enums. |
| Timestamps | Always `timestamptz`, stored in UTC; display in branch timezone. |
| Document numbers | Human-readable, per-branch, gap-free sequences (`INV-DHK1-000123`) allocated inside the posting transaction from a `document_sequences` row locked `FOR UPDATE`. |
| Naming | snake_case, plural table names, `<singular>_id` FKs, indexes `<table>_<cols>_idx`, uniques `<table>_<cols>_unique`. |
| JSON | `jsonb` only for genuinely schemaless data (settings payloads, audit diffs, AI metadata). |
| Immutability | Ledger and posted-document tables get a trigger that raises on `UPDATE`/`DELETE`. |

## 2. Entity overview

### Phase 2 — Identity & tenancy
- `organizations` (id, name, slug unique, base_currency, timezone, tax_mode `inclusive|exclusive`, settings jsonb, status)
- `branches` (organization_id, code unique per org, name, address, phone, timezone, allow_negative_stock bool, settings jsonb)
- `stores` / `warehouses` (branch_id, code, type `store|warehouse`) — stock is held per location
- `users` (uuid, organization_id nullable for Super Admin, name, email unique, password, status, last_login_at)
- `roles`, `permissions`, `role_permission`, `user_role` (organization-scoped roles), `branch_user` (branch assignments)
- `login_activities` (user_id, ip, user_agent, succeeded, created_at)
- `audit_logs` (organization_id, branch_id, user_id, action, auditable_type, auditable_id, old_values jsonb, new_values jsonb, ip, request_id, created_at) — append-only
- `personal_access_tokens` (Sanctum; `tokenable_id` as uuid)

### Phase 3 — Catalog & parties (implemented)
- `document_sequences` (organization_id, key, next_number) — gap-free counters locked `FOR UPDATE` in the consuming transaction (`CUS-000001`, `SUP-0001`, `SKU-000001`; invoices from Phase 5).
- `tax_rates` (name, rate `NUMERIC(9,4)` %, is_active) — one rate per product (compound taxes are out of scope for v1).
- `units` (name, code, allow_decimal, base_unit_id → units, conversion_factor `NUMERIC(18,6)`) — one level of derivation (box = 12 pcs).
- `categories` (parent_id → categories, sort_order, is_active) — tree, max 4 levels, names unique among siblings (checked in the application).
- `brands`.
- `products` (category_id, brand_id, unit_id, tax_rate_id nullable = exempt, type `standard|service`, track_stock / track_batches / track_serials, max_discount_percent `NUMERIC(5,2)`, options jsonb `[{name, values[]}]`, is_active, soft delete).
- `product_variants` (product_id, sku, name, option_values jsonb `{"Size":"M"}`, purchase_price / selling_price / wholesale_price `NUMERIC(18,2)`, reorder_level `NUMERIC(18,3)`, is_active, sort_order, soft delete). Every product has at least one variant; the variant is what is sold and stocked.
- `product_barcodes` (variant_id, barcode; unique per organization). Archived products keep their barcodes and SKUs reserved so they can always be restored.
- `product_images` (product_id, path on the `public` disk, original_name, mime_type, size, sort_order).
- `suppliers` (code, contact data, tax_number, payment_terms_days, opening_balance `NUMERIC(18,2)`, soft delete).
- `customer_groups` (name, discount_percent) and `customers` (code, group, phone, credit_limit, opening_balance, soft delete).

Deviations from the original sketch, by design:
- No `product_prices` history table: price changes are captured with before/after values in `audit_logs` (`product.updated`). Branch-specific prices are deferred until a concrete need appears (POS phase).
- No `attributes`/`attribute_values` tables: variant attributes are the product's `options` plus each variant's `option_values` (validated so every variant has exactly one value per option and combinations are unique).
- Product images are not secret, so they live on the public disk under random file names; the API returns same-origin `/storage/...` URLs.

### Phase 4 — Inventory & purchasing
- `stock_levels` (location_id, variant_id, batch_id nullable, quantity, reserved, version) — **projection**, row-locked during checkout, `CHECK (quantity >= 0)` enforced unless branch allows negative stock
- `stock_movements` (**ledger**, append-only: location, variant, batch, type `opening|purchase|sale|return|adjustment|transfer_in|transfer_out`, quantity signed, unit_cost, reference_type, reference_id, created_by)
- `batches` (variant_id, batch_no, expiry_date, cost), `serial_numbers`
- `stock_adjustments` (+ lines), `stock_transfers` (+ lines, status workflow)
- `purchase_orders`, `purchase_invoices`, `goods_receipts`, `purchase_returns` (+ lines each)
- `supplier_payments`

### Phase 5 — POS & sales
- `pos_terminals`, `register_sessions` (opening cash, closing cash, expected vs counted)
- `sales` (posted invoices, immutable: number, branch, customer, cashier, subtotal, discount_total, tax_total, grand_total, paid_total, due_total, status `completed|cancelled`, tax_mode snapshot)
- `sale_items` (variant, batch, quantity, unit_price, discount, tax_rate, tax_amount, line_total — all snapshot values)
- `held_sales` (draft carts, mutable until posted or discarded)
- `idempotency_keys` (key, user_id, route, request_hash, response_status, response_body jsonb, created_at; unique (user_id, key))

### Phase 6 — Money flows
- `payment_methods`, `payments` (**ledger**: direction in/out, method, amount, reference to sale/purchase/expense, register_session_id)
- `cash_movements` (cash in/out, reconciliation)
- `sale_returns`, `sale_return_items` (FK to original sale/sale_item, quantity ≤ remaining returnable), `return_reasons`, approval fields
- `refunds`
- `expenses`, `expense_categories`, `incomes`
- `loyalty_accounts`, `loyalty_transactions` (ledger)

### Phase 7 — Reporting
- Views: `v_sales_daily`, `v_sales_by_product`, `v_sales_by_cashier`, `v_inventory_valuation`, `v_customer_dues`, `v_supplier_dues`, …
- Materialized views refreshed by the scheduler for heavy aggregates.

### Phase 8 — AI
- `ai_conversations`, `ai_messages` (prompt/response metadata, token usage, no raw financial dumps), `ai_insights` (cached summaries)

## 3. Indexing strategy

- Every tenant table: composite index starting with `(organization_id, …)`; branch tables `(organization_id, branch_id, …)`.
- Hot POS lookups: `product_barcodes (organization_id, barcode)` unique; `product_variants (organization_id, lower(sku)) WHERE deleted_at IS NULL` unique. A trigram GIN index on product name (`pg_trgm`) is planned for Phase 9 performance work.
- Case-insensitive uniqueness uses expression indexes, e.g. `brands (organization_id, lower(name))`, and partial indexes such as `customers (organization_id, phone) WHERE deleted_at IS NULL AND phone IS NOT NULL` — valid on PostgreSQL and SQLite alike.
- Ledgers: `(location_id, variant_id, created_at)` for stock history; `(reference_type, reference_id)` for drill-down.
- Reports: `sales (organization_id, branch_id, created_at)` and BRIN on large append-only `created_at` columns once volumes justify it.

## 4. Concurrency model

- Checkout locks `stock_levels` rows `FOR UPDATE` in ascending `(location_id, variant_id, batch_id)` order.
- `register_sessions` row is locked when posting cash payments.
- Document numbers allocated from locked `document_sequences` rows.
- Transactions are short: pricing is computed before the transaction and re-validated inside it.
- Deadlock/serialization failures (`40P01`, `40001`) are retried a bounded number of times by a transaction helper.

## 5. Local databases

| Database | Purpose |
|----------|---------|
| `pos` | Development |
| `pos_test` | Automated tests (PHPUnit `RefreshDatabase`) |

Owner role `pos_app` (no superuser). Bootstrap with `backend/database/scripts/create_local_databases.sql` — see [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md).
