<?php

use App\Modules\Audit\AuditServiceProvider;
use App\Modules\Authentication\AuthenticationServiceProvider;
use App\Modules\Branches\BranchesServiceProvider;
use App\Modules\Catalog\CatalogServiceProvider;
use App\Modules\Customers\CustomersServiceProvider;
use App\Modules\Expenses\ExpensesServiceProvider;
use App\Modules\Inventory\InventoryServiceProvider;
use App\Modules\Loyalty\LoyaltyServiceProvider;
use App\Modules\Media\MediaServiceProvider;
use App\Modules\Notifications\NotificationsServiceProvider;
use App\Modules\Organizations\OrganizationsServiceProvider;
use App\Modules\Payments\PaymentsServiceProvider;
use App\Modules\Pos\PosServiceProvider;
use App\Modules\Products\ProductsServiceProvider;
use App\Modules\Purchasing\PurchasingServiceProvider;
use App\Modules\Sales\SalesServiceProvider;
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
    // Registers the storefront catch-all page route, so it stays last.
    StorefrontServiceProvider::class,
];
