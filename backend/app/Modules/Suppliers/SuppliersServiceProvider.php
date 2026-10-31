<?php

namespace App\Modules\Suppliers;

use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * Supplier master data. Balances and purchase history arrive with Purchasing (Phase 4).
 */
class SuppliersServiceProvider extends ModuleServiceProvider
{
    protected function permissions(): array
    {
        return [
            'suppliers.view' => 'View suppliers',
            'suppliers.manage' => 'Create, edit, archive and restore suppliers',
        ];
    }
}
