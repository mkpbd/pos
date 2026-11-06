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
- `purchase_orders` (number `PO-000001`, supplier, branch, store, status `draft|ordered|partially_received|received|cancelled` — `pending_approval` added in SC2, order_date, expected_date, subtotal, tax_total, total; SC2 approval columns below) + `purchase_order_lines` (quantity, unit_cost, tax_rate, line_subtotal, line_tax, line_total, received_quantity).
- `goods_receipts` — the supplier invoice (number `GRN-000001`, supplier, store, purchase_order_id nullable, supplier_invoice_number, invoice_date, due_date, totals) + `goods_receipt_lines` (purchase_order_line_id nullable, batch, amounts, returned_quantity). Unique `(organization_id, supplier_id, lower(supplier_invoice_number))` stops double entry of an invoice.
- `purchase_returns` (number `PRN-000001`, goods_receipt_id, reason, totals) + `purchase_return_lines` (goods_receipt_line_id, batch, amounts at the receipt's cost).
- `supplier_payments` (number `SPAY-000001`, supplier, amount, method `cash|bank_transfer|mobile_banking|cheque|card|other`, reference, paid_on).
- Supplier balance = `suppliers.opening_balance` + Σ receipts − Σ returns − Σ payments, computed on read (no stored balance column to drift). SC3: receipts at `payable_total`, plus charges and landed cost vouchers billed by the supplier (below).

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
- No `pos_terminals`: the cash register (Phase 6) plays that role. Sales already record branch, store and cashier.
- Customer balances are computed (opening balance + dues of completed sales; from Phase 6 minus return credits and customer payments).
- Payments of a sale live in `sale_payments` (Sales module); Phase 6 adds the organization-wide payments ledger and cash registers on top.

### Phase 6 — Money flows (implemented)
Payments module:
- `cash_registers` — branch, code (unique per organization, case-insensitive), name, active.
- `cash_register_sessions` — number `SES-{BRANCH}-000001`, register, branch, status `open|closed`, currency, opening_float, opened_by/at; on close expected_cash, counted_cash, variance, closing_notes, closed_by/at. Partial unique indexes: one open session per register and per user. Immutable once closed (model guard).
- `payments` — **the payments ledger**: branch, register session (nullable), direction `in|out`, method (`cash`, `card`, `mobile_banking`, `bank_transfer`, `cheque`), currency, amount (> 0), source_type (`sale`, `sale_cancellation`, `sale_return`, `customer_payment`, `expense`, `income`, `expense_void`, `income_void`, `cash_in`, `cash_out`) + source_id/number, customer, reference, description, created_by, created_at. Append-only (trigger `prevent_payments_mutation()`). Cash movements of a drawer are ledger rows with `source_type` `cash_in`/`cash_out` — no separate table.

Sales module additions:
- `return_reasons` — name (unique per organization), `restock_by_default`, active.
- `sale_returns` — number `RET-{BRANCH}-000001`, sale, branch, store, customer, status `pending|completed|rejected`, reason, notes, subtotal/tax_total/total, credited_total (applied to what the customer owed), refunded_total, requested_by/at, decided_by/at, rejection_reason. Only the decision of a pending return can change it.
- `sale_return_lines` — sale line, variant, quantity, restock flag, net/tax/line totals, unit_cost/cost_total, serials (JSON). Append-only.
- `sale_return_line_stock` — which sale-line allocation (and batch) restocked goods went back to, quantity, unit cost. Append-only.
- `sale_return_refunds` — method (incl. `loyalty_points`), amount, reference. Append-only. (The planned separate `refunds` table became this.)
- `customer_payments` — number `RCP-000001`, customer, branch, amount, method, reference, notes. Append-only.
- `sale_payments.method` now also allows `loyalty_points`.

Expenses module:
- `expense_categories` — type `expense|income`, name (unique per organization and type), active.
- `expenses` — type, number `EXP-000001` / `INC-000001`, branch, category, amount, method, reference, party, occurred_on, notes, void fields (SC3: `on_account`). Expenses and other income share one table (the planned `incomes` table became `type = income`).

Loyalty module:
- `loyalty_settings` — one row per organization: is_enabled, spend_amount, points_per_spend, point_value, min_redeem_points.
- `loyalty_accounts` — balance (may go negative), lifetime_earned, lifetime_redeemed per customer; locked `FOR UPDATE` for every change.
- `loyalty_transactions` — **points ledger**: type (`earn`, `redeem`, `earn_reversal`, `redeem_reversal`, `refund`, `adjustment`), signed points, balance_after, money value, sale, source document. Append-only (trigger `prevent_loyalty_mutation()`).

Deviations from the original sketch, by design: no `payment_methods` table (methods are a fixed list; organization-defined methods are added when a concrete need appears); no `cash_movements` table (they are ledger rows).

### E-commerce E4 — Storefront and media (implemented)
Full e-commerce schema plan: `docs/ecommerce/DATABASE_CHANGE_PLAN.md`.

Media module:
- `media` — disk, path, original_name, mime_type, size, width, height, alt, renditions jsonb (`{"320": path, …}`), checksum (sha-256; unique per organization, so identical uploads are stored once), created_by/updated_by.

Storefront module:
- `storefront_settings` — one row per organization (unique): is_enabled, site_name, meta_description.
- `storefront_domains` — host (lower-case, **globally** unique: a host serves one organization), is_primary.
- `theme_settings` — one row per organization: settings jsonb (normalized by `ThemeSchema`), custom_css.
- `menus` — name, location (`main|mobile|footer_1|footer_2|footer_3`, unique per organization), is_active.
- `menu_items` — menu (cascade), parent (self-reference, cascade), type (`custom` in E4), label, url, open_in_new_tab, is_visible, is_mega, mega_columns, image_media_id → media (`RESTRICT`), sort_order. Replaced as a whole tree on save.

No existing table changed in E4 (the idempotency scope change of ADR-014 lands with checkout in E8).

### E-commerce E5 — Content and homepage (implemented)

Storefront module:
- `banners` — placement (`hero_slider|home_promo`, CHECK), name (admin label), kicker, title, subtitle, link_url, button_label, secondary_link_url, secondary_button_label, desktop_media_id → media (`RESTRICT`, required), mobile_media_id → media (`RESTRICT`), text_color char(7), text_position (`left|center|right`), starts_at/ends_at (CHECK end > start), is_active, sort_order. Index `(organization_id, placement, is_active, sort_order)`.
- `homepage_sections` — type (validated by `Domain\SectionType`), title, subtitle, config jsonb (normalized per type; media ids for testimonial photos and the newsletter picture are protected by a tagged `MediaReferences` checker), is_enabled, starts_at/ends_at (CHECK), sort_order.
- `homepage_section_items` — section (cascade), item_type (`banner` now; products/categories/brands later), item_id, sort_order; unique `(section_id, item_type, item_id)`. Banner deletion is refused while an item points at it.
- `menu_items` (changed, additive): `target_id uuid NULL` and type `page`; CHECK `(type = 'custom' AND url IS NOT NULL) OR (type <> 'custom' AND target_id IS NOT NULL)`; index `(organization_id, type, target_id)`.

Cms module:
- `cms_pages` — slug (unique per organization, case-insensitive, among non-deleted rows), title, body_html (sanitized), template (`default|faq|contact`), status (`draft|published`), published_at, seo_title, seo_description, soft delete.
- `faq_items` — group, question, answer_html (sanitized), is_active, sort_order.
- `contact_messages` — name, email, phone, subject, message, ip, handled_at, handled_by → users. Never edited.
- `newsletter_subscribers` — email (unique per organization, case-insensitive), status (`pending|subscribed|unsubscribed`), confirm_token_hash and unsubscribe_token_hash (sha-256, unique), confirmation_sent_at, confirmed_at, unsubscribed_at, ip.

All timestamps with an offset are converted to the application timezone before they are stored (`Shared\Application\Support\Instants`).

### E-commerce E6 — Online catalog (implemented)

OnlineCatalog module (1:1 web tables beside the POS catalog; slugs are lower-case `a-z0-9-`, ≤ 120, **unique per organization regardless of case** through expression indexes `(organization_id, lower(slug))` on PostgreSQL and SQLite):
- `product_listings` — product_id → products (**unique**, `RESTRICT`), slug, is_published (default false), published_at / unpublished_at (optional window; CHECK end > start on PostgreSQL), is_featured, is_new_until date, short_description varchar(500), description_html (sanitized), specifications jsonb (`[{label, value}]`, default `[]`), seo_title varchar(70), seo_description varchar(160), sort_weight int, created_by/updated_by. Index `(organization_id, is_published)`. A product without a row is not online.
- `variant_listings` — variant_id → product_variants (**unique**, cascade), compare_at_price NUMERIC(18,2) NULL (CHECK > 0 on PostgreSQL; "above the selling price" is checked on save), image_id → product_images (`SET NULL` on delete). Rows exist only for variants with web data.
- `category_listings` — category_id → categories (**unique**, cascade), slug, is_visible (default true), image_media_id / banner_media_id → media (`RESTRICT`), description_html, seo_title, seo_description, author columns.
- `brand_listings` — brand_id → brands (**unique**, cascade), slug, is_visible (default true), logo_media_id → media (`RESTRICT`), description varchar(1000), seo_title, seo_description, author columns.
- `related_products` — organization_id, product_id → products (cascade), related_product_id → products (cascade), kind (`related|frequently_bought`, CHECK on PostgreSQL), sort_order smallint; primary key `(product_id, related_product_id, kind)`; CHECK not self on PostgreSQL; index `(organization_id, product_id, kind)`. No surrogate id.
- `product_stats` — product_id → products (**primary key**, cascade), organization_id, units_sold_30d / units_sold_total NUMERIC(18,3), refreshed_at; index `(organization_id, units_sold_30d)`. A projection, not a ledger: each refresh replaces the organization's rows (net units of completed sales minus completed returns, never below zero). No rating columns yet (E10).
- `products` (index only, PostgreSQL): extension `pg_trgm` and `products_name_trgm_index` — GIN `(lower(name) gin_trgm_ops)` for substring search.

Catalog module:
- `attributes` — name varchar(60) and slug varchar(80), each unique per organization case-insensitively; display (`text|swatch|button`, default `button`, CHECK on PostgreSQL), is_filterable (default true), sort_order, author columns.
- `attribute_values` — attribute_id → attributes (cascade), value varchar(60) (unique per attribute, case-insensitive), swatch_hex char(7) NULL (`#rrggbb`, CHECK on PostgreSQL), sort_order; index `(attribute_id, sort_order)`. Products keep `products.options` / `product_variants.option_values` as the source of truth; no foreign key from products, so deleting an attribute never touches a product.

Storefront module:
- `storefront_settings` (changed, additive): `fulfilment_store_id` → stores NULL (`RESTRICT`) — the stock location for online availability.
- `homepage_section_items.item_type` now also `product|category|brand` (hand-picked records of catalog sections; no foreign key — records that disappear drop out when the section is read). `menu_items.type` also `category|brand`.

### E-commerce E7 — Customer accounts, cart and wishlist (implemented)

Geography module (**global** reference data — no `organization_id`, shared by every organization):
- `geo_divisions` — id smallint (fixed 1–8, primary key), code varchar(8) unique (BBS geocode), name_en varchar(60), name_bn varchar(60).
- `geo_districts` — id smallint (fixed 1–64, primary key), division_id → geo_divisions (`RESTRICT`, indexed), code varchar(8) unique (division code + district geocode), name_en, name_bn.
- Both are filled by the migration from `Geography/Infrastructure/Data/bangladesh.php` (8 divisions, 64 districts; 2018 government English spellings, official Bangla names). Fixed ids keep addresses meaningful when the data is reloaded. No upazila/thana table yet.

CustomerAccounts module:
- `customer_accounts` — customer_id → customers (**unique**, cascade), email varchar(254) (unique per organization regardless of case: expression index `(organization_id, lower(email))` on PostgreSQL and SQLite), phone varchar(11) NULL (`01XXXXXXXXX`), password (hashed), status (`active|disabled`, default `active`, CHECK on PostgreSQL), email_verified_at, email_verification_token_hash varchar(64) NULL unique (sha-256), email_verification_sent_at (the link is valid 24 hours from it), last_login_at, remember_token, timestamps. No soft delete: the row follows its customer.
- `customer_password_reset_tokens` — organization_id → organizations (cascade), email, token_hash (sha-256), created_at; primary key `(organization_id, email)` — one live token per e-mail and store, valid 60 minutes. No surrogate id.

Customers module:
- `customer_addresses` — customer_id → customers (cascade), label varchar(40) NULL, recipient_name varchar(120), phone varchar(11) (`01XXXXXXXXX`), division_id → geo_divisions and district_id → geo_districts (`RESTRICT`; "district in division" is checked on save), area varchar(100) (thana/area as typed), address_line varchar(255), postcode varchar(4) NULL, is_default_shipping, is_default_billing, timestamps, soft delete. Index `(organization_id, customer_id)`. The limit of 10 and the single default are enforced in `CustomerAddressBook` under a lock on the customer row (no partial unique index on the flags).

Cart module (no price columns anywhere — every read reprices, ADR-005):
- `carts` — organization_id, customer_id → customers NULL (cascade; **one cart per customer**: partial unique index `carts_customer_unique (customer_id) WHERE customer_id IS NOT NULL`), token_hash varchar(64) NULL unique (sha-256 of the guest cookie token), expires_at (guest carts: 30 days after the last change; customer carts: NULL), timestamps. Index `(organization_id, expires_at)` for `cart:prune`.
- `cart_items` — cart_id → carts (cascade), variant_id → product_variants (cascade), quantity NUMERIC(18,3) (CHECK > 0 on PostgreSQL), timestamps; unique `(cart_id, variant_id)`. No organization_id (reached through the cart).
- `wishlists` — organization_id, customer_id → customers (**unique**, cascade), timestamps.
- `wishlist_items` — wishlist_id → wishlists (cascade), product_id → products (cascade), variant_id → product_variants NULL (cascade), created_at. One entry per product and variant through two partial unique indexes (a plain unique index would let NULL variants repeat): `(wishlist_id, product_id) WHERE variant_id IS NULL` and `(wishlist_id, product_id, variant_id) WHERE variant_id IS NOT NULL`.

No existing table changed in E7. Deferred to E8 with checkout: `carts.coupon_code` / `converted_order_id` and the idempotency scope change (ADR-014).

### E-commerce E8a — Shipping, checkout and orders (implemented)

Shipping module:
- `shipping_zones` — name varchar(60), is_active, sort_order, author columns, timestamps. Index `(organization_id, sort_order)`.
- `shipping_zone_districts` — organization_id, zone_id → shipping_zones (cascade), district_id → geo_districts (`RESTRICT`). **Unique `(organization_id, district_id)`**: one zone per district per organization (the save action reports `DISTRICT_IN_OTHER_ZONE` first; the index catches concurrent saves).
- `shipping_methods` — zone_id → shipping_zones (cascade), name varchar(60), description varchar(160) NULL, fee NUMERIC(18,2), free_over NUMERIC(18,2) NULL (free when the goods total after tax reaches it), cod_allowed (default true), cod_fee NUMERIC(18,2) (default 0), eta_min_days / eta_max_days smallint, is_active, sort_order, author columns, timestamps. Index `(zone_id, sort_order)`. PostgreSQL CHECKs: amounts ≥ 0; `eta_min_days <= eta_max_days AND eta_max_days <= 30`.

OnlinePayments module:
- `payment_gateways` — code varchar(30) (`cod` \| `bank_transfer` in E8a), is_enabled, display_name varchar(60), instructions text NULL (shown after placement — bank details), settings json NULL (`bank_transfer`: `{hold_hours}` 1–168; `cod`: `{max_order_total}` amount or null), sort_order, author columns, timestamps. Unique `(organization_id, code)`. Rows are created with defaults on first use (COD on, bank transfer off). `mode` and encrypted credentials arrive with the online gateways (E8c).

Orders module (ADR-003; snapshots and append-only detail like `sales`):
- `orders` — number varchar(40) (`WEB-000001`, unique `(organization_id, number)`), customer_id → customers NULL (`RESTRICT`; **NULL for guests** — no customer record is created), customer_account_id → customer_accounts NULL (set null), branch_id / store_id (the fulfilment store the stock left from, `RESTRICT`), status varchar(20) (`pending_payment|confirmed|processing|shipped|delivered|cancelled|failed`), payment_status varchar(20) (`unpaid|paid`), payment_method varchar(30) (`cod|bank_transfer`), shipping_method_id → shipping_methods NULL (set null) + shipping_method_name varchar(60) and eta_min_days / eta_max_days (snapshot), currency char(3), tax_mode varchar(10), subtotal, tax_total, shipping_total, cod_fee, total, paid_total (default 0), cost_total (NUMERIC(18,2)), contact_name / contact_email / contact_phone, notes varchar(500) NULL, access_token_hash char(64) NULL (sha-256 of the guest token), courier_name / tracking_number varchar(100) NULL, placed_at, expires_at NULL (bank transfer while pending), confirmed_at, shipped_at, delivered_at, cancelled_at, cancelled_by → users NULL, cancel_reason varchar(200) NULL, ip varchar(45), user_agent varchar(255), timestamps. Indexes `(organization_id, status, placed_at)`, `(organization_id, customer_id, placed_at)`, `(status, expires_at)` (expiry job). PostgreSQL CHECK: all amounts ≥ 0.
- `order_lines` — order_id (`RESTRICT`), position, product_id, variant_id, snapshots product_name, variant_name, product_slug varchar(160) NULL (for the product link), sku, option_values json NULL, image_url, quantity NUMERIC(18,3) (CHECK > 0 on PostgreSQL), unit_price, compare_at_price NULL, line_subtotal (quantity × unit price, what the storefront shows as the line total), net_amount, tax_rate NUMERIC(9,4), tax_amount, line_total (net + tax), unit_cost NUMERIC(18,4), cost_total, created_at. Indexes `(order_id, position)`, `(organization_id, variant_id)`.
- `order_line_stock` — order_line_id, batch_id → batches NULL, quantity NUMERIC(18,3), unit_cost NUMERIC(18,4), movement_id NULL: the exact allocations used to restock on cancellation (mirrors `sale_line_stock`).
- `order_addresses` — order_id, kind (`shipping`; billing = shipping in E8a; unique `(order_id, kind)`), recipient_name, phone, email NULL, division_id + division_name, district_id + district_name, area NULL, address_line, postcode NULL, created_at. Ids and names are copies (no FKs), so the address reads the same forever.
- `order_status_history` — order_id, from_status NULL, to_status, note varchar(255) NULL, actor_user_id → users NULL (NULL = the shopper at placement or the system at expiry), created_at. Index `(order_id, created_at)`.
- PostgreSQL triggers (`prevent_order_detail_mutation`) reject `UPDATE`/`DELETE` on `order_lines`, `order_line_stock` and `order_status_history`. `orders` itself is updated by the workflow (status, payment, timestamps) under a row lock.

Changes to existing tables:
- `idempotency_keys` (ADR-014; migration `database/migrations/2026_10_31_190000_scope_idempotency_keys.php`): new `scope varchar(80)` NOT NULL (`user:{id}` \| `customer:{account id}` \| `cart:{cart token hash}`; existing rows backfilled `user:{user_id}`), `user_id` nullable (set only for staff), unique `(scope, key)` replaces `(user_id, key)`.
- `carts.converted_order_id` → orders NULL (set null): a converted cart keeps its row and loses its lines. The one-cart-per-customer index becomes `carts_customer_unique (customer_id) WHERE customer_id IS NOT NULL AND converted_order_id IS NULL`.
- `storefront_settings.guest_checkout_enabled` boolean, default true.
- No schema change for the new values `stock_movements.type` `online_order` / `online_order_cancel`, `payments.source_type` `online_order` (`online_order_refund` reserved for E10) and `payments.method` `cash_on_delivery` (`online_gateway` reserved for E8c): those columns are plain strings checked by PHP enums.
- Not built in E8a: `payment_intents`, `payment_transactions`, `webhook_receipts` (E8c); couriers and shipments (built in E10a, below). `carts.coupon_code` and the promotions tables came with E8b.

### E-commerce E8b — Promotions, coupons and order discounts (implemented)

Promotions module (web channel only):
- `promotions` — name varchar(80), description varchar(200) NULL (shown to shoppers), type varchar(20) (`percent|fixed|free_shipping`), value NUMERIC(18,2) (default 0; `0.00` for free shipping), scope varchar(20) (`order|products|categories|brands`), min_subtotal / max_discount NUMERIC(18,2) NULL, trigger varchar(20) (`automatic|coupon`), starts_at / ends_at timestamptz NULL, show_countdown (default false), is_active (default true), usage_limit / usage_limit_per_customer integer NULL, author columns, timestamps. Indexes `(organization_id, trigger, is_active)`, `(organization_id, created_at)`. PostgreSQL CHECK `promotions_rules_check`: the three enums; percent `0 < value ≤ 100`; fixed `value > 0`; free shipping only with scope `order`; `show_countdown` needs `ends_at`, trigger `automatic` and a non-order scope; `ends_at > starts_at` when both are set; `min_subtotal ≥ 0`; `max_discount > 0`; limits ≥ 1.
- `promotion_targets` — organization_id, promotion_id → promotions (cascade), target_type varchar(10) (`product|category|brand`, CHECK on PostgreSQL), target_id uuid (no FK: products, categories or brands; existence is checked on save, deleted targets simply stop matching). Primary key `(promotion_id, target_type, target_id)`; index `(organization_id, target_type, target_id)`. Categories match their sub-categories at pricing time (not stored).
- `coupons` — promotion_id → promotions (cascade), code varchar(40), usage_limit integer NULL, used_count integer (default 0; projection of the redemptions with this code, incremented at placement under the row lock), is_active, author columns, timestamps. **Unique `(organization_id, lower(code))`** (expression index `coupons_code_unique`); index `(promotion_id, code)`. PostgreSQL CHECK: `code ~ '^[A-Z0-9-]{3,40}$'` (stored upper-case), `used_count ≥ 0`, `usage_limit ≥ 1`.
- `promotion_redemptions` — promotion_id → promotions (`RESTRICT`), coupon_id → coupons NULL (`RESTRICT`), order_id → orders (`RESTRICT`), order_number varchar(40), customer_id → customers NULL (set null), customer_account_id → customer_accounts NULL (set null), email varchar(255) (lower-case contact e-mail — per-customer limits of guests are counted by it), kind varchar(10) (`product|order|shipping`), amount NUMERIC(18,2), created_at. Indexes `(promotion_id, customer_id)`, `(promotion_id, email)`, `order_id`. PostgreSQL CHECK `amount ≥ 0` and kind; trigger `promotion_redemptions_append_only` (`prevent_promotion_redemption_mutation`) rejects `UPDATE`/`DELETE`. One row per promotion used by a placed order; cancelling the order does not remove it (E8b). The `RESTRICT` keys keep used promotions and codes from being deleted (the actions answer `IN_USE` first).

Orders module:
- `orders` gains discount_total NUMERIC(18,2) (default 0; goods discounts), shipping_discount NUMERIC(18,2) (default 0; the delivery fee waived by free delivery — `shipping_total` is what was charged) and coupon_code varchar(40) NULL (set only when the coupon was redeemed). PostgreSQL CHECK `orders_discounts_check`: both ≥ 0.
- `order_lines` gains discount_amount NUMERIC(18,2) (default 0): the line's product discount plus its share of the order discount, as `SaleCalculator` allocates it. PostgreSQL CHECK `0 ≤ discount_amount ≤ line_subtotal`.
- `order_promotions` — organization_id, order_id → orders (`RESTRICT`), promotion_id → promotions NULL (set null), name varchar(80) (snapshot), kind varchar(10) (`product|order|shipping`), amount NUMERIC(18,2), created_at. Index `order_id`. PostgreSQL CHECK amount ≥ 0 and kind; trigger `order_promotions_append_only` (the existing `prevent_order_detail_mutation`).

Cart module:
- `carts.coupon_code` varchar(40) NULL — one coupon per cart, normalized upper-case, re-checked on every pricing; an invalid code stays (ignored) until the shopper removes or replaces it.

Promotions keep no price or discount projection on products: card and product prices are computed per request from the live promotions (listing filters and sorting use the base price; E12 may index promotional prices).

### E-commerce E9 — Customer account area and reviews (implemented)

Reviews module:
- `reviews` — organization_id (`RESTRICT`), product_id → products (`RESTRICT`), customer_id → customers (`RESTRICT`), order_line_id → order_lines (`RESTRICT`; the delivered web order line that verifies the purchase — every review is a verified purchase), rating smallint, title varchar(120) NULL, body text (plain text, trimmed), status varchar(10) (`pending|approved|rejected`, default `pending`), rejection_reason varchar(200) NULL, moderated_by → users NULL (set null), moderated_at timestamptz NULL, timestamps. **Unique `(customer_id, product_id)`** (one review per customer and product; the action answers `REVIEW_EXISTS` first, the index catches parallel submits). Indexes `(organization_id, product_id, status, created_at)` (product page list and summary) and `(organization_id, status, created_at)` (moderation queue). PostgreSQL CHECK `reviews_rules_check`: `rating BETWEEN 1 AND 5`, the status enum, `char_length(body) BETWEEN 10 AND 2000`, title NULL or 1–120 characters, `rejection_reason` only when `rejected`, and `(status = 'pending') = (moderated_at IS NULL)` — an author's edit sets the review back to pending and clears the moderation columns.
- The rating summary (average with one decimal, count, distribution 1–5) is an aggregate query over approved rows per request; there is no rating projection on products in E9.

Orders module:
- `order_status_history.actor_type` varchar(10) NULL (`customer|staff|system`; PostgreSQL CHECK `order_status_history_actor_type_check`): `customer` for placement and a cancellation from the account area, `staff` for workflow steps (`actor_user_id` set), `system` for expiry. The table is append-only, so rows from before E9 stay NULL and the presenter derives the type (actor user → staff, first row → customer, otherwise system).
- No other order columns: a customer cancellation uses `cancelled_at` and `cancel_reason` (E8a) with `cancelled_by` NULL. The account order list uses the existing index `(organization_id, customer_id, placed_at)`; orders are the customer's by `orders.customer_id` only (guest orders keep it NULL and are not attached by e-mail).

### E-commerce E10a — Fulfilment: couriers, shipments and COD remittances (implemented)

Shipping module:
- `couriers` — organization_id (`RESTRICT`), name varchar(80), phone varchar(20) NULL, tracking_url_template varchar(500) NULL (absolute http(s) URL containing `{tracking}`, replaced by the url-encoded tracking number), is_active (default true), sort_order int (default 0), created_by / updated_by → users NULL (set null), timestamps. Unique expression index `couriers_name_unique (organization_id, lower(name))` (both drivers); index `(organization_id, sort_order)`. PostgreSQL CHECKs `couriers_tracking_template_check` (NULL or contains `{tracking}` and starts with `http://` / `https://`) and `couriers_name_check` (`length(trim(name)) > 0`). Shipments and remittances reference couriers with `RESTRICT`, so a used courier can only be deactivated (`IN_USE`).

Orders module (one migration, `2026_11_01_120200_create_shipments_and_cod_remittances_tables`):
- `shipments` — organization_id, order_id → orders (`RESTRICT`, **unique**: one shipment per order in E10a), courier_id → couriers NULL (`RESTRICT`), courier_name varchar(80) (snapshot), tracking_number varchar(60) NULL, status varchar(20) (`handed_over|in_transit|delivered|returned`), cod_amount NUMERIC(18,2) default 0 (what the courier collects: the order total of an unpaid COD order at hand-over, else 0), shipped_at timestamptz, delivered_at / returned_at timestamptz NULL, created_by → users NULL (set null), timestamps. Index `(organization_id, courier_id, status)`. PostgreSQL CHECK `shipments_rules_check`: the status enum, `cod_amount ≥ 0`, `delivered` ⇒ `delivered_at` set, `returned` ⇒ `returned_at` set. The row is updated as the parcel moves (status and times); its history is in `shipment_events`.
- `shipment_events` — organization_id, shipment_id → shipments (`RESTRICT`), status varchar(20), note varchar(200) NULL, occurred_at timestamptz (the courier's time; not before the hand-over), created_by → users NULL, created_at (when it was recorded). Index `(shipment_id, occurred_at)`. PostgreSQL CHECK `shipment_events_status_check`; trigger `shipment_events_append_only` (the E8a `prevent_order_detail_mutation()`).
- `cod_remittances` — organization_id, number varchar(40) (`REM-000001`, `document_sequences` key `cod_remittance`; unique `(organization_id, number)`), courier_id → couriers (`RESTRICT`), reference varchar(60) NULL (the courier's statement number), received_at **date**, method varchar(20) (`bank_transfer|cash|mobile_banking`), currency char(3), gross_amount / fee_amount / net_amount NUMERIC(18,2), expense_id → expenses NULL (`RESTRICT`; the "Courier fees" expense when the fee is above zero) and expense_number varchar(40) NULL (snapshot), note varchar(500) NULL, created_by → users NULL, created_at. Indexes `(organization_id, courier_id, received_at)`, `(organization_id, received_at)`. PostgreSQL CHECKs `cod_remittances_amounts_check` (`gross_amount > 0`, `0 ≤ fee_amount ≤ gross_amount`, `net_amount = gross_amount − fee_amount`) and `cod_remittances_method_check`; trigger `cod_remittances_append_only`.
- `cod_remittance_lines` — organization_id, remittance_id → cod_remittances (`RESTRICT`), order_id → orders (`RESTRICT`), amount NUMERIC(18,2) (the order total). **Unique `(organization_id, order_id)`**: an order is remitted once (the action checks `already_paid` first; the index catches a parallel remittance). Index `remittance_id`. PostgreSQL CHECK `cod_remittance_lines_amount_check` (`amount > 0`); trigger `cod_remittance_lines_append_only`.
- No change to `orders`: `courier_name`, `tracking_number`, `shipped_at`, `delivered_at` are still written on the order (lists, e-mails, storefront). Orders shipped before E10a have no `shipments` row. A remittance writes, per order, a `payments` row (`online_order`, in, `cash_on_delivery`, reference = REM number) and, for the fee, an `expenses` row with its `payments` row (`expense`, out, `cash_on_delivery`, no register session) — no new payment columns or values.

### E-commerce E10b — Online returns and refunds (implemented)

Storefront module (`2026_11_01_130000_add_return_window_to_storefront_settings`):
- `storefront_settings.return_window_days` unsigned smallint, default 7 (days after `orders.delivered_at` a customer may ask for a return; 0 = no online returns). PostgreSQL CHECK `storefront_settings_return_window_check` (`BETWEEN 0 AND 60`).

Orders module (`2026_11_01_130100_create_order_returns_tables`):
- `orders.refunded_total` NUMERIC(18,2) default 0 — the sum of booked return refunds; workflow-mutable like `paid_total`. PostgreSQL CHECK `orders_refunded_total_check` (`0 ≤ refunded_total ≤ paid_total`). `orders.payment_status` gains the values `partially_refunded` and `refunded` (varchar, no CHECK list).
- `order_returns` — organization_id, order_id → orders (`RESTRICT`), number varchar(40) (`RTN-WEB-000001`, `document_sequences` key `order_return`; unique `(organization_id, number)`), status varchar(20) (`requested|approved|received|refunded|rejected|cancelled`), reason_code varchar(20) (`damaged|wrong_item|not_as_described|changed_mind|other`), customer_note / staff_note varchar(500) NULL, rejection_reason varchar(200) NULL, requested_by varchar(10) (`customer|staff`), override_window boolean (staff accepted it after the window, with a note), currency char(3), items_amount / shipping_refund / refund_amount NUMERIC(18,2), refund_method varchar(20) NULL (`cash|bank_transfer|mobile_banking`), refund_reference varchar(80) NULL, requested_by_user_id, approved_at/approved_by, rejected_at/rejected_by, received_at/received_by, refunded_at/refunded_by (users, set null), cancelled_at, timestamps. Indexes `(organization_id, status, created_at)`, `order_id`. PostgreSQL CHECK `order_returns_rules_check`: the enums, `items_amount ≥ 0`, `shipping_refund ≥ 0`, `refund_amount = items_amount + shipping_refund`, `refunded` ⇒ method and `refunded_at`, `rejected` ⇒ reason and `rejected_at`, `cancelled` ⇒ `cancelled_at`, `approved|received|refunded` ⇒ `approved_at`, `received|refunded` ⇒ `received_at`. The row changes as the return moves; its history is in `order_return_history`. There is no `order_refunds` table: the refund's method, reference, time and actor are on the return and the money is a `payments` row (source `online_order_refund`, direction out, reference id = the return).
- `order_return_lines` — organization_id, return_id → order_returns (`RESTRICT`), order_line_id → order_lines (`RESTRICT`; unique `(return_id, order_line_id)`, index `order_line_id`), requested_quantity NUMERIC(18,3) (as asked; never changes), quantity NUMERIC(18,3) (approved; staff may lower it, 0 = not returned), amount / tax_amount / cost_total NUMERIC(18,2) (the proportional share of the order line, remainder rule), restock boolean NULL (decided at receipt; NULL before), restocked_quantity NUMERIC(18,3) default 0, created_at. PostgreSQL CHECK `order_return_lines_rules_check` (`requested_quantity > 0`, `0 ≤ quantity ≤ requested_quantity`, amounts ≥ 0, `0 ≤ restocked_quantity ≤ quantity`); trigger `order_return_lines_guard` (function `guard_order_return_line()`): no deletes, and `return_id`, `order_line_id`, `organization_id`, `requested_quantity` never change.
- `order_return_line_stock` — organization_id, return_line_id → order_return_lines, order_line_stock_id → order_line_stock, batch_id → batches NULL (all `RESTRICT`), quantity NUMERIC(18,3) (CHECK `> 0`), unit_cost NUMERIC(18,4), movement_id uuid NULL (the `online_return` stock movement). Indexes `return_line_id`, `order_line_stock_id`. Which allocation of the original sale each restocked unit went back to: a later return of the same line only uses what is still free per allocation, so no allocation is restocked twice. Trigger `order_return_line_stock_append_only`.
- `order_return_history` — organization_id, return_id → order_returns (`RESTRICT`), from_status varchar(20) NULL, to_status varchar(20), note varchar(255) NULL, actor_user_id → users NULL (set null), actor_type varchar(10) (`customer|staff`, PostgreSQL CHECK `order_return_history_actor_type_check`), created_at. Index `(return_id, created_at)`. Trigger `order_return_history_append_only`.
- New values, no new columns elsewhere: stock movement type `online_return` (inbound, reference type `online_return`, at the allocation's unit cost); payment source `online_order_refund` (bank transfer and mobile banking without a register session; cash with the refunding user's open session in the order's branch); document sequence `order_return`.
- Shipping and COD fees are not part of `items_amount`; `shipping_refund` (granted at approval) is limited to `orders.shipping_total` minus the shipping refunds of the order's other active returns.

### E-commerce E11 — Blog, popup banner, blog menu links (implemented)

Cms module (`2026_11_01_140000_create_blog_tables`):
- `blog_categories` — organization_id (`RESTRICT`), name varchar(80), slug varchar(100), description varchar(300) NULL, sort_order unsigned smallint default 0, created_by / updated_by → users NULL (set null), timestamptz, soft delete. Index `(organization_id, sort_order)`; unique `blog_categories_org_slug_unique (organization_id, lower(slug)) WHERE deleted_at IS NULL`. PostgreSQL CHECKs `blog_categories_slug_check` (`^[a-z0-9]+(-[a-z0-9]+)*$`), `blog_categories_name_check` (not blank).
- `blog_posts` — organization_id (`RESTRICT`), category_id → blog_categories NULL (**set null**; a soft-deleted category's posts are also set to null by `ManageBlogCategories`), slug varchar(100), title varchar(160), excerpt varchar(300) NULL, body_html text NULL (sanitized, ADR-009), cover_media_id → media NULL (**set null**; a post that is not deleted keeps its cover through the media reference check), author_user_id → users NULL (set null), status varchar(20) default `draft` (`draft|published`), published_at timestamptz NULL (a future time = scheduled), seo_title varchar(70) NULL, seo_description varchar(160) NULL, reading_minutes unsigned smallint default 1, created_by / updated_by → users NULL, timestamptz, soft delete. Indexes `(organization_id, status, published_at)`, `(organization_id, category_id)`; unique `blog_posts_org_slug_unique (organization_id, lower(slug)) WHERE deleted_at IS NULL`. PostgreSQL CHECKs `blog_posts_status_check`, `blog_posts_slug_check`, `blog_posts_reading_minutes_check` (`≥ 1`), `blog_posts_published_at_check` (`status = 'draft' OR published_at IS NOT NULL`).

Storefront module (`2026_11_01_140100_add_popup_banners_and_blog_menu_links`):
- `banners.popup_delay_seconds` unsigned smallint NULL and `banners.popup_frequency` varchar(20) NULL. PostgreSQL: `banners_placement_check` rebuilt with `popup` (`hero_slider|home_promo|popup`); new `banners_popup_settings_check` — a popup has `popup_delay_seconds BETWEEN 0 AND 60` and `popup_frequency IN ('once_per_session','once_per_day','once_per_week')`, every other placement has both null.
- `menu_items.type` gains `blog`, `blog_category`, `blog_post` (varchar; PHP `MenuItemType`). PostgreSQL `menu_items_target_check` rebuilt: `custom` needs `url`, `blog` has no `target_id`, every other type needs `target_id`. Blog targets are not foreign keys (as page, category and brand targets): deleting a linked category or post is refused (`IN_USE`, `BlogReferences` tag) and the bootstrap drops targets that are gone or not readable.
- `homepage_sections.type` gains `blog_posts` (varchar, no CHECK list; config `{category_id, limit, view_all_url}` in the `config` jsonb column).

No change to `orders`: cancelling a paid order sets `status = cancelled`, `payment_status = refunded`, `refunded_total = paid_total` and writes a `payments` row (source `online_order_refund`, direction out) — the E10b columns and values.

### E-commerce E12a — SEO and storefront performance (implemented)

Storefront module (`2026_11_01_150000_add_allow_indexing_to_storefront_settings`):
- `storefront_settings.allow_indexing` boolean NOT NULL default `true` (after `return_window_days`). `false` = robots `Disallow: /`, sitemaps 404, every shell page noindex. Additive, no backfill (existing stores stay indexable).

OnlineCatalog module (`2026_11_01_150100_add_storefront_performance_indexes`, from the E12a query review):

| Index | PostgreSQL | SQLite | Serves |
|-------|-----------|--------|--------|
| `product_listings_live_window_index` | `(organization_id, published_at, unpublished_at) WHERE is_published` | `(organization_id, is_published, published_at, unpublished_at)` | the live candidate set, sitemap products, `MIN(published_at) > now` (cache expiry) |
| `product_listings_unpublish_index` | `(organization_id, unpublished_at) WHERE is_published AND unpublished_at IS NOT NULL` | `(organization_id, unpublished_at)` | `MIN(unpublished_at) > now` (cache expiry) |
| `product_variants_live_product_index` | `(product_id, sort_order) WHERE deleted_at IS NULL AND is_active` | `(product_id, is_active, sort_order)` | "has an active variant" (`EXISTS`) and the variant load of the candidate set |

Created with `CREATE INDEX IF NOT EXISTS`; `StorefrontIndexesTest` (PostgreSQL only) asserts they exist. Reviewed and left as is: images `(product_id, sort_order)`, stock `(store_id, variant_id)`, reviews `(organization_id, product_id, status, created_at)`, promotions `(organization_id, trigger, is_active)`, blog `(organization_id, status, published_at)`, search on the `lower(name)` trigram index (SKU match is a scan; search results are not cached). Assumed scale: a few thousand products per organization. **`EXPLAIN` on PostgreSQL is pending** (no PostgreSQL access during E12a).

No table for the server cache: entries and the per-organization content version live in the configured cache store (`cache` table with the `database` store).

### E-commerce E12b — Bangla storefront and content translations (implemented)

Content translations (ADR-011): a nullable `translations` **jsonb** column `{"bn": {field: value}}` next to the base (English) columns, added by `Shared\Infrastructure\Persistence\TranslationsColumn::add()`. On PostgreSQL each gets `{table}_translations_check`: `translations IS NULL OR jsonb_typeof(translations) = 'object'`. Shape, allowed fields and lengths are enforced by the application (`TranslationInput`); the stored document has sorted keys, no empty locales, and is `NULL` when nothing is translated. No index on it: public reads fetch the column with the row, and the storefront search's Bangla-name match is an unindexed `lower(translations->'bn'->>'name') LIKE …` (Laravel JSON path; `json_extract` on SQLite) beside the trigram-indexed base-name match.

| Migration (2026_11_05_…) | Module | Tables gaining `translations` | Translatable fields |
|--------------------------|--------|-------------------------------|---------------------|
| `100000_add_translations_to_listings` | OnlineCatalog | `product_listings`, `category_listings`, `brand_listings` | product: `name` (base = `products.name`), `short_description`, `description_html`, `seo_title`, `seo_description`; category: `name` (base = `categories.name`), `description_html`, SEO; brand: `name` (base = `brands.name`), `description`, SEO |
| `100100_add_translations_to_content` | Cms | `cms_pages`, `faq_items`, `blog_categories`, `blog_posts` | page `title`, `body_html`, SEO; FAQ `question`, `answer_html`; blog category `name`, `description`; post `title`, `excerpt`, `body_html`, SEO |
| `100200_add_languages_to_storefront` | Storefront | `menu_items`, `banners`, `homepage_sections` | `label`; `kicker`, `title`, `subtitle`, `button_label`, `secondary_button_label`; `title`, `subtitle` + config texts (`body_html` of `rich_text`, `text` / `button_label` of `newsletter`) as flat keys |
| `100300_add_translations_to_shipping_methods` | Shipping | `shipping_methods` | `name`, `description` |
| `100400_add_translations_to_payment_gateways` | OnlinePayments | `payment_gateways` | `display_name`, `instructions` |
| `100500_add_translations_to_promotions` | Promotions | `promotions` | `name`, `description` |

The announcement bar's translations live inside the theme document (`theme_settings.settings → announcement.translations`, `{"bn": {"text": …}}` or null; `ThemeSchema` default null) — no column.

Store languages (Storefront `100200`, after `allow_indexing`):
- `storefront_settings.bangla_enabled` boolean NOT NULL default `true`; `default_locale` varchar(2) NOT NULL default `'en'`; `bangla_digits` boolean NOT NULL default `false`. PostgreSQL `storefront_settings_default_locale_check`: `default_locale IN ('en','bn') AND (bangla_enabled OR default_locale = 'en')`. Existing stores become bilingual with English as default.

Language of orders and accounts:
- `orders.locale` varchar(2) NOT NULL default `'en'` (Orders `100600_add_locale_to_orders`; PostgreSQL `orders_locale_check`: `locale IN ('en','bn')`) — the checkout request's language; existing orders are `en`. Line, delivery, promotion and address snapshots stay English.
- `customer_accounts.preferred_locale` varchar(2) NULL (CustomerAccounts `100700_add_preferred_locale_to_customer_accounts`; `customer_accounts_preferred_locale_check`: NULL or `en|bn`) — the language of the last sign-up / sign-in.

All additive, no backfill. Geography already had `name_bn` (E7); no change. **The CHECKs and the jsonb search expression have not run on PostgreSQL yet.**

### Supply chain SC1 — Supplier catalog, reorder rules and replenishment (implemented)

Inventory module (`2026_11_06_100000_create_replenishment_tables`):
- `stock_reorder_rules` — organization_id, branch_id (the store's branch, for branch scoping), store_id, variant_id → product_variants (all `RESTRICT`), min_qty `NUMERIC(18,3)` (reorder point), max_qty `NUMERIC(18,3)` NULL (order-up-to level; NULL = cover `coverage_days` of sales), is_active boolean default true, created_by / updated_by → users NULL (set null), timestamptz. Unique `(store_id, variant_id)`; index `(organization_id, variant_id)`. PostgreSQL CHECKs `stock_reorder_rules_min_check` (`min_qty >= 0`) and `stock_reorder_rules_max_check` (`max_qty IS NULL OR max_qty >= min_qty`). Without an active rule a store falls back to `product_variants.reorder_level` as minimum and no maximum.
- `replenishment_settings` — one row per organization (`organization_id` unique, `RESTRICT`), source_store_id → stores NULL (`RESTRICT`; the central store that replenishes the others), coverage_days / velocity_days / safety_days unsigned smallint (defaults 14 / 30 / 3), created_by / updated_by, timestamptz. PostgreSQL CHECKs: coverage `BETWEEN 1 AND 180`, velocity `BETWEEN 7 AND 180`, safety `BETWEEN 0 AND 60`. No row = the defaults with no source store; the row is created on the first save.

Purchasing module (`2026_11_06_100100_create_supplier_catalog_tables`):
- `supplier_products` — organization_id, supplier_id, variant_id → product_variants (all `RESTRICT`), supplier_sku varchar(64) NULL, unit_cost `NUMERIC(18,4)` (per base unit, tax-exclusive, as on purchase orders), pack_size `NUMERIC(18,3)` default 1, min_order_qty `NUMERIC(18,3)` NULL, lead_time_days unsigned smallint default 7, is_preferred boolean default false, last_purchase_cost `NUMERIC(18,4)` NULL and last_purchased_at timestamptz NULL (written only by goods receipts, for existing rows of the receipt's supplier), is_active boolean default true, created_by / updated_by, timestamptz. Hard delete. Unique `(supplier_id, variant_id)`; index `(organization_id, variant_id)`; **partial unique `supplier_products_preferred_unique (organization_id, variant_id) WHERE is_preferred`** — at most one preferred supplier per variant (created on PostgreSQL and SQLite). PostgreSQL CHECKs: `unit_cost >= 0`, `pack_size >= 1`, `min_order_qty IS NULL OR min_order_qty > 0`, `lead_time_days BETWEEN 0 AND 365`, `last_purchase_cost IS NULL OR last_purchase_cost >= 0`, `supplier_products_preferred_active_check` (`NOT is_preferred OR is_active`).
- `reorder_notification_runs` — organization_id, store_id (`RESTRICT`), run_on date (the organization-local day), items and recipients unsigned int, created_at timestamptz. Unique `(store_id, run_on)` — the claim that makes the daily reorder alert at most once per store and day; index `(organization_id, run_on)`. PostgreSQL CHECK `items > 0`.

Unchanged: `purchase_orders` (reorder drafts are ordinary `draft` orders, notes "Created from reorder suggestions."), `stock_transfers` (replenishment transfers are ordinary `in_transit` transfers; lines of batch-tracked goods are split one per batch taken), `product_variants.reorder_level` (still drives the low-stock alert and is the rule fallback). Inputs are read, not stored: on hand from `stock_levels`, in transit from `in_transit` transfer lines into the store, open orders from `ordered|partially_received` order lines (`quantity − received_quantity`), net units sold from `stock_movements`. All additive. **The CHECKs and the partial unique index have not run on PostgreSQL yet.**

### Supply chain SC2 — Requisitions, approvals and supplier quotes (implemented)

Purchasing module (`2026_11_07_100000_create_procurement_tables`). Foreign keys to organizations, branches, stores, variants, suppliers and parent documents are `RESTRICT` unless noted; author / actor columns → users `SET NULL`; timestamps timestamptz. Money `NUMERIC(18,2)`, unit costs and prices `NUMERIC(18,4)`, quantities `NUMERIC(18,3)`.

- `purchase_approval_settings` — one row per organization (`organization_id` unique), auto_approve_limit `NUMERIC(18,2)` default 10000, manager_limit `NUMERIC(18,2)` default 100000, require_po_approval boolean default true, created_by / updated_by. No row = the defaults. CHECK `purchase_approval_settings_limits_check` (`auto_approve_limit >= 0 AND manager_limit >= 0 AND auto_approve_limit <= manager_limit`).
- `purchase_requisitions` — organization_id, number varchar(30) (`PR-000001`, `SequenceGenerator` key `purchase_requisition`; unique `(organization_id, number)`), branch_id, store_id, status varchar(20) default `draft`, requested_by → users (`RESTRICT`), needed_by date NULL, notes varchar(1000) NULL, currency char(3), estimated_subtotal / estimated_tax / estimated_total (recomputed on every save), approval_level varchar(10) NULL (set on submit), submitted_at, approved_by NULL / approved_at (approved_at set with approved_by NULL = approved by the system), rejected_by / rejected_at / rejection_reason varchar(500), cancelled_by / cancelled_at / cancellation_reason varchar(500), converted_at, created_by / updated_by. Indexes `(organization_id, branch_id, status)`, `(organization_id, requested_by)`. CHECKs: `purchase_requisitions_status_check` (`draft|submitted|approved|rejected|cancelled|converted`), `_approval_level_check` (NULL or `none|manager|high`), `_amounts_check` (estimates ≥ 0), `_approved_check` (`approved` / `converted` need approved_at and approval_level), `_rejected_check` (`rejected` needs a reason), `_self_approval_check` (`approved_by IS NULL OR approved_by <> requested_by`).
- `purchase_requisition_lines` — organization_id, purchase_requisition_id (`CASCADE`), variant_id, quantity, estimated_unit_cost `NUMERIC(18,4)` (tax-exclusive), tax_rate `NUMERIC(9,4)` default 0, line_total `NUMERIC(18,2)` (incl. tax), suggested_supplier_id → suppliers NULL, notes varchar(255) NULL, converted_quantity default 0 (turned into POs or handed to an RFQ), sort_order. Index `(purchase_requisition_id, sort_order)`. CHECKs `_quantity_check` (`quantity > 0 AND estimated_unit_cost >= 0 AND line_total >= 0`), `_converted_check` (`0 <= converted_quantity <= quantity`).
- `purchase_requisition_status_history`, `purchase_order_status_history`, `rfq_status_history` — organization_id, the document id, from_status varchar(20) NULL, to_status varchar(20), note varchar(500) NULL, actor_user_id NULL (NULL = the system: automatic approval, released quantities), created_at. Index `(document id, created_at)`. **Append-only.**
- `rfqs` — organization_id, number (`RFQ-000001`, key `rfq`; unique `(organization_id, number)`), branch_id, store_id, status varchar(20) default `draft`, requisition_id → purchase_requisitions NULL, title varchar(150), needed_by / reply_by date NULL, notes varchar(2000) NULL, sent_at, closed_at, awarded_at, cancelled_at, created_by / updated_by. Indexes `(organization_id, branch_id, status)`, `(organization_id, status, reply_by)` (reminder scan). CHECK `rfqs_status_check` (`draft|sent|closed|awarded|cancelled`).
- `rfq_lines` — organization_id, rfq_id (`CASCADE`), variant_id, quantity, requisition_line_id → purchase_requisition_lines NULL, notes varchar(255), sort_order. Unique `(rfq_id, variant_id)`. CHECK `quantity > 0`.
- `rfq_suppliers` — organization_id, rfq_id (`CASCADE`), supplier_id, invited_at, sent_at NULL (request issued), emailed_at NULL and email NULL (queued e-mail and its address; NULL = send manually). Unique `(rfq_id, supplier_id)`; index `(organization_id, supplier_id)`.
- `supplier_quotes` — organization_id, rfq_supplier_id (unique, `CASCADE`: one answer per invited supplier, replaced on re-entry), status varchar(20), received_at, valid_until date NULL, notes varchar(1000), created_by / updated_by. CHECK `status IN ('received','declined')`.
- `supplier_quote_lines` — organization_id, supplier_quote_id (`CASCADE`), rfq_line_id (`CASCADE`), unit_price `NUMERIC(18,4)` (per base unit, tax-exclusive), quantity_offered NULL, lead_time_days smallint NULL, notes varchar(255). Unique `(supplier_quote_id, rfq_line_id)`. CHECK `unit_price >= 0`, `quantity_offered` NULL or > 0, `lead_time_days` NULL or 0–365.
- `rfq_awards` — organization_id, rfq_id, rfq_line_id, supplier_id, purchase_order_id (all `RESTRICT`), quantity, unit_price, created_at. Unique `(rfq_line_id, supplier_id)` (split awards: several suppliers per line, each once); index `rfq_id`. CHECK `quantity > 0 AND unit_price >= 0`. **Append-only.**
- `rfq_reminder_runs` — organization_id, rfq_id, run_on date (organization-local day), missing smallint, created_at. Unique `(rfq_id, run_on)` — the claim that makes the quotes-overdue reminder at most once per RFQ and day.
- `purchase_order_lines` gains requisition_line_id → purchase_requisition_lines NULL (`RESTRICT`, indexed; migration `2026_11_07_100100`): the requisition line a converted or awarded order line came from, so cancelling the order gives the quantity back.
- `purchase_orders` gains requisition_id → purchase_requisitions NULL, rfq_id → rfqs NULL, approved_amount `NUMERIC(18,2)` NULL (pre-approved amount; the order needs no approval while its total ≤ approved_amount × 1.05), approval_level varchar(10) NULL (set when submitted for approval), submitted_by / submitted_at, approved_by / approved_at, rejected_by / rejected_at, rejection_reason varchar(500). Indexes `(organization_id, requisition_id)`, `(organization_id, rfq_id)`. PostgreSQL: `purchase_orders_status_check` rebuilt with `pending_approval`; new `_approval_level_check`, `_approved_amount_check` (NULL or ≥ 0), `_self_approval_check` (`approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by`). SQLite keeps the enum's CHECK inside the column, so the migration widens `status` to varchar(20) there instead. `down()` turns `pending_approval` orders back into drafts before restoring the old CHECK.

**Append-only enforcement:** PostgreSQL function `prevent_procurement_history_mutation()` with `BEFORE UPDATE OR DELETE` triggers `purchase_requisition_status_history_append_only`, `purchase_order_status_history_append_only`, `rfq_status_history_append_only`, `rfq_awards_append_only`; the models also use the `AppendOnly` trait (Sales), which refuses Eloquent updates and deletes on every driver.

Existing rows are untouched: orders keep their status, have no history before SC2 and no approval data. **The CHECKs and the triggers have not run on PostgreSQL yet.**

### Supply chain SC3 — Landed cost (implemented)

Three migrations; money `NUMERIC(18,2)`, unit costs and averages `NUMERIC(18,4)`, quantities `NUMERIC(18,3)`; foreign keys `RESTRICT` unless noted, actor columns → users `SET NULL`, timestamps timestamptz.

Inventory (`2026_11_08_100000_add_value_to_stock_movements`):
- `stock_movements.value` `NUMERIC(18,2)` NULL — the value a value-only movement added to its level. New type `landed_cost`: quantity 0, `unit_cost` = the per-unit increase of the average, `balance_after` = the unchanged quantity. PostgreSQL CHECK `stock_movements_value_only_check`: `(type = 'landed_cost') = (value IS NOT NULL) AND (type <> 'landed_cost' OR (quantity = 0 AND value > 0))`. Existing rows keep `value` NULL (no backfill needed). The ledger stays append-only (existing trigger).

Expenses (`2026_11_08_100100_add_on_account_to_expenses`):
- `expenses.on_account` boolean default false — owed to a supplier (landed cost on stock already sold): no `payments` row, not voidable. Existing rows false.

Purchasing (`2026_11_08_100200_create_landed_cost_tables`):
- `goods_receipts` gains `charges_total`, `charges_tax_total`, `landed_total`, `payable_total` (all default 0). **Backfill:** `landed_total = subtotal`, `payable_total = total` for existing receipts (no charges). CHECK `goods_receipts_landed_check` (all ≥ 0).
- `goods_receipt_lines` gains `landed_cost` `NUMERIC(18,2)` default 0 and `landed_unit_cost` `NUMERIC(18,4)` default 0. **Backfill:** `landed_unit_cost = unit_cost`. CHECK `goods_receipt_lines_landed_check` (both ≥ 0). Landed cost from later vouchers is not written here (it lives in `landed_cost_allocations`).
- `goods_receipt_charges` — organization_id, goods_receipt_id, type varchar(20), description varchar(120) NULL, amount, tax_amount default 0, allocation varchar(10), charge_supplier_id → suppliers NULL (NULL = on the receipt's own invoice), sort_order, created_at. Indexes `goods_receipt_id`, `(organization_id, charge_supplier_id)`. CHECK `goods_receipt_charges_values_check` (type `freight|duty|insurance|handling|other`, allocation `value|quantity`, `amount > 0`, `tax_amount >= 0`). **Append-only.**
- `landed_cost_vouchers` — organization_id, number varchar(30) (`LCV-000001`, `SequenceGenerator` key `landed_cost_voucher`; unique `(organization_id, number)`), branch_id, status varchar(10) default `draft`, voucher_date date, charge_supplier_id → suppliers (NOT NULL), reference varchar(64) NULL, notes varchar(1000) NULL, currency char(3), charges_total / tax_total / total, on_hand_total and consumed_total NULL (set on posting), expense_id → expenses NULL and expense_number varchar(40) NULL, posted_by / posted_at, created_by / updated_by, timestamps. Indexes `(organization_id, status)`, `(organization_id, branch_id, voucher_date)`, `(organization_id, charge_supplier_id)`. CHECKs `landed_cost_vouchers_status_check` (`draft|posted`), `_totals_check` (`charges_total >= 0 AND tax_total >= 0 AND total = charges_total + tax_total`), `_posted_check` (posted ⇒ `posted_at` set, `on_hand_total >= 0`, `consumed_total >= 0`, `on_hand_total + consumed_total = charges_total`).
- `landed_cost_voucher_charges` — organization_id, landed_cost_voucher_id (`CASCADE`), type, description, amount, tax_amount, allocation, sort_order. CHECK `landed_cost_voucher_charges_values_check` (as receipt charges). Replaced on every draft save.
- `landed_cost_voucher_receipts` — organization_id, landed_cost_voucher_id (`CASCADE`), goods_receipt_id, sort_order. Unique `(landed_cost_voucher_id, goods_receipt_id)`; index `goods_receipt_id`.
- `landed_cost_allocations` — one row per receipt line when a voucher is posted: organization_id, landed_cost_voucher_id, goods_receipt_id, goods_receipt_line_id, variant_id → product_variants, store_id, batch_id NULL, received_quantity, on_hand_quantity, amount, on_hand_amount, consumed_amount, average_cost_before / average_cost_after NULL (the level's), stock_movement_id → stock_movements NULL, sort_order, created_at. Indexes `landed_cost_voucher_id`, `goods_receipt_line_id`. CHECK `landed_cost_allocations_values_check` (amounts ≥ 0, `on_hand_amount + consumed_amount = amount`, `0 <= on_hand_quantity <= received_quantity`). **Append-only.**

**Append-only enforcement:** PostgreSQL function `prevent_landed_cost_mutation()` with `BEFORE UPDATE OR DELETE` triggers `landed_cost_allocations_append_only` and `goods_receipt_charges_append_only`; both models use the `AppendOnly` trait on every driver. Vouchers have no void, so posted rows are final.

Supplier balance (computed on read) = opening balance + Σ receipts' `payable_total` + Σ receipt charges billed by the supplier (amount + tax) + Σ posted vouchers billed by it (`total`) − Σ returns − Σ payments. Supplier performance (SC3) is a read model over existing tables; it adds no table. All changes are additive. **The CHECKs and the triggers have not run on PostgreSQL yet.**

### Phase 7 — Reporting
- Views: `v_sales_daily`, `v_sales_by_product`, `v_sales_by_cashier`, `v_inventory_valuation`, `v_customer_dues`, `v_supplier_dues`, …
- Materialized views refreshed by the scheduler for heavy aggregates.

### Phase 8 — AI
- `ai_conversations`, `ai_messages` (prompt/response metadata, token usage, no raw financial dumps), `ai_insights` (cached summaries)

## 3. Indexing strategy

- Every tenant table: composite index starting with `(organization_id, …)`; branch tables `(organization_id, branch_id, …)`.
- Hot POS lookups: `product_barcodes (organization_id, barcode)` unique; `product_variants (organization_id, lower(sku)) WHERE deleted_at IS NULL` unique. Storefront search: trigram GIN index on `lower(products.name)` (`pg_trgm`, PostgreSQL only, E6). Storefront live listings: partial indexes on published `product_listings` windows and live `product_variants` (E12a). The Bangla-name search on `translations` jsonb (E12b) has no index (a GIN / trigram expression index can follow if `EXPLAIN` asks for it).
- Case-insensitive uniqueness uses expression indexes, e.g. `brands (organization_id, lower(name))`, and partial indexes such as `customers (organization_id, phone) WHERE deleted_at IS NULL AND phone IS NOT NULL` — valid on PostgreSQL and SQLite alike.
- Ledgers: `stock_movements (store_id, variant_id, created_at)` for stock history; `(reference_type, reference_id)` for drill-down to the source document.
- Reports: `sales (organization_id, branch_id, created_at)` and BRIN on large append-only `created_at` columns once volumes justify it.

## 4. Concurrency model

- Web order placement (E8a) locks the shopper's cart row first, then posts stock through the same ledger; staff steps and cancellation lock the `orders` row; the expiry job takes due orders with `FOR UPDATE SKIP LOCKED` (PostgreSQL) so it never waits on, or doubles, a staff action.
- COD remittances (E10a): one transaction locks the named `orders` rows `FOR UPDATE` in ascending id order, checks every order under the lock (all or nothing), allocates the `REM-` and `EXP-` numbers from locked `document_sequences` rows, then writes the remittance, its lines and per order the COD payment through the same locked path as *Record COD payment*; a second remittance of the same order waits for the lock and then finds it paid (`already_paid`), and `cod_remittance_lines (organization_id, order_id)` is unique as a backstop. Shipment updates lock the order row, then the `shipments` row. Bulk *Mark processing* takes each order's lock in its own transaction.
- Online returns (E10b): every step locks the `orders` row `FOR UPDATE`, then the `order_returns` row (one lock order everywhere). A request computes what is still returnable under the order lock, so two parallel requests cannot both take the last unit; approval re-values lines against the other active returns under the same lock; receipt reads `order_return_line_stock` per allocation before posting `online_return` through the stock ledger (which locks `stock_levels` as below); a refund checks `refunded_total + refund_amount ≤ paid_total` under the order lock and, for cash, posts through the register session (row locked). `RTN-WEB-` numbers come from locked `document_sequences` rows.
- Paid cancellations (E11): one transaction locks the `orders` row `FOR UPDATE`, re-checks status and payment status under the lock, books the refund (cash: the user's `register_sessions` row is locked by the payments ledger), restocks and closes the order; a second cancel finds it `cancelled` (`INVALID_STATUS_TRANSITION`) and the `Idempotency-Key` replays the first response. The e-mail is sent after commit.
- Promotion usage limits (E8b): inside the placement transaction, after the cart lock and a first pricing, the `promotions` rows that carry a usage limit and the order would use, and the `coupons` row of the code it would redeem, are locked `FOR UPDATE` (promotions in ascending id order, then the coupon); the cart is priced again under the locks (at most three rounds) and the redemptions are appended before commit, so two placements cannot both take the last use. Unlimited promotions are not locked. A limit reached meanwhile reprices without it → `409 TOTAL_CHANGED`. PostgreSQL-only `PromotionConcurrencyTest` covers two placements racing for a single-use coupon (not run yet).
- Every stock posting (adjustment, transfer, receipt, return; checkout from Phase 5; web orders from E8a) locks `stock_levels` rows `FOR UPDATE` in ascending `store|variant|batch` order, creating missing rows first with `INSERT … ON CONFLICT DO NOTHING` so there is always a row to lock.
- Supplier catalog (SC1): making a row preferred locks the variant's catalog rows `FOR UPDATE`, unsets the previous preferred row and sets the new one in one transaction; the partial unique index `(organization_id, variant_id) WHERE is_preferred` rejects a concurrent second preferred row. Reorder rule upserts lock the store's existing rules for the given variants `FOR UPDATE` before writing; settings saves lock the organization's row. The daily reorder alert claims `(store_id, run_on)` with `INSERT … ON CONFLICT DO NOTHING` (`insertOrIgnore`) before notifying, so overlapping runs never notify twice.
- Procurement (SC2): every requisition, purchase order and RFQ transition re-reads its row `FOR UPDATE` and checks the status under the lock, so two approvers (or an approve and a cancel) cannot both succeed; the loser gets `INVALID_STATUS_CHANGE`, and the `Idempotency-Key` replays the first answer to a retry. Convert locks the requisition, then its lines; award, close and cancel lock the RFQ, then (to give quantities back) the requisition and its lines; recording a quote locks the RFQ. Approval-settings saves lock the organization's row. The quotes-overdue reminder claims `(rfq_id, run_on)` with `insertOrIgnore` before notifying.
- Landed cost vouchers (SC3): posting locks the voucher row `FOR UPDATE` and checks it is still a draft (a second post gets `INVALID_STATUS_CHANGE`; the `Idempotency-Key` replays the first answer), then locks the affected `stock_levels` rows in the ledger's `store|variant|batch` order before reading on-hand quantities, so the attribution and the revaluation see the same stock and cannot deadlock with a stock posting. Draft edits and deletes lock the voucher row.
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
