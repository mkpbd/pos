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

PostgreSQL-only tests (`StockLockingTest` and, since E8a, `CheckoutConcurrencyTest`: two real connections, committed data via `DatabaseTruncation`) skip themselves on other drivers — 3 skips on SQLite as of E8a; `CheckoutConcurrencyTest` has not run yet because the local PostgreSQL run is still blocked. A quick interim run without PostgreSQL is possible with `DB_CONNECTION=sqlite DB_DATABASE=:memory: php artisan test`, but it does not satisfy the definition of done below: row locks, the ledger trigger and PostgreSQL error codes are only exercised on PostgreSQL.

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
| 3 | POS product selection | 5 | ✅ `PosTerminalTest` (grid with price/tax/stock, categories, inactive products hidden), `cart-store.test.ts`, POS page tests |
| 4 | Barcode scanning | 5 | ✅ `PosTerminalTest::test_scanning_a_barcode_finds_the_variant`, POS page scan test, full-stack spec (scan → pay → receipt) |
| 5 | Discount calculation | 5 | ✅ `SaleCalculatorTest` (item/invoice, percent/amount, exact allocation), `DiscountAndTaxTest` (permission, product limit, customer group, preview = checkout) |
| 6 | Tax calculation | 5 | ✅ `SaleCalculatorTest` (exclusive and inclusive, per-line rounding), `DiscountAndTaxTest::test_tax_inclusive_prices_contain_the_tax` |
| 7 | Multiple payment processing | 5–6 | ✅ `PaymentSettlementTest` (split, change from cash only, partial, credit), `CheckoutTest::test_split_partial_and_credit_payments`, `CustomerPaymentTest` (collections capped at the balance, ledger and drawer, statement), `LoyaltyTest` (points as a payment method) |
| 8 | Successful checkout | 5 | ✅ `CheckoutTest` (invoice, immutability, client prices ignored, idempotent replay, rollback, numbering), POS page tests, full-stack spec |
| 9 | Inventory deduction | 5 | ✅ `CheckoutTest` (deduction, rollback on `INSUFFICIENT_STOCK`, negative-stock branches, FEFO batches, services), `SalesManagementTest` (cancellation restocks exact batches), ledger tests from Phase 4; PostgreSQL-only `StockLockingTest` |
| 10 | Sales return and refund | 6 | ✅ `SaleReturnTest` (request → approval with refunds, quantities reserved, refund caps per method, restock to original batches at cost, credit before refund, written-off lines, serial release, exact remainder, rejection, branch/organization isolation), `ReturnShareTest` |
| 11 | Cash register closing | 6 | ✅ `CashRegisterTest` (open, cash in/out, `INSUFFICIENT_CASH`, close with variance, one session per register and cashier, visibility, isolation), `CustomerPaymentTest::test_every_checkout_needs_an_open_session_and_feeds_the_ledger` |
| 12 | Branch-level data isolation | 2+ | ✅ organization/branch/user/role level (`TenantIsolationTest`); extended per module in later phases (web orders and shipping zones: `WebOrderWorkflowTest::test_orders_and_shipping_are_isolated_between_organizations`, E8a) |

E-commerce exit criteria tracked the same way:

