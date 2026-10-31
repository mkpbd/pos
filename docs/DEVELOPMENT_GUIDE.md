# Development Guide

## Prerequisites

| Tool | Version | Notes (Windows/Laragon dev box) |
|------|---------|----------------------------------|
| PHP | 8.4 with `bcmath`, `intl`, `pdo_pgsql`, `pgsql`, `gd`, `zip` | `C:\laragon\bin\php\php-8.4.16-nts-Win32-vs17-x64` — put it first on `PATH` |
| Composer | 2.x | |
| Node.js | 22+ / npm 10+ | |
| PostgreSQL | 18 | Windows service on `127.0.0.1:5432`; `psql` at `C:\Program Files\PostgreSQL\18\bin` |
| Redis | 5+ (optional locally) | `C:\laragon\bin\redis`; the app uses the `predis` client, no PHP extension required |

`BCMath\Number` (PHP 8.4) backs all money arithmetic, so `bcmath` is mandatory.

## First-time setup

### 1. Databases (once)

Run as the PostgreSQL superuser; you will be asked for the superuser password and then for a password to give the new `pos_app` role:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -f backend\database\scripts\create_local_databases.sql
```

This creates role `pos_app` and databases `pos` and `pos_test`. It is safe to re-run.

### 2. Backend

```powershell
cd backend
composer install
copy .env.example .env        # then set DB_PASSWORD to the pos_app password
php artisan key:generate
php artisan migrate --seed    # dev data, see below
php artisan serve             # http://127.0.0.1:8000
```

The development seeder (refuses to run in production) creates:

| Account | Password | Role |
|---------|----------|------|
| `admin@pos.test` | `password` | Platform admin (all organizations) |
| `owner@demo.test` | `password` | Organization Admin of *Demo Mart* |
| `cashier@demo.test` | `password` | Cashier at *Dhaka Main* |

The seeder also creates a demo catalogue for *Demo Mart* (units, VAT rates, categories, brands, four products incl. a variant product and a service, two suppliers, a customer group and two customers) through the same application actions as the API.

Demo stock (`DemoStockSeeder`): an opening-stock adjustment in store `MAIN` (juice 60, rice 250.5 kg, polo shirts by size), purchase order `PO-000001` for 96 juice from Pran (placed, not yet received) and goods receipt `GRN-000001` for 100 kg rice from Local Mills (invoice `LM-1042`), so Inventory, Purchasing and supplier balances have data on first start.

Demo sales (`DemoSalesSeeder`): `INV-MAIN-000001`, a walk-in cash sale by the cashier with change, and `INV-MAIN-000002`, Rahman Traders (wholesale group −5 %) paying 1,000 by card with the rest on account.

Existing databases created before Phase 5 need `php artisan pos:permissions:sync` so the built-in roles receive `pos.sell` and the `sales.*` permissions.

Product images are stored on the `public` disk; run `php artisan storage:link` once so `/storage/...` URLs are served (the Vite dev server proxies `/storage` to the backend).

After adding permissions to a module, run `php artisan pos:permissions:sync` to update the catalog and every organization's built-in roles.

Without Redis running, keep `CACHE_STORE=database`, `QUEUE_CONNECTION=database`, `SESSION_DRIVER=database`. With Redis, switch them to `redis`.

Queue worker and scheduler during development (low-stock notifications are queued, so they only appear in the bell while a worker runs):

```powershell
php artisan queue:work
php artisan schedule:work
```

### 3. Frontend

```powershell
cd frontend
npm install
npm run dev                   # http://localhost:5173 (proxies /api and /sanctum to :8000)
```

Set `VITE_BACKEND_ORIGIN` in `frontend/.env.local` if the backend is not on `http://127.0.0.1:8000`.

## Daily commands

| Task | Backend (`backend/`) | Frontend (`frontend/`) |
|------|----------------------|------------------------|
| Run tests | `php artisan test` | `npm test` |
| Single test/filter | `php artisan test --filter=MoneyTest` | `npx vitest run src/lib` |
| E2E | — | `npm run test:e2e` |
| Format / lint | `vendor/bin/pint` | `npm run lint` |
| Type check | — | `npm run typecheck` |
| Build | `php artisan optimize` (prod) | `npm run build` |
| API docs | open `http://localhost:8000/docs/api` | |

## Coding standards

### Backend
- PSR-12 via Laravel Pint (`vendor/bin/pint` before committing).
- New code goes in a module under `app/Modules/<Module>` following [MODULE_STRUCTURE.md](MODULE_STRUCTURE.md). Nothing new in `app/Http` or `app/Models` except framework glue.
- Controllers return `ApiResponse::*`; never `response()->json()` directly.
- Money: `Money` value object or `NUMERIC` strings. Never cast money to `float`; never use PHP float literals in calculations.
- Domain failures throw `BusinessRuleViolation` (or a subclass) with a SCREAMING_SNAKE code.
- Eloquent strict mode is on outside production: lazy loading and unknown attributes throw. Eager-load explicitly.
- Every new endpoint ships with: Form Request, Policy/authorization, API Resource, feature test (happy path, validation, authorization, tenant isolation).

### Frontend
- TypeScript `strict` + `noUncheckedIndexedAccess`; no `any` without a comment explaining why.
- Server data only through TanStack Query hooks in `features/<module>/api.ts`.
- Forms: React Hook Form + Zod; map `ApiError.fieldErrors` back to fields.
- Every async view handles loading, error (with retry) and empty states (`components/common/state-views`).
- No navigation entries or buttons for features that are not implemented.
- shadcn components: add with `npx shadcn@4.21.5 add <name>`; prefer composition over editing generated files.

## Git workflow

- Branch from `main`: `feature/<phase>-<topic>`, `fix/<topic>`.
- Conventional Commits (`feat(inventory): …`, `fix(pos): …`).
- A phase is merged only when migrations run cleanly on PostgreSQL and both test suites pass.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `could not find driver (pgsql)` | Enable `pdo_pgsql` in the PHP 8.4 `php.ini`. |
| `password authentication failed for user "pos_app"` | `DB_PASSWORD` in `backend/.env` does not match the role password. |
| `419 CSRF_TOKEN_MISMATCH` from the SPA | Use the Vite dev URL (`localhost:5173`), not the backend URL; ensure `SANCTUM_STATEFUL_DOMAINS` contains it. |
| Health page shows "Backend unreachable" | `php artisan serve` not running, or `VITE_BACKEND_ORIGIN` wrong. |
| `Failed to listen on 127.0.0.1:8000 (… forbidden by its access permissions)` | Windows reserves that port (Hyper-V/WSL excluded range; check `netsh interface ipv4 show excludedportrange protocol=tcp`). Use another port: `php artisan serve --port=8010` and `VITE_BACKEND_ORIGIN=http://127.0.0.1:8010` in `frontend/.env.local`. |
| `ORGANIZATION_CONTEXT_REQUIRED` as platform admin | Tenant endpoints need `X-Organization-Id` for platform admins. |
| A new permission does not show up in a built-in role | Run `php artisan pos:permissions:sync`. |
