<?php

namespace App\Modules\Catalog;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Catalog\Infrastructure\Directory\EloquentCatalogDirectory;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * Catalog reference data shared by products: categories (tree), brands,
 * units of measure and tax rates.
 */
class CatalogServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CatalogDirectory::class, EloquentCatalogDirectory::class);
    }

    protected function permissions(): array
    {
        return [
            'categories.manage' => 'Create, edit and delete product categories',
            'brands.manage' => 'Create, edit and delete brands',
            'units.manage' => 'Create, edit and delete units of measure',
            'taxes.manage' => 'Create, edit and delete tax rates',
        ];
    }
}
