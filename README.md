# Enterprise POS

Multi-organization, multi-branch point-of-sale platform: **Laravel 13** REST API (modular monolith, PostgreSQL 18, Redis) and a **React 19 + TypeScript** SPA (Vite, Tailwind, shadcn/ui, TanStack Query, Zustand).

Correctness of sales calculations, inventory consistency and financial integrity come first: all totals are computed on the server with arbitrary-precision decimals inside database transactions, ledgers are append-only, and checkout/payment requests are idempotent.

## Repository layout

```
backend/    Laravel API — business modules in app/Modules/*
frontend/   React SPA — features in src/features/*
docs/       Architecture, database, API, guides
```

## Quick start

See [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) for prerequisites and details. The backend requires **PHP 8.4** (`composer.json`: `php ^8.4`). PDF exports also need Node.js ≥ 22.12, `PUPPETEER_SKIP_DOWNLOAD=1 npm ci` in `backend/pdf-renderer` and a Chrome/Chromium (locally Playwright's).

```powershell
# one-time: create role pos_app and databases pos / pos_test
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -f backend\database\scripts\create_local_databases.sql

cd backend;  composer install; copy .env.example .env; php artisan key:generate; php artisan migrate; php artisan serve
cd frontend; npm install; npm run dev     # admin http://localhost:5173/admin, storefront http://localhost:5173/
```

Storefront pages: `/` (homepage), `/shop`, `/search?q=`, `/category/{slug}`, `/brand/{slug}`, `/product/{slug}`, `/pages/{slug}`, `/blog`, `/blog/category/{slug}`, `/blog/{slug}`, `/cart`, `/wishlist`, `/checkout`, `/order/{number}`, `/account` (sign-in, registration, profile, addresses, orders, reviews, returns) — e.g. http://localhost:5173/shop and http://localhost:5173/product/pran-mango-juice-250ml on the seeded Demo Mart.

Seeded logins (`php artisan migrate:fresh --seed`, all with password `password`): back office `admin@pos.test` (platform admin), `owner@demo.test` (organization admin), `cashier@demo.test`; storefront shopper `shopper@demo.test` (verified, one saved address, one wishlist item) at http://localhost:5173/account/login. The demo store delivers everywhere ("Inside Dhaka" / "Outside Dhaka" zones) and takes cash on delivery and bank transfer; placed orders appear under *Web orders* in the admin. Demo promotions (*Promotions* in the admin): the flash sale "Juice week" (10 % off Pran products for 7 days after seeding, shown in the homepage's *Hot deals* section), the coupon `WELCOME50` (50 off orders from 500, once per customer) and free delivery over 3000. The demo shopper has three orders under *Orders* in the storefront account area: `WEB-000001` (delivered, with a published 5-star review of Pran Mango Juice), `WEB-000002` (confirmed cash on delivery, still cancellable) and `WEB-000003` (cash on delivery, shipped with Steadfast and in transit); reviews are moderated under *Reviews* in the admin. Couriers Pathao (with a tracking link), Steadfast and RedX are set up under *Online store → Shipping → Couriers*; once `WEB-000003` is marked delivered (*Add tracking update* on the order) it appears under *COD to collect* on the *Web orders* board and can be settled under *COD remittances*. Online returns are accepted for 7 days after delivery (`return_window_days`, set through `PATCH /storefront/settings`): `WEB-000001` can be returned from the shopper's order page (*Return items*); the request appears under *Web returns* in the admin (approve → goods received → refund) and the shopper sees it under *Returns* in the account area. A paid order that is not delivered yet can be cancelled with a full refund from its page in the admin (*Cancel* → refund method; needs `web_orders.refund`). The demo blog (*Content → Blog* in the admin) has the categories *Recipes* and *Store news*, four published posts and one scheduled a week ahead; it is linked as *Blog* in the main menu (http://localhost:5173/blog) and teased in the homepage's *From our blog* section. A popup banner "Free delivery over ৳3000" is seeded **inactive** (switch it on under *Online store → Banners → Popup*). Bank-transfer orders are cancelled when their hold runs out only while the scheduler runs (`php artisan schedule:work`). The demo store is bilingual (English default, Bangla on, Latin digits): the header's *English / বাংলা* switcher (in the mobile menu on small screens) shows the store in Bangla — e.g. http://localhost:5173/?lang=bn — with Bangla category, brand and menu names, five translated products (e.g. *Pran Mango Juice*), banners, homepage section titles, About us / FAQ / Contact, two blog posts, the delivery methods and cash on delivery; untranslated content shows in English. Languages are set under *Online store → Settings → Languages*; Bangla texts are entered in each editor's *বাংলা (Bangla)* section.

Exports: 37 admin list screens (sales, returns, payments, expenses, inventory, purchasing — incl. supplier catalog and reorder suggestions (SC1), requisitions, RFQs and the approvals inbox (SC2), landed cost vouchers and supplier performance (SC3) — and statements, products, customers, suppliers, web orders and returns, COD remittances, promotions, reviews, contact messages, newsletter, users, audit log) have an *Export* button — *Excel (.xlsx)* or *PDF* of every row matching the current filters, search and sort, with the organization letterhead on PDFs (Bangla text included). The API equivalent is `?export=xlsx|pdf` on the list endpoint ([API_DOCUMENTATION.md § Exports](docs/API_DOCUMENTATION.md#exports-x1)).

Supply chain (SC1): each supplier has a *Catalog* (supplier page → *Catalog*: supplier SKU, unit cost, pack size, minimum order, lead time, one preferred supplier per product; the last purchase cost is filled in by goods receipts), products have per-store *Reorder rules* (min / max) and their suppliers on the product page, and *Inventory → Settings* holds the replenishment settings (central source store, coverage, sales-history and safety days). *Purchasing → Reorder* lists what each store needs from stock, open orders, transfers in transit and sales velocity, and turns the selection into draft purchase orders (one per supplier) or a replenishment transfer from the source store; the purchase order editor prefills catalog costs and pack hints. Purchasing staff get a daily in-app *Reorder needed* alert per store while the scheduler runs. Demo data: Pran sells the mango juice in cartons of 24 (preferred, 3 days), Local Mills the Miniket rice in 25 kg sacks (preferred, minimum 50, 2 days), Pran the rice as an alternative; the main store has rules for juice, rice and the M polo shirt, so a fresh seed suggests buying 144 juices from Pran, 300 kg rice from Local Mills and 18 polo shirts (no supplier). The demo has one store, so no source store is set and nothing is suggested for transfer.

Requisitions and quotes (SC2): branch staff raise *Purchasing → Requisitions* (or *Raise requisition* on the Reorder page, without `purchases.manage`); the estimated total decides who approves — up to 10 000.00 nobody (approved on submit), up to 100 000.00 a manager (`purchases.approve`), above that `purchases.approve_high` — and nobody approves their own document. Approvers work from *Purchasing → Approvals*; approved requisitions are converted into draft purchase orders per supplier (pre-approved for the approved amount + 5 %) and/or a request for quotation. Purchase orders above the auto-approve limit wait for approval after *Save & submit*. *Purchasing → RFQs* invites suppliers, sends a PDF per supplier (e-mailed when the supplier has an address — needs the queue worker), records the quotes staff enter, compares them line by line (lowest price, fastest, totals, coverage) and awards lines (split allowed) into draft purchase orders, optionally updating the supplier catalog. Limits are set under *Purchasing → Settings*. Demo data: `PR-000001` by the cashier (16 036.00, waiting for manager approval in the owner's inbox), `PR-000002` approved and converted into the draft, pre-approved `PO-000002` (Local Mills), and `RFQ-000001` (polo shirts) sent to Pran and Local Mills with Pran's quote recorded.

Landed cost and supplier performance (SC3): the goods receipt editor has a *Charges* section (freight, duty, insurance, handling, other; spread over the lines by value or quantity, optionally billed by another supplier) and shows the landed unit cost per line before posting — stock enters at that cost. Bills that arrive after the goods are entered under *Purchasing → Landed costs* as landed cost vouchers against posted receipts of one branch: the preview shows how much goes into the cost of stock still on hand and how much is expensed for stock already sold; posting raises the average cost, books the rest as an expense on the supplier's account and adds the bill to that supplier's balance. *Purchasing → Supplier performance* scores suppliers 0–100 on on-time delivery, fill rate, returns, price changes and quote responses (default the last 90 days; *Export*), and each supplier page has a *Performance* tab with a 12-month trend and late or short deliveries. Needs `purchases.landed_cost` for vouchers (Branch Manager, Inventory Manager, Accountant, Organization Admin). Demo data: *Dhaka Apparel Sourcing* delivered `PO-000003` late and short as `GRN-000002` (polo shirts L and XL, with sea freight billed by *Sundarban Freight Services* and handling on the invoice; 2 XL returned as `PRN-000001`) and `PO-000004` on time as `GRN-000003`; `LCV-000001` (800.00 customs duty from Sundarban on `GRN-000002`) is posted — 720.00 into stock, 80.00 expensed as `EXP-000002` for the returned shirts — so the scorecard lists Dhaka Apparel Sourcing below 100.

## Documentation

| Document | Contents |
|----------|----------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, module communication, tenancy, auth, transactional rules, risks |
| [MODULE_STRUCTURE.md](docs/MODULE_STRUCTURE.md) | Module template, boundaries, module map |
| [DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) | Conventions, entities per phase, indexing, concurrency |
| [API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) | Envelope, error codes, headers, endpoints |
| [DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) | Setup, commands, coding standards |
| [TESTING_GUIDE.md](docs/TESTING_GUIDE.md) | Test suites, coverage matrix, definition of done |
| [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) | Production topology, release steps, security checklist |
| [AI_INTEGRATION.md](docs/AI_INTEGRATION.md) | Optional, provider-independent, read-only AI module |
| [CHANGELOG.md](CHANGELOG.md) | Changes per phase |

## Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Project setup, architecture, shared kernel, docs | ✅ (PostgreSQL run pending) |
| 2 | Authentication, RBAC, organizations, branches, audit trail | ✅ (PostgreSQL run pending) |
| 3 | Products, categories, brands, units, suppliers, customers | ✅ (PostgreSQL run pending) |
| 4 | Purchasing and inventory | ✅ (PostgreSQL run pending) |
| 5 | POS terminal and sales processing | ✅ (PostgreSQL run pending) |
| 6 | Payments, returns, refunds, cash register, expenses, loyalty | ✅ (PostgreSQL run pending) |
| 7 | Reports and dashboard analytics | ☐ |
| 8 | AI features | ☐ |
| 9 | Test hardening, security review, performance | ☐ |
| 10 | Production deployment and documentation | ☐ |

### Online store (e-commerce track)

BerryKid-inspired storefront on the same backend; plan, decisions and API in [docs/ecommerce/](docs/ecommerce/ECOMMERCE_IMPLEMENTATION_PLAN.md).

| Phase | Scope | Status |
|-------|-------|--------|
| E1–E3 | Project analysis, reference investigation, architecture and database plan | ✅ |
| E4 | Storefront shell: host-based storefronts, theme, menus, media library, storefront layout, admin under `/admin` | ✅ (PostgreSQL run pending) |
| E5 | Content and homepage builder: banners, homepage sections, content pages, FAQ, contact form, newsletter | ✅ (PostgreSQL run pending) |
| E6 | Online catalog and product pages: web listings, attributes, shop/category/brand/search pages with faceted filters, product page with variants, related products, catalog homepage sections | ✅ (PostgreSQL run pending) |
| E7 | Customer accounts, cart, wishlist: sign-up/sign-in on a separate shopper guard, e-mail verification, password reset, profile, address book with Bangladesh divisions/districts, guest and customer carts repriced on every read with merge at sign-in, mini-cart and cart page, wishlist | ✅ (PostgreSQL run pending) |
| E8a | Shipping zones and methods by district, checkout (guest or signed-in) with server preview and idempotent placement, web orders that take stock once from the fulfilment store, cash on delivery and bank transfer, order confirmation page and e-mail, admin web orders with payment confirmation, shipping, delivery, cancellation with restock, expiry of unpaid orders | ✅ (PostgreSQL run pending) |
| E8b | Promotions (web only): automatic product, category, brand and order discounts, free delivery, coupon codes with usage limits, flash sales with countdown and a hot-deals homepage section, one server pricing path from product card to placed order, admin promotions with coupons and redemptions | ✅ (PostgreSQL run pending) |
| E8c | Online payment gateways (SSLCommerz, bKash, Nagad) — needs each provider's sandbox credentials | ☐ |
| E9 | Customer account area: order history and detail with tracking, cancel unpaid orders, buy again, product reviews from verified (delivered) purchases with staff moderation and a rating summary on the product page | ✅ (PostgreSQL run pending) |
| E10a | Fulfilment: couriers with tracking links, shipments with tracking updates, orders board with filters, counts and bulk processing, packing slip and invoice printing, returned parcels cancelled with restock, courier COD remittances that pay orders and book the courier fee | ✅ (PostgreSQL run pending) |
| E10b | Online returns and refunds (customer request within the return window, staff approval, receipt with restock to the original batches, refund through the payments ledger), customers' web activity on the customer card, promotion report, ratings on product cards and the *Top rated* sort | ✅ (PostgreSQL run pending) |
| E11 | CMS depth: blog with categories, scheduled posts, blog menu links and a homepage blog section; popup banner; cancelling a paid, undelivered web order with stock back and a full refund | ✅ (PostgreSQL run pending) |
| E12a | SEO and performance: JSON-LD structured data, meta / canonical / noindex rules, `robots.txt` and XML sitemaps served by the app, an *allow indexing* switch for staging stores, ETag and HTTP caching of public storefront reads, a versioned server cache invalidated on content writes, storefront indexes, client-side head tags, image loading priorities and code splitting | ✅ (PostgreSQL run pending) |
| E12b | Bangla storefront: typed English / Bangla UI dictionary on every storefront screen, language switcher (`?lang=`, `lang` cookie), Bengali fonts and optional Bengali digits, content translations with per-field English fallback for listings, pages, FAQ, blog, menus, banners, homepage sections, announcement, delivery and payment methods and promotions (admin "বাংলা (Bangla)" sections), search over Bangla names, hreflang / canonical per language and sitemap alternates, store language settings | ✅ (PostgreSQL run pending) |
| E13–E14 | AI, hardening | ☐ |

### Cross-cutting

| Phase | Scope | Status |
|-------|-------|--------|
| X1 | PDF and Excel export on every admin list (current filters, search and sort; all rows; row limits, audit, throttle; letterhead and Bangla fonts in PDFs); business dates validated in the organization's timezone | ✅ (PostgreSQL run pending) |

### Supply chain

| Phase | Scope | Status |
|-------|-------|--------|
| SC1 | Supplier catalog (costs, pack sizes, minimum orders, lead times, preferred supplier, last purchase cost from receipts), per-store reorder rules, replenishment settings, reorder suggestions from stock, open orders, transfers and sales velocity → draft purchase orders per supplier and replenishment transfers, daily reorder alert | ✅ (PostgreSQL run pending) |
| SC2 | Purchase requisitions with amount-based single-step approval (auto / manager / high limits, no self-approval), purchase order approval (`pending_approval`, pre-approval from requisitions), approvals inbox, requests for quotation (PDF per supplier, queued e-mail), staff-entered supplier quotes, comparison and split award into draft purchase orders, daily quotes-overdue reminder | ✅ (PostgreSQL run pending) |
| SC3 | Landed cost: charges on goods receipts allocated by value or quantity into the stock cost, landed cost vouchers for later bills (on-hand share revalues stock, sold share expensed on the supplier's account), charge payables on the billing supplier's account; supplier performance: on-time, fill, lead time, returns, price change, quote response, 0–100 score, monthly trend and late / short deliveries | ✅ (PostgreSQL run pending) |
