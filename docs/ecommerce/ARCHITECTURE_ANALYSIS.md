# Architecture Analysis — adding a storefront to the POS

E-commerce track, phase E1. Proposals here are **not yet approved**; decisions marked *open* need a yes/no at the E1 checkpoint.

## 1. Constraints carried over from the existing system

- One deployable Laravel app + React frontend. No WordPress, no new runtime services (no Node SSR server) unless a decision below says so.
- Module rules from `docs/MODULE_STRUCTURE.md`: thin controllers, business rules in Application/Domain, a module never writes another module's tables, cross-module calls through `Application/Contracts`, events after commit.
- Money only via `Money`/`NUMERIC`; the server prices everything; money-moving POSTs are idempotent and transactional.
- Every tenant query scoped by organization (and branch where relevant).
- No placeholder UI.

## 2. Mapping the requested module list onto the codebase

The brief suggests ~35 modules. Many already exist or are too small to stand alone. Proposed mapping:

| Requested | Lands in | Status |
|-----------|----------|--------|
| Authentication, Users, Roles, Permissions | Authentication, Users | Exist (staff) |
| Customers | Customers (+ addresses) and new **CustomerAccounts** (credentials, sessions) | Extend + new |
| Products, Variants | Products | Exist |
| Categories, Brands | Catalog | Exist |
| Attributes | Catalog (attribute dictionary) | Extend |
| Inventory, Warehouses | Inventory, Branches (`stores.type = warehouse`) | Exist |
| Pricing | Products (prices) + shared pricing service extracted from Sales | Refactor |
| Discounts, Promotions, Coupons | new **Promotions** | New |
| ShoppingCart, Wishlist | new **Cart** | New |
| Checkout, Orders, Returns, Refunds (online) | new **Orders** | New |
| Payments (gateways) | new **OnlinePayments** → existing Payments ledger | New + extend |
| Shipping, Delivery | new **Shipping** (zones, methods, rates, BD geography, shipments) | New |
| Reviews | new **Reviews** | New |
| CMS, Blogs | new **Cms** (pages, blog, FAQ, contact messages, newsletter) | New |
| Media | new **Media** (library, renditions) | New |
| Menus, Navigation, ThemeSettings, PageBuilder, Banners | new **Storefront** (site configuration) | New |
| Product web data, public catalog, search, facets | new **OnlineCatalog** | New |
| Notifications | Notifications (+ mail channel) | Extend |
| Reports, Analytics | Reports (POS Phase 7) | Planned |
| AI | AI (POS Phase 8) | Planned |

Eleven new modules, five extended. Menus/theme/banners/homepage are one module because they change together and are read together by one endpoint; splitting them would only add contracts.

## 3. Module boundaries and dependencies

```
                ┌────────────── Storefront (theme, menus, banners, homepage sections, domains)
                │                    │ reads via directories
Media ◀─────────┤                    ▼
                │           OnlineCatalog (listings, slugs, SEO, facets, public read API)
Cms ────────────┘                    │ ProductDirectory, CatalogDirectory, StockLevels (read)
                                     ▼
CustomerAccounts ──▶ Customers   Cart (carts, wishlists) ──▶ Promotions (coupon/discount evaluation)
                                     │
                                     ▼
                                  Orders ──▶ Inventory.StockLedger (post / restock)
                                     │  ──▶ Shipping (rates, shipments)
                                     │  ──▶ Promotions (redemptions)
                                     │  ──▶ shared pricing (SaleCalculator)
                                     ▼
                              OnlinePayments ──▶ Payments.PaymentLedger
Reviews ──▶ Orders (verified purchase check, contract)
```

- **OnlineCatalog** owns web-only product data in its own tables keyed by `product_id`/`category_id`/`brand_id`. POS product screens stay unchanged; the admin product editor gets an "Online" tab that talks to OnlineCatalog endpoints.
- Public list/detail endpoints are **read models** that join `products`/`product_variants`/`stock_levels` read-only — the documented exception already used by `GET /inventory/stock`.

## 4. Key decisions

