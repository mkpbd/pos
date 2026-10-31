<?php

namespace App\Modules\Suppliers;

use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use App\Modules\Suppliers\Infrastructure\Directory\EloquentSupplierDirectory;

/**
 * Supplier master data. Balances and purchase history arrive with Purchasing (Phase 4).
 */
class SuppliersServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(SupplierDirectory::class, EloquentSupplierDirectory::class);
    }

    protected function permissions(): array
    {
        return [
            'suppliers.view' => 'View suppliers',
            'suppliers.manage' => 'Create, edit, archive and restore suppliers',
        ];
    }
}
