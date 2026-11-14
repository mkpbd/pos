<?php

use App\Modules\AI\AIServiceProvider;
use App\Modules\Audit\AuditServiceProvider;
use App\Modules\Authentication\AuthenticationServiceProvider;
use App\Modules\Branches\BranchesServiceProvider;
use App\Modules\Cart\CartServiceProvider;
use App\Modules\Catalog\CatalogServiceProvider;
use App\Modules\Cms\CmsServiceProvider;
use App\Modules\CustomerAccounts\CustomerAccountsServiceProvider;
use App\Modules\Customers\CustomersServiceProvider;
use App\Modules\Expenses\ExpensesServiceProvider;
use App\Modules\Geography\GeographyServiceProvider;
use App\Modules\Inventory\InventoryServiceProvider;
use App\Modules\Loyalty\LoyaltyServiceProvider;
use App\Modules\Marketing\MarketingServiceProvider;
use App\Modules\Media\MediaServiceProvider;
use App\Modules\Notifications\NotificationsServiceProvider;
use App\Modules\OnlineCatalog\OnlineCatalogServiceProvider;
use App\Modules\OnlinePayments\OnlinePaymentsServiceProvider;
use App\Modules\Orders\OrdersServiceProvider;
use App\Modules\Organizations\OrganizationsServiceProvider;
use App\Modules\Payments\PaymentsServiceProvider;
use App\Modules\Pos\PosServiceProvider;
use App\Modules\Products\ProductsServiceProvider;
use App\Modules\Promotions\PromotionsServiceProvider;
use App\Modules\Purchasing\PurchasingServiceProvider;
use App\Modules\Reports\ReportsServiceProvider;
use App\Modules\Reviews\ReviewsServiceProvider;
use App\Modules\Sales\SalesServiceProvider;
use App\Modules\Shipping\ShippingServiceProvider;
use App\Modules\Social\SocialServiceProvider;
use App\Modules\Storefront\StorefrontServiceProvider;
use App\Modules\Suppliers\SuppliersServiceProvider;
use App\Modules\System\SystemServiceProvider;
use App\Modules\Users\UsersServiceProvider;
use App\Providers\AppServiceProvider;

return [
    AppServiceProvider::class,

    // Business modules (app/Modules/*). Each provider wires its own routes, migrations, permissions and bindings.
    SystemServiceProvider::class,
    AuditServiceProvider::class,
    OrganizationsServiceProvider::class,
    BranchesServiceProvider::class,
    UsersServiceProvider::class,
    AuthenticationServiceProvider::class,
    CatalogServiceProvider::class,
    ProductsServiceProvider::class,
    SuppliersServiceProvider::class,
    CustomersServiceProvider::class,
    InventoryServiceProvider::class,
    PurchasingServiceProvider::class,
    NotificationsServiceProvider::class,
    PaymentsServiceProvider::class,
    ExpensesServiceProvider::class,
    SalesServiceProvider::class,
    LoyaltyServiceProvider::class,
    PosServiceProvider::class,
    MediaServiceProvider::class,
    CmsServiceProvider::class,
    OnlineCatalogServiceProvider::class,
    GeographyServiceProvider::class,
    CustomerAccountsServiceProvider::class,
    PromotionsServiceProvider::class,
    CartServiceProvider::class,
    ShippingServiceProvider::class,
    OnlinePaymentsServiceProvider::class,
    OrdersServiceProvider::class,
    ReviewsServiceProvider::class,
    // Phase 7: reports and the dashboard (read models over the modules above).
    ReportsServiceProvider::class,
    // Phase 8: optional AI module (reads through the Reports registry; off unless AI_ENABLED).
    AIServiceProvider::class,
    // P2a: campaigns, short links (/go/<code>, registered before the storefront catch-all) and visits.
    MarketingServiceProvider::class,
    // P2b: Facebook & Instagram posting and catalog feeds (/feeds/*, before the storefront catch-all).
    SocialServiceProvider::class,
    // Registers the storefront catch-all page route, so it stays last.
    StorefrontServiceProvider::class,
];
