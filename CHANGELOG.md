# Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### E-commerce E7 — Customer accounts, cart and wishlist (online store track)

#### Added
- **CustomerAccounts module** (ADR-002): online store accounts of customers (`customer_accounts`, 1:1 `customers`) on their own session guard `customer` (provider `customer_accounts`, tenant-scoped: accounts resolve only inside the storefront's organization, so a session of store A is anonymous on store B). Sign-up, sign-in (optional "remember me"), sign-out, e-mail verification, forgotten password, profile (name, Bangladeshi mobile) and password change. Sign-in regenerates the session id; sign-out forgets only the shopper and gets a new CSRF token, so a staff session in the same browser survives. Unknown e-mail, wrong password and disabled accounts give the same `INVALID_CREDENTIALS` answer with equalised hashing time.
- **Registration never links POS customers** (ADR-018): every sign-up creates a new customer record (`CUS-` sequence) and its account; the phone is copied to the customer only when no other customer of the organization uses it.
- **E-mail verification:** queued e-mail with a link to `/account/verify-email?token=` on the shopper's host (random token stored as sha-256, valid 24 hours, a new link replaces the old one); unverified accounts can sign in and shop; the account page shows a banner with "Resend". **Password reset** with its own `customer_password_reset_tokens` table (sha-256, one per e-mail and organization, valid 60 minutes, at most one e-mail a minute per address, identical answers whether or not an account exists); the reset signs the shopper in, marks the e-mail verified and rotates the remember-me token. Changing the e-mail address is not offered yet.
- **Geography module:** global reference tables `geo_divisions` (8) and `geo_districts` (64) with English (2018 government spellings) and Bangla names and BBS geocodes, loaded by the migration from a bundled data file; public `GET /store/geo/divisions` and `/store/geo/districts?division=` (cacheable for a day). No upazila/thana table yet — addresses keep a free-text area.
- **Address book** (Customers module, `customer_addresses`): label, recipient, Bangladeshi mobile (normalized to `01XXXXXXXXX` from `+88`, spaces, dashes — shared `BangladeshMobile`), division and district (the district must be in the division), area, address line, optional 4-digit postcode, default shipping and billing flags. At most 10 per customer (`ADDRESS_LIMIT_REACHED`); the first address becomes the default; exactly one default shipping address while any exist; deleting the default promotes the most recent one. Soft deletes.
- **Cart module:** guest carts by an httpOnly `cart_token` cookie (40 random bytes, SameSite=Lax, Secure on HTTPS, 30 days; only its sha-256 is stored) and one cart per customer. No prices are stored: **every read and every write reprices** through `CartPricer` — live listing, price, compare-at price, availability, stock at the fulfilment store and tax rate from the OnlineCatalog contract (`variantsForCart`), totals from the POS `SaleCalculator` with the organization's tax mode and currency. Lines that are no longer purchasable or out of stock stay in the cart, flagged (`issues`: `unavailable`, `out_of_stock`, `exceeds_stock`), with `line_total` `"0.00"` and left out of the totals; a line above the stock is flagged and counts with the available quantity. Quantities are never changed on read.
- Cart rules: whole units unless the product's unit allows decimals (3 places), at most 999 per line and 50 lines (`CART_FULL`); adding a variant already in the cart increases its line; `VARIANT_NOT_PURCHASABLE`, `OUT_OF_STOCK`, `INSUFFICIENT_STOCK` (`details.max_quantity`, `in_cart`).
- **Guest → customer merge** on sign-in, registration and password reset: guest lines are added to the customer's cart in one transaction (quantities summed and capped at the stock and 999; lines beyond the 50-line limit are dropped), the guest cart is deleted and its cookie forgotten; the response reports `merge: {merged_lines, capped_lines}`. Guest carts expire 30 days after their last change and are deleted by the daily `cart:prune`.
- **Wishlist** (Cart module): signed-in customers on the server (`wishlists`, `wishlist_items`; at most 200 entries, `WISHLIST_FULL`; entries of products that are no longer live are kept but not shown); guests keep theirs in the browser (product id and slug only, ≤ 100) and it is merged with `POST /store/wishlist/merge` after signing in.
- **`storefront.session` middleware:** storefront hosts are not Sanctum-stateful, so the bootstrap, account, cart and wishlist routes run the cookie/session/CSRF stack themselves (EncryptCookies, AddQueuedCookies, StartSession, ValidateCsrfToken) unless Sanctum already made the request stateful. Catalog, CMS and geography routes stay sessionless. The storefront client sends `X-XSRF-TOKEN` and, after a 419, refreshes the cookie with `GET /store/account/me` and retries once.
- Rate limiters `customer-auth` (sign-up, sign-in, forgot/reset password, resend verification, password change: `POS_AUTH_RATE_LIMIT` per e-mail+IP, four times that per IP) and `storefront-write` (cart, wishlist, address, profile writes and e-mail verification: 60/min per IP and 60/min per signed-in customer).
- **Staff:** `GET /customers/{id}` (and create/update/restore) include `online_account` (`null` or e-mail, verified/last sign-in/created times, status) through the Customers contract `CustomerOnlineAccounts`; `PATCH /customer-accounts/{customerId} {status: active|disabled}` (`customers.manage`, audited `customer_account.status_changed`). A disabled account — or an archived or inactive customer — is refused at sign-in and signed out on its next request (401 on signed-in routes; `me` answers `null`). Admin: an **Online store account** card in the customer account sheet (opened from the customers list) with Disable/Enable.
- **Storefront:** sign-in, registration, forgot/reset password and e-mail confirmation pages; account overview with verification banner, profile and password page, address book (add/edit dialog with division → district selects, default, delete with confirmation); account pages need sign-in (`/account/login?next=`; only relative storefront paths are accepted as `next`, against open redirects) and sign-in pages send signed-in shoppers on. Header: sign-in link or *My account* menu with sign-out, wishlist and cart icons with counts; **mini-cart drawer** (lines, quantity steppers, remove, subtotal, *View cart*). Product page and quick view: quantity stepper + *Add to cart* (disabled until a variant is chosen and while it is out of stock; stock errors narrow the stepper) and a wishlist heart; product cards: heart and *Add to cart* for single-variant products, else *Choose options*. Cart page: lines with image, variant, unit and compare-at price, stepper, line total, remove, flags with a one-click "Change quantity to N", totals (VAT line in exclusive mode, "Prices include VAT" in inclusive mode). Wishlist page (server or browser list, cards fetched fresh, single-variant products move to the cart). A notice tells the shopper when merged lines were reduced to the stock. **No checkout button** (E8) and no order history (E9).
- The shell answers `/account`, `/account/login`, `/account/register`, `/account/forgot-password`, `/account/reset-password`, `/account/verify-email`, `/account/profile`, `/account/addresses`, `/cart` and `/wishlist` with `noindex`.
- Demo data: shopper account `shopper@demo.test` / `password` (verified) on the demo store with a home address in Dhaka and the mango juice on the wishlist; no seeded cart.
- Tests: 388 backend tests (386 pass, 2 PostgreSQL-only skipped on SQLite) — new `CustomerAccountTest`, `CustomerSessionTest` (staff and shopper sessions in one browser, session fixation, store isolation, a non-stateful host with CSRF and 419), `AddressBookTest`, `CartTest` (repricing, flags, both tax modes equal to `SaleCalculator`, merge, isolation, rate limit, prune), `WishlistTest`, `CartRulesTest`; 272 Vitest tests; Playwright: `storefront-account-cart.spec.ts` (mocked; the mocked suite: 40 pass + 2 skipped by design) and the full-stack test `a guest cart merges into the shopper account at sign-in and its totals match the server`.

#### Changed
- Product cards add `default_variant_id` (only for products with exactly one active variant, else `null`); the product detail adds `allow_decimal` (the unit allows decimal quantities).
- `GET /store/bootstrap` now starts the storefront session and sets the `XSRF-TOKEN` cookie.
- Middleware priority: `storefront` and `storefront.session` run before authentication, so `auth:customer` looks accounts up inside the host's organization.
- `StorefrontCatalog` gains `variantsForCart()`; OnlineCatalog now also uses Products' `ProductDirectory`.

#### Fixed
- `auth:customer` makes `customer` the request's default guard, so `Auth::id()` could be a shopper's account id. Author columns (`TracksAuthor`) and the audit trail now use `StaffActor::id()`, which counts only staff users.

### E-commerce E6 — Online catalog and product page (online store track)

#### Added
- **OnlineCatalog module:** web listings of products (`product_listings`: address, publish switch with optional window `published_at`/`unpublished_at`, featured, "new until" date, short description, sanitized description, up to 30 specifications, SEO title/description, sort weight; states *draft*, *scheduled*, *live*, *expired*), per-variant web data (`variant_listings`: compare-at price, which must be above the selling price — `COMPARE_AT_NOT_ABOVE_PRICE` — and the product image shown for the variant), category and brand listings (address, visibility, image/banner or logo from the media library, description, SEO) and hand-picked **related** and **frequently bought together** products (≤ 12 each, ordered). Only active products can be published (`PRODUCT_NOT_SELLABLE`). A blank address takes a free suggestion from the name (`mango-juice`, `mango-juice-2`, …); addresses are unique per organization regardless of case.
- **Attribute dictionary** (Catalog module): attributes (name, slug, display *button*/*swatch*/*text*, filterable, order) with ordered values and swatch colours. Product options stay the source of truth; an option is linked to an attribute when the names match case-insensitively, and only linked, filterable attributes become shop filters. The product editor suggests attribute names and shows their known values.
- **Public shop API:** `GET /store/categories[/{slug}]`, `/store/brands[/{slug}]`, `/store/products` (search, category scope incl. subcategories, brands, price range, attributes, in stock, on sale; sorts featured, popularity, latest, price, name; 12/24/36/48 per page; **disjunctive facets with real counts**; `slugs=` mode for recently viewed lists), `/store/products/{slug}` (gallery, options in dictionary order, variants with price, sale, availability and image; staff preview of unpublished listings with `?preview=1`), `/store/products/{slug}/related` (falls back to the newest products of the same category) and `/store/search/suggest`.
- **Availability** from the storefront's new **fulfilment store** (`storefront_settings.fulfilment_store_id`, chosen under *Online store → Settings & domains*; `STORE_NOT_FOUND` for a store that is not an active store of the organization): products that do not track stock are always available; tracked ones need sellable on-hand stock there. Exact quantities are never public — only `in_stock` and `low_stock` (1–5 left).
- **Popularity projection** `product_stats` (net units sold in 30 days and in total from completed POS sales minus completed returns), rebuilt hourly by `storefront:refresh-product-stats` (`RefreshProductStats` job); drives the *popularity* sort and *best sellers* sources.
- **Homepage sections** product carousel, product grid (3–5 columns), product tabs (2–5 tabs), category strip and brand strip. Sources: hand-picked (`item_ids`), featured, new arrivals, best sellers, on sale, a category (with subcategories); strips: hand-picked, top level / all. Sections whose products, categories or brands are all unavailable are not rendered (preview state `empty`).
- **Menus link to categories and brands** (`type: category|brand`, `target_id`); items whose target has no visible listing drop out of the storefront navigation. `GET /storefront/link-targets` adds categories (tree order) and brands with their storefront address.
- **Storefront:** shop, category, brand and search pages (breadcrumbs, category banner and description, subcategory chips, filter sidebar / mobile drawer with counts, price range, swatches, in-stock and on-sale toggles, sort, grid/list view, page size, pagination — all state in the URL), product cards (hover image, sale/new/out-of-stock badges, price ranges, struck-through compare-at price), quick view, header search with keyboard-accessible suggestions, and the product page (gallery with hover zoom and lightbox, variant selector updating price, SKU, availability and image with `?variant=` in the URL, unavailable combinations disabled, "Excl. VAT" in exclusive tax mode, description and specifications tabs, related, frequently bought together, recently viewed). Prices are formatted in the store currency from the bootstrap. The shell answers `/shop`, `/search` (`noindex`) and existing `/category/{slug}`, `/brand/{slug}`, `/product/{slug}` with title, description and `og:image` (`og:type` `product` for products).
- **Admin:** *Online store* section on the product editor (publish and schedule, address with storefront link, featured, new-until, descriptions, specifications, SEO with counters, per-variant compare-at price and image, related and frequently-bought pickers; toast "Online listing saved."), the same form on `/admin/products/{id}/online-store` for online store staff who cannot edit products, *Online store → Categories* and *→ Brands*, *Catalog → Attributes*, the fulfilment store in *Online store → Settings & domains*, editors for the five new section types and category/brand menu items.
- Permissions `online_catalog.view`, `online_catalog.manage` and `attributes.manage` (Online Store Manager role through `online_catalog.*` and `attributes.manage`). The attribute list is readable with `products.view` or `attributes.manage`.
- PostgreSQL: `pg_trgm` extension and a GIN trigram index on `lower(products.name)` for substring search; CHECK constraints on listing windows, related kinds and compare-at prices.
- Demo data: Main store as fulfilment store, two more products (one with low stock), listings for every product for sale (two featured, two with compare-at prices, specifications, generated artwork), visible categories and brands with images, a *Size* attribute, refreshed product stats, three catalog homepage sections (featured carousel, category strip, New arrivals / Best sellers / On sale tabs) and *Shop* plus a *Grocery* mega menu in the main menu.
- Tests: 330 backend tests (328 pass, 2 PostgreSQL-only skipped on SQLite) — new `OnlineCatalogAdminTest`, `StoreCatalogTest`, `StorefrontCatalogIntegrationTest`, `CatalogDomainTest`, `AttributeManagementTest`; 211 Vitest tests; Playwright: `online-catalog-admin.spec.ts` and `storefront-catalog.spec.ts` (mocked, 36 pass + 2 skipped by design) and a full-stack test for brief checks 7–10 (a product created and published in the admin appears in search, listing and product page; repriced in the product editor, the new price shows on the product page, the shop listing, the search suggestions and the homepage carousel).

#### Changed
- `GET /store/bootstrap` adds `store.currency` (organization base currency) and `store.prices_include_tax` (`true` in inclusive tax mode).
- `GET /storefront/homepage-sections[/{id}]` returns `item_ids` and `items` (`{id, name, image_url}`) for hand-picked records; `/types` adds `manual_items` (record type and limits). Duplicating a section copies its hand-picked records.
- The sign-in rate limit is configurable: `POS_AUTH_RATE_LIMIT` (default 5 attempts per minute per account and IP, four times that per IP).
- `CatalogDirectory` gains `categories()`, `brands()` and `attributes()` (inactive records included) for the online catalog's read model.

#### Fixed
- The full-stack menu test counts the existing menu items instead of assuming the seeded main menu has four.

### E-commerce E5 — Content and homepage builder (online store track)

#### Added
- **Homepage builder** (Storefront module): `homepage_sections` + `homepage_section_items` with a typed config per section type (`Domain\SectionType`: defaults, normalization, media references). Types shipped: **hero slider**, **banner grid** (2, 3, 3-split or 4 columns), **text block** (rich text), **features strip** (icon, title, text), **testimonials** (quote, name, role, stars, photo) and **newsletter sign-up**. Sections can be added (go last), edited, duplicated (disabled copy right below), enabled/disabled, scheduled (`starts_at`/`ends_at`), reordered and deleted.
- **Banners** with placements `hero_slider` and `home_promo`: kicker, headline, text, one or two buttons (or the whole banner as link), desktop and mobile image, text colour and position, schedule, active flag, order per placement. Banners shown by a section cannot be deleted or moved to another placement (`IN_USE`, `BANNER_IN_USE`).
- **Public homepage API** `GET /store/homepage`: live sections in order with banners and media resolved; a section whose banners are all inactive or outside their schedule is left out, so empty blocks never render. `?preview=1` from staff of the store with `storefront.view` adds hidden, scheduled, ended and empty sections with their `state`. `ETag` support.
- **Cms module:** content pages (`/pages/{slug}`, layouts *standard*, *FAQ*, *contact*; draft/published with optional publication time; SEO title and description), FAQ entries (topic groups, order, active flag), contact form messages (honeypot, 5 per hour per visitor, handled/open in the admin), newsletter subscribers with **double opt-in** (confirmation e-mail with hashed tokens valid 7 days, one e-mail per address per 10 minutes, identical answers whether or not an address is known, click-to-unsubscribe) and a CSV export of confirmed subscribers.
- **Rich text** sanitized on the server with HTMLPurifier (`ezyang/htmlpurifier` 4.19, ADR-009 whitelist; images only from the media disk) through the new shared `HtmlSanitizer` contract; edited with **TipTap 3.32** in the admin (headings 2–4, emphasis, lists, quote, divider, safe links, images from the media library).
- **Menus link to content pages** (`type: page`, `target_id`): the storefront resolves the address, so renames follow and unpublished pages drop out of the navigation. A page linked from a menu cannot be deleted. `GET /storefront/link-targets` lists the pages for the editor.
- **Storefront:** homepage renderer (accessible hero carousel with optional autoplay that pauses on hover/focus, can be stopped and respects reduced motion; banner grids; text; features; testimonials; newsletter form), content pages with breadcrumb, FAQ accordion and contact form plus the store's contact details, newsletter confirm/unsubscribe pages, staff preview markers. The shell answers 200 with the page's title and description for published pages and `noindex` for the newsletter pages.
- **Admin:** *Online store → Homepage* (builder with type picker, per-type editors, banner chooser, preview link) and *→ Banners*; new *Content* area (`cms.manage`): Pages (list and editor), FAQ, Messages, Newsletter.
- Permission `cms.manage` (in the Online Store Manager role through `cms.*`).
- Demo data: Demo Mart gets About, FAQ, Contact and Privacy pages, four FAQ entries, generated banner artwork, a six-section homepage and menus linking to the pages.
- Tests: 295 backend tests (2 PostgreSQL-only skipped on SQLite) — new `CmsPagesTest`, `ContactAndNewsletterTest`, `HomepageBuilderTest`, `HtmlSanitizerTest`; 139 Vitest tests (20 new); Playwright: homepage sections and content pages (mocked) and a full-stack test for brief checks 1–2 and 5–6 (a banner edited in the admin shows on the storefront; a section added and moved to the top shows first; hidden again, it disappears).

#### Changed
- `PUT /storefront/menus/{id}/items` keeps the items in the order sent even when only some items carry optional keys (Laravel's `validated()` could reorder them).
- Timestamps with an offset (`2026-11-03T00:00:00+06:00`) are moved to the application timezone before Eloquent stores them (`Shared\Application\Support\Instants`), so schedules keep their instant.
- E5 ships the section types whose content and link targets exist. Product, category and brand sections follow with the online catalog (E6), deal countdowns with promotions (E8) and blog teasers with the blog (E11) — no section may link to a page that does not exist yet.

### E-commerce E4 — Storefront shell (online store track)

Plan, decisions and API surface of the e-commerce track: `docs/ecommerce/` (analysis E1, reference investigation E2, ADR-001…017 and API plan E3).

#### Added
- **Storefront module:** storefront settings (open/closed, site name, meta description), domains (host → organization, one primary), theme document (colours, fonts, button style, card radius, content width, sticky header, logo, favicon, scheduled announcement bar, footer about/contact/social/payment logos) normalized by `ThemeSchema`, policy-checked custom CSS, menus per location (`main`, `mobile`, `footer_1`..`footer_3`) with nested items up to three levels and mega menus on the main navigation.
- **Public storefront API:** `GET /api/v1/store/bootstrap` resolved from the request host (`storefront` middleware; unknown host, closed store or suspended organization → `404 STOREFRONT_NOT_FOUND`; staff with `storefront.view` preview a closed store), with `ETag` support and its own rate limiter (300/min per IP).
- **Storefront HTML shell:** every non-API, non-admin path is served by Laravel from the built `storefront.html` with server-written title, description, canonical, Open Graph, favicon and the inlined bootstrap payload; unknown storefront paths answer 404 with `noindex`. Modules can now ship `Presentation/Routes/web.php`.
- **Media module:** image library (JPEG/PNG/WebP/GIF ≤ 5 MB), de-duplication by checksum, WebP renditions 320/640/1280 px by a queued GD job, `srcset` everywhere, alt text, lookup by ids, in-use protection (foreign keys and tagged `MediaReferences` checkers).
- **Storefront app** (`frontend/storefront.html` → `src/storefront/`): announcement bar, header with logo, accent-coloured main navigation with dropdowns and mega menus (hover and keyboard), sticky header, mobile drawer, footer with menus/contact/social/payment logos, preview ribbon, home page with the store's name and description, not-found page; theme applied as CSS variables; Baloo 2 and Poppins self-hosted.
- **Admin screens:** *Online store* (`/admin/storefront`: settings and domains, theme with WCAG contrast checks, menus with a tree editor) and *Media library* (`/admin/media`, upload by drag and drop, alt text, delete), with read-only views for `storefront.view` without `storefront.manage`.
- Permissions `storefront.view`, `storefront.manage`, `storefront.custom_css`, `media.manage`; new built-in role **Online Store Manager** (custom CSS stays with the Organization Admin).
- Demo data: Demo Mart's storefront open on `STOREFRONT_DEFAULT_HOST` (default `shop.localhost`) with a main and a footer menu.
- Tests: 275 backend tests (2 PostgreSQL-only skipped on SQLite) — new `MediaLibraryTest`, `StorefrontAdminTest`, `StorefrontPublicTest`, `StorefrontRulesTest`; 119 Vitest tests (32 new: theme mapping, navigation, footer, menu tree operations, contrast, schedule conversion, settings/theme/menu pages); Playwright `storefront.spec.ts` and `storefront-admin.spec.ts` (mocked) and a full-stack test where a theme colour and a menu changed in the admin appear on the storefront.

#### Changed
- **The back office moved to `/admin`** (React Router `basename`; password-reset links now point to `/admin/reset-password`). The storefront owns `/`. The Vite dev server serves both (`/admin/*` → `index.html`, other pages → `storefront.html`); production routing is in `DEPLOYMENT_GUIDE.md`.
- `VITE_BACKEND_ORIGIN` from the shell now overrides `frontend/.env.local`; Playwright honours `E2E_PORT` (own dev server when 5173 is busy); the API rate limit is configurable (`POS_API_RATE_LIMIT`, default 120/min).

### Phase 6 — Payments, returns, refunds, cash registers, expenses, loyalty

#### Added
- **Payments module:** organization-wide payments ledger (`payments`, append-only) fed by every module through the `PaymentLedger` contract; cash registers per branch; register sessions (`SES-{BRANCH}-000001`) with opening float, cash in/out, closing count, expected cash and variance; X/Z session reports (cash reconciliation, totals per method and per kind of transaction); payment history with totals.
- **Sales returns and refunds:** returns against the original invoice (`RET-{BRANCH}-000001`) with an approval workflow (pending → completed/rejected; approvers' own returns complete at once), return reasons with a default restocking rule, per-line restock or write-off, restock to the exact batches sold from at their cost, serial numbers released, values from the invoice line (discounts and tax included, exact remainder on the last return), settlement against what the customer still owes before refunding, refunds by method (card/mobile/points capped at what was paid that way), preview endpoint.
- **Receivables:** customer payments (`RCP-000001`, capped at the balance) and customer statements with running balance; balances now subtract return credits and payments.
- **Expenses module:** expense and income categories, expenses and other income (`EXP-` / `INC-`), voiding with a reversing payment.
- **Loyalty module:** program settings (points per spend, point value, minimum redemption), point accounts and an append-only points ledger; points earned at checkout, redeemed as the `loyalty_points` payment method, reversed on cancellation and returns, manual adjustments. Plugs into Sales through the Sales-owned `LoyaltyProgram` contract.
- Permissions: `payments.view`, `payments.collect`, `cash_registers.view|operate|manage`, `returns.view|create|approve|manage`, `expenses.view|manage`, `loyalty.view|manage` (Cashier: operate registers, request returns, collect payments).
- Demo data: two registers, the cashier's open shift, return reasons, expense categories, an enabled loyalty program, a customer payment and an expense.
- Frontend:
  - **Cash registers** (`/cash-registers`): registers per branch with their open session, add/edit (managers), open a session with a counted float; session list with variance badges; X/Z report page (cash reconciliation, by method, by transaction type, entries) with cash in/out and close-with-count (live variance preview).
  - **POS terminal:** register-session bar (number, expected cash, cash in/out, close); without a session the till asks to open one before taking payment; loyalty points as a payment method for the selected customer (whole points, minimum redemption, “Use points” fills the affordable amount).
  - **Returns** (`/returns`): “Return items” on the invoice → per-line quantities or serials, restock switch defaulting from the reason, server preview of value and settlement (credit against the balance, refund due), refund split over the methods the invoice allows (card/mobile/points capped, rest in cash); approvers complete at once, others send for approval; return document with approve (refunds) / reject; return reasons tab. The invoice lists its returns and hides “Cancel sale” once it has any.
  - **Payments** (`/payments`): payments ledger with period, direction, method and type filters, totals, links to sales, returns and sessions; customer payments list.
  - **Customers:** account sheet per customer — running statement with “Receive payment”, loyalty points with history and manual adjustment; points column.
  - **Expenses** (`/expenses`): expenses and other income with period/category filters, totals by category, new entry (cash through the caller's session), void; categories tab.
  - **Loyalty** (`/loyalty`): program rules with a worked example.
  - Every money-moving mutation (checkout, cancellation, return, collection, expense) refreshes the ledger, register sessions, customer accounts and points.
- Tests: 240 backend tests (2 PostgreSQL-only skipped on SQLite) — new `CashRegisterTest`, `SaleReturnTest`, `CustomerPaymentTest`, `ExpenseTest`, `LoyaltyTest`, `ReturnShareTest`, `PointsRuleTest`; 87 Vitest tests (new: refunds and points arithmetic, partial return with immediate card refund, return sent for approval, approval with credit and cash refund, till asks for a register session, X→Z report close with variance, expense blocked without a session then paid by bank); 6 Playwright smoke tests; 6 full-stack Playwright tests (new: a cashier requests a return, the owner tops up the drawer and approves it with a cash refund out of the shift).

#### Changed
- **Every POS checkout needs the cashier's open register session** in the store's branch (`CASH_SESSION_REQUIRED`); cash refunds, cancellations, collections and expenses go through the user's drawer and cannot take it below zero (`INSUFFICIENT_CASH`).
- Cancelling a sale writes ledger reversals, reverses loyalty points, and is refused once the sale has returns (`SALE_HAS_RETURNS`).
- The sale document lists its returns and per-line returned quantities.
- `Idempotency-Key` is now also required on returns, return approvals, customer payments, expenses and cash movements.

### UI theme refresh

#### Changed
- New visual theme for the SPA, light and dark: purple top bar with brand and branch switcher over a fixed white icon sidebar (uppercase entries, highlighted active icon), grey page canvas, flat cards with hairline shadow and uppercase titles, tinted table headers, soft status badges (Active/Completed/Received in green, partially received and low stock in amber, in transit in cyan), Plus Jakarta Sans font (replaces Geist).
- Sales summary cards show the value in the primary colour with a round icon.
- Sign-in pages use the same top bar and canvas.

### Phase 5 — POS terminal and sales processing

#### Added
- **Sales module:** immutable sale invoices numbered per branch (`INV-{BRANCH}-000001`, prefix from organization settings) with product snapshots, cost of goods, batch allocations, serial numbers and payments; `SaleCalculator` (item and invoice discounts as percent or amount, exact allocation of invoice discounts, tax-inclusive and tax-exclusive pricing with per-line rounding); `PaymentSettlement` (split payments, change from cash only, partial payments leaving a due); customer credit limits under a per-customer lock; discount rules (`sales.discount`, product max. discount %, automatic customer group discount); cancellation (restock to the exact batches, negative payment reversals, serials released, audited); sales history with filters; daily sales summary with payments by method; customer balances.
- **POS module:** product grid with stock of the selling store, barcode/SKU lookup, live server pricing of the cart, held (parked) carts per branch, idempotent checkout that also consumes a resumed held cart.
- **Shared idempotency:** `idempotent` route middleware and `idempotency_keys` table (replay of successful responses, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_REQUEST_IN_PROGRESS`, `IDEMPOTENCY_KEY_REQUIRED`), pruned daily by the scheduler.
- Inventory: first-expiry-first-out batch allocation inside the stock ledger (expired batches are never sold), `StockLevels` contract for availability, movement type `sale_cancellation`.
- Directories: `CustomerDirectory` (Customers), `CatalogDirectory::categoryWithDescendants`, `ProductDirectory::sellablePage` and `max_discount_percent`, `BranchDirectory::profile` and store `branch_code`, `OrganizationDirectory` document settings, `UserDirectory::names`.
- Permissions: `pos.sell`, `sales.view`, `sales.discount`, `sales.credit`, `sales.cancel` (Cashier: `pos.*`, `sales.view`; Branch Manager: `pos.*`, `sales.*`).
- Demo sales seeder (a walk-in cash sale with change and a wholesale customer on account).
- Frontend: POS terminal (scan field, categories and product grid with stock, cart with quantity steppers, line and invoice discounts, serial capture, customer picker with credit position, held sales, recent sales, payment dialog with split/partial payments and change, receipt preview and printing for 58 mm / 80 mm thermal and A4, shortcuts F2/F4/F8/F9, cart persisted per branch, idempotency key reused on retry), Sales pages (daily summary, history, invoice detail with receipt and cancellation), customer balances on the Customers page.
- Tests: 217 backend tests (2 PostgreSQL-only skipped on SQLite); 74 Vitest tests; 6 Playwright smoke tests; 5 full-stack Playwright tests (new: a cashier scans, takes cash and the sale reaches stock and history).

#### Changed
- Users land on the POS terminal when they may sell (first navigation entry), otherwise on the first page their role may open.
- The stock ledger reports per-batch allocations for every change.

### Phase 4 — Purchasing and inventory

#### Added
- **Inventory module:** `StockLedger` as the single write path for stock — row-locked `stock_levels` projection (deterministic lock order, insert-if-missing then `FOR UPDATE`, availability checked after the lock), append-only `stock_movements` ledger with `balance_after` (PostgreSQL trigger + model guard), weighted average cost at 4 decimals, per-branch negative-stock setting (`INSUFFICIENT_STOCK` otherwise), batches with expiry (`BATCH_EXPIRY_MISMATCH`), untracked products and services skipped.
- Stock adjustments (`ADJ-`; opening, count, damage, expiry, theft, correction, other — with sign rules per reason), two-step stock transfers between any active stores (`TRF-`; dispatch at source average cost, receive or cancel), stock list with low-stock filter, batch/expiry list, movement history, valuation (cost-gated).
- **Purchasing module:** purchase orders (`PO-`; draft → ordered → partially received → received, cancel), goods receipts that are the supplier invoice (`GRN-`; stock in + payable in one transaction, against an order or standalone, open-quantity cap, duplicate supplier-invoice guard, due date from payment terms), purchase returns limited to the returnable quantity at original cost and batch (`PRN-`), supplier payments (`SPAY-`), supplier balances and running statements computed from documents. All totals computed server-side with `Money`/`Decimal`.
- **Notifications module:** in-app inbox (`/notifications`, unread count, mark read / all read). First notification: low stock — `StockFellBelowReorderLevel` is dispatched after commit and a queued listener notifies users with `inventory.view` for the branch.
- Shared: `Decimal` helper (BCMath, fixed scales) and `Money::ofProduct()`; directory contracts `ProductDirectory`, `UserDirectory`, `BatchDirectory`; `BranchDirectory::store()/storeSummaries()`; `TenantUnique::withMessage()`.
- Demo stock seeder (opening stock, an open purchase order, a posted receipt).
- Frontend: Inventory area (Stock with low-stock filter, Batches & expiry, Movements, Adjustments, Transfers with receive/cancel), Purchasing area (orders with draft/place/cancel, receive goods against an order with open quantities pre-filled, receipts with returns, purchase returns, supplier payments), supplier balances and statement sheet on the Suppliers page, notification bell, reusable product-lines editor (product search/scan picker, batch picker, signed quantities), exact decimal comparison/subtraction (`compareDecimal`, `subtractDecimal`) so quantities never touch floats.
- Tests: 179 backend tests (2 PostgreSQL-only lock tests skipped until PostgreSQL is configured); 63 Vitest tests; 6 Playwright smoke tests; 4 full-stack Playwright tests (new: receiving a purchase order moves stock 60 → 156 and the supplier balance).

#### Changed
- Accountant role gains `purchases.pay` (supplier payments).
- Suppliers page shows the balance owed (with `purchases.view`) instead of the opening balance.
- Mobile header: brand hidden below `sm` and branch switcher narrower so the notification bell, theme and account buttons stay reachable.

#### Deferred
- Serial-number capture (products can already be flagged `track_serials`): with the POS in Phase 5, where serials are scanned at sale time.

### Phase 3 — Products, catalog, suppliers and customers

#### Added
- **Catalog module:** categories (tree, max 4 levels, cycle protection), brands, units of measure with one-level conversion (box = 12 pcs), tax rates; case-insensitive uniqueness per organization; deletion refused with `IN_USE` while referenced.
- **Products module:** products with variants (options x values matrix), SKUs (auto-numbered when blank), multiple barcodes per variant with GS1 check-digit validation, purchase/selling/wholesale prices as NUMERIC, reorder level, max item discount, stock/batch/serial tracking flags, services, images (JPEG/PNG/WebP, random names, max 8), archive/restore, barcode/SKU lookup for the till, search by name/SKU/barcode. Price changes are audited with before/after values. Cost prices only for `products.view_cost`.
- **Suppliers module:** supplier master data with auto codes, payment terms, opening balance, archive/restore.
- **Customers module:** customers with auto codes, normalised unique phone numbers, groups with default discount, credit limit and opening balance (only with `customers.manage`; cashiers can register customers at the till), archive/restore with phone-conflict detection.
- Shared: `SequenceGenerator` (gap-free per-organization numbers), `TenantUnique` validation rule, `ReferentialIntegrity` helper, `409 CONFLICT` for unique-index races, paginated responses with per-item presenters.
- Demo catalogue seeder.
- Frontend: Products list (search incl. barcode scan, category filter, archived view with restore), product editor (details, stock tracking, variant generator, per-variant prices/barcodes, nested server errors, images), Catalog page (category tree, brands, units, tax rates), Suppliers and Customers pages (incl. customer groups), exact decimal-string money formatting, multipart uploads, route-level code splitting (main bundle 847 kB to 533 kB).
- Tests: 148 backend tests; 44 Vitest tests; 6 Playwright smoke tests; 3 full-stack Playwright tests (now including product creation and cost-price hiding).

#### Changed
- Accountant role gains product (incl. cost) visibility and tax-rate management; Cashier gains product view and customer registration.
- Users land on the first page their role may open (Products for most roles).

### Phase 2 — Authentication, authorization, organizations and branches

#### Added
- **Organizations module:** organizations (tenants) with profile, timezone, tax mode (inclusive/exclusive), receipt settings and immutable base currency; one-transaction provisioning (organization → main branch + main store → built-in roles → first admin); `tenant` middleware resolving organization and `X-Branch-Id`, rejecting inactive users and suspended organizations on every request; platform-admin API to list, provision, suspend and reactivate organizations.
- **Branches module:** branches with trading flags (`allow_negative_stock`), stores/warehouses per branch, `BranchDirectory` contract; guard against deactivating the last active branch.
- **Users module:** UUID users, organization-scoped roles, code-declared permission catalog (`PermissionRegistry`, `pos:permissions:sync`), five built-in roles defined by permission patterns, custom roles, branch membership; guards against self lock-out, losing the last active Organization Admin, and privilege escalation (no granting permissions you lack, no editing more powerful users).
- **Authentication module:** Sanctum SPA cookie login, device tokens with expiry, self-service sign-up, password forgot/reset (links to the SPA) and change, logout per credential, login activity for every attempt, `auth` rate limiter, enumeration-resistant failures.
- **Audit module:** append-only `audit_logs` with before/after diffs, secret redaction, request id and IP; audit and login-activity APIs.
- Shared kernel: `TenantContext`, `BelongsToOrganization` (tenant scope + stamping), `TracksAuthor`, `AuditTrail` and `TenantUser` contracts, `ListQuery` (search/sort/pagination), `Changes` diff helper.
- Development seeder (platform admin, demo organization admin and cashier).
- Frontend: session bootstrap via `/auth/me`, route guards (auth, guest, permission, platform), sign-in / sign-up / forgot / reset pages, branch switcher sending `X-Branch-Id`, permission-filtered navigation, account menu; pages for Branches (+ stores), Users, Roles & permissions, Organization settings, Audit log, Profile & security (password, devices, sign-in history) and platform Organizations.
- Tests: 98 backend tests (incl. tenant isolation, RBAC, lock-out guards, auth flows); 26 Vitest tests; 6 Playwright smoke tests; opt-in full-stack Playwright spec against a real backend.

#### Changed
- `ResolveTenant` runs before route-model binding (middleware priority) so bound models are tenant-scoped.
- Users table moved into the Users module and switched to UUID primary keys; Sanctum tokens use UUID morphs.
- `.env.example`: `POS_*` settings.

#### Fixed
- Frontend no longer issues requests with a stale `X-Branch-Id` from a previous session; rendering waits until the active branch is valid.

### Phase 1 — Project setup and architecture

#### Added
- Backend: Laravel 13 on PHP 8.4 with Sanctum 4, Scramble (OpenAPI at `/docs/api`), Predis.
- Backend: modular monolith skeleton under `app/Modules` with an auto-wiring `ModuleServiceProvider` (module routes under `/api/v1`, module migrations).
- Backend shared kernel: `Money` value object on `BCMath\Number` (no floats, half-away-from-zero rounding, loss-free allocation), `BusinessRuleViolation`, unified `ApiResponse` envelope, `ApiExceptionRenderer`, `AssignRequestId` middleware (`X-Request-Id` on responses, logs and jobs).
- Backend: `GET /api/v1/health` reporting database and cache status (200/503) without leaking error details.
- Backend: API rate limiter (120/min per user or IP), Eloquent strict mode outside production.
- Backend: `Modules` PHPUnit suite; tests target PostgreSQL `pos_test`.
- Database: `database/scripts/create_local_databases.sql` to create role `pos_app` and databases `pos`, `pos_test`.
- Frontend: React 19 + Vite 8 + TypeScript 7 (strict, `noUncheckedIndexedAccess`), Tailwind CSS 4, shadcn/ui (Radix, Nova preset), React Router 8, TanStack Query 5, Zustand 5.
- Frontend: typed API client for the envelope (`ApiError` with codes/field errors, XSRF + idempotency headers), query client defaults, app shell with responsive sidebar, light/dark/system theme, loading/error/empty state components, system status page.
- Frontend tests: Vitest + Testing Library (12 tests), Playwright smoke specs on desktop and mobile viewports (6 tests).
- Documentation: README, ARCHITECTURE, MODULE_STRUCTURE, DATABASE_DESIGN, API_DOCUMENTATION, DEVELOPMENT_GUIDE, TESTING_GUIDE, DEPLOYMENT_GUIDE, AI_INTEGRATION, CHANGELOG.

#### Changed
- `.env.example` defaults to PostgreSQL, Predis and Sanctum SPA stateful domains.
