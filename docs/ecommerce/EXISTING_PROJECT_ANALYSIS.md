# Existing Project Analysis

E-commerce track, phase E1. Written 2026-10-31 against branch `phase-6-payments-returns` (commit `062fcf2` plus uncommitted Phase 6 work).

The goal of this document: record what the application already does, so the storefront is built **on** it instead of next to it.

## 1. Snapshot

| Area | Finding |
|------|---------|
| Product | Multi-organization, multi-branch **POS** (back-office + till). No public storefront, no customer self-service, no online orders. |
| Backend | Laravel 13.17, PHP 8.4 (composer allows `^8.3`), Sanctum 4, Scramble 0.13 (OpenAPI at `/docs/api`), predis 3. No other runtime packages. |
| Database | PostgreSQL 18 target. UUIDv7 keys, `NUMERIC` money, append-only ledgers with triggers, partial unique indexes. At the time of this analysis Phases 1–5 had only been verified on SQLite; *update 2026-11-11:* the full backend suite now runs and passes on PostgreSQL 18 (see README roadmap and CHANGELOG § PostgreSQL verification). |
| Frontend | One React 19.3 + TypeScript 7 (strict) SPA, Vite 8, React Router 8 (data router, lazy routes), TanStack Query 5, Zustand 5, React Hook Form 7 + Zod 4, Tailwind 4, shadcn/ui (Radix, pinned 4.21.5), lucide icons, sonner, cmdk. Plus Jakarta Sans self-hosted. |
| Tests | PHPUnit 12 (module suites in `app/Modules/*/Tests`), Vitest 5 + Testing Library, Playwright 1.64 (smoke + full-stack with `E2E_BACKEND=1`). |
| Architecture | Modular monolith: `backend/app/Modules/<Module>/{Domain,Application,Infrastructure,Presentation,Tests}`, contracts between modules, events after commit, `ApiResponse` envelope, `/api/v1`. See `docs/ARCHITECTURE.md`. |
| Work in progress | POS Phase 6 (payments ledger, cash registers, returns, receivables, expenses, loyalty): backend done, frontend being finished by another session in the same working tree. Nothing committed since Phase 5. |

## 2. Backend modules today

| Module | What it owns | Relevance to e-commerce |
|--------|--------------|-------------------------|
| Shared | `Money` (BCMath), `Decimal`, `ApiResponse`, exception renderer, request id, `ModuleServiceProvider`, `TenantContext`, `BelongsToOrganization` scope, `TracksAuthor`, `PermissionRegistry`, `ListQuery`, `SequenceGenerator`, idempotency middleware | Reused as-is by every new module. |
| System | `/health` | — |
| Audit | Append-only `audit_logs`, `AuditTrail` contract | Reused for all admin changes (theme, menus, prices, orders). |
| Organizations | Organizations (slug, currency, timezone, `tax_mode`, settings jsonb), `ResolveTenant` middleware, provisioning, platform admin | The storefront belongs to an organization; needs a public (unauthenticated) way to resolve it. |
| Branches | Branches, stores/warehouses (`type store|warehouse`), `allow_negative_stock` | Online orders need a fulfilment store. "Warehouse management" already exists here. |
| Users | Staff users, org-scoped roles, code-declared permissions, branch membership, escalation guard | Admin panel permissions for every new module. Customers must **not** become `users`. |
| Authentication | Sanctum SPA cookie login (`web` session guard), device tokens, org sign-up, password reset, login activity, `throttle:auth` | Pattern to copy for a separate customer guard. |
| Catalog | Categories (tree, `MAX_DEPTH = 4`), brands, units, tax rates, `CatalogDirectory` | Storefront categories and brands. Missing: slugs, images/banners, SEO, visibility on the web. |
| Products | Products → variants (SKU, `purchase_price`/`selling_price`/`wholesale_price`, `option_values` jsonb), barcodes, images (public disk), archive/restore, `ProductDirectory` | The sellable unit for the web is the variant. Missing: slug, publication, featured flags, SEO, specs, compare-at price, per-variant images. |
| Suppliers | Supplier master | Not customer-facing. |
| Customers | Customers (code, phone unique per org, email, address text, group, credit limit), customer groups with discount % | The shopper's commercial identity. Missing: login credentials, structured addresses. |
| Inventory | `stock_levels` projection + append-only `stock_movements`, `StockLedger` (the only stock write path, sorted `FOR UPDATE`), batches/expiry, adjustments, transfers, WAC valuation, low-stock event | Online orders post stock through `StockLedger` — no second stock system. |
| Purchasing | POs, goods receipts, purchase returns, supplier payments | Untouched. |
| Pos | Terminal API, `held_sales`, idempotent checkout → Sales | Untouched. Its pricing flow is the model for web pricing. |
| Sales | Invoices (immutable), `SaleCalculator` (inclusive/exclusive tax, discount allocation), `CartPricer`, `PaymentSettlement`, cancellations, returns, customer payments, `LoyaltyProgram` contract | `SaleCalculator`/`CartPricer` logic must be reused for web totals so POS and web agree to the cent. |
| Payments (Phase 6) | Payments ledger (`PaymentLedger`), cash registers, sessions | Online payments must land in this ledger. Its contract today requires a staff actor (`TenantUser`) and a drawer session for cash. |
| Expenses, Loyalty (Phase 6) | Expenses/income; points ledger | Loyalty can later earn on web orders through the same contract. |
| Notifications | Database-channel inbox for staff | Needs mail (and later SMS) for customers. |

