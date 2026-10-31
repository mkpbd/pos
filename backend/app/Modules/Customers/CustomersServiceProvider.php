<?php

namespace App\Modules\Customers;

use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * Customers and customer groups. Balances, purchase history, statements and loyalty
 * points build on sales and payments (Phases 5–6).
 */
class CustomersServiceProvider extends ModuleServiceProvider
{
    protected function permissions(): array
    {
        return [
            'customers.view' => 'View customers and customer groups',
            'customers.create' => 'Register new customers (name and contact details)',
            'customers.manage' => 'Edit and archive customers, set groups, credit limits and opening balances, manage groups',
        ];
    }
}
