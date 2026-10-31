# Database Change Plan — e-commerce track

E-commerce track, phase E1. **Plan only; no migration exists yet.** Conventions from `docs/DATABASE_DESIGN.md` §1 apply to every table below: UUIDv7 `id`, `organization_id` FK + leading index column, `created_by/updated_by`, `timestamptz`, `NUMERIC(18,2)` money, `NUMERIC(18,3)` quantities, `varchar + CHECK` enums, partial uniques on soft-deleted tables, append-only triggers on ledgers.

Columns `id`, `organization_id`, timestamps and author columns are omitted from the listings below unless they matter.

## 1. Requested entities vs what exists (no duplicates)

| Requested | Decision |
|-----------|----------|
| users, roles, permissions, audit_logs, notifications | **Exist.** Reused. |
| customers | **Exists.** Add `customer_addresses`; credentials go to new `customer_accounts`. |
| products, product_images, categories, brands, product_variants | **Exist.** Web data in new 1:1 tables (§3). `product_categories` (many-to-many) **not added**: a product has one category; extra merchandising groupings use homepage sections / collections. |
| attributes, attribute_values | **New** in Catalog as a dictionary; variant `option_values` jsonb stays the source of truth. |
| inventory, stock_movements, warehouses | **Exist** as `stock_levels`, `stock_movements`, `stores (type=warehouse)`. Only new movement types. |
| carts, cart_items, wishlists, wishlist_items | **New** (Cart). |
| orders, order_items, order_addresses | **New** (Orders). Table `order_lines` (project naming: `sale_lines`, `purchase_order_lines`). |
| payments | **Exists** (Phase 6 ledger). Online attempts go to new `payment_intents`/`payment_transactions`. |
| payment_transactions | **New** (OnlinePayments). |
| shipping_methods, shipments | **New** (Shipping). |
| coupons, discounts | **New** (Promotions) as `promotions` + `coupons`. |
| returns, refunds | POS has `sale_returns`/`sale_return_refunds`. Online: new `order_returns`, `order_refunds` (they reference orders, not invoices). |
| reviews | **New**. |
| banners, sliders | **New** as one `banners` table with a `placement` (a slider is a placement with several banners). |
| homepage_sections, homepage_section_items | **New** (Storefront). |
| theme_settings | **New** (one row per organization, typed jsonb). |
| menus, menu_items | **New**. |
| cms_pages, blog_posts, blog_categories | **New** (Cms). |
| media | **New** (Media). |

## 2. Changes to existing tables (all additive)

| Table | Change | Why |
|-------|--------|-----|
| `stock_movements.type` | **No schema change** (verified: plain string, constrained only by PHP `MovementType`). Add enum cases `online_order`, `online_order_cancel`, `online_return`. | Online stock posts through the same ledger. |
| `payments.source_type`, `payments.method` | **No schema change** (verified: strings + PHP enums; `created_by` already nullable). Add `PaymentSource` cases `online_order`, `online_order_refund`; `PaymentMethod` cases `online_gateway`, `cash_on_delivery` (ADR-006). | Gateway-verified money in the ledger. |
| `idempotency_keys` | `user_id` → nullable; add `scope varchar(80)` backfilled `user:{user_id}`; unique `(scope, key)` replaces `(user_id, key)` (ADR-014). | Guests and customers have no staff user id. |
| `product_variants` | Index: `CREATE INDEX … USING gin (option_values jsonb_path_ops)` | Attribute facet filtering. |
| `products` | `pg_trgm` GIN index on `lower(name)` (already planned for Phase 9) | Search suggestions. |

No column is renamed or dropped. The only change to an existing constraint is the idempotency unique key; Phase 5–6 idempotency tests guard it.

## 3. New tables per module

