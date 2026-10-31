# Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Phase 6 — Payments, returns, refunds, cash registers, expenses, loyalty

#### Added
- **Payments module:** organization-wide payments ledger (`payments`, append-only) fed by every module through the `PaymentLedger` contract; cash registers per branch; register sessions (`SES-{BRANCH}-000001`) with opening float, cash in/out, closing count, expected cash and variance; X/Z session reports (cash reconciliation, totals per method and per kind of transaction); payment history with totals.
- **Sales returns and refunds:** returns against the original invoice (`RET-{BRANCH}-000001`) with an approval workflow (pending → completed/rejected; approvers' own returns complete at once), return reasons with a default restocking rule, per-line restock or write-off, restock to the exact batches sold from at their cost, serial numbers released, values from the invoice line (discounts and tax included, exact remainder on the last return), settlement against what the customer still owes before refunding, refunds by method (card/mobile/points capped at what was paid that way), preview endpoint.
- **Receivables:** customer payments (`RCP-000001`, capped at the balance) and customer statements with running balance; balances now subtract return credits and payments.
- **Expenses module:** expense and income categories, expenses and other income (`EXP-` / `INC-`), voiding with a reversing payment.
- **Loyalty module:** program settings (points per spend, point value, minimum redemption), point accounts and an append-only points ledger; points earned at checkout, redeemed as the `loyalty_points` payment method, reversed on cancellation and returns, manual adjustments. Plugs into Sales through the Sales-owned `LoyaltyProgram` contract.
- Permissions: `payments.view`, `payments.collect`, `cash_registers.view|operate|manage`, `returns.view|create|approve|manage`, `expenses.view|manage`, `loyalty.view|manage` (Cashier: operate registers, request returns, collect payments).
- Demo data: two registers, the cashier's open shift, return reasons, expense categories, an enabled loyalty program, a customer payment and an expense.
- Frontend:
  - **Cash registers** (`/cash-registers`): registers per branch with their open session, add/edit (managers), open a session with a counted float; session list with variance badges; X/Z report page (cash reconciliation, by method, by transaction type, entries) with cash in/out and close-with-count (live variance preview).
  - **POS terminal:** register-session bar (number, expected cash, cash in/out, close); without a session the till asks to open one before taking payment; loyalty points as a payment method for the selected customer (whole points, minimum redemption, “Use points” fills the affordable amount).
  - **Returns** (`/returns`): “Return items” on the invoice → per-line quantities or serials, restock switch defaulting from the reason, server preview of value and settlement (credit against the balance, refund due), refund split over the methods the invoice allows (card/mobile/points capped, rest in cash); approvers complete at once, others send for approval; return document with approve (refunds) / reject; return reasons tab. The invoice lists its returns and hides “Cancel sale” once it has any.
  - **Payments** (`/payments`): payments ledger with period, direction, method and type filters, totals, links to sales, returns and sessions; customer payments list.
  - **Customers:** account sheet per customer — running statement with “Receive payment”, loyalty points with history and manual adjustment; points column.
  - **Expenses** (`/expenses`): expenses and other income with period/category filters, totals by category, new entry (cash through the caller's session), void; categories tab.
  - **Loyalty** (`/loyalty`): program rules with a worked example.
  - Every money-moving mutation (checkout, cancellation, return, collection, expense) refreshes the ledger, register sessions, customer accounts and points.
- Tests: 240 backend tests (2 PostgreSQL-only skipped on SQLite) — new `CashRegisterTest`, `SaleReturnTest`, `CustomerPaymentTest`, `ExpenseTest`, `LoyaltyTest`, `ReturnShareTest`, `PointsRuleTest`; 87 Vitest tests (new: refunds and points arithmetic, partial return with immediate card refund, return sent for approval, approval with credit and cash refund, till asks for a register session, X→Z report close with variance, expense blocked without a session then paid by bank); 6 Playwright smoke tests; 6 full-stack Playwright tests (new: a cashier requests a return, the owner tops up the drawer and approves it with a cash refund out of the shift).

#### Changed
- **Every POS checkout needs the cashier's open register session** in the store's branch (`CASH_SESSION_REQUIRED`); cash refunds, cancellations, collections and expenses go through the user's drawer and cannot take it below zero (`INSUFFICIENT_CASH`).
- Cancelling a sale writes ledger reversals, reverses loyalty points, and is refused once the sale has returns (`SALE_HAS_RETURNS`).
- The sale document lists its returns and per-line returned quantities.
- `Idempotency-Key` is now also required on returns, return approvals, customer payments, expenses and cash movements.

### UI theme refresh

#### Changed
- New visual theme for the SPA, light and dark: purple top bar with brand and branch switcher over a fixed white icon sidebar (uppercase entries, highlighted active icon), grey page canvas, flat cards with hairline shadow and uppercase titles, tinted table headers, soft status badges (Active/Completed/Received in green, partially received and low stock in amber, in transit in cyan), Plus Jakarta Sans font (replaces Geist).
- Sales summary cards show the value in the primary colour with a round icon.
- Sign-in pages use the same top bar and canvas.

### Phase 5 — POS terminal and sales processing

#### Added
- **Sales module:** immutable sale invoices numbered per branch (`INV-{BRANCH}-000001`, prefix from organization settings) with product snapshots, cost of goods, batch allocations, serial numbers and payments; `SaleCalculator` (item and invoice discounts as percent or amount, exact allocation of invoice discounts, tax-inclusive and tax-exclusive pricing with per-line rounding); `PaymentSettlement` (split payments, change from cash only, partial payments leaving a due); customer credit limits under a per-customer lock; discount rules (`sales.discount`, product max. discount %, automatic customer group discount); cancellation (restock to the exact batches, negative payment reversals, serials released, audited); sales history with filters; daily sales summary with payments by method; customer balances.
- **POS module:** product grid with stock of the selling store, barcode/SKU lookup, live server pricing of the cart, held (parked) carts per branch, idempotent checkout that also consumes a resumed held cart.
- **Shared idempotency:** `idempotent` route middleware and `idempotency_keys` table (replay of successful responses, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_REQUEST_IN_PROGRESS`, `IDEMPOTENCY_KEY_REQUIRED`), pruned daily by the scheduler.
- Inventory: first-expiry-first-out batch allocation inside the stock ledger (expired batches are never sold), `StockLevels` contract for availability, movement type `sale_cancellation`.
- Directories: `CustomerDirectory` (Customers), `CatalogDirectory::categoryWithDescendants`, `ProductDirectory::sellablePage` and `max_discount_percent`, `BranchDirectory::profile` and store `branch_code`, `OrganizationDirectory` document settings, `UserDirectory::names`.
- Permissions: `pos.sell`, `sales.view`, `sales.discount`, `sales.credit`, `sales.cancel` (Cashier: `pos.*`, `sales.view`; Branch Manager: `pos.*`, `sales.*`).
- Demo sales seeder (a walk-in cash sale with change and a wholesale customer on account).
- Frontend: POS terminal (scan field, categories and product grid with stock, cart with quantity steppers, line and invoice discounts, serial capture, customer picker with credit position, held sales, recent sales, payment dialog with split/partial payments and change, receipt preview and printing for 58 mm / 80 mm thermal and A4, shortcuts F2/F4/F8/F9, cart persisted per branch, idempotency key reused on retry), Sales pages (daily summary, history, invoice detail with receipt and cancellation), customer balances on the Customers page.
- Tests: 217 backend tests (2 PostgreSQL-only skipped on SQLite); 74 Vitest tests; 6 Playwright smoke tests; 5 full-stack Playwright tests (new: a cashier scans, takes cash and the sale reaches stock and history).

#### Changed
- Users land on the POS terminal when they may sell (first navigation entry), otherwise on the first page their role may open.
- The stock ledger reports per-batch allocations for every change.

### Phase 4 — Purchasing and inventory

#### Added
- **Inventory module:** `StockLedger` as the single write path for stock — row-locked `stock_levels` projection (deterministic lock order, insert-if-missing then `FOR UPDATE`, availability checked after the lock), append-only `stock_movements` ledger with `balance_after` (PostgreSQL trigger + model guard), weighted average cost at 4 decimals, per-branch negative-stock setting (`INSUFFICIENT_STOCK` otherwise), batches with expiry (`BATCH_EXPIRY_MISMATCH`), untracked products and services skipped.
- Stock adjustments (`ADJ-`; opening, count, damage, expiry, theft, correction, other — with sign rules per reason), two-step stock transfers between any active stores (`TRF-`; dispatch at source average cost, receive or cancel), stock list with low-stock filter, batch/expiry list, movement history, valuation (cost-gated).
- **Purchasing module:** purchase orders (`PO-`; draft → ordered → partially received → received, cancel), goods receipts that are the supplier invoice (`GRN-`; stock in + payable in one transaction, against an order or standalone, open-quantity cap, duplicate supplier-invoice guard, due date from payment terms), purchase returns limited to the returnable quantity at original cost and batch (`PRN-`), supplier payments (`SPAY-`), supplier balances and running statements computed from documents. All totals computed server-side with `Money`/`Decimal`.
- **Notifications module:** in-app inbox (`/notifications`, unread count, mark read / all read). First notification: low stock — `StockFellBelowReorderLevel` is dispatched after commit and a queued listener notifies users with `inventory.view` for the branch.
- Shared: `Decimal` helper (BCMath, fixed scales) and `Money::ofProduct()`; directory contracts `ProductDirectory`, `UserDirectory`, `BatchDirectory`; `BranchDirectory::store()/storeSummaries()`; `TenantUnique::withMessage()`.
- Demo stock seeder (opening stock, an open purchase order, a posted receipt).
- Frontend: Inventory area (Stock with low-stock filter, Batches & expiry, Movements, Adjustments, Transfers with receive/cancel), Purchasing area (orders with draft/place/cancel, receive goods against an order with open quantities pre-filled, receipts with returns, purchase returns, supplier payments), supplier balances and statement sheet on the Suppliers page, notification bell, reusable product-lines editor (product search/scan picker, batch picker, signed quantities), exact decimal comparison/subtraction (`compareDecimal`, `subtractDecimal`) so quantities never touch floats.
- Tests: 179 backend tests (2 PostgreSQL-only lock tests skipped until PostgreSQL is configured); 63 Vitest tests; 6 Playwright smoke tests; 4 full-stack Playwright tests (new: receiving a purchase order moves stock 60 → 156 and the supplier balance).

#### Changed
- Accountant role gains `purchases.pay` (supplier payments).
- Suppliers page shows the balance owed (with `purchases.view`) instead of the opening balance.
- Mobile header: brand hidden below `sm` and branch switcher narrower so the notification bell, theme and account buttons stay reachable.

#### Deferred
- Serial-number capture (products can already be flagged `track_serials`): with the POS in Phase 5, where serials are scanned at sale time.

### Phase 3 — Products, catalog, suppliers and customers

#### Added
- **Catalog module:** categories (tree, max 4 levels, cycle protection), brands, units of measure with one-level conversion (box = 12 pcs), tax rates; case-insensitive uniqueness per organization; deletion refused with `IN_USE` while referenced.
- **Products module:** products with variants (options x values matrix), SKUs (auto-numbered when blank), multiple barcodes per variant with GS1 check-digit validation, purchase/selling/wholesale prices as NUMERIC, reorder level, max item discount, stock/batch/serial tracking flags, services, images (JPEG/PNG/WebP, random names, max 8), archive/restore, barcode/SKU lookup for the till, search by name/SKU/barcode. Price changes are audited with before/after values. Cost prices only for `products.view_cost`.
- **Suppliers module:** supplier master data with auto codes, payment terms, opening balance, archive/restore.
- **Customers module:** customers with auto codes, normalised unique phone numbers, groups with default discount, credit limit and opening balance (only with `customers.manage`; cashiers can register customers at the till), archive/restore with phone-conflict detection.
- Shared: `SequenceGenerator` (gap-free per-organization numbers), `TenantUnique` validation rule, `ReferentialIntegrity` helper, `409 CONFLICT` for unique-index races, paginated responses with per-item presenters.
- Demo catalogue seeder.
- Frontend: Products list (search incl. barcode scan, category filter, archived view with restore), product editor (details, stock tracking, variant generator, per-variant prices/barcodes, nested server errors, images), Catalog page (category tree, brands, units, tax rates), Suppliers and Customers pages (incl. customer groups), exact decimal-string money formatting, multipart uploads, route-level code splitting (main bundle 847 kB to 533 kB).
- Tests: 148 backend tests; 44 Vitest tests; 6 Playwright smoke tests; 3 full-stack Playwright tests (now including product creation and cost-price hiding).

#### Changed
- Accountant role gains product (incl. cost) visibility and tax-rate management; Cashier gains product view and customer registration.
- Users land on the first page their role may open (Products for most roles).

### Phase 2 — Authentication, authorization, organizations and branches

#### Added
- **Organizations module:** organizations (tenants) with profile, timezone, tax mode (inclusive/exclusive), receipt settings and immutable base currency; one-transaction provisioning (organization → main branch + main store → built-in roles → first admin); `tenant` middleware resolving organization and `X-Branch-Id`, rejecting inactive users and suspended organizations on every request; platform-admin API to list, provision, suspend and reactivate organizations.
- **Branches module:** branches with trading flags (`allow_negative_stock`), stores/warehouses per branch, `BranchDirectory` contract; guard against deactivating the last active branch.
- **Users module:** UUID users, organization-scoped roles, code-declared permission catalog (`PermissionRegistry`, `pos:permissions:sync`), five built-in roles defined by permission patterns, custom roles, branch membership; guards against self lock-out, losing the last active Organization Admin, and privilege escalation (no granting permissions you lack, no editing more powerful users).
- **Authentication module:** Sanctum SPA cookie login, device tokens with expiry, self-service sign-up, password forgot/reset (links to the SPA) and change, logout per credential, login activity for every attempt, `auth` rate limiter, enumeration-resistant failures.
- **Audit module:** append-only `audit_logs` with before/after diffs, secret redaction, request id and IP; audit and login-activity APIs.
- Shared kernel: `TenantContext`, `BelongsToOrganization` (tenant scope + stamping), `TracksAuthor`, `AuditTrail` and `TenantUser` contracts, `ListQuery` (search/sort/pagination), `Changes` diff helper.
- Development seeder (platform admin, demo organization admin and cashier).
- Frontend: session bootstrap via `/auth/me`, route guards (auth, guest, permission, platform), sign-in / sign-up / forgot / reset pages, branch switcher sending `X-Branch-Id`, permission-filtered navigation, account menu; pages for Branches (+ stores), Users, Roles & permissions, Organization settings, Audit log, Profile & security (password, devices, sign-in history) and platform Organizations.
- Tests: 98 backend tests (incl. tenant isolation, RBAC, lock-out guards, auth flows); 26 Vitest tests; 6 Playwright smoke tests; opt-in full-stack Playwright spec against a real backend.

#### Changed
- `ResolveTenant` runs before route-model binding (middleware priority) so bound models are tenant-scoped.
- Users table moved into the Users module and switched to UUID primary keys; Sanctum tokens use UUID morphs.
- `.env.example`: `POS_*` settings.

#### Fixed
- Frontend no longer issues requests with a stale `X-Branch-Id` from a previous session; rendering waits until the active branch is valid.

### Phase 1 — Project setup and architecture

#### Added
- Backend: Laravel 13 on PHP 8.4 with Sanctum 4, Scramble (OpenAPI at `/docs/api`), Predis.
- Backend: modular monolith skeleton under `app/Modules` with an auto-wiring `ModuleServiceProvider` (module routes under `/api/v1`, module migrations).
- Backend shared kernel: `Money` value object on `BCMath\Number` (no floats, half-away-from-zero rounding, loss-free allocation), `BusinessRuleViolation`, unified `ApiResponse` envelope, `ApiExceptionRenderer`, `AssignRequestId` middleware (`X-Request-Id` on responses, logs and jobs).
- Backend: `GET /api/v1/health` reporting database and cache status (200/503) without leaking error details.
- Backend: API rate limiter (120/min per user or IP), Eloquent strict mode outside production.
- Backend: `Modules` PHPUnit suite; tests target PostgreSQL `pos_test`.
- Database: `database/scripts/create_local_databases.sql` to create role `pos_app` and databases `pos`, `pos_test`.
- Frontend: React 19 + Vite 8 + TypeScript 7 (strict, `noUncheckedIndexedAccess`), Tailwind CSS 4, shadcn/ui (Radix, Nova preset), React Router 8, TanStack Query 5, Zustand 5.
- Frontend: typed API client for the envelope (`ApiError` with codes/field errors, XSRF + idempotency headers), query client defaults, app shell with responsive sidebar, light/dark/system theme, loading/error/empty state components, system status page.
- Frontend tests: Vitest + Testing Library (12 tests), Playwright smoke specs on desktop and mobile viewports (6 tests).
- Documentation: README, ARCHITECTURE, MODULE_STRUCTURE, DATABASE_DESIGN, API_DOCUMENTATION, DEVELOPMENT_GUIDE, TESTING_GUIDE, DEPLOYMENT_GUIDE, AI_INTEGRATION, CHANGELOG.

#### Changed
- `.env.example` defaults to PostgreSQL, Predis and Sanctum SPA stateful domains.
