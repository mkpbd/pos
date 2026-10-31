# Enterprise POS — agent guide

Laravel 13 / PHP 8.4 API in `backend/` (modular monolith, PostgreSQL 18), React 19 + TS SPA in `frontend/`. Read `docs/ARCHITECTURE.md` and `docs/MODULE_STRUCTURE.md` before adding code.

## Environment (Windows dev box)
- PHP 8.4: prepend `/c/laragon/bin/php/php-8.4.16-nts-Win32-vs17-x64` to PATH (8.3 is also installed and first on PATH by default).
- PostgreSQL 18 service on 127.0.0.1:5432; DBs `pos` / `pos_test`, role `pos_app`. Never read or print `backend/.env` secrets.
- Redis optional locally (predis client).

## Commands
- Backend: `php artisan test`, `vendor/bin/pint`, `php artisan migrate`.
- Frontend: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`.

## Non-negotiables
- Business logic in module Domain/Application layers; controllers thin and return `ApiResponse::*`.
- Money via `App\Modules\Shared\Domain\ValueObjects\Money` / NUMERIC strings — never floats.
- Financial operations in DB transactions; server recomputes all totals; checkout/payments idempotent.
- Every tenant-owned query scoped by organization/branch; tests for isolation.
- No placeholder UI: a nav entry appears only when its endpoints work.
- Work phase by phase (README roadmap); checkpoint with the user after each phase. Update CHANGELOG + docs per phase.