| Phase | Criterion | Coverage |
|-------|-----------|----------|
| E7 | Cart totals shown = server totals | `CartTest` (`test_every_read_reprices_from_the_catalog`, `test_totals_equal_the_sale_calculator_in_both_tax_modes`, flagged/over-stock lines), `storefront-cart.test.tsx` (the page shows the server's figures), full-stack `a guest cart merges into the shopper account at sign-in and its totals match the server` |
| E7 | Guest cart → sign-in merge | `CartTest` (`test_guest_cart_merges_into_the_customer_cart_on_sign_in`, `…_on_registration`, capped lines), `CartRulesTest`, mocked `storefront-account-cart.spec.ts`, the full-stack test above |
| E7 | Shopper and staff identities never mix | `CustomerSessionTest` (customer cookie on staff routes, staff session on shopper routes, shopper sign-out keeps the staff session, session fixation, store A's account anonymous on store B, non-stateful host with CSRF/419) |
| E7 | Customer A never sees customer B's data | `AddressBookTest::test_another_customers_address_is_not_found`, `CartTest::test_customers_cannot_touch_each_others_cart_lines`, `CartTest::test_a_guest_cart_token_is_useless_on_another_store`, `WishlistTest::test_customers_have_separate_wishlists` |
| E8a | Order placed (brief check 13) | `CheckoutTest` (`test_guest_places_a_cash_on_delivery_order`, `test_customer_places_a_bank_transfer_order_with_a_saved_address`, COD fee / free delivery / tampered totals → `TOTAL_CHANGED`, errors, cart issues, no fulfilment store, guest checkout off), `storefront-checkout.test.tsx`, mocked `storefront-checkout.spec.ts`, full-stack `a guest places a cash-on-delivery order; the admin sees it and stock goes down once` |
| E8a | Stock deducted exactly once; idempotent retry | `CheckoutTest` (`test_placement_is_idempotent_and_scoped`, `test_a_replay_with_the_same_cart_cookie_returns_the_first_order`, `test_insufficient_stock_rolls_everything_back`, `test_web_orders_never_oversell_even_when_the_branch_allows_negative_stock`), `WebOrderWorkflowTest::test_cancel_restocks_the_exact_batches_once`, PostgreSQL-only `CheckoutConcurrencyTest` (not run yet), the full-stack test above (reloading the confirmation page places nothing; inventory shows 4 → 2) |
| E8a | Unpaid orders expire and restock | `WebOrderWorkflowTest::test_expired_bank_transfer_orders_are_cancelled_and_restocked` |
| E8a | Order visible in history (brief check 14) | `WebOrderWorkflowTest` (lifecycle, idempotent payment confirmation, permissions, isolation), `web-order-pages.test.tsx`, mocked `web-orders-admin.spec.ts`, the full-stack test above (admin web orders list and order page). The customer's own order list is E9. |

## Frontend (Vitest 5 + Testing Library)

```powershell
cd frontend
npm test                 # vitest run
npm run test:watch
npm run typecheck
```

- Tests are colocated: `*.test.ts(x)` next to the code.
- Timeouts (`vite.config.ts`, `src/test/setup.ts`, E8a): `testTimeout` is 20 s and Testing Library's `asyncUtilTimeout` (`findBy*`, `waitFor`) 5 s instead of 5 s / 1 s — form-heavy page tests (checkout, shipping zones, web order dialogs) drive many `user-event` steps and timed out on a loaded machine. A test that needs more is too slow and should be split.
- E8a page and logic tests: `storefront-checkout.test.tsx`, `checkout/checkout-logic.test.ts` (placement attempts and keys, error mapping, delivery labels), `storefront-cart.test.tsx` (checkout button), `features/web-orders` (`orders.test.ts`, `web-order-pages.test.tsx`), `features/shipping` (`shipping.test.ts`, `shipping-page.test.tsx`), `features/online-payments/pages/payment-methods-page.test.tsx`, `features/storefront/pages/checkout-settings.test.tsx`.
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
- `storefront.spec.ts` (public storefront) and `storefront-admin.spec.ts` (Online store and Media library screens) are mocked like the smoke tests. The dev server serves the storefront at `/` and the admin at `/admin`.
- `online-catalog-admin.spec.ts` (product web listing with sale price and related product, category visibility, hand-picked product carousel, menu item linking a category) and `storefront-catalog.spec.ts` (browse the shop, filter by brand, open a product and switch its variant; search suggestions and quick view; unknown product → not-found page) are mocked too; they run on both projects.
- `storefront-account-cart.spec.ts` (E7, mocked against the E7 API contract): a guest fills the cart and the wishlist, signs up and finds both in the new account, then adds an address; a guest signs in from the cart and returns to it with the guest lines merged (since E8a the cart page's *Checkout* link is checked too).
- `storefront-checkout.spec.ts` (E8a, mocked): a guest pays cash on delivery and lands on the confirmation page; a customer uses a saved address, pays by bank transfer and gets the instructions; a changed total (409 `TOTAL_CHANGED`) is shown and confirmed again. `web-orders-admin.spec.ts` (E8a, mocked): open a web order from the list and confirm its bank transfer; create a shipping zone from districts. The mocked suite: 49 pass, 2 skipped by design (the desktop/mobile navigation tests of `storefront.spec.ts`). Under heavy load one mobile `storefront-account-cart.spec.ts` test was flaky once and passed on rerun.
- `integration.spec.ts` runs against a **real backend** (Sanctum cookies, CSRF, tenancy, RBAC; since E4 also the admin → storefront path: a theme colour and a menu item changed in the admin appear on the storefront; since E5 a banner edited and a section added and moved to the top appear on the storefront in that order — brief checks 1, 2, 5, 6; since E6 `a product created and repriced in the admin shows its current price everywhere on the storefront` — a product created and published in the admin is found by search and has a product page, and after a price change in the product editor the new price shows on the product page, the shop listing, the search suggestions and the homepage carousel — brief checks 7–10; the menu test counts the existing menu items instead of assuming four; since E7 `a guest cart merges into the shopper account at sign-in and its totals match the server` — the demo shopper puts one item in the account cart and signs out, a guest adds two of it from the product page and another product from its card, signs in and finds the merged quantities on the cart page, whose total equals `GET /store/cart`; after signing out the browser has no cart; since E8a `a guest places a cash-on-delivery order; the admin sees it and stock goes down once` — brief checks 13–14: a guest buys two litchi drinks (seeded stock 4) with home delivery and cash on delivery, sees "Thank you", reloads the confirmation page (no second order), then the owner finds the order in *Web orders*, opens it, and *Inventory* shows 2 left) and is opt-in:

```powershell
cd backend;  php artisan migrate:fresh --seed; php artisan serve --port=8010   # re-seed before every run: the specs post documents
cd frontend; $env:E2E_BACKEND=1; $env:VITE_BACKEND_ORIGIN='http://127.0.0.1:8010'; npm run test:e2e -- e2e/integration.spec.ts
```

Notes for the full-stack run:
- The backend needs `STOREFRONT_DEFAULT_HOST=shop.localhost` (the seeded store) and, because the suite signs in and checks out many times a minute, `POS_API_RATE_LIMIT=1000`, `POS_AUTH_RATE_LIMIT=100` and `POS_CHECKOUT_RATE_LIMIT=1000` (the checkout page previews on every change; the default 10/min per IP makes the E8a test fail with 429). `POS_AUTH_RATE_LIMIT` (default 5) is the number of sign-in / password-reset attempts per minute per account and IP (four times that per IP); the suite signs the owner in more than five times a minute, so the default makes later specs fail with 429.
- `php artisan serve` passes only a few environment variables to its PHP process; to override `DB_*` and the settings above from the shell, run `php -S 127.0.0.1:8010 ../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php` from `backend/public` instead.
- If another dev server already holds port 5173, Playwright would reuse it (and its backend). Set `E2E_PORT=5180` and add `localhost:5180` to `SANCTUM_STATEFUL_DOMAINS` of the test backend. The same applies to any port: a leftover dev server or `php -S` from an earlier run is silently reused (Windows lets several processes listen on one port), so if results do not match a fresh seed, check for old `node`/`php` processes and pick unused ports.
- Run one project per fresh seed (`--project=desktop-chromium`): both projects post documents into the same database. The admin's mobile layout hides the sidebar links the first specs click, so the full-stack suite currently passes on desktop only (11/11 on `desktop-chromium` against a fresh seed in E8a, 10/10 in E7; the E6 product test and the E8a order test skip themselves on mobile).
- **Re-seed before every run** also because of the E7 cart test: it uses the demo shopper's account cart and expects it to start empty (the seed creates no cart), so a second run against the same database finds the previous run's lines and fails on the quantities. The E8a order test likewise expects the seeded litchi stock (4 → 2) and no earlier web orders.
- The storefront runs on the Vite host (`localhost:5173`, listed in `SANCTUM_STATEFUL_DOMAINS`), so browser requests there are usually made stateful by Sanctum and `storefront.session` steps aside. The production path — a storefront host that is not stateful, with its own session, CSRF and 419 — is covered by the backend `CustomerSessionTest`.

## Definition of done per phase

1. `php artisan migrate:fresh` succeeds on PostgreSQL.
2. `php artisan test` green.
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` green.
4. `npm run test:e2e` green.
5. Endpoints verified in Scramble docs; frontend integrated against the real API.
6. Docs and CHANGELOG updated.
