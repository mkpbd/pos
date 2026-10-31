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

Storefront pages: `/` (homepage), `/shop`, `/search?q=`, `/category/{slug}`, `/brand/{slug}`, `/product/{slug}`, `/pages/{slug}` — e.g. http://localhost:5173/shop and http://localhost:5173/product/pran-mango-juice-250ml on the seeded Demo Mart.

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
| E7 | Customer accounts, cart, wishlist | ☐ |
| E8 | Checkout, orders, payments, shipping, promotions | ☐ |
| E9–E14 | Account area, admin operations, CMS depth, SEO/localization, AI, hardening | ☐ |
