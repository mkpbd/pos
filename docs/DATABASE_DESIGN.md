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
- `expenses` — type, number `EXP-000001` / `INC-000001`, branch, category, amount, method, reference, party, occurred_on, notes, void fields. Expenses and other income share one table (the planned `incomes` table became `type = income`).

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
- Not built in E8a: `carts.coupon_code`, promotions tables (E8b); `payment_intents`, `payment_transactions`, `webhook_receipts` (E8c); couriers and shipments (E10).

### Phase 7 — Reporting
- Views: `v_sales_daily`, `v_sales_by_product`, `v_sales_by_cashier`, `v_inventory_valuation`, `v_customer_dues`, `v_supplier_dues`, …
- Materialized views refreshed by the scheduler for heavy aggregates.

### Phase 8 — AI
- `ai_conversations`, `ai_messages` (prompt/response metadata, token usage, no raw financial dumps), `ai_insights` (cached summaries)

## 3. Indexing strategy

- Every tenant table: composite index starting with `(organization_id, …)`; branch tables `(organization_id, branch_id, …)`.
- Hot POS lookups: `product_barcodes (organization_id, barcode)` unique; `product_variants (organization_id, lower(sku)) WHERE deleted_at IS NULL` unique. Storefront search: trigram GIN index on `lower(products.name)` (`pg_trgm`, PostgreSQL only, E6).
- Case-insensitive uniqueness uses expression indexes, e.g. `brands (organization_id, lower(name))`, and partial indexes such as `customers (organization_id, phone) WHERE deleted_at IS NULL AND phone IS NOT NULL` — valid on PostgreSQL and SQLite alike.
- Ledgers: `stock_movements (store_id, variant_id, created_at)` for stock history; `(reference_type, reference_id)` for drill-down to the source document.
- Reports: `sales (organization_id, branch_id, created_at)` and BRIN on large append-only `created_at` columns once volumes justify it.

## 4. Concurrency model

- Web order placement (E8a) locks the shopper's cart row first, then posts stock through the same ledger; staff steps and cancellation lock the `orders` row; the expiry job takes due orders with `FOR UPDATE SKIP LOCKED` (PostgreSQL) so it never waits on, or doubles, a staff action.
- Every stock posting (adjustment, transfer, receipt, return; checkout from Phase 5; web orders from E8a) locks `stock_levels` rows `FOR UPDATE` in ascending `store|variant|batch` order, creating missing rows first with `INSERT … ON CONFLICT DO NOTHING` so there is always a row to lock.
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
