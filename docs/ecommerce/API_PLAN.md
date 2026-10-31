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
| `web_orders.manage` | Status transitions, shipments, COD remittance, cancellation |
| `web_orders.refund` | Online returns approval and refunds |
| `payment_gateways.manage` | Gateway enablement and credentials (Org Admin only by default) |
| `reviews.moderate` | Approve/reject reviews |
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
| GET `/store/products/{slug}/reviews` | P | E9 | Approved only, paginated |
| GET `/store/search/suggest?q=` | P | E6 | ≤ 8 products + categories, `pg_trgm` (*E6: ≤ 6 products + ≤ 4 categories, substring match; trigram index only speeds it up, no similarity ranking*) |
| GET `/store/geo/divisions` · `/districts?division=` · `/areas?district=` | P | E7 | Global reference data, long cache |
| POST `/store/account/register` · `login` · `logout` · `forgot-password` · `reset-password` · `verify-email` | P/C | E7 | `throttle:customer-auth` |
| GET/PUT `/store/account/profile` · PUT `/store/account/password` | C | E7 | |
| GET/POST/PUT/DELETE `/store/account/addresses[/{id}]` | C | E7 | |
| GET `/store/cart` | P/C | E7 | Guest cart by httpOnly `cart_token` cookie; always repriced |
| POST `/store/cart/items` · PATCH/DELETE `/store/cart/items/{id}` | P/C | E7 | `throttle:storefront-write` |
| POST/DELETE `/store/cart/coupon` | P/C | E8 | `throttle:coupon` |
| POST `/store/cart/estimate` | P/C | E8 | District → shipping options and totals |
| GET/POST/DELETE `/store/wishlist[/items/{id}]` | C | E7 | Guest wishlist local, merged on login |
| GET `/store/shipping-methods?district_id=` | P | E8 | |
| POST `/store/checkout/preview` | P/C | E8 | Server totals for the chosen address/method/payment |
| POST `/store/checkout` | P/C, I | E8 | Creates order (stock posted); returns order number, guest access token, next payment action |
| POST `/store/orders/{number}/pay` | P/C, I | E8 | Initiate gateway payment; returns redirect URL |
| GET `/store/payments/{gateway}/return` | P | E8 | Browser return → server verify → redirect to order page |
| POST `/store/payments/{gateway}/webhook` | P | E8 | IPN/webhook; signature + verify API; idempotent |
| GET `/store/orders/{number}?token=` | P | E8 | Guest order view (signed token, expires) |
| GET `/store/account/orders` · `/store/account/orders/{number}` | C | E9 | Own orders only |
| POST `/store/account/orders/{number}/cancel` | C, I | E9 | Only `pending_payment`/`confirmed` |
| POST `/store/account/orders/{number}/returns` | C, I | E10 | Within the return window |
| POST `/store/account/reviews` | C | E9 | Verified purchase sets `order_line_id` |
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
| Geography areas | CRUD `/shipping/areas` (divisions/districts read-only) | shipping.manage | E8 |
| Shipping | CRUD `/shipping/zones`, `/shipping/methods`, `/shipping/couriers` | shipping.manage | E8 |
| Promotions | CRUD `/promotions`, `/promotions/{id}/coupons`, GET `/promotions/{id}/redemptions` | promotions.view / .manage | E8 |
| Payment gateways | GET `/payment-gateways`, PUT `/payment-gateways/{code}` (credentials write-only) | payment_gateways.manage | E8 |
| Web orders | GET `/web-orders`, `/web-orders/{id}`; POST `/{id}/confirm`, `/process`, `/ship` (shipment), `/deliver`, `/cancel` (I), `/confirm-payment` (bank transfer, I), `/cod-remittance` (I) | web_orders.view / .manage | E8/E10 |
| Online returns | GET `/web-orders/returns`, POST `/web-orders/{id}/returns` (I), POST `/web-orders/returns/{id}/approve` (I) / `/reject` | web_orders.refund | E10 |
| Reviews | GET `/reviews`, POST `/reviews/{id}/approve` / `/reject` | reviews.moderate | E9/E10 |
| AI generations | POST `/ai/generations` (description, seo, category suggestion), POST `/{id}/approve` / `/reject` | online_catalog.manage + ai.use | E13 |

## 4. New error codes

`STOREFRONT_NOT_FOUND` (404) · `PRODUCT_NOT_AVAILABLE` (variant unpublished/inactive) · `INSUFFICIENT_STOCK` (existing, reused) · `CART_EMPTY` · `CART_CHANGED` (prices/availability moved since preview; client re-previews) · `COUPON_INVALID` · `COUPON_NOT_APPLICABLE` · `COUPON_LIMIT_REACHED` · `SHIPPING_NOT_AVAILABLE` · `PAYMENT_METHOD_NOT_AVAILABLE` · `ORDER_NOT_PAYABLE` · `PAYMENT_VERIFICATION_FAILED` · `ORDER_TRANSITION_NOT_ALLOWED` · `RETURN_WINDOW_CLOSED` · `REVIEW_ALREADY_EXISTS` · `MEDIA_IN_USE` (via `IN_USE`) · `CUSTOM_CSS_REJECTED`.

*Added in E6:* `COMPARE_AT_NOT_ABOVE_PRICE`, `PRODUCT_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `BRAND_NOT_FOUND`, `STORE_NOT_FOUND`; reused `PRODUCT_NOT_SELLABLE`, `SCHEDULE_INVALID`, `SECTION_ITEMS_INVALID`, `MEDIA_NOT_FOUND`. A taken slug is a field error (`VALIDATION_FAILED`), not a separate code.

## 5. OpenAPI (Scramble) tags

`Store · Bootstrap`, `Store · Catalog`, `Store · Cart`, `Store · Checkout`, `Store · Account`, `Store · Payments`, `Storefront admin`, `Media`, `CMS`, `Online catalog`, `Promotions`, `Shipping`, `Web orders`, `Payment gateways`, `Reviews`.
