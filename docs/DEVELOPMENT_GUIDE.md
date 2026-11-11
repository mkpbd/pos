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
| `manager@demo.test` | `password` | Branch Manager of *Dhaka Main* ("Demo Floor Manager", Phase 7 demo history) |
| `cashier@demo.test` | `password` | Cashier at *Dhaka Main* |

The seeder also creates a demo catalogue for *Demo Mart* (units, VAT rates, categories, brands, four products incl. a variant product and a service, two suppliers, a customer group and two customers) through the same application actions as the API.

Demo stock (`DemoStockSeeder`): an opening-stock adjustment in store `MAIN` (juice 60, rice 250.5 kg, polo shirts by size), purchase order `PO-000001` for 96 juice from Pran (placed, not yet received) and goods receipt `GRN-000001` for 100 kg rice from Local Mills (invoice `LM-1042`), so Inventory, Purchasing and supplier balances have data on first start.

Demo sales (`DemoSalesSeeder`): `INV-MAIN-000001`, a walk-in cash sale by the cashier with change, and `INV-MAIN-000002`, Rahman Traders (wholesale group −5 %) paying 1,000 by card with the rest on account.

Demo reporting history (`DemoReportsSeeder`, Phase 7, runs last) goes through the real sale, return, register, stock and web-order actions. It uses only products of its own, so earlier demo documents and the stock the full-stack tests count stay unchanged: juice 54, Miniket rice 321, `WEB-000001`–`003`, `PO-000001`–`004`, `GRN-000001`–`003`, and the owner's and cashier's open shifts. It creates:
- categories *Snacks* (under *Grocery*) and *Household*;
- *Butter Cookies 200g* (`DEMO-COOKIES-200`, VAT 15 %) and *Atta Flour 2kg* (`DEMO-ATTA-2KG`, no VAT);
- *Bath Soap 100g* (`DEMO-SOAP-100`, VAT 15 %, batch-tracked): batch `SOAP-A` expires 12 days after seeding, so it shows in the *Expiry* report;
- *Dishwashing Liquid 500ml* (`DEMO-DISH-500`, VAT 7.5 %): its reorder level 120 is above its stock, so it is on the dashboard's low-stock list and in the *Low stock* report;
- an opening stock adjustment 61 days back;
- `manager@demo.test` on the new register *T3 — Counter 2*, with 61 closed shifts `SES-MAIN-000003`…`063` (one per day for the last 60 days and today);
- 276 POS sales `INV-MAIN-000003`…`278` (3–6 a day, cash, card or mobile banking);
- 8 returns `RET-MAIN-000001`…`008` (one item every 7th day);
- 6 delivered cash-on-delivery guest web orders `WEB-000004`…`009` (RedX, COD recorded). Their listings are published only while ordering, so the storefront catalogue is unchanged.

After a fresh seed the next numbers are `INV-MAIN-000279`, `RET-MAIN-000009` and `WEB-000010`.

Sign in as `owner@demo.test` or `manager@demo.test` to land on the *Dashboard*. `cashier@demo.test` still lands on the POS terminal and sees the dashboard of their branch without profit figures. Reports are under *Reports*; P&L and tax need `reports.financial`, and cost columns need `products.view_cost`. After pulling Phase 7, run `php artisan migrate` (reporting indexes) and `php artisan pos:permissions:sync` (`reports.view`, `reports.financial`, `dashboard.view`), or `php artisan migrate:fresh --seed` for the demo history.

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

The quotes-overdue reminder (SC2) also runs hourly from 07:00 organization time; to run it now: `php artisan purchasing:rfq-reminders --any-hour` (prints "Sent N RFQ reminder(s)."; it only reminds about `sent` RFQs whose reply-by date is before today with suppliers that have not answered, once per RFQ and day — the seeded `RFQ-000001` replies by 5 days after seeding, so a fresh seed sends nothing). After pulling SC2, run `php artisan migrate` and `php artisan pos:permissions:sync` (new `purchases.request`, `purchases.approve`, `purchases.approve_high`, `purchases.settings` and the changed Branch Manager / Inventory Manager / Cashier lists), or `php artisan migrate:fresh --seed` for the demo requisitions and RFQ. Sign in as `cashier@demo.test` to raise a requisition (*Requisitions* in the sidebar) and as `owner@demo.test` to approve it (*Purchasing → Approvals*). RFQ e-mails are queued, so they go out only while `php artisan queue:work` runs (or with `QUEUE_CONNECTION=sync`); the seeded suppliers have no e-mail address — add one to a supplier to try it (with the `log` mailer the message ends up in `storage/logs/laravel.log`). Sending to a supplier with an address and the PDF download need the X1 PDF renderer (see above).

