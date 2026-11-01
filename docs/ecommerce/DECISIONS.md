# E-commerce Architecture Decisions (ADR log)

Phase **E3**. Status of every record: **Accepted 2026-10-31** (owner proceeded past the E1/E2 checkpoints without objection; any record can be reopened before the phase that implements it). Format: context → decision → consequences. Background in ARCHITECTURE_ANALYSIS.md (D1–D12).

---

## ADR-001 Storefront tenancy by host

**Context.** Shoppers are anonymous; today the organization comes from the logged-in staff user.
**Decision.** `storefront_domains (host → organization)`. `ResolveStorefront` middleware: normalize `Host` (lower-case, strip port), look up (cached), `TenantContext::setOrganization()`, 404 `STOREFRONT_NOT_FOUND` for unknown host / disabled storefront / suspended organization. Local dev: `STOREFRONT_DEFAULT_HOST` maps `localhost`/`127.0.0.1` to a configured host. Branch context is set to the fulfilment store's branch (ADR-004).
**Consequences.** The existing `BelongsToOrganization` scope protects every public query unchanged. Isolation tests: same slug/SKU in two orgs on two hosts never cross.

## ADR-002 Separate customer identity and guard

**Context.** Customers must never be staff `users`; staff and shoppers can share a browser on one domain.
**Decision.** `customer_accounts` (1:1 `customers`), session guard `customer` (provider `customer_accounts`), password broker `customers`. `config/sanctum.php` keeps `guard => ['web']`, so a customer session can never satisfy `auth:sanctum`. Storefront account routes use `auth:customer`.
**Session rule.** Customer logout calls `Auth::guard('customer')->logout()` + `session()->regenerateToken()`, **never** `session()->invalidate()` (that would also log out a staff user in the same browser). Login regenerates the session id (fixation).
**Consequences.** Tests: customer cookie → 401 on staff routes; staff cookie → 401 on `/store/account/*`; customer logout keeps staff logged in.
*As built (E7):* no password broker — password resets use the module's own `customer_password_reset_tokens` (organization + e-mail, sha-256, 60 minutes). Storefront hosts get their session and CSRF from the `storefront.session` middleware, not from `SANCTUM_STATEFUL_DOMAINS`. Because `auth:customer` makes `customer` the default guard, author and audit columns use `StaffActor::id()` (staff only). All three tests above exist (`CustomerSessionTest`).

## ADR-003 Online orders are their own document

**Decision.** `orders` in a new Orders module with lifecycle `pending_payment → confirmed → processing → shipped → delivered`, side exits `cancelled`, `failed`, `returned`. Not converted into POS `sales`. Numbering `WEB-000001` per organization via `SequenceGenerator`. Reports union `sales` and `orders`.
**Consequences.** Online returns/refunds are a mirror of the Phase 6 pattern inside Orders (`order_returns`, `order_refunds`), not a reuse of `sale_returns`.
*As built (E8a):* statuses `pending_payment`, `confirmed`, `processing`, `shipped`, `delivered`, `cancelled` and `failed` (reserved for gateways, unused); `returned` waits for E10. Transitions are coded in `OrderStatus` (`pending_payment → confirmed|cancelled`, `confirmed → processing|cancelled`, `processing → shipped|cancelled`, `shipped → delivered`; else `INVALID_STATUS_TRANSITION`). Cash-on-delivery orders start `confirmed`, bank-transfer orders `pending_payment`. `payment_status` is `unpaid|paid` only; paid orders cannot be cancelled until refunds exist (`ORDER_PAID`, E10). Guest orders carry no customer (`customer_id` NULL, contact snapshot) — no POS customer is created or linked by phone. Every change is appended to `order_status_history` (actor NULL = shopper or system).
*As built (E10a):* no `returned` order status: a parcel returned to the sender is a **shipment** state (`shipments.status = returned`) while the order stays `shipped`; an unpaid order in that state may be cancelled (`CancelOrder::returnedToSender()`), which restocks the exact allocations as any cancellation. Shipments (one per order), their append-only `shipment_events` and courier COD remittances live in the Orders module; couriers in Shipping (`CourierDirectory`). Paid orders still cannot be cancelled (refunds: E10b).

## ADR-004 Stock leaves at placement from one fulfilment store

