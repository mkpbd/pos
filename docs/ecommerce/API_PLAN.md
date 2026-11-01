# E-commerce API Plan

Phase **E3** draft. Becomes part of `docs/API_DOCUMENTATION.md` phase by phase as endpoints ship. All routes under `/api/v1`, envelope and error codes as in API_DOCUMENTATION.md. Namespace rules in DECISIONS.md ADR-013.

**Legend:** `P` public (storefront middleware: host → organization, `throttle:storefront`) · `C` customer (`auth:customer`) · `S` staff (`auth:sanctum` + `tenant` + permission) · `I` Idempotency-Key required.

## 1. New permissions

| Permission | Grants |
|------------|--------|
| `storefront.view` | Read storefront settings, theme, menus, banners, homepage sections |
| `storefront.manage` | Change the above, domains, announcement bar |
| `storefront.custom_css` | Edit custom CSS (Org Admin only by default) |
| `media.manage` | Upload, edit alt text, delete unused media |
| `cms.manage` | Pages, FAQ, blog, contact messages, newsletter export |
| `online_catalog.view` | Read web listings in the admin (added in E6) |
| `online_catalog.manage` | Product/category/brand web listings, publish schedule, featured, related |
| `attributes.manage` | Attribute dictionary and values |
| `promotions.view` / `promotions.manage` | Promotions, coupons, usage |
| `shipping.manage` | Zones, methods, rates, couriers, geography areas |
| `web_orders.view` | Online orders list/detail |
| `web_orders.manage` | Status transitions, shipments, COD remittance, cancellation (*E10a: shipments, tracking updates, bulk processing; courier COD remittances moved to `web_orders.remit`*) |
| `web_orders.remit` | Record and view couriers' COD remittances (*added in E10a; Organization Admin via `*`, Online Store Manager via `web_orders.*`, Accountant together with `web_orders.view`*) |
| `web_orders.refund` | Online returns approval and refunds |
| `payment_gateways.manage` | Gateway enablement and credentials (Org Admin only by default) |
| `reviews.view` / `reviews.moderate` | Read the review queue / approve, reject, delete reviews (*`reviews.view` added in E9*) |
| `ai.use` | Request AI generations (declared by the AI module, POS Phase 8 / E13) |

## 2. Public and customer endpoints (`/store`)