## 3. API and conventions

- Versioned under `/api/v1`, routes auto-mounted per module. Every response uses the `ApiResponse` envelope; errors carry machine codes (`VALIDATION_FAILED`, `INSUFFICIENT_STOCK`, `IDEMPOTENCY_KEY_REUSED`, …).
- Authenticated staff routes use `auth:sanctum` + `tenant` + `can:<permission>`. Branch context via `X-Branch-Id`.
- List endpoints follow `ListQuery` (`?search`, `?sort`, `?page`, `?per_page`, whitelisted columns).
- Rate limiters: `api` (120/min), `auth` (per account+IP and per IP).
- Idempotency: `idempotent` middleware with `Idempotency-Key` on every money-moving POST.
- **No public (unauthenticated) business endpoints exist.** Every tenant query relies on the organization coming from the logged-in user.

## 4. Frontend today

- `frontend/src/app/routes.tsx`: all pages lazily loaded; guards `RequireAuth`, `GuestOnly`, `RequirePermission`, `RequirePlatformAdmin`. The admin app owns `/` and `/login`.
- `features/<module>/{api.ts,pages,components}`; server state only through query hooks; Zustand for theme, session and the POS cart.
- Visual theme: purple top bar + icon sidebar, CSS variables in `src/index.css`, light/dark.
- Navigation only lists modules backed by working endpoints (project rule).
- Vite proxies `/api`, `/sanctum`, `/storage` to Laravel so cookie auth is same-origin.
- One HTML entry (`index.html`), client-rendered only — no SSR, no per-page meta tags.

## 5. Answers to the six questions

### 5.1 What already exists
Staff auth and RBAC, tenancy, audit, products with variants/barcodes/images, categories/brands, tax rates and inclusive/exclusive tax maths, multi-store inventory with a race-safe ledger, customers and groups, POS pricing and checkout, payments ledger, returns/refunds for POS invoices, loyalty, staff notifications, idempotency, OpenAPI, test suites at every level.

### 5.2 What is missing (for the requested storefront)
Public storefront API and tenant resolution without login · customer accounts (guard, registration, password reset, addresses) · web publication data for products/categories/brands (slugs, SEO, visibility, schedule, featured, specs, compare-at prices, variant images) · attribute dictionary for filters/swatches · faceted search · carts (guest + customer) and wishlists · coupons, promotions, flash sales · shipping zones/methods/rates and Bangladesh geography · online orders, fulfilment, shipments, order returns/refunds · online payment gateways (COD, SSLCommerz, bKash, Nagad, bank transfer) with webhooks · reviews · CMS pages, blog, FAQ, contact form, newsletter · media library · theme settings, menus, banners/sliders, homepage builder · SEO (meta, OG, JSON-LD, sitemap, robots) · Bangla localization · customer e-mail/SMS notifications · storefront UI itself · AI module (already planned as POS Phase 8).