**Decision.** `storefront_settings.fulfilment_store_id`. Order placement posts `MovementType::OnlineOrder` through `StockLedger` inside the order transaction. Cancellation/expiry posts `OnlineOrderCancel` to the exact allocations; returns post `OnlineReturn`. `pending_payment` orders expire after `pending_payment_ttl_minutes` (default 30) via a scheduled job using `FOR UPDATE SKIP LOCKED`.
**Consequences.** New `MovementType` enum cases only — the `type` column is a plain string with no DB CHECK (verified). Storefront availability = stock of the fulfilment store; `allow_negative_stock` of its branch is **ignored for web orders** (web never oversells).
*As built (E8a):* `online_order` and `online_order_cancel` (inbound, restores the exact batch allocations of `order_line_stock` at their cost) exist; `online_return` waits for E10. `MovementType::forbidsNegativeStock()` makes the ledger refuse `online_order` below zero whatever the branch allows. The payment hold is not `pending_payment_ttl_minutes` on the storefront settings but the bank-transfer method's `hold_hours` (1–168, default 48); the job is `orders:expire-pending`, every minute, `FOR UPDATE SKIP LOCKED` on PostgreSQL, reason `payment_expired`.
*As built (E10a):* a refused parcel goes back through `online_order_cancel` (no new movement type); `online_return` waits for E10b.

## ADR-005 One pricing path, server-side

**Decision.** Extract from `Sales\CartPricer` a `VariantPriceLoader` (variants, selling price, tax rate, product flags) usable without a POS store/actor. Web pricing = loader → Promotions (automatic + coupon) → `SaleCalculator` (organization `tax_mode`) → shipping + COD fee lines. Used by cart, checkout preview, placement. Compare-at price is display-only (`variant_listings.compare_at_price`); "sale prices" are Promotions with dates.
**Consequences.** POS behaviour unchanged (CartPricer keeps its public API and delegates). Golden tests: same cart priced by POS and web without promotions gives identical tax/total.
*As built (E7–E8a):* no `VariantPriceLoader` was extracted; the web path is the Cart module's own `CartPricer` (live data from `StorefrontCatalog::variantsForCart` → POS `SaleCalculator`), and checkout's `CheckoutQuoter` adds the delivery and COD fees — after tax and untaxed in E8a. Promotions join in E8b. The client confirms the total it showed (`expected_total`); a difference is `409 TOTAL_CHANGED` with a fresh preview.

## ADR-006 Gateways behind one interface; server verification only

**Decision.** `OnlinePayments\Domain\PaymentGateway` (`initiate`, `verify`, `parseWebhook`, `refund`, `supportsRefund`). Drivers: `cod`, `bank_transfer` (manual confirm by staff), `sslcommerz`, `bkash` (tokenized checkout), `nagad`. Paid = verified server-to-server (IPN/webhook + verify API, amount + currency + order match). Browser return URL only triggers verify and redirects. Every call logged in `payment_transactions` (redacted). Webhooks idempotent via `webhook_receipts`. Credentials per organization, `encrypted` cast, write-only in the API.
**Ledger.** `PaymentLedger` gains `recordSystem(string $branchId, array $entries, PaymentSource $source, ?string $actorId = null)` for non-drawer entries (`created_by` is already nullable — verified); cash-method entries are refused there (`CASH_SESSION_REQUIRED` semantics kept). New `PaymentSource` cases `online_order`, `online_order_refund`; new `PaymentMethod` cases `online_gateway` (gateway code kept in the reference) and `cash_on_delivery` (recorded when staff confirm courier remittance). Both are PHP enums over string columns — no DB constraint change.
**Order of delivery.** COD + bank transfer (no credentials) → SSLCommerz sandbox → bKash sandbox → Nagad, each when credentials exist.
*As built (E8a):* the interface has only `code()`, `initiate()` (returns `GatewayInitiation{awaitsPayment, redirectUrl}`) and `supportsRefund()`; `verify`/`parseWebhook`/`refund`, `payment_transactions`, `webhook_receipts`, `mode` and encrypted credentials arrive with the online drivers (E8c). Checkout talks to the module through `CheckoutPaymentMethods`. `payment_gateways` rows hold COD (`max_order_total`) and bank transfer (`hold_hours`, instructions = bank details) with lazily created defaults (COD on, bank transfer off). Ledger extensions as decided, plus `PaymentLedger::entriesOf()` for the order page; bank transfers are recorded when staff confirm them (reference required), COD when staff record the courier's remittance — both through `recordSystem` with source `online_order`. `PaymentSource` is a class with string constants (`ONLINE_ORDER`, `ONLINE_ORDER_REFUND`), not an enum.
*As built (E10a):* couriers' COD remittances settle many orders at once: `RecordCodRemittance` locks the orders and calls `OrderWorkflow::recordCodPaymentLocked()` per order — the same code as the manual *Record COD payment* (`cash_on_delivery`, source `online_order`, order total, reference = the `REM-` number). The courier's fee is not netted against the order: it is a separate outgoing `recordSystem` entry (method `cash_on_delivery`, source `expense`) of an expense in "Courier fees", recorded through the Expenses module's `ExpenseRecorder` contract. Remittances are all or nothing and append-only.