### D1 — Which organization does a storefront belong to? *(open)*
The POS is multi-tenant; a shopper is not logged in, so the tenant cannot come from the user.

- **Recommended:** `storefront_domains (organization_id, host unique)`. A `ResolveStorefront` middleware maps `Host` → organization, sets `TenantContext`, rejects suspended orgs / disabled storefronts (404). In local dev a configured fallback (`STOREFRONT_DEFAULT_HOST`) maps `localhost`. Every organization can run its own shop on its own domain or subdomain.
- Alternative: single-shop install (`STOREFRONT_ORGANIZATION_ID` env). Simpler, but throws away multi-tenancy for the web side.

### D2 — Customer identity
Shoppers are **not** staff `users`. New `customer_accounts` table (email, phone, password hash, verification) 1:1 with a `customers` row, unique per organization. Separate session guard `customer` and password broker `customers`. Sanctum's stateful guard list stays `['web']`, so a shopper cookie can never pass a staff route; storefront account routes use `auth:customer`. Guest checkout creates/links a `customers` row by phone (the existing unique key), without credentials. POS and web then share one customer record, one loyalty balance and one statement.

### D3 — Online orders: own document or POS `sales`? *(open)*
- **Recommended:** new `orders` document in the Orders module. An online order has a lifecycle the immutable POS invoice does not (pending payment → confirmed → packed → shipped → delivered / cancelled / failed), addresses, shipping and gateway payments. Orders posts stock via `StockLedger` and money via `PaymentLedger`, so inventory and cash reporting already see it; Reports (Phase 7) unions `sales` and `orders` for revenue.
- Alternative: on delivery, convert the order into a Sales invoice (channel `online`). Reuses returns/receivables/loyalty, but `CompleteSale` assumes a cashier, a drawer session and immediate settlement — forcing web orders through it would bend the POS rules.

### D4 — When does stock leave?
**At order placement**, through `StockLedger` from the organization's fulfilment store, inside the order transaction (same lock protocol, no overselling). Orders awaiting online payment expire after a configurable window (default 30 min) and are cancelled by the scheduler, which restocks the exact batches. Rationale: the system deliberately has no reservation table (see DATABASE_DESIGN Phase 4 deviations); keeping one stock truth is worth briefly holding stock for abandoned payments. The storefront shows availability from the fulfilment store only. Multi-store fulfilment/splitting is out of scope for v1.

### D5 — Pricing and totals
One pricing path for the web: `WebCartPricer` (Orders/Cart) loads current variant prices and tax rates through a shared loader extracted from Sales' `CartPricer`, applies Promotions (automatic discounts, coupon) and runs the existing pure `SaleCalculator`. Shipping and COD fee are separate lines after tax. Cart page, checkout preview and order placement call the same code; the client never sends prices. Display prices on listings come from the same rules (cached per variant, invalidated on price/promotion change).

**Compare-at ("was") price** is a display field on the web listing; the charged price is always `selling_price` minus active promotions. Sale prices with dates are modelled as Promotions (product/category flash sales with start/end), not as a second price column — one mechanism for "sale price", "hot deal countdown" and "flash sale".

### D6 — Payments
`OnlinePayments` owns gateway drivers behind one `PaymentGateway` interface (`initiate`, `verify`, `handleWebhook`, `refund`): COD, bank transfer (manual verification), SSLCommerz (cards, mobile wallets, net banking), bKash tokenized checkout, Nagad. Rules:
- An order is paid only after **server-side verification** with the provider (IPN/webhook or verify API). Browser return URLs only trigger a verify call.
- Every request/response to a provider is stored in `payment_transactions` (secrets redacted).
- Webhooks are idempotent on the provider's transaction id; amount and currency are checked against the order.
- Verified money is appended to the Payments ledger with a system actor (requires the additive `PaymentLedger` change). COD is recorded when the courier remittance is confirmed by staff.
- Credentials are per organization, encrypted (`encrypted` cast, `APP_KEY`), never returned by the API.

