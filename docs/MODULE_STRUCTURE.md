# Module Structure

## Backend module template

```
app/Modules/Inventory/
├── InventoryServiceProvider.php          # extends Shared\Infrastructure\Providers\ModuleServiceProvider
├── Domain/
│   ├── Entities/                         # plain PHP objects with behaviour (e.g. StockLevel)
│   ├── ValueObjects/                     # Quantity, BatchNumber, …
│   ├── Events/                           # StockAdjusted, LowStockDetected
│   ├── Exceptions/                       # InsufficientStock extends BusinessRuleViolation
│   ├── Repositories/                     # interfaces only (StockRepository)
│   └── Services/                         # pure domain services (FifoCostCalculator)
├── Application/
│   ├── Actions/                          # one use case per class (AdjustStock, TransferStock)
│   ├── DTOs/                             # typed input/output of actions
│   └── Contracts/                        # interfaces OTHER modules may call (StockReservation)
├── Infrastructure/
│   ├── Database/Migrations/              # auto-loaded by ModuleServiceProvider
│   ├── Database/Factories/
│   ├── Models/                           # Eloquent models (private to this module)
│   ├── Repositories/                     # Eloquent implementations of Domain repositories
│   ├── Listeners/  Jobs/
│   └── ...
├── Presentation/
│   ├── Routes/api.php                    # auto-mounted under /api/v1 with the "api" middleware group
│   ├── Http/Controllers/                 # thin: authorize → call action → return ApiResponse
│   ├── Http/Requests/                    # Form Requests (shape validation only)
│   ├── Http/Resources/                   # API Resources (output shape)
│   └── Policies/
└── Tests/
    ├── Unit/                             # domain + application logic, no HTTP
    └── Feature/                          # HTTP + database
```

Create only the folders a module actually needs.

### Rules

1. **Controllers are thin.** No calculations, no queries beyond route-model binding; call one Application action.
2. **Form Requests validate shape** (types, required, formats). **Actions validate business rules** (stock available, credit limit) and throw `BusinessRuleViolation`.
3. **Eloquent models stay inside their module.** Other modules use `Application/Contracts` or listen to events.
4. **Every financial action runs in a transaction** inside the Application layer, not in the controller.
5. **Every route is authorized** (policy or `can:` middleware) and tenant-scoped.
6. **Module tests live in the module** (`Tests/Unit`, `Tests/Feature`) and are picked up by the `Modules` PHPUnit suite.

### Adding a module

1. Create `app/Modules/<Name>/<Name>ServiceProvider.php` extending `ModuleServiceProvider`.
2. Register it in `backend/bootstrap/providers.php`.
3. Add `Presentation/Routes/api.php` and/or `Infrastructure/Database/Migrations/` as needed — they are wired automatically.
4. Add the module's frontend feature folder and, once endpoints work, its navigation entry.

## Module map and boundaries

| Module | Owns | Depends on (contracts/events) | Phase |
|--------|------|-------------------------------|-------|
| Shared | Kernel: Money, envelope, exceptions, base provider, tenancy, permission registry | — | 1–2 ✅ |
| System | Health/status endpoints | Shared | 1 ✅ |
| Audit | `audit_logs` (append-only), `AuditTrail` implementation, audit API | Shared | 2 ✅ |
| Organizations | Organizations, tenant resolution middleware, provisioning, org settings (tax mode, receipt), platform admin API | Branches (actions, `BranchDirectory`), Users (actions) | 2 ✅ |
| Branches | Branches, stores/warehouses, branch trading flags | Shared | 2 ✅ |
| Users | Users, roles, permission catalog, branch membership | Branches (`BranchDirectory`) | 2 ✅ |
| Authentication | SPA session login, device tokens, sign-up, password reset/change, login activity | Users (auth model), Organizations | 2 ✅ |
| Settings | App-wide typed settings beyond organization/branch columns (added when first needed) | Organizations, Branches | later |
| Catalog | Categories (tree, max 4 levels), brands, units of measure (one-level conversion), tax rates; `CatalogDirectory` | Shared | 3 ✅ |
| Products | Products, variants (SKU, prices, option values), barcodes (GS1 check), images, archive/restore, code lookup | Catalog (`CatalogDirectory`) | 3 ✅ |
| Suppliers | Supplier master data, payment terms, opening balance (ledger balances in Phase 4) | Shared | 3 ✅ |
| Customers | Customers, customer groups (default discount), credit limits, opening balance (statements/loyalty in Phases 5–6) | Shared | 3 ✅ |
| Inventory | Stock levels, stock ledger, batches/expiry, serials, adjustments, transfers, valuation | Products, Branches | 4 |
| Purchasing | Purchase orders, invoices, goods receipt, purchase returns, supplier payments | Suppliers, Products, Inventory | 4 |
| Discounts | Discount rules and limits | Products, Customers | 5 |
| POS | Terminal sessions, holds/drafts, cart pricing, checkout orchestration | Sales, Inventory, Payments, Discounts | 5 |
| Sales | Sale invoices (immutable), cancellation, history | Products, Customers | 5 |
| Payments | Payment methods, payment ledger, split/partial/due payments, cash register | Sales, Purchasing | 6 |
| Returns, Refunds | Sales/purchase returns, approval workflow, refunds, restocking rules | Sales, Inventory, Payments | 6 |
| Expenses | Expense categories and entries, income | Payments | 6 |
| Loyalty | Points accrual/redemption | Customers, Sales events | 6 |
| Reports | Read-only views, report definitions, exports | All (read-only views) | 7 |
| Notifications | Low stock, expiry, daily summary channels | Events from all modules | 7 |
| AI | Provider abstraction, insights, NL reporting over Reports definitions | Reports | 8 |

## Frontend feature template

```
src/features/<module>/
  api.ts            # query keys, fetchers, useXQuery / useXMutation hooks
  schemas.ts        # Zod schemas shared by forms
  types.ts          # API types for this feature
  pages/            # route-level components
  components/       # feature-specific components
  *.test.tsx        # colocated tests
```