## ADR-007 Frontend: second Vite entry, admin under `/admin`

**Decision.** `frontend/storefront.html` → `src/storefront/main.tsx` (own router, layout, tokens). Shared: `lib/api`, `lib/money`, query client, `components/ui`. Admin router gets `basename: '/admin'`; old admin paths redirect (`/login` → `/admin/login`, etc.). Production Nginx: `/admin/*` → `dist/index.html`; `/api`, `/sanctum`, `/storage`, `/sitemap*.xml`, `/robots.txt` → PHP; everything else → Laravel storefront shell (ADR-008). Dev: Vite middleware rewrites non-`/admin` HTML requests to `storefront.html`.
**Consequences.** Password-reset e-mail links, Playwright `baseURL`s and the deployment guide change in E4. Admin bundle never ships to shoppers.

## ADR-008 SEO via a Laravel-rendered shell

**Decision.** `Storefront\Presentation\Http\Controllers\StorefrontShellController` renders `storefront.html` (from the Vite manifest) with injected `<title>`, meta description, canonical, Open Graph/Twitter, JSON-LD (`Organization`, `WebSite`+`SearchAction`, `Product`+`Offer`+`AggregateRating`, `BreadcrumbList`, `Article`), `hreflang` (en/bn), and an inline bootstrap payload (theme + menus) to avoid a first-paint round-trip. Unknown slugs → HTTP 404 with the SPA 404. `sitemap.xml` index + chunks (products, categories, brands, pages, posts), `robots.txt` per host. Cached per host+path, invalidated with ADR-012 versions.
**Consequences.** No Node runtime. Revisit SSR only with measured indexing problems.

## ADR-009 Rich text and custom CSS

**Decision.** Admin editor TipTap, introduced in E5 with CMS pages and reused for product/category descriptions (E6) and blog (E11). Server sanitation with `ezyang/htmlpurifier` on save, whitelist: p, h2–h4, strong, em, u, s, a[href|title|target=_blank rel], ul/ol/li, blockquote, img[src from own media host|alt|width|height], table/thead/tbody/tr/th/td, figure/figcaption, hr, br. Custom CSS behind `storefront.custom_css`, ≤ 20 KB, rejects `</style`, `@import`, `expression(`, `javascript:`, and `url()` outside own media host.

## ADR-010 Media module and renditions

**Decision.** `media` table + upload API: extension and sniffed-MIME whitelist (jpeg, png, webp, gif, svg **rejected**), ≤ 5 MB, random names, sha256 dedupe per org. Queued job creates WebP renditions 320/640/1280 w with PHP's GD extension directly (available with WebP support on the dev PHP) — no image package needed; GIFs are kept as uploaded. Disk from `MEDIA_DISK` (public locally, S3-compatible in production → CDN by disk URL). API returns `src`, `srcset`, `width`, `height`, `alt`.
**Consequences.** Existing `product_images` stay; product galleries may move to Media later only if needed.

## ADR-011 Localization

**Decision.** Locales `en` (default) and `bn`. UI strings: typed dictionary in `src/storefront/i18n/{en,bn}.ts` with a `t()` helper (no library until plural/ICU needs appear). Content: optional `translations jsonb` (`{"bn": {"title": "…"}}`) on listing/CMS/storefront records; API resolves by `?lang=` or `lang` cookie, falls back to the base value. Phone: `^(?:\+?88)?01[3-9]\d{8}$`, stored as `+8801XXXXXXXXX`. Money: BDT, `৳` symbol, en digits by default, bn digits optional per theme setting. Fonts: Baloo 2 / Baloo Da 2 headings, Poppins / Hind Siliguri body (Fontsource, self-hosted).

## ADR-012 Caching and invalidation

**Decision.** Per-organization version counters (`storefront:{org}:v:{area}` for `theme`, `menus`, `homepage`, `catalog`, `cms`), bumped in the same transaction's `afterCommit` by every admin write. Public read models cached under `…:{version}:{hash(query)}`. `ETag` = version on bootstrap/homepage. Redis in production, `database` store locally.

## ADR-013 API namespace

**Context.** The brief's examples (`/api/v1/products`, `/api/v1/orders`) collide with existing staff endpoints (`/products`) or are ambiguous next to purchase orders and sales.
**Decision.** Public and customer API under `/api/v1/store/*`. Staff API keeps the existing unprefixed convention with distinct resource names: `/storefront/*`, `/media`, `/cms/*`, `/online-catalog/*`, `/attributes`, `/promotions`, `/coupons`, `/shipping/*`, `/web-orders`, `/payment-gateways`, `/reviews`. Full list in API_PLAN.md.