### Storefront
- `storefront_settings` — organization_id **unique**, is_enabled, fulfilment_store_id → stores, default_locale, currency (copy of base), order_number_prefix, pending_payment_ttl_minutes (default 30), guest_checkout_enabled.
- `storefront_domains` — host **unique (lower(host))**, is_primary. Index `(organization_id)`.
- `theme_settings` — organization_id unique, `settings jsonb` validated by a versioned PHP schema (logo media, favicon, colors primary/secondary/accent, font key from a bundled whitelist, button radius, container width, header/footer layout keys, sticky header, announcement bar {enabled, text, link, colors, schedule}, page title banner {bg color, image per page type, show breadcrumb}, footer gallery media ids, payment logo media ids, map embed URL, social links, contact info), `custom_css text`, version int (cache key).
- `menus` — location `main|footer_1|footer_2|footer_3|mobile|top_bar` unique per org, name, is_active.
- `menu_items` — menu_id, parent_id → menu_items, type `custom|category|brand|page|blog_category|product`, target_id uuid NULL, url NULL, label, translations jsonb, is_mega bool, mega_columns smallint, image_media_id, open_in_new_tab, is_visible, sort_order. CHECK: `url` required iff type = custom. Index `(menu_id, parent_id, sort_order)`.
- `banners` — placement `hero_slider|home_promo|category_top|shop_sidebar|popup`, title, subtitle, button_label, link_url, desktop_media_id, mobile_media_id, text_color, starts_at, ends_at, is_active, sort_order. Index `(organization_id, placement, is_active, sort_order)`.
- `homepage_sections` — type (`hero_slider`, `banner_grid`, `category_strip`, `category_showcase`, `category_tabs`, `product_carousel`, `product_grid`, `product_tabs`, `hot_deals`, `brand_strip`, `testimonials`, `features_strip`, `blog_posts`, `newsletter`, `rich_text` — catalogue from UI_REFERENCE_ANALYSIS §5), title, subtitle, translations jsonb, `config jsonb` (layout key, limit, columns, source `manual|new_arrivals|best_sellers|featured|on_sale|category`, category_id, tabs, background color/media, promotion_id for countdown, inline items for testimonials/features), is_enabled, starts_at, ends_at, sort_order. Config validated per type by a PHP schema class.
- `homepage_section_items` — section_id, item_type `product|category|brand|banner`, item_id uuid, sort_order. Unique `(section_id, item_type, item_id)`.

### OnlineCatalog
- `product_listings` — product_id **unique**, slug (unique per org, `lower`), is_published, published_at, unpublished_at (schedule), is_featured, is_new_until date, short_description, description_html (purified), specifications jsonb `[{label,value}]`, shipping_note, seo_title, seo_description, og_media_id, translations jsonb, sort_weight. Index `(organization_id, is_published, published_at)`.
- `variant_listings` — variant_id **unique**, compare_at_price NUMERIC(18,2) NULL (CHECK > 0), image ids jsonb (ordered `product_images` ids).
- `category_listings` — category_id unique, slug unique per org, image_media_id, banner_media_id, description_html, seo_title, seo_description, show_in_menu, translations jsonb.
- `brand_listings` — brand_id unique, slug unique per org, logo_media_id, description, is_visible, seo fields.
- `product_stats` — product_id PK, units_sold_30d, units_sold_total, rating_avg NUMERIC(3,2), rating_count, refreshed_at. Projection rebuilt by a scheduled job (best sellers, rating sort). Not a ledger.
- `related_products` — product_id, related_product_id, kind `related|frequently_bought`, sort_order. PK `(product_id, related_product_id, kind)`.

*As built in E6* (see DATABASE_DESIGN.md): `product_listings` has no `shipping_note`, `og_media_id` or `translations` yet (SEO image = first product image; translations E12) and is indexed `(organization_id, is_published)`; `variant_listings.image_id` is a single nullable FK to `product_images` instead of an ordered id list; `category_listings` uses `is_visible` instead of `show_in_menu` (menus link categories explicitly) and has no `translations`; `product_stats` has no rating columns yet (E10) and adds `organization_id`; `related_products` also carries `organization_id`.

### Catalog (extension)
- `attributes` — name (unique per org, lower), slug, display `text|swatch|button`, is_filterable, sort_order.
- `attribute_values` — attribute_id, value (unique per attribute, lower), swatch_hex char(7) NULL, swatch_media_id, sort_order.
Product options remain `products.options` jsonb; the editor offers dictionary values; facets read `product_variants.option_values` via GIN.

*As built in E6:* `attribute_values` has no `swatch_media_id` (colour swatches only). Facets are computed in PHP from the live candidate set, so the GIN index on `product_variants.option_values` (§2) was not added; E12 decides with `EXPLAIN`. The `pg_trgm` index on `lower(products.name)` shipped (PostgreSQL only). `storefront_settings` got only `fulfilment_store_id` in E6.

### CustomerAccounts / Customers
- `customer_accounts` — customer_id **unique**, email (unique per org, lower, partial on not null), phone (normalized), password, email_verified_at, phone_verified_at, status `active|disabled`, last_login_at, remember_token. Unique `(organization_id, lower(email))`.
- `customer_password_reset_tokens` — organization_id, email, token hash, created_at.
- `customer_addresses` (Customers) — customer_id, label, recipient_name, phone, division_id, district_id, area_id, address_line, postcode, is_default_shipping, is_default_billing, soft delete.

