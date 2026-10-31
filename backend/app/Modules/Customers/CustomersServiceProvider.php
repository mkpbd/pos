<?php

namespace App\Modules\Customers;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Customers\Application\Contracts\CustomerOnlineAccounts;
use App\Modules\Customers\Application\Services\NoOnlineAccounts;
use App\Modules\Customers\Infrastructure\Directory\EloquentCustomerDirectory;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * Customers and customer groups. Balances, purchase history, statements and loyalty
 * points build on sales and payments (Phases 5–6).
 */
class CustomersServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CustomerDirectory::class, EloquentCustomerDirectory::class);
        // Replaced by the CustomerAccounts module when it is installed.
        $this->app->bindIf(CustomerOnlineAccounts::class, NoOnlineAccounts::class);
    }

    protected function permissions(): array
    {
        return [
            'customers.view' => 'View customers and customer groups',
            'customers.create' => 'Register new customers (name and contact details)',
            'customers.manage' => 'Edit and archive customers, set groups, credit limits and opening balances, manage groups',
        ];
    }
}