AI (Phase 8 / AI1) is off by default and every other screen works without it; *AI Insights* still shows its deterministic facts. To try it:

- **Without a key (UI only):** in `backend/.env` set `AI_ENABLED=true` and `AI_PROVIDER=fake` (allowed only when `APP_ENV` is not `production`). Every model call then answers the fixed text "This is a test answer." without calling tools, so Ask shows that text with no report table, and the insight pages show it as their summary. Useful for checking the screens, settings, usage and budget; not for answers.
- **With a key:** `AI_ENABLED=true`, `AI_PROVIDER=anthropic`, `AI_API_KEY=<your key>` (optionally `AI_MODEL`, default `claude-sonnet-5-5`). Never commit the key; `backend/.env` is git-ignored. Then `php artisan config:clear` if the config is cached. Sign in as `owner@demo.test` → *AI Insights* → *Ask* ("How were sales in the last 7 days?", "আজকের বিক্রি কত?"), *Business* (yesterday / this month), *Customers*; *Purchasing → Reorder* → *Explain with AI*; *Organization → AI* for the switch, budget and usage. Calls go to `api.anthropic.com` and cost tokens.
- `php artisan ai:daily-insights --any-hour` stores yesterday's insights now (once per organization / branch and day; `--date=Y-m-d` for another closed day).
- After pulling Phase 8: `php artisan migrate` (AI tables) and `php artisan pos:permissions:sync` (`ai.ask`, `ai.insights`, `ai.manage`).
- Tests never call the provider: `phpunit.xml` forces AI off and the AI tests use a scripted model.

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
| `fe_sendauth: no password supplied` | `DB_PASSWORD` in `backend/.env` is empty; set it to the `pos_app` password. |
| A new migration fails on PostgreSQL with SQLSTATE 42830 (`there is no unique constraint matching given keys`) | A self-referencing foreign key declared inside `Schema::create`; add it in a `Schema::table` after the create ([DATABASE_DESIGN.md § Conventions](DATABASE_DESIGN.md)). |
| A second `migrate:fresh` fails with 42723 (`function … already exists`) | A trigger function created with `CREATE FUNCTION`; use `CREATE OR REPLACE FUNCTION`. |
| Timestamps stored hours off on PostgreSQL | The session timezone is not UTC; keep `'timezone' => 'UTC'` on the `pgsql` connection in `config/database.php`. |
| `419 CSRF_TOKEN_MISMATCH` from the SPA | Use the Vite dev URL (`localhost:5173`), not the backend URL; ensure `SANCTUM_STATEFUL_DOMAINS` contains it. |
| Health page shows "Backend unreachable" | `php artisan serve` not running, or `VITE_BACKEND_ORIGIN` wrong. |
| `Failed to listen on 127.0.0.1:8000 (… forbidden by its access permissions)` | Windows reserves that port (Hyper-V/WSL excluded range; check `netsh interface ipv4 show excludedportrange protocol=tcp`). Use another port: `php artisan serve --port=8010` and `VITE_BACKEND_ORIGIN=http://127.0.0.1:8010` in `frontend/.env.local`. |
| `ORGANIZATION_CONTEXT_REQUIRED` as platform admin | Tenant endpoints need `X-Organization-Id` for platform admins. |
| A new permission does not show up in a built-in role | Run `php artisan pos:permissions:sync`. |
| `composer install` fails with "requires php ^8.4" | PHP 8.3 is first on `PATH`; prepend `C:\laragon\bin\php\php-8.4.16-nts-Win32-vs17-x64`. |
| *Ask* says AI is unavailable / `503 AI_UNAVAILABLE` | `AI_ENABLED` not `true`, no `AI_API_KEY` (with `AI_PROVIDER=anthropic`), `AI_PROVIDER=fake` with `APP_ENV=production`, the organization switched AI off (*Organization → AI*), or a cached config (`php artisan config:clear`). `details.reason` says which (`disabled`, `not_configured`, `provider_auth`, `timeout`, …). |
| `429 AI_BUDGET_EXCEEDED` | The organization used its monthly token budget; raise it under *Organization → AI* (`0` = unlimited). |
| PDF export answers 503 `PDF_UNAVAILABLE` | `backend/pdf-renderer/node_modules` missing (`PUPPETEER_SKIP_DOWNLOAD=1 npm ci` there), no Chromium (`npx playwright install chromium`, or set `PDF_CHROME_PATH`), or `node` not on the server process's `PATH` (`PDF_NODE_BINARY`). Render failures are logged as "PDF rendering failed.". |