*As built (E7):* `customer_accounts` has no `phone_verified_at` (no phone OTP yet) and adds `email_verification_token_hash` / `email_verification_sent_at` (24-hour link); the e-mail index is a plain `(organization_id, lower(email))` unique index (e-mail is required). `customer_password_reset_tokens` is keyed `(organization_id, email)` — one live token per address — and replaces a Laravel password broker. `customer_addresses` stores a free-text `area` (≤ 100) instead of `area_id`, and references `geo_divisions` / `geo_districts` directly.

### Shipping
- `geo_divisions` (8), `geo_districts` (64), `geo_areas` (upazila/thana, admin-extendable) — **global reference tables** (no organization_id), name_en, name_bn, code. Seeded from an openly licensed dataset (source to be confirmed in E8).

*As built (E7):* `geo_divisions` and `geo_districts` shipped early, in their own `Geography` module (addresses needed them before Shipping exists), with fixed ids and BBS codes from a bundled PHP data file loaded by the migration. `geo_areas` is **deferred** until a licensed upazila/thana dataset is confirmed.
- `shipping_zones` — name, is_active; `shipping_zone_districts` (zone_id, district_id) PK pair; unique district per org enforced in app (one zone per district).
- `shipping_methods` — zone_id, name, code, rate_type `flat|weight|order_total`, base_fee, per_kg_fee, free_over NUMERIC NULL, cod_allowed, cod_fee, eta_min_days, eta_max_days, is_active, sort_order.
- `couriers` — name, tracking_url_template, is_active.
- `shipments` — order_id, courier_id, tracking_number, status `pending|handed_over|in_transit|delivered|returned|failed`, shipped_at, delivered_at, cod_amount, notes. `shipment_events` append-only (status, note, occurred_at).

### Cart
- `carts` — customer_id NULL, token_hash (guest cookie, unique), currency, coupon_code NULL, expires_at, converted_order_id NULL. Partial unique: one active cart per customer `WHERE converted_order_id IS NULL AND customer_id IS NOT NULL`.
- `cart_items` — cart_id, variant_id, quantity NUMERIC(18,3) CHECK > 0. Unique `(cart_id, variant_id)`. **No price columns** — always repriced.
- `wishlists` — customer_id unique (guest wishlist lives in the browser and is merged on login).
- `wishlist_items` — wishlist_id, product_id, variant_id NULL, created_at. Unique `(wishlist_id, product_id, variant_id)`.

*As built (E7):* `carts` has no `currency`, `coupon_code` or `converted_order_id` yet (currency comes from the organization on every read; coupons and conversion arrive with checkout in E8), so the partial unique index is `(customer_id) WHERE customer_id IS NOT NULL`; guest carts carry `expires_at` (30 days after the last change, `cart:prune`), customer carts none. `cart_items` CHECK `quantity > 0` on PostgreSQL. `wishlists` carries `organization_id`; because `wishlist_items.variant_id` is nullable, uniqueness is two partial indexes — `(wishlist_id, product_id) WHERE variant_id IS NULL` and `(wishlist_id, product_id, variant_id) WHERE variant_id IS NOT NULL` — valid on PostgreSQL and SQLite.

### Promotions
- `promotions` — name, type `percent|fixed|free_shipping`, value, scope `order|products|categories|brands`, min_subtotal, max_discount, customer_group_id NULL, channel `web|pos|all` (POS use later), is_automatic, starts_at, ends_at, priority, is_stackable, show_countdown, is_active, usage_limit, usage_limit_per_customer.
- `promotion_targets` — promotion_id, target_type `product|variant|category|brand`, target_id. PK triple.
- `coupons` — promotion_id, code (unique per org, lower), usage_limit, used_count (projection), is_active.
- `promotion_redemptions` — promotion_id, coupon_id NULL, order_id, customer_id NULL, amount. Append-only; counted under a lock on the coupon row at order placement.

