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

### Phase 4 — Inventory & purchasing (implemented)
Inventory module:
- `batches` (variant_id, batch_number, manufactured_on, expires_on) — unique `(organization_id, variant_id, lower(batch_number))`; index `(organization_id, expires_on)` for expiry reports.
- `stock_levels` (branch_id, store_id, variant_id, batch_id nullable, quantity `NUMERIC(18,3)`, average_cost `NUMERIC(18,4)`) — **projection**, one row per store × variant × batch, enforced by two partial unique indexes (`(store_id, variant_id) WHERE batch_id IS NULL` and `(store_id, variant_id, batch_id) WHERE batch_id IS NOT NULL`, because `NULL` never collides in a plain unique index). Locked `FOR UPDATE` by the ledger; negative quantities only occur in branches with `allow_negative_stock`.
- `stock_movements` (**ledger**: branch, store, variant, batch, type, signed quantity, unit_cost, balance_after, reference_type / reference_id / reference_number, created_by, created_at). Types: `opening`, `adjustment_in`, `adjustment_out`, `transfer_out`, `transfer_in`, `purchase_receipt`, `purchase_return`; `sale` and `sale_return` are reserved for Phases 5–6. Append-only: PostgreSQL trigger `stock_movements_append_only` (function `prevent_ledger_mutation()`) rejects `UPDATE`/`DELETE`, and the model throws on update/delete. Indexes `(store_id, variant_id, created_at)`, `(organization_id, variant_id, created_at)`, `(organization_id, created_at)`, `(reference_type, reference_id)`.
- `stock_adjustments` (branch, store, number `ADJ-000001`, reason `opening|count|damage|expiry|theft|correction|other`, note) + `stock_adjustment_lines` (variant, batch, signed quantity, unit_cost).
- `stock_transfers` (number `TRF-000001`, from/to branch + store, status `in_transit|received|cancelled`, dispatched_by/at, completed_by/at) + `stock_transfer_lines` (variant, batch, quantity, unit_cost = source average cost at dispatch).

Purchasing module (money `NUMERIC(18,2)`, quantities `NUMERIC(18,3)`, unit costs `NUMERIC(18,4)`, tax rates `NUMERIC(9,4)`):
- `purchase_orders` (number `PO-000001`, supplier, branch, store, status `draft|ordered|partially_received|received|cancelled`, order_date, expected_date, subtotal, tax_total, total) + `purchase_order_lines` (quantity, unit_cost, tax_rate, line_subtotal, line_tax, line_total, received_quantity).
- `goods_receipts` — the supplier invoice (number `GRN-000001`, supplier, store, purchase_order_id nullable, supplier_invoice_number, invoice_date, due_date, totals) + `goods_receipt_lines` (purchase_order_line_id nullable, batch, amounts, returned_quantity). Unique `(organization_id, supplier_id, lower(supplier_invoice_number))` stops double entry of an invoice.
- `purchase_returns` (number `PRN-000001`, goods_receipt_id, reason, totals) + `purchase_return_lines` (goods_receipt_line_id, batch, amounts at the receipt's cost).
- `supplier_payments` (number `SPAY-000001`, supplier, amount, method `cash|bank_transfer|mobile_banking|cheque|card|other`, reference, paid_on).
- Supplier balance = `suppliers.opening_balance` + Σ receipts − Σ returns − Σ payments, computed on read (no stored balance column to drift).

Notifications module:
- `notifications` (Laravel's table with UUID `id`, `notifiable` morph, `type`, `data` JSON, `read_at`).

Deviations from the original sketch, by design:
- No separate `purchase_invoices` table: a goods receipt *is* the supplier invoice (stock and payable are posted in one transaction), which removes a class of "received but not invoiced" mismatches for retail use. Invoice-before-goods workflows can be added later as a status on the receipt.
- `stock_levels` has no `reserved` or `version` column: stock is decremented under a row lock at the moment of sale, so reservations and optimistic versions are unnecessary.
- No `CHECK (quantity >= 0)`: negative stock is a per-branch setting, enforced in the ledger after the row lock.
- `serial_numbers` as a stock register are deferred; Phase 5 captures serial numbers at sale time (`sale_line_serials`).

### Phase 5 — POS & sales (implemented)
Sales module (money `NUMERIC(18,2)`, quantities `NUMERIC(18,3)`, costs `NUMERIC(18,4)`, rates `NUMERIC(9,4)`):
- `sales` — the posted invoice: number `INV-{BRANCH}-000001` (per-branch sequence, prefix from the organization's `invoice_prefix`), branch, store, customer (NULL = walk-in), status `completed|cancelled`, `tax_mode` snapshot, currency, subtotal, item/invoice discount totals (+ invoice discount type, value and source `manual|customer_group`), tax_total, total, paid_total, change_total, due_total, cost_total (COGS snapshot), sold_at, created_by (cashier), cancellation fields. Immutable except for its cancellation (model guard). Indexes `(organization_id, branch_id, sold_at)`, `(organization_id, customer_id, status)`, `(organization_id, created_by, sold_at)`.
- `sale_lines` — snapshot of product name, variant, SKU, unit; quantity, unit_price, line discount (type/value/amount), invoice discount share, net_amount, tax_rate, tax_amount, line_total, unit_cost and cost_total.
- `sale_line_stock` — which batch (or untracked stock, batch NULL) each line was taken from, quantity and unit cost; used to restock cancellations (and returns in Phase 6) exactly.
- `sale_line_serials` — serial numbers sold; partial unique index `(organization_id, variant_id, lower(serial)) WHERE released_at IS NULL` stops selling the same serial twice; cancellation sets `released_at`.
- `sale_payments` — cash/card/mobile banking: kind `payment|reversal`, signed amount, tendered (cash), reference, branch, created_by, created_at. Reversals (negative) are written when a sale is cancelled.
- PostgreSQL triggers (`prevent_sales_mutation()`) make `sale_lines`, `sale_line_stock` and `sale_payments` append-only.

POS module:
- `held_sales` — parked carts per branch/store: label, customer, cart JSON (lines with quantities/discounts/serials, invoice discount, notes), lines_count, created_by. No prices: carts are priced again on resume. Deleted on checkout (inside the checkout transaction) or discard.

Shared:
- `idempotency_keys` — user_id, key, sha256 fingerprint (method, path, branch header, canonical body), status `processing|completed`, response status and body; unique `(user_id, key)`; pruned after 24 h by the scheduler (`model:prune`).

Deviations from the original sketch, by design:
- No `pos_terminals` / `register_sessions` yet: they belong to the cash register (Phase 6). Sales already record branch, store and cashier.
- Customer balances are computed (opening balance + dues of completed sales); due collections arrive with Phase 6 payments.
- Payments of a sale live in `sale_payments` (Sales module). Phase 6 adds the organization-wide payments ledger and cash register on top.

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
- Ledgers: `stock_movements (store_id, variant_id, created_at)` for stock history; `(reference_type, reference_id)` for drill-down to the source document.
- Reports: `sales (organization_id, branch_id, created_at)` and BRIN on large append-only `created_at` columns once volumes justify it.

## 4. Concurrency model

- Every stock posting (adjustment, transfer, receipt, return; checkout from Phase 5) locks `stock_levels` rows `FOR UPDATE` in ascending `store|variant|batch` order, creating missing rows first with `INSERT … ON CONFLICT DO NOTHING` so there is always a row to lock.
- Receiving locks the purchase order row and returning locks the receipt lines first, so two concurrent receipts (or returns) cannot both take the last open (or returnable) quantity.
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
