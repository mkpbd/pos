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

Foreign keys across module tables are allowed (referential integrity matters more than purity), but a module never writes another module's tables and never imports another module's Eloquent models. Read access goes through directory contracts (`BranchDirectory`, `OrganizationDirectory`). Two documented exceptions: the Authentication module operates on the Users module's `User` model (it is Laravel's auth model), and model factories may reference foreign models to build test data.

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

## 4. Authentication and authorization

- **Web SPA:** Laravel Sanctum **cookie-based SPA authentication** (session + CSRF via `XSRF-TOKEN`). No bearer tokens in browser storage, so XSS cannot exfiltrate long-lived credentials. The Vite dev server proxies `/api` and `/sanctum` so the SPA is same-origin.
- **Devices and integrations** (e.g. dedicated terminals, scripts): Sanctum personal access tokens with abilities, revocable per device.
- **RBAC (own implementation, no package):** organization-scoped roles map to code-declared permissions; Gates check permissions, never role names. Built-in roles (Organization Admin, Branch Manager, Cashier, Inventory Manager, Accountant) are provisioned per organization and read-only; organizations create custom roles for anything else. **Super Admin** is a platform-level flag (`users.is_platform_admin`, never mass-assignable), not a role: it passes every Gate and can provision/suspend organizations. A custom implementation was chosen over spatie/laravel-permission because permissions are code-declared per module, roles are strictly tenant-scoped, and the feature set needed is ~300 lines.
- **Lock-out guards:** users cannot change their own roles or status; an organization always keeps at least one active Organization Admin (enforced under a row lock); an organization always keeps one active branch.
- **Escalation guard:** nobody can grant more power than they hold — roles may only contain, and users may only be assigned, permissions the acting user has, and users may only edit users whose permissions are a subset of their own (so `users.manage` alone cannot reset an admin's password). Platform admins and system processes are exempt.
- **Credential hygiene:** login failures are indistinguishable for unknown e-mail vs. wrong password (same message, equalised hashing time); every attempt is recorded in `login_activities`; `/auth/*` credential endpoints are rate-limited per account+IP and per IP; password change/reset and deactivation revoke the user's other sessions and tokens.
- **Audit trail:** sensitive actions are written through the `AuditTrail` contract to the append-only `audit_logs` table with before/after diffs (secrets redacted), request id and IP.

## 5. Transactional integrity (critical POS rules)

| Rule | Implementation |
|------|----------------|
| Sale + stock deduction are atomic | Checkout runs in one `DB::transaction`; any failure rolls back sale, payments and stock movements together. |
| No overselling (unless configured) | Stock rows locked with `SELECT … FOR UPDATE` in ascending product/batch id order (prevents deadlocks); quantity checked after lock; `CHECK (quantity >= 0)` unless branch allows negative stock. |
| Server-side totals | Client sends only product ids, quantities, requested discounts and payments. Prices, taxes, discounts and totals are recomputed from the database with `Money`. |
| Price/discount validation | Discounts checked against product/role limits and active promotions on the server. |
| Idempotency | `Idempotency-Key` header required on checkout and payment endpoints; key + user + request hash stored with the response; replays return the stored response, mismatched payloads get 409. |
| Immutable history | Posted sales, stock ledger and payment ledger rows are append-only (enforced in code and by database triggers that reject `UPDATE`/`DELETE`). |
| Returns reference original sale | `sale_returns.sale_id` FK + per-line quantity ceilings. |
| Decimal types only | `NUMERIC(18,2)` money, `NUMERIC(18,3)` quantities, `NUMERIC(9,4)` rates. No `float`/`double`/`real` anywhere. |
| Concurrency-safe inventory | Row locks + ledger + optimistic version on stock levels; covered by concurrency tests that run parallel checkouts. |
| Tax-inclusive / exclusive pricing | Per-organization/branch setting consumed by one pricing service; both modes covered by calculation tests. |

## 6. API

Versioned REST under `/api/v1`, one envelope for every response, OpenAPI generated by Scramble at `/docs/api` (local only by default). Details in [API_DOCUMENTATION.md](API_DOCUMENTATION.md).

## 7. Asynchronous work

- **Queues** (Redis in staging/production, database driver locally): notifications, report exports, low-stock checks, AI summaries.
- **Events/listeners:** cross-module reactions; listeners that touch external systems are queued.
- **Scheduler:** daily summaries, expiry alerts, idempotency-key cleanup, cash-register reminders.
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
- The POS terminal is optimized for keyboard and barcode scanners (Phase 5): focus-managed scan input, shortcut map, optimistic cart with server-side pricing confirmation.

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
