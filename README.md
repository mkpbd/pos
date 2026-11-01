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

See [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) for prerequisites and details.

```powershell
# one-time: create role pos_app and databases pos / pos_test
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -f backend\database\scripts\create_local_databases.sql

cd backend;  composer install; copy .env.example .env; php artisan key:generate; php artisan migrate; php artisan serve
cd frontend; npm install; npm run dev     # admin http://localhost:5173/admin, storefront http://localhost:5173/
```

Storefront pages: `/` (homepage), `/shop`, `/search?q=`, `/category/{slug}`, `/brand/{slug}`, `/product/{slug}`, `/pages/{slug}`, `/blog`, `/blog/category/{slug}`, `/blog/{slug}`, `/cart`, `/wishlist`, `/checkout`, `/order/{number}`, `/account` (sign-in, registration, profile, addresses, orders, reviews, returns) — e.g. http://localhost:5173/shop and http://localhost:5173/product/pran-mango-juice-250ml on the seeded Demo Mart.

Seeded logins (`php artisan migrate:fresh --seed`, all with password `password`): back office `admin@pos.test` (platform admin), `owner@demo.test` (organization admin), `cashier@demo.test`; storefront shopper `shopper@demo.test` (verified, one saved address, one wishlist item) at http://localhost:5173/account/login. The demo store delivers everywhere ("Inside Dhaka" / "Outside Dhaka" zones) and takes cash on delivery and bank transfer; placed orders appear under *Web orders* in the admin. Demo promotions (*Promotions* in the admin): the flash sale "Juice week" (10 % off Pran products for 7 days after seeding, shown in the homepage's *Hot deals* section), the coupon `WELCOME50` (50 off orders from 500, once per customer) and free delivery over 3000. The demo shopper has three orders under *Orders* in the storefront account area: `WEB-000001` (delivered, with a published 5-star review of Pran Mango Juice), `WEB-000002` (confirmed cash on delivery, still cancellable) and `WEB-000003` (cash on delivery, shipped with Steadfast and in transit); reviews are moderated under *Reviews* in the admin. Couriers Pathao (with a tracking link), Steadfast and RedX are set up under *Online store → Shipping → Couriers*; once `WEB-000003` is marked delivered (*Add tracking update* on the order) it appears under *COD to collect* on the *Web orders* board and can be settled under *COD remittances*. Online returns are accepted for 7 days after delivery (`return_window_days`, set through `PATCH /storefront/settings`): `WEB-000001` can be returned from the shopper's order page (*Return items*); the request appears under *Web returns* in the admin (approve → goods received → refund) and the shopper sees it under *Returns* in the account area. A paid order that is not delivered yet can be cancelled with a full refund from its page in the admin (*Cancel* → refund method; needs `web_orders.refund`). The demo blog (*Content → Blog* in the admin) has the categories *Recipes* and *Store news*, four published posts and one scheduled a week ahead; it is linked as *Blog* in the main menu (http://localhost:5173/blog) and teased in the homepage's *From our blog* section. A popup banner "Free delivery over ৳3000" is seeded **inactive** (switch it on under *Online store → Banners → Popup*). Bank-transfer orders are cancelled when their hold runs out only while the scheduler runs (`php artisan schedule:work`).

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
| E12b | Bangla storefront UI and content translations | ☐ |
| E13–E14 | AI, hardening | ☐ |