### D7 — Frontend structure *(open)*
- **Recommended:** keep one Vite project, add a second entry: `storefront.html` → `src/storefront/` with its own router, layout, CSS tokens and a smaller bundle (no admin code shipped to shoppers). Shared: `lib/api`, `lib/money`, query client, shadcn primitives. The admin app moves under `/admin` (React Router `basename`), the storefront owns `/`. Laravel's web routes serve `storefront.html` for `/*` and `index.html` for `/admin/*`.
- Alternative: admin on a separate host (`admin.example.com`) and storefront on the main host — same code split, no path move, needs two hosts locally.

### D8 — SEO for a client-rendered app *(open)*
- **Recommended (no new runtime):** Laravel renders the storefront HTML shell per request with server-side `<title>`, meta description, canonical, Open Graph and JSON-LD (Product, BreadcrumbList, Organization) for product, category, CMS and blog URLs, using the same read models as the API (cached). The body still renders client-side; Google executes JS and the critical metadata is in the first byte. Plus `sitemap.xml` (chunked) and `robots.txt` from Laravel.
- Upgrade path: React Router framework-mode SSR on a Node process, only if measured indexing problems justify a second runtime.

### D9 — Rich text and custom CSS
CMS pages, blog posts and product descriptions need rich text. Proposed: TipTap editor in admin, **HTMLPurifier** on the server on every save (whitelisted tags/attributes), rendered as trusted HTML only after purification. Custom CSS: separate permission `storefront.custom_css`, size limit, strip `</style`, `@import`, `expression(`, and external `url()`s; injected in a `<style>` scoped to the storefront.

### D10 — Media
`Media` module: uploads to the configured disk (public locally, S3-compatible in production → CDN-ready via the disk URL), MIME sniffing + extension whitelist, max size, random names, renditions (thumb / medium / large WebP) generated by a queued job, `srcset` in API output, alt text per asset. Existing `product_images` keep working; new product gallery uploads go through Media later only if it brings a real gain (not required for v1).

### D11 — Localization
English and Bangla UI strings in the storefront via a small typed dictionary (or `react-i18next` if pluralization needs grow). Content translation (Bangla product names, pages) as optional `translations` jsonb on OnlineCatalog/Cms/Storefront records, resolved per `?lang`/cookie — not on POS tables. BDT formatting via the existing money formatter with locale digits optional. Phone validation `^(?:\+?88)?01[3-9]\d{8}$`, normalized to `+8801XXXXXXXXX`.

### D12 — Caching
Public reads (theme, menus, homepage, listing pages, product detail) cached with tags/versions per organization; any admin change bumps the version. Redis in production; database/file store locally. HTTP `ETag` on theme/menu/homepage endpoints.

## 5. Cross-cutting rules for every new module

- Public storefront routes: `storefront` middleware group = `ResolveStorefront` + `throttle:storefront` (per IP), no `auth`.
- Customer routes: `storefront` + `auth:customer` (+ `throttle:customer-auth` on credential endpoints).
- Admin routes: existing `auth:sanctum` + `tenant` + `can:<module>.<action>`; new permissions declared by each module provider (`storefront.manage`, `storefront.custom_css`, `cms.manage`, `orders.view`, `orders.manage`, `orders.refund`, `promotions.manage`, `shipping.manage`, `reviews.moderate`, `payments.gateways.manage`, `media.manage`).
- Idempotency-Key on: place order, payment initiate, refund, return approval.
- Audit every admin mutation.

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Scope (11 new modules + storefront UI) is several times the POS so far | Vertical slices with a checkpoint each (see plan); defer what is not needed for a first sale. |
| Public endpoints become scraping/DoS targets | Per-IP throttles, cached read models, pagination caps (`per_page ≤ 48`). |
| Gateway integration without sandbox credentials | Build against provider sandboxes only once credentials exist; COD + bank transfer ship first. |
| Duplicating POS logic for the web | Shared pricing loader + `SaleCalculator`, `StockLedger`, `PaymentLedger`, Customers — no copies. |
| Copying a commercial theme | Recreate layout and behaviour only; no theme code, CSS, images or fonts (see UI_REFERENCE_ANALYSIS §2). |