| Method & path | Auth | Phase | Notes |
|---------------|------|-------|-------|
| GET `/store/bootstrap` | P | E4 | Settings, theme tokens, menus, announcement, locales; `ETag` |
| GET `/store/homepage` | P | E5 | Enabled, in-window sections resolved with items; `ETag` |
| GET `/store/banners?placement=` | P | E5 | Active, scheduled banners |
| GET `/store/pages/{slug}` | P | E5 | Published CMS page |
| GET `/store/faq` | P | E5 | |
| POST `/store/contact` | P | E5 | `throttle:contact`, honeypot field |
| POST `/store/newsletter` · GET `/store/newsletter/unsubscribe/{token}` | P | E5 | Double opt-in by e-mail |
| GET `/store/categories` · `/store/categories/{slug}` | P | E6 | Tree (published listings only) |
| GET `/store/brands` · `/store/brands/{slug}` | P | E6 | |
| GET `/store/products` | P | E6 | `q, category, brand, price_min, price_max, attr[<slug>][]=, in_stock, on_sale, sort=(popularity\|rating\|latest\|price_asc\|price_desc), page, per_page≤48`; returns items + `facets` (counts). *As built (E6):* sorts `featured` (default), `popularity`, `latest`, `price_asc`, `price_desc`, `name` — no `rating` until E10; `per_page` 12/24/36/48; extra `slugs=` mode for recently viewed; response adds `context` |
| GET `/store/products/{slug}` | P | E6 | Variants, prices, availability, gallery, specs, SEO, rating summary (*E6: no rating summary until E10; staff `?preview=1`*) |
| GET `/store/products/{slug}/related` | P | E6 | Related + frequently bought together |
| GET `/store/products/{slug}/reviews` | P | E9 | Approved only, paginated (*E9 ✅: `sort=newest\|highest\|lowest`, `rating=`, 10 per page; author first name + last initial; top-level `summary {average, count, distribution}` over all approved reviews; product detail gains `rating {average, count} \| null`, cards none until E10*) |
| GET `/store/search/suggest?q=` | P | E6 | ≤ 8 products + categories, `pg_trgm` (*E6: ≤ 6 products + ≤ 4 categories, substring match; trigram index only speeds it up, no similarity ranking*) |
| GET `/store/geo/divisions` · `/districts?division=` · `/areas?district=` | P | E7 | Global reference data, long cache (*E7: divisions and districts only, `max-age=86400`; `/areas` waits for an upazila/thana dataset — addresses carry a free-text `area`*) |
| POST `/store/account/register` · `login` · `logout` · `forgot-password` · `reset-password` · `verify-email` | P/C | E7 | `throttle:customer-auth` (*E7: plus GET `/store/account/me` (null for guests) and POST `/store/account/verification-notification`; `logout` unthrottled beyond `storefront`, `verify-email` on `storefront-write`; register/login/reset return `{customer, merge}`; reset uses an own token table, not a broker*) |
| GET/PUT `/store/account/profile` · PUT `/store/account/password` | C | E7 | |
| GET/POST/PUT/DELETE `/store/account/addresses[/{id}]` | C | E7 | (*E7: changes use PATCH, not PUT; max 10, `ADDRESS_LIMIT_REACHED`*) |
| GET `/store/cart` | P/C | E7 | Guest cart by httpOnly `cart_token` cookie; always repriced |
| POST `/store/cart/items` · PATCH/DELETE `/store/cart/items/{id}` | P/C | E7 | `throttle:storefront-write` (*E7: also DELETE `/store/cart`*) |
| POST/DELETE `/store/cart/coupon` | P/C | E8 | `throttle:coupon` (*E8b ✅: `{code}` → the repriced cart with `coupon {code, applied, reason, message, promotion_name}`; `422 COUPON_INVALID` with `details.reason`; `coupon` limiter `POS_COUPON_RATE_LIMIT` per customer, else cart, else IP; cart, preview and order views gain `discount_total`, `promotions`, line `discount_amount`, checkout/order `shipping_discount` and `coupon_code`*) |
| POST `/store/cart/estimate` | P/C | E8 | District → shipping options and totals (*not built: `POST /store/checkout/preview` covers it*) |
| GET/POST/DELETE `/store/wishlist[/items/{id}]` | C | E7 | Guest wishlist local, merged on login (*E7: POST `/store/wishlist/merge`, ≤ 100 entries per call, ≤ 200 per wishlist*) |
| GET `/store/shipping-methods?district_id=` | P | E8 | (*E8a ✅; `[]` when no active zone covers the district*) |
| POST `/store/checkout/preview` | P/C | E8 | Server totals for the chosen address/method/payment (*E8a ✅, `throttle:checkout`; also GET `/store/checkout/options`*) |
| POST `/store/checkout` | P/C, I | E8 | Creates order (stock posted); returns order number, guest access token, next payment action (*E8a ✅: 201 `{order, access_token}` — no payment action yet; `expected_total` required, `409 TOTAL_CHANGED`*) |
| POST `/store/orders/{number}/pay` | P/C, I | E8 | Initiate gateway payment; returns redirect URL (*E8c*) |
| GET `/store/payments/{gateway}/return` | P | E8 | Browser return → server verify → redirect to order page (*E8c*) |
| POST `/store/payments/{gateway}/webhook` | P | E8 | IPN/webhook; signature + verify API; idempotent (*E8c*) |
| GET `/store/orders/{number}?token=` | P | E8 | Guest order view (signed token, expires) (*E8a ✅: random token stored as sha-256, does not expire; the signed-in owner needs no token*) |
| GET `/store/account/orders` · `/store/account/orders/{number}` | C | E9 | Own orders only (*E9 ✅: by `orders.customer_id`, guest orders with the same e-mail not attached; `status=open\|delivered\|cancelled`, 10 per page; detail = storefront order view + `can_cancel`, `cancelled_at`, `cancel_reason`, line `product_id`, `variant_id`, `review`, `reviewable`; also POST `/store/account/orders/{number}/reorder` → `{cart, added, skipped}`*) |
| POST `/store/account/orders/{number}/cancel` | C, I | E9 | Only `pending_payment`/`confirmed` (*E9 ✅: and unpaid, else `422 ORDER_NOT_CANCELLABLE` (`details.status`, `payment_status`); `{reason?}` ≤ 200; `idempotent:shopper`; reuses the E8a restock path, history actor `customer`, staff notification + e-mail*) |
| POST `/store/account/orders/{number}/returns` | C, I | E10 | Within the return window (*E10b*) |
| POST `/store/account/reviews` | C | E9 | Verified purchase sets `order_line_id` (*E9 ✅: verified purchases only — a delivered line is required (`REVIEW_NOT_ALLOWED`), one per product (`REVIEW_EXISTS`, instead of the planned `REVIEW_ALREADY_EXISTS`); `throttle:reviews` (`POS_REVIEW_RATE_LIMIT`, 5/hour); also GET `/store/account/reviews`, PATCH/DELETE `/store/account/reviews/{id}` (edit → pending)*) |
| GET `/sitemap.xml` · `/sitemaps/{type}-{n}.xml` · `/robots.txt` | P (web routes) | E12 | Per host |