## ADR-014 Idempotency for customers and guests

**Context (verified).** `idempotency_keys.user_id` is a NOT NULL FK to `users` and the middleware scopes keys by staff user id. Guests and customers have none.
**Decision.** Migration: `user_id` nullable, add `scope varchar(80)`; unique `(scope, key)`. Scope = `user:{id}` (staff), `customer:{id}` (logged-in shopper), `cart:{cart token hash}` (guest). Existing rows backfilled `user:{user_id}`. Middleware resolves the scope; behaviour otherwise unchanged.
**Consequences.** Phase 5–6 idempotency tests must stay green; new tests for guest/customer replay and cross-scope isolation.
*As built (E8a):* migration in `database/migrations` as decided (`user_id` kept for staff rows). The middleware takes a mode: `idempotent` (staff, `user:{id}`) and `idempotent:shopper`, which resolves the scope through the Shared interface `ShopperIdempotencyScope`, implemented by Cart: `customer:{account id}` (the account, not the customer id), else `cart:{sha-256 of the cart cookie token}`; a guest without a cart cookie gets `422 CART_EMPTY` before the controller. The guest scope outlives the cart's conversion, so a lost 201 is replayed. Staff tests unchanged and green; `CheckoutTest` covers replay and cross-scope isolation.
*As built (E10a):* the new staff writes `POST /web-orders/{id}/shipment/events`, `POST /web-orders/bulk/process` and `POST /cod-remittances` use `idempotent` (scope `user:{id}`); the admin reuses the key when retrying a bulk run or a refused remittance with the same body.

## ADR-015 Rate limits for public endpoints

**Decision.** New limiters: `storefront` 300/min per IP (reads), `storefront-write` 30/min per IP+cart (cart, wishlist), `checkout` 10/min per IP+cart, `customer-auth` same shape as `auth` (5/min per e-mail+IP, 20/min per IP), `coupon` 10/min per cart (brute force), `contact`/`newsletter` 5/hour per IP, webhooks unthrottled but signature/verify gated. Listing `per_page` capped at 48.
*As built (E7):* `storefront-write` is 60/min per IP plus 60/min per signed-in customer (not per cart); `customer-auth` takes its numbers from `POS_AUTH_RATE_LIMIT` like staff sign-in.
*As built (E8a):* `checkout` (preview and placement) is `POS_CHECKOUT_RATE_LIMIT` (default 10) per minute per IP + shopper (customer account, else guest cart). Behind a proxy all limiters need `TRUSTED_PROXIES` to see the visitor's IP.

## ADR-016 Roles

**Decision.** New permissions (API_PLAN.md §1) flow into **Organization Admin** through its existing glob. New built-in role **Online Store Manager**: `storefront.*`, `media.*`, `cms.*`, `online_catalog.*`, `attributes.manage`, `promotions.*`, `shipping.*`, `web_orders.*`, `reviews.*`, plus `products.view`, `inventory.view`, `customers.view`. `storefront.custom_css` and `payment_gateways.manage` are **not** in that role (Organization Admin only by default).
*As built (E8a):* `web_orders.view`, `web_orders.manage` and `shipping.manage` reach the Online Store Manager through `web_orders.*` / `shipping.*`; `web_orders.refund` is not declared yet (E10). `GET /shipping/zones` is also readable with `web_orders.view`.
*As built (E10a):* new permission `web_orders.remit` (couriers' COD remittances) — Organization Admin through `*`, Online Store Manager through `web_orders.*`, and the built-in **Accountant** role gains `web_orders.remit` and `web_orders.view` (it settles money; it sees the orders it settles). `GET /shipping/couriers` is readable with `web_orders.view` (the ship dialog); changes need `shipping.manage`. `web_orders.refund` still waits for E10b.

## ADR-017 Out of scope for v1

Product compare, multi-currency, split fulfilment across stores, marketplace, subscriptions, bundles, blog comments, Instagram API feed (footer gallery is admin-curated media), drag-and-drop page builder, offline/PWA checkout.

## ADR-018 Registration never links POS customers

*Accepted 2026-10-31 (E7).*
Registration never links POS customers. Every sign-up creates a new `customers` row (CUS sequence) with its 1:1 `customer_accounts` row. It never attaches to an existing customer with the same e-mail or phone, because proving ownership of a known number would allow account takeover. The phone goes on the new customer only when no other live customer uses it, so the till's unique lookup and non-enumeration both hold. Staff linking or merging of online and POS customers is out of scope (later phase).
