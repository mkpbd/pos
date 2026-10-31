# Architecture

Enterprise POS is a **modular monolith**: one deployable Laravel application split into business modules with explicit boundaries, plus a React single-page application. There are no microservices.

```
┌──────────────────────────┐        HTTPS (same origin, /api/v1)        ┌────────────────────────────────────┐
│  React 19 SPA (Vite)     │ ─────────────────────────────────────────▶ │ Laravel 13 (PHP 8.4)               │
│  TanStack Query, Zustand │ ◀───────────── JSON envelope ───────────── │  app/Modules/*  (modular monolith) │
└──────────────────────────┘                                            └──────┬───────────┬────────────┬────┘
                                                                               │           │            │
                                                                        PostgreSQL 18    Redis      Queue workers /
                                                                        (system of       (cache,    scheduler
                                                                         record)          queues)
```

## 1. Guiding principles

1. **Correctness of money and stock first.** Every financial number is computed on the server with arbitrary-precision decimals, inside a database transaction, and persisted as `NUMERIC`.
2. **Business logic lives in the Domain and Application layers**, never in controllers, Form Requests, Eloquent models or React components.
3. **Modules talk through contracts and events**, not through each other's tables or models.
4. **Tenant isolation is enforced by the platform**, not remembered by each query.
5. **History is immutable.** Posted sales, ledgers and payments are never edited; corrections are new entries (returns, reversals, adjustments).
6. **The POS keeps working when optional parts fail** (AI provider, Redis-backed cache, notifications).

## 2. Backend layering (per module)

```
app/Modules/<Module>/
  Domain/            Entities, value objects, domain services, domain events, repository interfaces, rules.
                     Pure PHP. No Laravel facades, no HTTP, no Eloquent.
  Application/       Use cases (actions/services), DTOs, application-level contracts exposed to other modules.
                     Orchestrates domain + repositories inside transactions. Dispatches events.
  Infrastructure/    Eloquent models, repository implementations, migrations, external clients, listeners, jobs.
  Presentation/      HTTP controllers (thin), Form Requests, API Resources, Policies, routes (Routes/api.php).
  Tests/             Unit + Feature tests for this module.
  <Module>ServiceProvider.php   Binds contracts, registers events/policies. Extends ModuleServiceProvider.
```

Dependency direction: `Presentation → Application → Domain ← Infrastructure`. The Domain depends on nothing; Infrastructure implements Domain interfaces.

A request flows: **Route → Form Request (shape validation) → Controller → Application action (business validation, transaction) → Domain → Repository → API Resource → `ApiResponse` envelope**.

### Shared kernel (`app/Modules/Shared`)

Code every module may depend on. Kept small and stable.

| Component | Purpose |
|-----------|---------|
| `Domain/ValueObjects/Money` | Immutable money on `BCMath\Number`; rejects floats; half-away-from-zero rounding; loss-free `allocate()` for spreading discounts. |
| `Domain/Exceptions/BusinessRuleViolation` | Domain invariant failure → HTTP 422 with a machine-readable code. |
| `Infrastructure/Http/Responses/ApiResponse` | The only way controllers build responses (success, created, paginated, error). |
| `Infrastructure/Exceptions/ApiExceptionRenderer` | Maps every exception under `/api/*` to the error envelope; hides internals unless `APP_DEBUG`. |
| `Infrastructure/Http/Middleware/AssignRequestId` | Correlation id on every request, response header, log context and queued job context. |
| `Infrastructure/Providers/ModuleServiceProvider` | Base provider: auto-mounts `Presentation/Routes/api.php` under `/api/v1`, loads module migrations, registers the module's permissions. |
| `Application/Tenancy/TenantContext` | Request-scoped organization + active branch; `runAs()` for console/provisioning code. |
| `Infrastructure/Persistence/Concerns/BelongsToOrganization` | Global tenant scope + `organization_id` stamping for tenant-owned models. |
| `Infrastructure/Persistence/Concerns/TracksAuthor` | Fills `created_by` / `updated_by`. |
| `Application/Contracts/AuditTrail` | Append-only audit recording (implemented by the Audit module). |
| `Application/Contracts/TenantUser` | What tenancy needs from the authenticated user, without depending on the Users module. |
| `Application/Authorization/PermissionRegistry` | Catalog of permissions declared by modules. |
| `Infrastructure/Http/Queries/ListQuery` | `?search`, `?sort`, `?page`, `?per_page` conventions with whitelisted columns. |
| `Application/Support/Changes` | Before/after diff for audit entries. |

### Module registration

Each module has a `<Module>ServiceProvider` listed in `backend/bootstrap/providers.php`. Adding a module = create the folder, extend `ModuleServiceProvider`, register it there. See [MODULE_STRUCTURE.md](MODULE_STRUCTURE.md).

### Cross-module communication

| Need | Mechanism | Example |
|------|-----------|---------|
| Synchronous query/command | Interface in the provider module's `Application/Contracts`, bound in its service provider | Sales asks `Inventory\Application\Contracts\StockReservation` to deduct stock |
| React to something that happened | Domain event + listener in the consuming module | `SaleCompleted` → Loyalty awards points, Notifications alerts low stock |
| Reporting across modules | Read-only PostgreSQL views owned by the Reports module | `v_sales_by_day` |

| Orchestrating a use case that spans modules | Call the other module's `Application/Actions` (its public API) inside one transaction | `ProvisionOrganization` → `Branches\CreateBranch` + `Users\ProvisionSystemRoles` + `Users\CreateUser` |

Foreign keys across module tables are allowed (referential integrity matters more than purity), but a module never writes another module's tables and never imports another module's Eloquent models. Read access goes through directory contracts (`BranchDirectory`, `OrganizationDirectory`, `ProductDirectory`, `SupplierDirectory`, `UserDirectory`, `BatchDirectory`). Documented exceptions:

