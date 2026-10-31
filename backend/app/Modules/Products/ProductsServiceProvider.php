<?php

namespace App\Modules\Products;

use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Products\Infrastructure\Directory\EloquentProductDirectory;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * Products, their sellable variants (SKU, prices, barcodes) and images.
 */
class ProductsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(ProductDirectory::class, EloquentProductDirectory::class);
    }

    protected function permissions(): array
    {
        return [
            'products.view' => 'View products, prices and catalog reference data',
            'products.view_cost' => 'See purchase (cost) prices',
            'products.manage' => 'Create, edit, archive and restore products and their images',
        ];
    }
}
