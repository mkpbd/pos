# Development Guide

## Prerequisites

| Tool | Version | Notes (Windows/Laragon dev box) |
|------|---------|----------------------------------|
| PHP | 8.4 with `bcmath`, `intl`, `pdo_pgsql`, `pgsql`, `gd`, `zip` | `C:\laragon\bin\php\php-8.4.16-nts-Win32-vs17-x64` — put it first on `PATH` |
| Composer | 2.x | |
| Node.js | 22.12+ / npm 10+ | 22.12 is the minimum of `backend/pdf-renderer` (PDF exports) |
| PostgreSQL | 18 | Windows service on `127.0.0.1:5432`; `psql` at `C:\Program Files\PostgreSQL\18\bin` |
| Redis | 5+ (optional locally) | `C:\laragon\bin\redis`; the app uses the `predis` client, no PHP extension required |

`BCMath\Number` (PHP 8.4) backs all money arithmetic, so `bcmath` is mandatory. Since X1 `composer.json` requires `php ^8.4` (OpenSpout 5), so Composer refuses PHP 8.3 — on this box 8.3 is first on `PATH` by default.

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

**List exports (X1).** Excel works out of the box. PDF needs the renderer package and a Chrome once:

```powershell
cd backend\pdf-renderer
$env:PUPPETEER_SKIP_DOWNLOAD='1'; npm ci     # puppeteer-core only, no Chromium download
cd ..\..\frontend; npx playwright install chromium   # if not installed yet (also used by the E2E tests)
```

Leave `PDF_CHROME_PATH` empty locally: the app uses the newest Playwright Chromium under `%LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win64` (or `chrome-win`). The PHP server process must see `LOCALAPPDATA` and have `node` on `PATH`; otherwise set `PDF_CHROME_PATH` / `PDF_NODE_BINARY` in `backend/.env`. Without them PDF answers 503 `PDF_UNAVAILABLE` and Excel still works. Settings: `config/exports.php`, `config/pdf.php` (keys in [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)).

Queue worker and scheduler during development (low-stock notifications are queued, so they only appear in the bell while a worker runs):

```powershell
php artisan queue:work
php artisan schedule:work
```

The daily reorder alert (SC1) runs hourly from 07:00 organization time; to send it now: `php artisan purchasing:reorder-notifications --any-hour` (once per store and day — a second run the same day sends nothing). After pulling SC1, run `php artisan pos:permissions:sync` so the built-in roles get `inventory.manage`.

### 3. Frontend

```powershell
cd frontend
npm install
npm run dev                   # http://localhost:5173 (proxies /api and /sanctum to :8000)
```

Set `VITE_BACKEND_ORIGIN` in `frontend/.env.local` if the backend is not on `http://127.0.0.1:8000`.

The dev server hosts both apps: the back office at **http://localhost:5173/admin** and the online storefront at **http://localhost:5173/**. The storefront picks its organization from the host name; locally, requests to `localhost` / `127.0.0.1` are served as `STOREFRONT_DEFAULT_HOST` (set `STOREFRONT_DEFAULT_HOST=shop.localhost` in `backend/.env`; the seeder opens Demo Mart's storefront on that host). On a database seeded before E4, run `php artisan pos:permissions:sync` and add the domain under **Online store → Domains**. Media renditions are generated by a queued job, so keep `php artisan queue:work` running (or use `QUEUE_CONNECTION=sync`).

Selling needs an open register session (Phase 6). After seeding, the demo cashier's and the owner's shifts are open; anyone else opens one from the POS terminal or **Cash registers** with a counted float. Cash paid out of a session (refunds, expenses, cash out) cannot exceed the cash in its drawer, so the owner's seeded shift (float 0.00) needs a **Cash in** before a cash refund.

## Daily commands

| Task | Backend (`backend/`) | Frontend (`frontend/`) |
|------|----------------------|------------------------|
| Run tests | `php artisan test` (real PDF render: `$env:PDF_E2E='1'; php artisan test --filter=test_real_pdf_rendering_with_chrome`, `PDF_E2E_OUT=<file>` keeps the PDF) | `npm test` |
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
- Colours come from theme tokens only (`bg-primary`, `text-heading`, `bg-canvas`, badge variants `success`/`warning`/`info`/`soft`); no hex values in components. A newly generated shadcn component may need its radius/ring classes aligned with `card.tsx`, `badge.tsx` and `table.tsx`.

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
| `composer install` fails with "requires php ^8.4" | PHP 8.3 is first on `PATH`; prepend `C:\laragon\bin\php\php-8.4.16-nts-Win32-vs17-x64`. |
| PDF export answers 503 `PDF_UNAVAILABLE` | `backend/pdf-renderer/node_modules` missing (`PUPPETEER_SKIP_DOWNLOAD=1 npm ci` there), no Chromium (`npx playwright install chromium`, or set `PDF_CHROME_PATH`), or `node` not on the server process's `PATH` (`PDF_NODE_BINARY`). Render failures are logged as "PDF rendering failed.". |
