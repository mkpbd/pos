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
│   ├── Routes/web.php                    # optional HTML pages, mounted with the "web" group (storefront shell)
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
| Shared | Kernel: Money, envelope, exceptions (`BusinessRuleViolation` with an optional HTTP status, E8a), base provider, tenancy, permission registry; `StaffActor` (acting staff user for author/audit columns, E7), `BangladeshMobile` (E7); `idempotent` middleware with scoped keys (`idempotent:shopper` asks the `ShopperIdempotencyScope` interface, implemented by Cart, E8a); trusted proxies (`config/trustedproxy.php`, E8a) | — | 1–2 ✅ |
| System | Health/status endpoints | Shared | 1 ✅ |
| Audit | `audit_logs` (append-only), `AuditTrail` implementation, audit API | Shared | 2 ✅ |
| Organizations | Organizations, tenant resolution middleware, provisioning, org settings (tax mode, receipt), platform admin API | Branches (actions, `BranchDirectory`), Users (actions) | 2 ✅ |
| Branches | Branches, stores/warehouses, branch trading flags | Shared | 2 ✅ |
| Users | Users, roles, permission catalog, branch membership; `UserDirectory` (names, recipients by permission in a branch or — E8a — in the whole organization) | Branches (`BranchDirectory`) | 2 ✅ |
| Authentication | SPA session login, device tokens, sign-up, password reset/change, login activity | Users (auth model), Organizations | 2 ✅ |
| Settings | App-wide typed settings beyond organization/branch columns (added when first needed) | Organizations, Branches | later |
| Catalog | Categories (tree, max 4 levels), brands, units of measure (one-level conversion), tax rates, attribute dictionary (attributes with ordered values and swatches, linked to product options by name); `CatalogDirectory` | Shared | 3 ✅ (attributes E6 ✅) |
| Products | Products, variants (SKU, prices, option values), barcodes (GS1 check), images, archive/restore, code lookup; `ProductDirectory` (incl. `products()` — names of non-archived products, E8b promotion targets) | Catalog (`CatalogDirectory`) | 3 ✅ |
| Suppliers | Supplier master data, payment terms, opening balance; `SupplierDirectory` (balances are computed by Purchasing) | Shared | 3 ✅ |
| Customers | Customers, customer groups (default discount), credit limits, opening balance (statements/loyalty in Phases 5–6); **online store addresses** (`customer_addresses`, `CustomerAddressBook`: max 10, one default shipping) and the customer record behind a store account (`OnlineCustomerProfiles`: always a new customer, ADR-018); declares `CustomerOnlineAccounts` (null by default) so `GET /customers/{id}` can show `online_account` | Shared, Geography (`GeoDirectory`) | 3 ✅ (addresses E7 ✅) |
| Inventory | Stock levels, append-only stock ledger (`StockLedger` — the only stock write path), batches/expiry (`BatchDirectory`), adjustments, two-step transfers, weighted-average valuation, low-stock event; movement types `online_order` (never below zero, whatever the branch allows) and `online_order_cancel` (E8a) | Products (`ProductDirectory`), Branches (`BranchDirectory`), Users (`UserDirectory`, notification recipients) | 4 ✅ (serials with POS in 5) |
| Purchasing | Purchase orders, goods receipts (= supplier invoices), purchase returns, supplier payments, supplier balances and statements | Suppliers (`SupplierDirectory`), Products (`ProductDirectory`), Branches, Inventory (`StockLedger`, `StockLineRules`, `StoreAccess`, `ResolveBatch`, `BatchDirectory`) | 4 ✅ |
| Discounts | Manual POS discount rules live in Sales (`CartPricer`: `sales.discount`, product max. %, customer group discount). Online store promotions and coupons are the `Promotions` module (E8b, web only); POS promotions are not built | — | later |
| Pos | POS terminal API: product grid and scan lookup, live cart pricing, held carts (`held_sales`), idempotent checkout that hands the cart to Sales (`Checkout` → `CompleteSale`) | Sales (actions, `CartPricer`, presenter), Products (`ProductDirectory`, `FindSellableVariant`), Catalog, Inventory (`StockLevels`, `StoreAccess`), Customers, Users | 5 ✅ |
| Sales | Sale invoices (immutable lines, stock allocations, serials, payments), `SaleCalculator` (discounts, inclusive/exclusive tax), `PaymentSettlement` (split/partial/due, change), customer credit, cancellation, history, daily summary; **returns** (approval workflow, return reasons, restocking to original batches, `ReturnShare`, refunds) and **receivables** (customer payments, statements) — returns and refunds live here like purchase returns live in Purchasing; declares the `LoyaltyProgram` contract | Inventory (`StockLedger`, `BatchDirectory`, `StockLevels`), Products, Customers (`CustomerDirectory`), Payments (`PaymentLedger`), Organizations, Branches, Users | 5–6 ✅ |
| Payments | The payments ledger (`PaymentLedger`: every amount in/out, by any module; `recordSystem()` for entries without a drawer — no cash — and `entriesOf()`, E8a; sources `online_order`/`online_order_refund`, methods `cash_on_delivery`/`online_gateway`), cash registers, register sessions with float, cash in/out, closing count and variance, session reports, payment history | Organizations, Branches, Users | 6 ✅ |
| Expenses | Expense and income categories, expense/other-income entries, voiding | Payments (`PaymentLedger`), Branches, Users | 6 ✅ |
| Loyalty | Program settings, point accounts and the points ledger; implements Sales' `LoyaltyProgram` (earn, redeem as a payment method, reversals) | Sales (contract), Customers (`CustomerDirectory`) | 6 ✅ |
| Media | Image library: uploads, alt text, WebP renditions, in-use protection; `MediaLibrary` (existence + public refs), `MediaReferences` (tagged checkers for JSON references) | Shared | E4 ✅ |
| Storefront | Storefront settings (incl. fulfilment store), domains (host → organization), theme document + custom CSS, menus (custom, page, category and brand links), banners, homepage sections (incl. product/category/brand sections and `hot_deals`, E8b — validated through `CatalogPromotions::isCountdownPromotion`), guest checkout switch (E8a); `storefront` and `storefront.session` (cookie session + CSRF for shopper routes) middleware, `storefront` / `storefront-write` rate limiters, public `GET /store/bootstrap` and `/store/homepage`, HTML shell (incl. `noindex` account, cart, wishlist, checkout and order pages) | Media (`MediaLibrary`, implements `MediaReferences`), Cms (`PageDirectory`, implements `PageReferences`), OnlineCatalog (`StorefrontCatalog`, incl. `hotDealCards`), Promotions (`CatalogPromotions`, E8b), Branches (`BranchDirectory`), Organizations (`OrganizationDirectory`) | E4–E6 ✅ (hot deals E8b) |
| Cms | Content pages, FAQ, contact messages, newsletter subscribers (double opt-in); public `/store/pages`, `/store/faq`, `/store/contact`, `/store/newsletter`; `PageDirectory`, `PageReferences` | Shared (`HtmlSanitizer`), Organizations (`OrganizationDirectory`) | E5 ✅ |
| OnlineCatalog | Web listings of products (publish window, featured, descriptions, specifications, SEO), variants (compare-at price, image), categories and brands; related / frequently bought products; `product_stats` popularity projection (`storefront:refresh-product-stats`); listing read model with facets; card/product `promotion` and variant `promo_price` from Promotions (E8b; filters and sorts keep the base price); public `/store/categories`, `/store/brands`, `/store/products`, `/store/search/suggest`; `StorefrontCatalog` (`variantsForCart` with `brand_id`/`category_id`, `hotDealCards`, E8b) | Catalog (`CatalogDirectory`), Inventory (`StockLevels`), Media (`MediaLibrary`, implements `MediaReferences`), Organizations (`OrganizationDirectory`), Shared (`HtmlSanitizer`), Storefront (`storefront` middleware), Products (`ProductDirectory`, for `variantsForCart`), Promotions (`CatalogPromotions`, E8b); read models read Products, Sales and `storefront_settings` tables read-only | E6 ✅ (cart data E7, promotions E8b) |
| Geography | **Global** reference data (no `organization_id`): `geo_divisions` (8) and `geo_districts` (64) of Bangladesh with English/Bangla names and BBS codes, loaded by the migration from `Infrastructure/Data/bangladesh.php`; `GeoDirectory` contract; public `GET /store/geo/divisions`, `/store/geo/districts` (cacheable) and the same lists for staff at `/geography/*` (E8a). No upazila/thana table yet | Shared | E7 ✅ |
| CustomerAccounts | Online store accounts (`customer_accounts`, 1:1 customers) and the `customer` session guard with its tenant-scoped provider; sign-up, sign-in/out, e-mail verification, password reset (own `customer_password_reset_tokens`), profile and password; the shopper's address endpoints (data kept by Customers); `customer.active` middleware; `customer-auth` rate limiter; staff `PATCH /customer-accounts/{customerId}`; implements `CustomerOnlineAccounts`; declares `GuestCartMerger` (no-op by default) | Customers (`OnlineCustomerProfiles`, `CustomerAddressBook`, implements `CustomerOnlineAccounts`), Organizations (`OrganizationDirectory`), Storefront (`storefront`, `storefront.session` middleware), Shared (`AuditTrail`) | E7 ✅ |
| Cart | Online carts (guest by httpOnly `cart_token` cookie, one per customer; no stored prices), `CartPricer` (the one pricing path: live catalog data + promotions (product discounts as line discounts, order discount as invoice discount, E8b) + `SaleCalculator`; `quote()` adds the counted lines for an order, E8a), one coupon per cart (`carts.coupon_code`, `POST/DELETE /store/cart/coupon`, `coupon` rate limiter, E8b), cart rules and errors, guest → customer merge (implements `GuestCartMerger`), `cart:prune`, checkout lock and conversion (`lockForCheckout`, `markConverted`, E8a), the shopper idempotency scope (implements Shared's `ShopperIdempotencyScope`, E8a); customer wishlists and the browser-list merge; public `/store/cart*`, `/store/wishlist*` | OnlineCatalog (`StorefrontCatalog`), Promotions (`PromotionPricing`, `CouponCode`/`CouponReason`, E8b), Sales (`SaleCalculator`, `TaxMode`), Organizations (`OrganizationDirectory`), CustomerAccounts (`GuestCartMerger`; the `customer` guard's account model identifies the shopper), Storefront (middleware) | E7 ✅ (coupons E8b) |
| Shipping | Delivery zones (sets of districts, one zone per district — `DISTRICT_IN_OTHER_ZONE`) and delivery methods per zone (flat fee, free-over threshold, COD allowed + COD fee, ETA); `ShippingRates` (methods for a district), `ShippingFee`; staff `/shipping/zones*`, `/shipping/methods/*`; public `GET /store/shipping-methods`. Couriers and shipments: E10 | Geography (`GeoDirectory`), Storefront (middleware), Shared (`AuditTrail`) | E8a ✅ |
| OnlinePayments | Payment methods of the online store per organization (`payment_gateways`: COD and bank transfer in E8a, defaults created lazily), the `PaymentGateway` interface with the offline drivers, `CheckoutPaymentMethods` (enabled methods, `usable()` → `PAYMENT_METHOD_UNAVAILABLE`, `initiate()`); staff `/payment-gateways`. Online gateways (SSLCommerz, bKash, Nagad), payment intents and webhooks: E8c | Shared (`AuditTrail`) | E8a ✅ |
| Orders | Web orders (ADR-003): `CheckoutQuoter` (preview = placement pricing), `PlaceOrder` (one transaction: cart lock, repricing, promotion locks and redemptions — E8b, stock posting, snapshots incl. `order_promotions` and discounts, cart conversion), `OrderWorkflow` (confirm payment, process, ship, deliver, record COD payment — ledger `recordSystem`), `CancelOrder` (restock to exact batches), `orders:expire-pending`, order confirmation e-mail and staff inbox notification (`OrderPlaced`), `checkout` rate limiter; public `/store/checkout*`, `/store/orders/{number}`; staff `/web-orders*` | Cart (`ShoppingCart`, `CartPricer`, `CartCookie`), Customers (`CustomerAddressBook`, `CustomerDirectory`), CustomerAccounts (the `customer` guard's account), Geography (`GeoDirectory`), Shipping (`ShippingRates`), OnlinePayments (`CheckoutPaymentMethods`), Promotions (`PromotionRedemptions`, E8b), Inventory (`StockLedger`), Payments (`PaymentLedger`), Products (`ProductDirectory`), Branches (`BranchDirectory`), Organizations (`OrganizationDirectory`), Users (`UserDirectory`), Storefront (`StorefrontConfig`, middleware), Sales (`TaxMode`) | E8a ✅ (discounts E8b) |
| Promotions | Online store promotions (web only): `promotions` (percent / fixed / free shipping; order, product, category or brand scope; automatic or coupon; schedule, countdown, usage limits), `promotion_targets`, `coupons`, append-only `promotion_redemptions`; pure `Domain\PromotionEngine` (the application rule); contracts `PromotionPricing` (Cart), `PromotionRedemptions` (Orders: lock + record in the placement transaction), `CatalogPromotions` (OnlineCatalog display, Storefront hot deals); staff `/promotions*`, `/coupons/*` (`promotions.view` / `promotions.manage`) | Catalog (`CatalogDirectory`), Products (`ProductDirectory`), Customers (`CustomerDirectory`), Organizations (`OrganizationDirectory`), Shared (`AuditTrail`, `Money`, `Instants`); Sales' `AppendOnly` model trait | E8b ✅ |
| Reports | Read-only views, report definitions, exports | All (read-only views) | 7 |
| Notifications | In-app notification inbox API (database channel); notifications themselves are sent by the module that owns the event (low stock: Inventory; new online order: Orders, E8a). Expiry alerts and daily summaries follow | Shared | 4 ✅ (inbox) / 7 |
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