### 5.3 What can be reused unchanged
`Money`/`Decimal`, envelope, exception renderer, `ListQuery`, `SequenceGenerator`, idempotency middleware, `AuditTrail`, `PermissionRegistry` + roles, `StockLedger` (with new movement types), `CatalogDirectory`/`ProductDirectory`, `SaleCalculator` (pure domain class), product image storage, shadcn primitives, query/form/test infrastructure, Playwright harness.

### 5.4 What needs modification (additive)
| Item | Change |
|------|--------|
| `PaymentLedger` | Accept a system actor (webhooks, scheduler) and non-drawer collections (COD remittance, gateway settlement); new `PaymentSource` types `online_order`, `online_order_refund`. |
| `StockLedger` movement types | Add `online_order`, `online_order_cancel`, `online_return`. |
| `CartPricer` | Extract the variant/price/tax loading so a web pricer can share it; today it takes a staff `TenantUser` and a POS store. |
| Organizations | Web settings (fulfilment store, storefront enabled) — new table, not new columns on `organizations`. |
| Customers | Structured addresses table; link to customer accounts. |
| Auth config | Second guard `customer` (session) and broker `customers`. |
| Frontend | Second Vite entry for the storefront; admin app moves under `/admin` (see ARCHITECTURE_ANALYSIS D7). |
| Notifications | Mail channel for customers. |

### 5.5 New modules required
`Storefront` (site config: domains, theme, menus, banners, homepage sections), `OnlineCatalog` (publication data + public catalog read API + facets), `CustomerAccounts`, `Cart` (carts + wishlists), `Promotions`, `Shipping`, `Orders`, `OnlinePayments`, `Reviews`, `Cms`, `Media`. Reports and AI are already on the POS roadmap (Phases 7–8) and get e-commerce scope added. Rationale and boundaries in ARCHITECTURE_ANALYSIS.md.

### 5.6 Potential breaking changes
| Risk | Impact | Mitigation |
|------|--------|------------|
| Admin SPA moves from `/` to `/admin` | Bookmarks, e2e specs, reset-password links in e-mails | Redirect old paths; update e-mail URL builder and Playwright base paths in the same change. |
| Second auth guard on the same cookie domain | A customer session must never satisfy staff `auth:sanctum` routes | Keep `sanctum.guard = ['web']`; storefront account routes use `auth:customer` only; isolation tests both ways. |
| Public endpoints bypass the login-derived tenant | Cross-tenant leakage if org resolution is wrong | One `ResolveStorefront` middleware sets `TenantContext` from the request host; the global scope then applies; isolation tests per endpoint. |
| `PaymentLedger` contract change | Phase 6 callers (Sales, Expenses) | Additive method/parameter only; existing signature unchanged. |
| New stock movement types | Reports/filters that switch over `MovementType` | Enum cases only (column is a plain string, verified in E3); ledger trigger untouched. |
| Idempotency for non-staff callers | `idempotency_keys.user_id` is a NOT NULL FK to `users` | Scope column + new unique key (ADR-014); existing idempotency tests must stay green. |
| Product changes for the web | POS reads products | Web data lives in new 1:1 tables owned by `OnlineCatalog`; `products` gets no web columns. |
| Concurrent work | Phase 6 uncommitted in the same tree | Start e-commerce code only after Phase 6 is committed, on its own branch. |

## 6. Gaps in the current baseline to close first

1. **PostgreSQL verification of Phases 1–6.** The storefront leans on PG-only features (`jsonb` containment for facets, `pg_trgm` search, triggers). Tests must run on PG before e-commerce migrations land. *Closed late, on 2026-11-11:* the full suite now passes on PostgreSQL 18 (CHANGELOG § PostgreSQL verification).
2. **Commit Phase 6** so the e-commerce branch starts from a clean, reviewed base.
3. **Redis** is optional locally; storefront caching works with the `database`/`file` cache store in dev, Redis in production.