## 3. Staff endpoints

| Resource | Endpoints | Permission | Phase |
|----------|-----------|------------|-------|
| Storefront settings | GET/PATCH `/storefront/settings` | storefront.view / .manage | E4 |
| Domains | GET/POST `/storefront/domains`, PATCH (make primary)/DELETE `/{id}` | storefront.manage | E4 |
| Theme | GET/PUT `/storefront/theme`, PUT `/storefront/theme/custom-css` | storefront.manage / .custom_css | E4 |
| Menus | GET/POST `/storefront/menus`, GET/PATCH/DELETE `/{id}`, PUT `/storefront/menus/{id}/items` (whole tree, ordered) | storefront.manage | E4 |
| Media | GET/POST `/media`, PATCH/DELETE `/media/{id}` | media.manage | E4 |
| Banners | CRUD `/storefront/banners`, PUT `/storefront/banners/order` | storefront.manage | E5 |
| Homepage | CRUD `/storefront/homepage-sections`, POST `/{id}/duplicate`, PUT `/order`, GET `/storefront/homepage-sections/types` (schemas) | storefront.manage | E5 |
| CMS pages, FAQ | CRUD `/cms/pages`, `/cms/faq` | cms.manage | E5 |
| Contact messages | GET `/cms/contact-messages`, PATCH `/{id}` (handled) | cms.manage | E5 |
| Newsletter | GET `/cms/newsletter-subscribers` (+ CSV export) | cms.manage | E5 |
| Product listings | GET/PUT `/online-catalog/products/{productId}` (incl. variant listings), PUT `/related` | online_catalog.manage (GET: online_catalog.view) | E6 |
| Category/brand listings | GET/PUT `/online-catalog/categories/{id}`, `/online-catalog/brands/{id}` (+ GET lists) | online_catalog.manage (GET: online_catalog.view) | E6 |
| Attributes | CRUD `/attributes`, `/attributes/{id}/values` (*E6: values are replaced with the attribute — no separate `/values` route; GET also with `products.view`*) | attributes.manage | E6 |
| Geography areas | CRUD `/shipping/areas` (divisions/districts read-only) | shipping.manage | E8 (*not built — no upazila dataset; E8a adds read-only GET `/geography/divisions`, `/geography/districts` for any staff user*) |
| Shipping | CRUD `/shipping/zones`, `/shipping/methods`, `/shipping/couriers` | shipping.manage | E8 (*E8a ✅: GET/POST `/shipping/zones`, PATCH/DELETE `/shipping/zones/{id}`, POST `/shipping/zones/{id}/methods`, PATCH/DELETE `/shipping/methods/{id}`; GET also with web_orders.view; couriers E10*) (*E10a ✅ couriers: GET `/shipping/couriers` (`?active=1`; also with web_orders.view), POST, PATCH/DELETE `/shipping/couriers/{id}`; `{name, phone?, tracking_url_template? (http(s) with {tracking}), is_active?, sort_order?}`; deleting a used courier → `IN_USE`*) |
| Promotions | CRUD `/promotions`, `/promotions/{id}/coupons`, GET `/promotions/{id}/redemptions` | promotions.view / .manage | E8 (*E8b ✅: GET/POST `/promotions`, GET/PATCH/DELETE `/promotions/{id}` (delete only unused, else `IN_USE`), GET/POST `/promotions/{id}/coupons` (one code or `generate` ≤ 500 with prefix), PATCH/DELETE `/coupons/{id}` (instead of nested coupon paths; delete only unused), GET `/promotions/{id}/redemptions`; homepage section type `hot_deals`; reports E10*) |
| Payment gateways | GET `/payment-gateways`, PUT `/payment-gateways/{code}` (credentials write-only) | payment_gateways.manage | E8 (*E8a ✅ for `cod` and `bank_transfer`; credentials E8c*) |
| Customer online accounts | `online_account` in GET `/customers/{id}`; PATCH `/customer-accounts/{customerId}` `{status}` (*added in E7*) | customers.view / customers.manage | E7 |
| Web orders | GET `/web-orders`, `/web-orders/{id}`; POST `/{id}/confirm`, `/process`, `/ship` (shipment), `/deliver`, `/cancel` (I), `/confirm-payment` (bank transfer, I), `/cod-remittance` (I) | web_orders.view / .manage | E8/E10 (*E8a ✅: `/confirm-payment`, `/process`, `/ship` (courier name + tracking text), `/deliver`, `/record-cod-payment` (instead of `/cod-remittance`), `/cancel` — **all** with I; no `/confirm` (COD orders start confirmed)*) (*E10a ✅: `/ship` takes `{courier_id, tracking_number?, note?}` and creates a shipment (`courier_name` no longer accepted); POST `/{id}/shipment/events` (I; `in_transit\|delivered\|returned`); `/cancel` also for a returned unpaid parcel; GET `/web-orders` board filters `courier_id`, `payment_method`, `district_id`, `date_from`/`date_to`, `cod_unremitted` + `meta.status_counts`; POST `/web-orders/bulk/process` (I, per-order results); GET `/web-orders/print?ids[]=&kind=packing_slip\|invoice`. The planned per-order `/cod-remittance` became the courier-level resource `/cod-remittances` (below); `/record-cod-payment` stays for own riders*) |
| COD remittances | GET/POST `/cod-remittances`, GET `/cod-remittances/{id}` | web_orders.remit | E10a ✅ (*POST with I; all or nothing (`REMITTANCE_INVALID`); each order paid through the shared COD payment path; courier fee booked as an expense in "Courier fees"; no edit or delete*) |
| Online returns | GET `/web-orders/returns`, POST `/web-orders/{id}/returns` (I), POST `/web-orders/returns/{id}/approve` (I) / `/reject` | web_orders.refund | E10 (*E10b*) |
| Reviews | GET `/reviews`, POST `/reviews/{id}/approve` / `/reject` | reviews.moderate | E9/E10 (*E9 ✅ moderation: GET `/reviews` with `reviews.view` (new; `status`, `rating`, `search`, pending first, `meta.pending_count`), approve / reject `{reason?}` (idempotent by state) and DELETE `/reviews/{id}` with `reviews.moderate`; review media and the rest E10*) |
| AI generations | POST `/ai/generations` (description, seo, category suggestion), POST `/{id}/approve` / `/reject` | online_catalog.manage + ai.use | E13 |

