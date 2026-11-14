<?php

namespace App\Modules\Products;

use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Products\Application\Contracts\VariantStock;
use App\Modules\Products\Application\Contracts\VariantWebData;
use App\Modules\Products\Application\Services\NoVariantStock;
use App\Modules\Products\Application\Services\NoVariantWebData;
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
        // P1a: replaced by Inventory (stock in the variant grid) and OnlineCatalog (web data).
        $this->app->bindIf(VariantStock::class, NoVariantStock::class);
        $this->app->bindIf(VariantWebData::class, NoVariantWebData::class);
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