- the Authentication module operates on the Users module's `User` model (it is Laravel's auth model);
- `ProvisionOrganization` receives the `User` returned by the Users module's `CreateUser` action, and `pos:permissions:sync` (Users) iterates `Organization` rows — both are provisioning/maintenance paths, not request paths;
- **read models may join foreign tables read-only** when a directory round-trip would make a list unfilterable — e.g. `GET /inventory/stock` joins `product_variants` to filter by search text and reorder level. The join is confined to the presenting controller and never writes;
- model factories and tests may reference foreign models to build data.

### Permissions are declared by modules

Each module's provider returns its permissions from `permissions()` (e.g. `'users.manage' => 'Create users, …'`). They are collected in the in-memory `PermissionRegistry`, mirrored into the `permissions` table by `php artisan pos:permissions:sync`, and every registered permission is a Gate ability (`can:users.manage`, `$user->can('sales.void')`). Built-in roles are defined as glob patterns over the catalog (`products.*`), so permissions added by later phases flow into them on the next sync.

## 3. Multi-tenancy and data isolation

- **Model:** shared database, shared schema. Tenant-owned tables carry `organization_id`; branch-scoped tables also carry `branch_id`.
- **Tenant context:** the `tenant` middleware (`Organizations\…\ResolveTenant`) resolves the organization from the authenticated user (platform admins choose one with `X-Organization-Id`) and the active branch from `X-Branch-Id`, which must be an active branch of that organization the user may access (assigned, or holding `branches.access_all`). It also rejects deactivated users and suspended organizations on every request, so revocation is immediate even for live tokens. The context lives in the request-scoped `TenantContext` and is cleared when the request ends.
- **Ordering matters:** `ResolveTenant` is placed before `SubstituteBindings` in the middleware priority list (`bootstrap/app.php`), so route-model binding already runs under the tenant scope — `/users/{id}` of another organization is a 404, never a loaded model.
- **Enforcement:** the `BelongsToOrganization` trait adds a global scope filtering by the context organization and stamps `organization_id` on insert (refusing a mismatching one). Branch-limited users only see their assigned branches. Cross-tenant access is covered by `Organizations/Tests/Feature/TenantIsolationTest` (critical workflow #12).
- **Outside a request** (console, seeders, provisioning) no organization is in context and queries are unscoped; code that must act for a tenant uses `TenantContext::runAs($organizationId, fn () => …)`.
- **Defense in depth (Phase 9):** evaluate PostgreSQL Row-Level Security policies keyed on `SET LOCAL app.organization_id`.

## 3a. Catalog and master data (Phase 3)

- **Variants are the sellable unit.** A product groups variants (simple product = one variant); prices, SKU, barcodes and (from Phase 4) stock belong to the variant.
- **Prices and amounts are decimal strings end to end:** `NUMERIC` columns, `decimal:N` casts, string JSON, and a frontend formatter that groups digits by string manipulation. The frontend never computes money.
- **Cost prices are need-to-know:** `purchase_price` is only serialised for `products.view_cost`; the product editor requires it together with `products.manage`.
- **In-use checks are delegated to the database:** catalog rows are referenced with `ON DELETE RESTRICT`; `ReferentialIntegrity::deleteOrFail()` turns the FK violation into `IN_USE`, so the Catalog module never needs to know who references it.
- **Human-readable numbers** come from `SequenceGenerator` (row-locked `document_sequences`), the same mechanism invoices will use.
- **Races** that slip past validation hit unique indexes and are reported as `409 CONFLICT`.

## 3b. Inventory and purchasing (Phase 4)

- **One write path for stock.** Every stock change — adjustment, transfer, goods receipt, purchase return, and later sales and refunds — goes through the `StockLedger` contract (`Inventory\Application\Contracts`). Callers pass `StockChange`s (store, variant, optional batch, signed quantity, unit cost) and a `StockReference` (document type/id/number); the ledger returns the resulting movements.
- **Two tables, two roles.** `stock_levels` is the current balance per store × variant × batch (a projection, locked and updated in place); `stock_movements` is the append-only ledger with `balance_after` on every row, so history can be audited and levels rebuilt. A PostgreSQL trigger rejects `UPDATE`/`DELETE` on the ledger; the Eloquent model refuses them too.
- **Locking protocol.** The ledger refuses to run outside a transaction. It sorts changes by `store|variant|batch` (so two documents touching the same rows always lock in the same order and cannot deadlock), inserts a missing level row with `INSERT … ON CONFLICT DO NOTHING`, then takes `SELECT … FOR UPDATE` and checks availability **after** the lock. Outbound quantities beyond stock raise `INSUFFICIENT_STOCK` unless the store's branch has `allow_negative_stock`.
- **Valuation is weighted average cost** per level row, kept at 4 decimals: inbound `(q·avg + in·cost) / (q + in)` (or the inbound cost when stock was ≤ 0); outbound leaves at the current average, which is also the cost recorded on transfers and the basis for future COGS.
- **Untracked items are skipped**, not rejected: services and products with `track_stock = false` produce no movement.
- **Batches and expiry.** Batch-tracked products need a batch number (with optional expiry) on the way in and an existing batch on the way out; the same batch number with a different expiry is `BATCH_EXPIRY_MISMATCH`.
- **Transfers are two-step** (dispatch → in transit → receive or cancel). Dispatch leaves the source at its average cost and stores that cost on the lines, so the destination receives exactly what left.
- **Purchasing documents.** A purchase order commits nothing to stock. A goods receipt is the supplier invoice: one transaction posts stock in, the payable, and the received quantities back onto the order (`partially_received`/`received`). Returns are limited per receipt line to the quantity not yet returned and leave at the receipt's unit cost and batch. Supplier balances and statements are computed from documents (opening balance + receipts − returns − payments), not stored, so they can never drift.
- **Low stock** is detected inside the ledger when a level crosses its reorder level downward. `StockFellBelowReorderLevel` is dispatched **after commit** (a rolled-back sale never alerts) and handled by a queued listener that notifies users holding `inventory.view` for that branch through Laravel database notifications (`/notifications`).

## 3c. POS and sales (Phase 5)

- **The server prices every cart.** The client sends variant ids, quantities, requested discounts and payments — never prices or totals. `CartPricer` loads current selling prices and tax rates, applies the discount rules and runs the pure `SaleCalculator`; the POS preview (`POST /pos/price`) and checkout use the same code, so they always agree to the cent.
- **Calculation order** per line: subtotal = quantity × price (rounded once) → item discount → share of the invoice discount (allocated in proportion with largest-remainder rounding, so shares add up exactly) → tax: added on top (exclusive) or extracted as amount × rate / (100 + rate) (inclusive, the organization's `tax_mode`, snapshotted on the sale). Invoice totals are sums of rounded line values.
- **Discount rules** (critical rule #4): manual discounts need `sales.discount`; an item discount may not exceed the product's max. discount %; the customer's group discount is applied automatically as the invoice discount and needs no permission. Violations are `DISCOUNT_NOT_ALLOWED`.
- **Payments** (`PaymentSettlement`): any mix of cash, card and mobile banking. Only cash can be over-tendered (change is taken from the last cash payments); a shortfall stays due and needs a customer, `sales.credit` and room in the customer's credit limit, checked under a per-customer advisory lock.
- **Checkout transaction** (`CompleteSale`, critical rules #1–3, #9): number the invoice from the branch's locked sequence row → post stock through the ledger (batch-tracked goods first-expiry-first-out, expired batches never) → write the invoice with its cost snapshot, batch allocations, serial numbers and payments. Anything failing (stock, credit, serial already sold) rolls everything back, including the invoice number.
- **Idempotency** (critical rule #5): `POST /pos/checkout` requires `Idempotency-Key`. The `idempotent` middleware claims the key before the controller runs, stores a successful response and replays it for retries with the same payload; a different payload with the same key is `409 IDEMPOTENCY_KEY_REUSED`, a concurrent duplicate `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`. Failed attempts release the key. The SPA keeps the key with the pending cart, so a retry after a time-out or reload cannot sell twice.
- **Immutability** (critical rule #6): lines, stock allocations and payments are append-only (model guards + PostgreSQL triggers). Cancelling a sale changes only its status: stock goes back to the exact batches at the cost it left with, payments get negative reversal entries, serials are released, and the cancellation is audited.
- **Visibility:** `sales.view` sees the sales of accessible branches; a POS-only role sees the sales it rang up. Cost figures need `products.view_cost`.

## 3d. Payments, returns, cash registers, expenses, loyalty (Phase 6)

- **One payments ledger.** Every amount of money received or paid out — sale payments, cancellation reversals, refunds, customer payments, expenses, other income, voids, cash in/out — is appended to `payments` (Payments module) through the `PaymentLedger` contract, inside the transaction of the document that moved it. Rows are immutable (direction + positive amount, method, source document, customer, register session). Loyalty points are value, not money: they have their own ledger in Loyalty and never reach `payments`.
- **Cash registers.** A register (till) belongs to a branch; a cashier runs one session (shift) at a time on one register, and a register has one session at a time (partial unique indexes). The session opens with a counted float; the ledger gives the expected cash (float + cash in − cash out); closing stores the counted cash and the variance (critical workflow #11). **Every POS checkout needs the cashier's open session in the store's branch** (`CASH_SESSION_REQUIRED`), and so does any cash leaving or entering a drawer (refund, cancellation, collection, expense); a payout cannot take the drawer below zero (`INSUFFICIENT_CASH`). Non-cash entries are linked to the session when one is open, so the session report (X while open, Z once closed) shows every method.
- **Returns** live in Sales, next to the invoices they correct (as purchase returns live in Purchasing). A return references its invoice and lines; quantities are capped at what is neither returned nor requested (pending requests reserve them). Each line is valued at its share of what the line actually charged (discounts and tax included, proportional and rounded; the last return of a line takes the exact remainder — `ReturnShare`). Without `returns.approve` a return is a pending request; an approver completes or rejects it (their own returns complete at once). Completion, in one transaction: restocked lines go back to the exact batches they were sold from at their cost (written-off lines bring no stock back), serials are released, the total is **first credited against what the customer still owes on the invoice**, the rest is refunded with the given methods (must add up exactly — `REFUND_MISMATCH`; card, mobile and points refunds capped at what was paid that way; cash from the approver's drawer). A sale with returns can no longer be cancelled.
- **Receivables.** Customer balance = opening balance + dues of completed sales − returns credited − customer payments (`CustomerCredit`, computed, never stored). Customer payments cannot exceed the balance (no advances) and are locked per customer like credit sales; the statement lists invoices, till payments, cancellations, returns, refunds and payments with a running balance.
- **Expenses and other income** (Expenses module): categorized, numbered `EXP-`/`INC-`, immutable; voiding books the opposite payment.
- **Loyalty** plugs into Sales by dependency inversion: Sales declares the `LoyaltyProgram` contract (bound to a no-op by default); the Loyalty module implements it, so Loyalty depends on Sales and not the other way round. Points are earned on the sale total minus points redeemed (`points_per_spend` for every full `spend_amount`, rounded down), redeemed as the `loyalty_points` payment method in whole points, and reversed with cancellations (all) and returns (the returned share of what was earned, cumulatively; points refunded at the rate they were redeemed at). Balances may go negative when earned points were already spent.

## 3e. Online storefront (e-commerce track, E4)

The e-commerce track (plan and decisions in `docs/ecommerce/`) adds a public storefront to the same application.

- **Tenant from the host name.** `storefront_domains` maps host → organization. The `storefront` middleware (`ResolveStorefront` in the Storefront module) puts that organization into `TenantContext`, so the existing organization scope protects every public query; unknown hosts, closed stores and suspended organizations are 404. Staff of the organization holding `storefront.view` can preview a closed store in the browser they are signed in with. Local hosts map to `STOREFRONT_DEFAULT_HOST` (ADR-001).
- **Configuration modules.** `Storefront` owns settings, domains, the theme document (schema-normalized JSON: defaults for missing keys, unknown keys dropped) with policy-checked custom CSS, and menus (one per location, whole-tree replacement, links restricted to site paths or http(s) URLs). `Media` owns the image library: random names on the configured disk, sha-256 de-duplication, WebP renditions by a queued GD job, `srcset` in every reference, and in-use protection — foreign keys where they exist, plus tagged `MediaReferences` checkers for ids kept in JSON (the theme).
- **One public read model.** `GET /store/bootstrap` returns everything the storefront needs before drawing a page; the HTML shell (`StorefrontShellController`, a module `web.php` route) serves the built `storefront.html` with title, description, canonical, Open Graph and favicon written on the server and the same payload inlined, so crawlers get metadata in the first byte and the SPA needs no extra round trip (ADR-008). Paths without a storefront page answer 404 + `noindex`.
- **Two SPAs, one build.** The back office moved under `/admin` (React Router `basename`); the storefront is a second Vite entry (`storefront.html` → `src/storefront/`) that never loads admin code (ADR-007).
- **Content and homepage (E5).** The homepage is a list of typed sections (`Domain\SectionType`: defaults, normalization and media references per type, value validation in the request); banner sections attach banners as ordered items. `GET /store/homepage` returns only live sections and drops sections with no live banner, so the storefront never draws an empty block; staff get the full list with each section's state as a preview. Section types are added only with the data and pages they link to (products in E6, deals in E8, blog in E11). The `Cms` module owns pages, FAQ, contact messages and the double opt-in newsletter; Storefront depends on it through `PageDirectory` (menu links to pages, page metadata in the shell) and protects linked pages through the tagged `PageReferences` contract — the same pattern as `MediaReferences`.
- **Rich text.** Staff-written HTML goes through the shared `HtmlSanitizer` contract (HTMLPurifier, ADR-009 whitelist; images only from the media disk) on every save, and is rendered as stored. The admin editor (TipTap) only offers what survives sanitizing.

## 3f. Online catalog (e-commerce track, E6)

- **Web data next to the POS catalog, not in it.** The `OnlineCatalog` module owns 1:1 web tables beside the POS records — `product_listings`, `variant_listings`, `category_listings`, `brand_listings`, `related_products` — plus the `product_stats` projection. Products, Catalog and Inventory know nothing about the online store. In the admin the web listing is a separate form under the product editor (saved on its own, `online_catalog.*`), also reachable on its own page `/admin/products/{id}/online-store` for online store staff without `products.manage`. The attribute dictionary (`attributes`, `attribute_values`) belongs to Catalog; products keep their own `options`/`option_values`, and an option is linked to an attribute by a case-insensitive name match.
- **Listing read model.** `Infrastructure/ReadModels/CatalogReadModel` loads the candidate set — live listings (published, inside their window) of active, non-archived products of the organization, narrowed in SQL only by search, category scope, ids or slugs — together with active variants, compare-at prices, images, stock and popularity in a handful of chunked queries. Filtering, disjunctive faceting (`Domain\FacetCalculator`, `CatalogFilter`), sorting (`CatalogSort`, always ending with name and id so pages are stable) and paging then run in PHP on plain `CatalogItem` values, so results are identical on SQLite (tests) and PostgreSQL. Scale assumption: a few thousand published products per organization; E12 revisits this with `EXPLAIN` on real data (candidates: SQL-side price/brand filters, a materialized facet table). Like the Inventory stock list, read models read other modules' tables (products, variants, images, stock, sales) read-only and filter every query by organization; writes always go through the owning module.
- **Contract for the Storefront module.** Storefront never touches catalog tables: homepage catalog sections, menu links to categories/brands, link-picker data, hand-picked item summaries and the shell's page metadata all come through the OnlineCatalog contract `StorefrontCatalog` (implemented by `ReadModelStorefrontCatalog`). Category images/banners and brand logos are protected from deletion by a tagged `MediaReferences` checker, as in E4/E5.
- **Availability.** The storefront's `fulfilment_store_id` names the stock location for online availability. A variant is in stock when its product does not track stock (or is a service) or when its sellable on-hand quantity there (Inventory `StockLevels::onHand`, expired batches excluded) is above zero. Without a fulfilment store, tracked products are out of stock. Exact quantities never leave the server: the API exposes `in_stock` and `low_stock` (1–5 left).
- **Prices.** The storefront shows the variants' `selling_price` as stored (decimal strings, never floats) and filters/sorts by the same number. The bootstrap's `store.prices_include_tax` reflects the organization's tax mode; in exclusive mode the product page says "Excl. VAT" and tax is added at checkout (E8). A compare-at price only counts while it is above the selling price, so a later price increase ends a sale instead of showing a negative discount.
- **Popularity.** `product_stats` holds net units (completed POS sales minus completed returns, each return counted in the period of the sale it reverses) for the last 30 days and in total, rebuilt per organization by the `RefreshProductStats` job; `storefront:refresh-product-stats` runs it hourly from the scheduler. It drives the *popularity* sort and the *best sellers* source; there is no rating column or sort until reviews (E10).
- **Search.** `q` is a case-insensitive substring match on product name, active SKU and brand name (`lower(...) LIKE`). On PostgreSQL a `pg_trgm` GIN index on `lower(products.name)` serves it; there is no `similarity()` ranking (results must match SQLite), and suggestions rank names that start with the term first.
- **Storefront pages.** `/shop`, `/search`, `/category/{slug}`, `/brand/{slug}` share one listing page whose filter state lives in the URL; `/product/{slug}` keeps the selected variant in `?variant=`. Recently viewed products are stored as slugs only (localStorage) and fetched fresh with `GET /store/products?slugs=`, so a price change shows everywhere.

## 3g. Customer identity, storefront sessions and cart pricing (e-commerce track, E7)

- **Shoppers are not users.** The `CustomerAccounts` module owns `customer_accounts` (1:1 `customers`, e-mail unique per organization regardless of case) and the session guard `customer` (provider `customer_accounts`, ADR-002). Sanctum's guard stays `['web']`, so a shopper session never satisfies `auth:sanctum`, and staff sessions are never shoppers. The guard's provider (`StorefrontCustomerProvider`) only looks accounts up while a storefront has put its organization into `TenantContext`; the account model carries the organization scope, so a session cookie of store A is anonymous on store B's host. `ResolveStorefront` and `storefront.session` are placed before `AuthenticatesRequests` in the middleware priority list for that reason.
- **One browser, two identities.** Sign-in calls `Auth::guard('customer')->login()` and regenerates the session id (fixation). Sign-out calls `Auth::guard('customer')->logout()` and `regenerateToken()` — never `invalidate()` — so a staff member signed in to the back office in the same browser stays signed in (covered by `CustomerSessionTest`). `customer.active` re-checks the account status and the customer record (archived, inactive) on every signed-in request and signs the shopper out, so staff disabling an account (`PATCH /customer-accounts/{customerId}`) takes effect at once; `customer.active:optional` downgrades such a request to a guest (cart, `me`).
- **Default guard side effect.** `auth:customer` makes `customer` the request's default guard, so `Auth::id()` would return a shopper's account id. Author columns (`TracksAuthor`) and the audit trail therefore ask `Shared\Application\Support\StaffActor::id()`, which returns an id only for staff users (`TenantUser`).
- **Sessions on storefront hosts.** Storefront hosts are not in `SANCTUM_STATEFUL_DOMAINS` (they are configured per organization at runtime), so the API group gives them no session. The `storefront.session` middleware runs the same stack Sanctum uses — `EncryptCookies`, `AddQueuedCookiesToResponse`, `StartSession`, `ValidateCsrfToken` — on the bootstrap, account, cart and wishlist routes only, with httpOnly, SameSite=Lax session cookies; it does nothing when Sanctum already made the request stateful (attribute `sanctum`, e.g. the storefront served from a stateful dev host). Catalog, CMS and geography reads stay sessionless and cacheable. The storefront client (`src/storefront/http.ts`) echoes `XSRF-TOKEN` as `X-XSRF-TOKEN` and, after a 419, refreshes the cookie with `GET /store/account/me` and retries once.
- **Registration never links POS customers** (ADR-018). Every sign-up creates a new `customers` row through the Customers module (`OnlineCustomerProfiles`, `CUS-` sequence) and its account in one transaction. The phone is copied to the customer only when no other customer of the organization uses it, so the till's phone lookup stays unique and the form never reveals a known number. Customers depend on nothing in CustomerAccounts: the customer screens read the account through the Customers-owned `CustomerOnlineAccounts` contract (bound to a null implementation by default, implemented by CustomerAccounts — the `LoyaltyProgram` pattern).
- **Tokens.** E-mail verification and password reset use random tokens stored as sha-256 (verification on the account row, 24 hours; reset in the module's own `customer_password_reset_tokens`, one per e-mail and organization, 60 minutes, keyed by organization and e-mail — instead of a Laravel password broker). Links point at the host the request came from. Answers to forgot-password and sign-in never reveal whether an e-mail is registered (same message, equalised hashing time). A reset rotates the remember-me token but cannot end other sessions (`logoutOtherDevices` needs the old password). Unverified accounts can sign in and shop; checkout does not require verification either (E8a).
- **Addresses and geography.** Addresses belong to Customers (`customer_addresses`, `CustomerAddressBook`): every operation is scoped to the signed-in shopper's customer id and serialized by a lock on the customer row (limit of 10, exactly one default shipping address). Divisions and districts are **global** reference data in the `Geography` module (no `organization_id`; `GeoDirectory` contract); the upazila/thana level is a free-text `area` until a licensed dataset is chosen (E8 shipping zones work at district level). Phones are normalized to `01XXXXXXXXX` by the shared `Shared\Domain\BangladeshMobile`.
- **Cart pricing (ADR-005).** Carts store variant ids and quantities only. `Cart\Application\Services\CartPricer` is the one pricing path: it loads every line's live data through `StorefrontCatalog::variantsForCart()` (listing state, price, compare-at, unit, tax rate, on-hand at the fulfilment store via Inventory `StockLevels`) and totals the countable lines with the POS `SaleCalculator` in the organization's tax mode and currency. It runs on every read and after every write, so the storefront never computes money and a price change or stock movement shows on the next request. Reads never change quantities: unavailable and out-of-stock lines stay flagged and count zero; lines above the stock count with what is available. Writes run in a transaction with the cart row locked; adding checks purchasability and stock (`VARIANT_NOT_PURCHASABLE`, `OUT_OF_STOCK`, `INSUFFICIENT_STOCK`). Stock is **not reserved** by a cart — it leaves only at order placement (ADR-004, E8).
- **Guest carts and merge.** A guest cart is found by the sha-256 of a random token in the httpOnly `cart_token` cookie; it is created on the first add and deleted by `cart:prune` 30 days after its last change. CustomerAccounts declares `GuestCartMerger` (no-op by default); the Cart module implements it, so sign-in, registration and password reset merge the cookie's cart into the customer's cart (summed, capped at stock and 999, 50-line limit) inside one transaction with the customer's cart locked, then forget the cookie. The guest wishlist never reaches the server until sign-in: the browser keeps product ids and slugs (no names or prices) and posts them to `/store/wishlist/merge`.

## 3h. Shipping, checkout and web orders (e-commerce track, E8a)

- **Modules.** `Shipping` owns delivery zones (sets of districts, one zone per district per organization — `DISTRICT_IN_OTHER_ZONE` in `ManageShippingZones` under a lock, backed by a unique index) and their methods; checkout asks it through `ShippingRates::methodsForDistrict()`, and `Domain\ShippingFee` computes the delivery fee (flat, free from `free_over` compared with the goods total after tax) and the COD fee. `OnlinePayments` owns the per-organization method configuration (`payment_gateways`) behind `CheckoutPaymentMethods` (`all`, `enabled`, `usable`, `initiate`) and the `PaymentGateway` drivers — in E8a only `CashOnDeliveryGateway` and `BankTransferGateway`, which never redirect (`GatewayInitiation::awaitsPayment` is true for bank transfer). `Orders` owns checkout, the order document and its workflow. Orders depends on Cart (`ShoppingCart`, `CartPricer`), Customers (`CustomerAddressBook`), Geography, Shipping, OnlinePayments, Inventory (`StockLedger`), Payments (`PaymentLedger`), Products, Branches, Users and Storefront (`StorefrontConfig`); none of them depends on Orders.
- **One pricing path** (ADR-005). `Orders\Application\Services\CheckoutQuoter` is shared by the preview and the placement: `CartPricer::quote()` (E7: live listing data, availability, `SaleCalculator` in the organization's tax mode) gives the cart view and the counted lines with their `SaleCalculator` amounts; the quoter adds the delivery fee of the chosen method for the address's district and the COD fee, after tax and untaxed in E8a. The client never sends a price — only `expected_total`, the total it showed, which the server compares with its own (`409 TOTAL_CHANGED` with the fresh preview). The preview tolerates partial input and auto-picks a district's only method; placement insists on the shopper's choice.
- **Placement transaction** (`PlaceOrder`, brief check 13). Outside the transaction: guest checkout allowed? fulfilment store active? Inside one `DB::transaction`: (1) lock the shopper's active cart (`ShoppingCart::lockForCheckout`, `FOR UPDATE`) — no cart or no lines → `CART_EMPTY`; (2) reprice through the quoter — any flagged line → `CART_HAS_ISSUES`; (3) resolve the address snapshot (a saved address of this customer or the inline one, district in division); (4) the delivery method must be offered for that district (`SHIPPING_UNAVAILABLE`); (5) the payment method must be usable (`PAYMENT_METHOD_UNAVAILABLE`); (6) compare `expected_total`; (7) number `WEB-000001` from the locked `document_sequences` row (key `web_order`); (8) post every line through `StockLedger::post` as `online_order` at the fulfilment store with batch allocation (stock rows locked in the ledger's deterministic order; `INSUFFICIENT_STOCK` aborts everything); (9) write `orders`, `order_lines` (snapshots, cost from the allocations or the purchase price for untracked products), `order_line_stock` (the allocations: batch, quantity, unit cost, movement id), `order_addresses`, the first `order_status_history` row; (10) mark the cart converted (lines deleted, `converted_order_id` set). Any failure rolls all of it back. After commit: an optional save of the inline address to the address book (best effort) and the `OrderPlaced` event (confirmation e-mail queued, staff inbox notification) inside a `try` — the order stands even if notifying fails.
- **Stock leaves exactly once** (ADR-004, brief check 14). Stock is posted only by a successful placement; the endpoint's idempotency makes a retried request replay the first answer instead of posting again. `MovementType::OnlineOrder` overrides the branch's `allow_negative_stock` (`forbidsNegativeStock()`), so the web never oversells; two checkouts racing for the last unit serialize on the stock row lock (`CheckoutConcurrencyTest`, PostgreSQL only). **Restock** (`CancelOrder`): with the order row locked, the status is checked (`INVALID_STATUS_TRANSITION` for a cancelled order, `ORDER_PAID` for a paid one) and each `order_line_stock` allocation goes back to its batch at its unit cost as `online_order_cancel` (inbound), in the same transaction as the status change — a second cancel, or a cancel racing the expiry job, finds the order cancelled and posts nothing.
- **Idempotency scopes** (ADR-014). `idempotency_keys` are unique per `(scope, key)`. Staff routes (`idempotent`) use `user:{id}`; storefront routes use `idempotent:shopper`, which asks the Shared interface `ShopperIdempotencyScope` (implemented by Cart's `CartIdempotencyScope`, which owns the cart cookie): `customer:{account id}` for a signed-in shopper, `cart:{sha-256 of the cart cookie token}` for a guest, and `422 CART_EMPTY` for a guest without a cart (nothing to check out, no scope). The guest scope survives the cart's conversion, so a retry whose response was lost still finds the stored 201. The storefront's `PlacementAttempts` keeps one key per attempt and reuses it only after an open outcome (network error, 5xx, `IDEMPOTENCY_REQUEST_IN_PROGRESS`); any change of the body or a definite answer starts a new key. Admin web order steps send a key per dialog submission, reused on a safe retry.
- **Order lifecycle** (ADR-003). `OrderStatus` encodes the transitions (`pending_payment → confirmed | cancelled`, `confirmed → processing | cancelled`, `processing → shipped | cancelled`, `shipped → delivered`; `failed` is reserved for gateways, E8c). `OrderWorkflow` runs every staff step with the order row locked, appends history (actor = staff user; `NULL` = shopper at placement or the system at expiry) and audits it. COD orders start `confirmed`; bank-transfer orders start `pending_payment` with `expires_at` = placement + `hold_hours`. `allowed_actions` in the staff view is derived from status, payment status and method, so the admin shows only valid buttons; the server re-checks anyway.
- **Money in the ledger** (ADR-006). Confirming a bank transfer and recording a courier's COD remittance call `PaymentLedger::recordSystem()` — entries that do not pass through a register drawer (no session, `created_by` = the confirming staff user or null for the system) — with method `bank_transfer` / `cash_on_delivery`, source `PaymentSource::ONLINE_ORDER` and the order total; cash-method entries are refused there (`CASH_SESSION_REQUIRED`). `PaymentLedger::entriesOf()` gives the order page its payments. A paid order cannot be cancelled until refunds exist (E10).
- **Expiry job.** `orders:expire-pending` (scheduler, every minute, `withoutOverlapping`) lists up to 500 due `pending_payment` orders across organizations, then for each runs inside the order's tenant: re-select it with `FOR UPDATE SKIP LOCKED` on PostgreSQL (plain `FOR UPDATE` on SQLite) and still `pending_payment` and due, then `CancelOrder::cancelLocked()` with reason `payment_expired` and no actor. An order a staff member is confirming at that moment is skipped (locked) and re-checked on the next run; parallel runs never cancel or restock twice.
- **Guests and customers.** Guest orders keep `customer_id` NULL and a contact snapshot — no POS customer record is created (keeps the till's customer list and phone lookup clean). Signed-in orders carry `customer_id` and `customer_account_id`. A guest's order page needs a random 32-byte token returned once in the 201 and in the e-mail link; only its sha-256 is stored, compared with `hash_equals`; a wrong token is a 404 like an unknown number. The storefront keeps the token in `sessionStorage` per order number and removes it from the address bar.
- **Courier and tracking** are free text on the order until shipments and couriers arrive (E10).

## 4. Authentication and authorization

- **Web SPA:** Laravel Sanctum **cookie-based SPA authentication** (session + CSRF via `XSRF-TOKEN`). No bearer tokens in browser storage, so XSS cannot exfiltrate long-lived credentials. The Vite dev server proxies `/api` and `/sanctum` so the SPA is same-origin.
- **Devices and integrations** (e.g. dedicated terminals, scripts): Sanctum personal access tokens with abilities, revocable per device.
- **Online store shoppers** (E7) sign in on a separate session guard, `customer`, never as staff users; see §3g.
- **RBAC (own implementation, no package):** organization-scoped roles map to code-declared permissions; Gates check permissions, never role names. Built-in roles (Organization Admin, Branch Manager, Cashier, Inventory Manager, Accountant) are provisioned per organization and read-only; organizations create custom roles for anything else. **Super Admin** is a platform-level flag (`users.is_platform_admin`, never mass-assignable), not a role: it passes every Gate and can provision/suspend organizations. A custom implementation was chosen over spatie/laravel-permission because permissions are code-declared per module, roles are strictly tenant-scoped, and the feature set needed is ~300 lines.
- **Lock-out guards:** users cannot change their own roles or status; an organization always keeps at least one active Organization Admin (enforced under a row lock); an organization always keeps one active branch.
- **Escalation guard:** nobody can grant more power than they hold — roles may only contain, and users may only be assigned, permissions the acting user has, and users may only edit users whose permissions are a subset of their own (so `users.manage` alone cannot reset an admin's password). Platform admins and system processes are exempt.
- **Credential hygiene:** login failures are indistinguishable for unknown e-mail vs. wrong password (same message, equalised hashing time); every attempt is recorded in `login_activities`; `/auth/*` credential endpoints are rate-limited per account+IP and per IP; password change/reset and deactivation revoke the user's other sessions and tokens.
- **Audit trail:** sensitive actions are written through the `AuditTrail` contract to the append-only `audit_logs` table with before/after diffs (secrets redacted), request id and IP.

## 5. Transactional integrity (critical POS rules)

| Rule | Implementation |
|------|----------------|
| Sale + stock deduction are atomic | Checkout runs in one `DB::transaction`; any failure rolls back sale, payments and stock movements together. |
| No overselling (unless configured) | Stock level rows locked with `SELECT … FOR UPDATE` in deterministic store/variant/batch order (prevents deadlocks); quantity checked after the lock; `INSUFFICIENT_STOCK` unless the branch allows negative stock (implemented in Phase 4, see §3b). |
| Server-side totals | Client sends only product ids, quantities, requested discounts and payments. Prices, taxes, discounts and totals are recomputed from the database with `Money`. |
| Price/discount validation | Discounts checked against product/role limits and active promotions on the server. |
| Idempotency | `Idempotency-Key` header required on checkout, returns and approvals, customer payments, expenses, cash movements, web order steps and the storefront checkout; key + scope (staff user, shopper account or guest cart) + request fingerprint stored with the response; replays return the stored response (`Idempotent-Replayed: true`), mismatched payloads get 409, failed attempts release the key (see §3c, §3d, §3h). |
| Immutable history | Posted sales, stock ledger and payment ledger rows are append-only (enforced in code and by database triggers that reject `UPDATE`/`DELETE`). |
| Returns reference original sale | `sale_returns.sale_id` + `sale_return_lines.sale_line_id` FKs; per-line quantity ceilings checked under the sale's row lock; amounts from the invoice line (see §3d). |
| Decimal types only | `NUMERIC(18,2)` money, `NUMERIC(18,3)` quantities, `NUMERIC(9,4)` rates. No `float`/`double`/`real` anywhere. |
| Concurrency-safe inventory | Row locks + append-only ledger with `balance_after`; PostgreSQL-only tests hold a lock from a second connection and prove the ledger waits and never oversells (`Inventory/Tests/Feature/StockLockingTest`; web checkout: `Orders/Tests/Feature/CheckoutConcurrencyTest`, E8a). Parallel-checkout tests follow in Phase 5. |
| Tax-inclusive / exclusive pricing | Per-organization/branch setting consumed by one pricing service; both modes covered by calculation tests. |

## 6. API

Versioned REST under `/api/v1`, one envelope for every response, OpenAPI generated by Scramble at `/docs/api` (local only by default). Details in [API_DOCUMENTATION.md](API_DOCUMENTATION.md).

## 7. Asynchronous work

- **Queues** (Redis in staging/production, database driver locally): notifications, report exports, low-stock checks, AI summaries.
- **Events/listeners:** cross-module reactions; listeners that touch external systems are queued. Events raised inside financial transactions implement `ShouldDispatchAfterCommit` (first one: `StockFellBelowReorderLevel` → queued `NotifyLowStock`).
- **In-app notifications** use Laravel's database channel (`notifications` table, UUID ids, JSON payload with a `type` and an in-app `link` or `url`); the SPA bell polls the unread count every 60 s and opens `url` (else `link`) when it is a same-origin path. E8a: "New online order" (`orders.new_online_order`) to every active user with `web_orders.view`; the order confirmation e-mail is a queued mail notification sent after the placement commits.
- **Scheduler:** daily summaries, expiry alerts, idempotency-key cleanup, cash-register reminders; hourly storefront product stats (E6); daily `cart:prune` of expired guest carts (E7); `orders:expire-pending` every minute (E8a, see §3h).
- Request id is propagated to jobs through Laravel `Context`.

## 8. Frontend architecture

```
frontend/src/
  app/            Providers, routes, layouts, navigation config, route error boundary
  components/ui   shadcn/ui primitives (generated; edit sparingly)
  components/common  Cross-feature building blocks (state views, theme toggle, …)
  features/<module>/ api.ts (query/mutation hooks), pages/, components/, schemas (Zod)
  lib/            api client, query client, utilities
  stores/         Zustand stores for client-only state (theme, POS cart, terminal session)
  test/           Vitest setup and helpers
e2e/              Playwright specs
```

- **Server state** only via TanStack Query hooks in `features/*/api.ts`; components never call `fetch` directly.
- **Client state** (theme, cart drafts, UI) in Zustand. Server data is never duplicated into Zustand.
- **Forms:** React Hook Form + Zod; server `VALIDATION_FAILED` details are mapped back onto fields.
- **Navigation** lists a module only once it is backed by working endpoints (no placeholder UI).
- The POS terminal is optimized for keyboard and barcode scanners: an always-focused scan field (scanners type the code and press Enter → exact barcode/SKU lookup), shortcuts F2 search, F4 customer, F8 hold, F9 pay; the cart lives in a persisted Zustand store per branch while every amount shown comes from the server's pricing endpoint.
- **Visual theme** lives in `src/index.css` as CSS variables (light on `:root`, dark on `.dark`) mapped into Tailwind with `@theme inline`. Beyond the shadcn tokens it defines `canvas` (page background behind cards), `heading`, `topbar*`, soft status colours (`success`, `warning`, `info` with `*-soft-foreground`) and the shell sizes `--topbar-height` / `--sidebar-width` (utilities `h-topbar`, `w-sidebar`, `md:ml-sidebar`). The shell is a full-width purple top bar over a fixed icon sidebar; cards are flat with a hairline shadow and uppercase titles; status badges use the soft variants (`success`, `warning`, `info`, `soft`, `destructive`). Font: Plus Jakarta Sans (self-hosted via Fontsource, no external font requests). Colour pairs are chosen for WCAG AA text contrast in both themes.
- Receipts print from the browser: the receipt is rendered into a print-only portal with an `@page` size for 58 mm or 80 mm thermal rolls or A4. Cash drawers wired to the receipt printer open through the printer driver's "open drawer on print" setting; browsers cannot drive a drawer directly.

## 9. Optional AI module

Provider-independent, disabled-by-default, read-only with respect to business data. See [AI_INTEGRATION.md](AI_INTEGRATION.md).

## 10. Technology versions

| Layer | Version |
|-------|---------|
| PHP | 8.4 |
| Laravel | 13.x, Sanctum 4, Scramble 0.13 (OpenAPI) |
| PostgreSQL | 18 |
| Redis | 5+ (client: predis) |
| React | 19.3, React Router 8, TanStack Query 5, Zustand 5, React Hook Form 7, Zod 4 |
| Build/UI | Vite 8, TypeScript 7 (strict), Tailwind CSS 4, shadcn/ui (Radix) |
| Testing | PHPUnit 12, Vitest 5, Testing Library, Playwright 1.64 |

## 11. Key risks

| Risk | Mitigation |
|------|------------|
| Deadlocks under concurrent checkouts | Deterministic lock ordering, short transactions, retry-on-deadlock wrapper, concurrency tests. |
| Tenant data leakage | Global scopes + policies + isolation tests; RLS evaluation in Phase 9. |
| Rounding disputes | Single pricing service, `Money` VO, documented rounding (per line, half away from zero), golden-value tests. |
| Offline POS terminals | Out of scope for v1; terminals require connectivity. Hold/resume drafts are server-side. |
| Very new toolchain (TS 7, Vite 8, React Router 8) | Pinned lockfiles; upgrade only with green test suite. |
| AI misuse | No SQL generation, whitelisted report intents, permission-checked tools, no write actions without user confirmation. |