## 4. New error codes

`STOREFRONT_NOT_FOUND` (404) · `PRODUCT_NOT_AVAILABLE` (variant unpublished/inactive) · `INSUFFICIENT_STOCK` (existing, reused) · `CART_EMPTY` · `CART_CHANGED` (prices/availability moved since preview; client re-previews) · `COUPON_INVALID` · `COUPON_NOT_APPLICABLE` · `COUPON_LIMIT_REACHED` · `SHIPPING_NOT_AVAILABLE` · `PAYMENT_METHOD_NOT_AVAILABLE` · `ORDER_NOT_PAYABLE` · `PAYMENT_VERIFICATION_FAILED` · `ORDER_TRANSITION_NOT_ALLOWED` · `RETURN_WINDOW_CLOSED` · `REVIEW_ALREADY_EXISTS` · `MEDIA_IN_USE` (via `IN_USE`) · `CUSTOM_CSS_REJECTED`.

*Added in E6:* `COMPARE_AT_NOT_ABOVE_PRICE`, `PRODUCT_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `BRAND_NOT_FOUND`, `STORE_NOT_FOUND`; reused `PRODUCT_NOT_SELLABLE`, `SCHEDULE_INVALID`, `SECTION_ITEMS_INVALID`, `MEDIA_NOT_FOUND`. A taken slug is a field error (`VALIDATION_FAILED`), not a separate code.

*Added in E8a:* `CART_HAS_ISSUES` (instead of `CART_CHANGED`; `details.cart`), `TOTAL_CHANGED` (409, `details.preview`), `CHECKOUT_UNAVAILABLE`, `GUEST_CHECKOUT_DISABLED`, `SHIPPING_UNAVAILABLE` (instead of `SHIPPING_NOT_AVAILABLE`), `PAYMENT_METHOD_UNAVAILABLE` (instead of `PAYMENT_METHOD_NOT_AVAILABLE`), `INVALID_STATUS_TRANSITION` (instead of `ORDER_TRANSITION_NOT_ALLOWED`), `ORDER_PAID`, `ORDER_ALREADY_PAID`, `DISTRICT_IN_OTHER_ZONE`; reused `CART_EMPTY`, `INSUFFICIENT_STOCK`, `IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_REUSED` / `IDEMPOTENCY_REQUEST_IN_PROGRESS`, `CASH_SESSION_REQUIRED` (cash refused by `recordSystem`). `ORDER_NOT_PAYABLE` and `PAYMENT_VERIFICATION_FAILED` wait for E8c.

*Added in E8b:* `COUPON_INVALID` with `details.reason` (`not_found`, `not_started`, `expired`, `usage_limit_reached`, `customer_limit_reached`, `min_subtotal`, `not_applicable`) — replaces the planned `COUPON_NOT_APPLICABLE` and `COUPON_LIMIT_REACHED`; `NOT_A_COUPON_PROMOTION`, `CODES_EXHAUSTED`, `PROMOTION_NOT_FOUND` (hot-deals section); reused `IN_USE`, `TOTAL_CHANGED` (a usage limit reached during placement). Promotion rule violations are field errors (`VALIDATION_FAILED`).

*Added in E9:* `ORDER_NOT_CANCELLABLE` (`details.status`, `payment_status`), `REVIEW_NOT_ALLOWED`, `REVIEW_EXISTS` (instead of `REVIEW_ALREADY_EXISTS`; `details.review_id`); reused `IDEMPOTENCY_KEY_REQUIRED` and the idempotency codes on the customer cancel.

*Added in E10a:* `SHIPMENT_NOT_FOUND` (`details.status`; a tracking update for an order without a courier shipment), `REMITTANCE_INVALID` (`details.orders [{id, number, reason}]`, reasons `not_found`, `not_cod`, `already_paid`, `not_delivered`, `other_courier`); reused `IN_USE` (couriers), `INVALID_STATUS_TRANSITION` (parcel transitions, bulk results), `NOT_FOUND` (bulk results).

*Added in E7:* `VARIANT_NOT_PURCHASABLE` (instead of the planned `PRODUCT_NOT_AVAILABLE`), `OUT_OF_STOCK`, `CART_FULL`, `WISHLIST_FULL`, `ADDRESS_LIMIT_REACHED`; reused `INSUFFICIENT_STOCK` (`details.max_quantity`, `in_cart`), `INVALID_CREDENTIALS`, `TOKEN_INVALID`, `SESSION_UNAVAILABLE`. A wrong reset token, a wrong current password and a non-live wishlist product are field errors (`VALIDATION_FAILED`).

## 5. OpenAPI (Scramble) tags

`Store · Bootstrap`, `Store · Catalog`, `Store · Cart`, `Store · Checkout`, `Store · Account`, `Store · Payments`, `Storefront admin`, `Media`, `CMS`, `Online catalog`, `Promotions`, `Shipping`, `Web orders`, `Payment gateways`, `Reviews`.
