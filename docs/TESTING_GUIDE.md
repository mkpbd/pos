# Testing Guide

A module is not complete until its functionality and tests pass. Tests run against **PostgreSQL** (`pos_test`), never SQLite, because the system relies on PostgreSQL behaviour (row locks, partial indexes, `NUMERIC`, triggers).

## Backend (PHPUnit 12)

```powershell
cd backend
php artisan test                         # all suites
php artisan test --testsuite=Modules     # module tests only
php artisan test --filter=Checkout       # by name
php artisan test --parallel              # once suites grow
```

Suites (`phpunit.xml`):

| Suite | Location | Contents |
|-------|----------|----------|
| `Modules` | `app/Modules/*/Tests/**/*Test.php` | Module unit and feature tests (primary location) |
| `Unit` | `tests/Unit` | Cross-cutting unit tests |
| `Feature` | `tests/Feature` | Cross-module / end-to-end API flows |

Test environment: `DB_CONNECTION=pgsql`, `DB_DATABASE=pos_test`, array cache, sync queue, array mail. Credentials come from `backend/.env` (`DB_USERNAME`/`DB_PASSWORD`).

PostgreSQL-only tests (`StockLockingTest`: two real connections, committed data via `DatabaseTruncation`) skip themselves on other drivers. A quick interim run without PostgreSQL is possible with `DB_CONNECTION=sqlite DB_DATABASE=:memory: php artisan test`, but it does not satisfy the definition of done below: row locks, the ledger trigger and PostgreSQL error codes are only exercised on PostgreSQL.

### What each kind of test covers

| Kind | Example | Rules |
|------|---------|-------|
| Unit (domain) | `MoneyTest`, pricing calculator, tax-inclusive/exclusive math | No database, no framework boot. Golden values for every rounding rule. |
| Feature (API) | `POST /api/v1/pos/checkout` | `RefreshDatabase`; assert envelope, status, DB state, ledger rows. |
| Authorization | Cashier cannot adjust stock | One test per policy ability, both allow and deny. |
| Tenant isolation | User of branch A gets 404 for branch B sale | Required for every tenant-scoped resource. |
| Transaction | Payment failure rolls back sale and stock | Force a failure mid-transaction; assert nothing persisted. |
| Concurrency | Two checkouts for the last unit | Separate DB connections/processes; exactly one succeeds, stock never negative. |
| Idempotency | Same `Idempotency-Key` twice | One sale, identical responses; different payload → 409. |

### Critical workflow coverage (tracked)

| # | Workflow | Phase | Status |
|---|----------|-------|--------|
| 1 | Product creation | 3 | ✅ `ProductManagementTest`, `ProductDefinitionRulesTest`, editor UI tests, full-stack spec |
| 2 | Purchase and stock receiving | 4 | ✅ `PurchasingWorkflowTest` (order → partial receipt → over-receipt refused → return → payment → statement), `PurchaseTotalsTest`, receipt/return UI tests, full-stack spec (receive PO-000001: stock 60 → 156, supplier balance) |
| 3 | POS product selection | 5 | ☐ |
| 4 | Barcode scanning | 5 | ☐ |
| 5 | Discount calculation | 5 | ☐ (Money allocation ✅) |
| 6 | Tax calculation | 5 | ☐ |
| 7 | Multiple payment processing | 6 | ☐ |
| 8 | Successful checkout | 5 | ☐ |
| 9 | Inventory deduction | 5 | ◐ ledger side done in Phase 4: `StockLedgerTest` (insufficient stock, negative-stock branches, WAC, batches, immutability), `StockTransferTest`, PostgreSQL-only `StockLockingTest` (row lock held across connections; last unit cannot be issued twice). Checkout integration in Phase 5 |
| 10 | Sales return and refund | 6 | ☐ |
| 11 | Cash register closing | 6 | ☐ |
| 12 | Branch-level data isolation | 2+ | ✅ organization/branch/user/role level (`TenantIsolationTest`); extended per module in later phases |

## Frontend (Vitest 5 + Testing Library)

```powershell
cd frontend
npm test                 # vitest run
npm run test:watch
npm run typecheck
```

- Tests are colocated: `*.test.ts(x)` next to the code.
- `src/test/utils.tsx`: `renderWithQuery`, `renderRoutes` (memory router), `mockApi({'GET /users': ok([...])})` per-route fetch mock (unmocked calls fail with 599), `ok()` / `fail()` envelope builders, `mockFetchJson`.
- `src/test/fixtures.ts`: `makeCurrentUser()` (organization admin), `cashier()`, `catalogManager()`, `counterCashier()`, `stockManager()` session fixtures and `branchesWithStores()`.
- Backend stock tests use `App\Modules\Inventory\Tests\Concerns\InteractsWithStock` (`stockedVariant()`, `mainStoreId()`, `adjust()`, `stockRow()`).
- Backend tests build tenants through the real provisioning use case: `App\Modules\Shared\Tests\Concerns\InteractsWithTenancy` (`provisionTenant()`, `createUserWithRole()`, `createBranch()`, `actingAsUser()`, `spaHeaders()`).
- Mock the network at `fetch`, not at hooks, so the real API client and envelope handling are exercised.
- Query by role/label (accessibility-first), not by class names.

## End-to-end (Playwright)

```powershell
cd frontend
npx playwright install chromium   # first time
npm run test:e2e
```

- Specs in `frontend/e2e`; projects `desktop-chromium` and `mobile-chromium` (responsive checks).
- Playwright starts the Vite dev server automatically.
- `smoke.spec.ts` intercepts `/api/v1/*` with `page.route` (no backend needed).
- `integration.spec.ts` runs against a **real backend** (Sanctum cookies, CSRF, tenancy, RBAC) and is opt-in:

```powershell
cd backend;  php artisan migrate:fresh --seed; php artisan serve --port=8010   # re-seed before every run: the specs post documents
cd frontend; $env:E2E_BACKEND=1; $env:VITE_BACKEND_ORIGIN='http://127.0.0.1:8010'; npm run test:e2e -- e2e/integration.spec.ts
```

## Definition of done per phase

1. `php artisan migrate:fresh` succeeds on PostgreSQL.
2. `php artisan test` green.
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` green.
4. `npm run test:e2e` green.
5. Endpoints verified in Scramble docs; frontend integrated against the real API.
6. Docs and CHANGELOG updated.
