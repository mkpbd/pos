<?php

namespace App\Modules\Catalog;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Catalog\Infrastructure\Directory\EloquentCatalogDirectory;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Support\Facades\Gate;

/**
 * Catalog reference data shared by products: categories (tree), brands,
 * units of measure, tax rates and the attribute dictionary.
 */
class CatalogServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CatalogDirectory::class, EloquentCatalogDirectory::class);
    }

    public function boot(): void
    {
        parent::boot();

        // Product editors need the dictionary for option suggestions; attribute managers own it.
        Gate::define('attributes.read', fn (Authorizable $user) => $user->can('products.view') || $user->can('attributes.manage'));
    }

    protected function permissions(): array
    {
        return [
            'categories.manage' => 'Create, edit and delete product categories',
            'brands.manage' => 'Create, edit and delete brands',
            'units.manage' => 'Create, edit and delete units of measure',
            'taxes.manage' => 'Create, edit and delete tax rates',
            'attributes.manage' => 'Create, edit and delete product attributes (option names and values)',
        ];
    }
}
