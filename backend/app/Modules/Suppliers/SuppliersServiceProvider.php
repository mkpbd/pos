<?php

namespace App\Modules\Suppliers;

use App\Modules\Imports\Application\Contracts\ImportHandler;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use App\Modules\Suppliers\Application\Imports\SuppliersImport;
use App\Modules\Suppliers\Infrastructure\Directory\EloquentSupplierDirectory;

/**
 * Supplier master data. Balances and purchase history arrive with Purchasing (Phase 4).
 */
class SuppliersServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(SupplierDirectory::class, EloquentSupplierDirectory::class);
        // ST1: supplier import (Imports module).
        $this->app->tag([SuppliersImport::class], ImportHandler::TAG);
    }

    protected function permissions(): array
    {
        return [
            'suppliers.view' => 'View suppliers',
            'suppliers.manage' => 'Create, edit, archive and restore suppliers',
        ];
    }
}