### Orders
- `orders` — number (`WEB-000001`, `SequenceGenerator`), customer_id, customer_account_id NULL (NULL = guest), branch_id + store_id (fulfilment), status `pending_payment|confirmed|processing|shipped|delivered|cancelled|failed|returned`, payment_status `unpaid|partially_paid|paid|refunded|partially_refunded`, payment_method_code, shipping_method_id, currency, tax_mode snapshot, subtotal, discount_total, tax_total, shipping_total, cod_fee, total, paid_total, refunded_total, cost_total, coupon_code, notes, placed_at, expires_at, cancelled_at/by/reason, ip, user_agent. Indexes `(organization_id, status, placed_at)`, `(organization_id, customer_id, placed_at)`.
- `order_lines` — snapshot like `sale_lines` (product/variant name, SKU, option_values, image path), quantity, unit_price, compare_at_price, discount_amount, net_amount, tax_rate, tax_amount, line_total, unit_cost, cost_total. Append-only trigger.
- `order_line_stock` — batch allocation per line (mirrors `sale_line_stock`) for exact restock.
- `order_addresses` — order_id, kind `shipping|billing` (unique pair), snapshot of name, phone, email, division/district/area names + ids, address_line, postcode.
- `order_status_history` — order_id, from_status, to_status, note, actor (user or system), created_at. Append-only.
- `order_returns`, `order_return_lines`, `order_refunds` — same pattern as Phase 6 sale returns; refunds through the gateway (where supported) or manual.

### OnlinePayments
- `payment_gateways` — code `cod|bank_transfer|sslcommerz|bkash|nagad`, display_name, is_enabled, mode `sandbox|live`, credentials **encrypted text**, settings jsonb (bank details text, COD limits), sort_order. Unique `(organization_id, code)`.
- `payment_intents` — order_id, gateway_code, amount, currency, status `created|pending|succeeded|failed|cancelled|expired|refunded`, provider_reference (session/payment id), idempotency_key, verified_at. Unique `(gateway_code, provider_reference)` where not null.
- `payment_transactions` — intent_id, kind `initiate|redirect_return|webhook|verify|refund|query`, http_status, request jsonb (redacted), response jsonb (redacted), provider_txn_id, amount, succeeded bool, created_at. Append-only.
- `webhook_receipts` — gateway_code, provider_event_id unique per gateway, payload hash, processed_at — idempotent webhook processing.

### Reviews
- `reviews` — product_id, customer_id, order_line_id NULL (verified purchase), rating smallint CHECK 1–5, title, body, status `pending|approved|rejected`, moderated_by/at. Unique `(customer_id, product_id)`.
- `review_media` (optional, E10).

### Cms
- `cms_pages` — slug unique per org, title, body_html (purified), template `default|faq|contact`, status `draft|published`, published_at, seo fields, translations jsonb, soft delete.
- `faq_items` — group, question, answer_html, sort_order, is_active.
- `blog_categories` — name, slug unique per org, sort_order.
- `blog_posts` — category_id, slug unique per org, title, excerpt, body_html, cover_media_id, author_user_id, status, published_at, seo fields, translations jsonb, soft delete.
- `contact_messages` — name, email, phone, subject, message, ip, handled_at/by.
- `newsletter_subscribers` — email unique per org, status `subscribed|unsubscribed`, confirmed_at, unsubscribe_token.

### Media
- `media` — disk, path, original_name, mime_type, size, width, height, alt, renditions jsonb `{thumb, medium, large}`, checksum (sha256, dedupe per org), uploaded_by. Referenced by FK with `ON DELETE RESTRICT` (`IN_USE` on delete, like Catalog).

### AI (POS Phase 8 extended)
- `ai_generations` — subject_type/id (product, category, page), kind `description|seo|category_suggestion`, provider, model, prompt hash, output text, status `draft|approved|rejected|applied`, approved_by/at, tokens_in/out. Human approval before applying.

## 4. Integrity and concurrency

- **Order placement transaction:** lock cart → reprice → lock coupon row (usage limits) → number from `document_sequences` → `StockLedger` post (sorted `FOR UPDATE`) → insert order/lines/allocations/addresses/redemptions → mark cart converted. Rolls back as one unit; `Idempotency-Key` required.
- **Payment confirmation:** lock order row `FOR UPDATE`, check status and amount, write intent + ledger entry, transition order. Duplicate webhooks hit `webhook_receipts` uniqueness.
- **Expiry job:** selects `pending_payment` orders past `expires_at` with `FOR UPDATE SKIP LOCKED`, cancels and restocks.
- **Customer data:** account/address/order reads scoped by organization **and** `customer_id` of the session; tests for both.

## 5. Migration order

E4 Storefront + Media → E5 Cms (pages needed by menus) → E6 OnlineCatalog + Catalog attributes → E7 CustomerAccounts/addresses + Cart → E8 Shipping + Promotions + Orders + OnlinePayments + ledger CHECK changes → E10 Reviews, returns → E13 AI. Each migration ships with its tests and runs on PostgreSQL before the phase closes.
