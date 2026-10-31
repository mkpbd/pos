<?php

namespace App\Modules\Catalog\Tests\Concerns;

use App\Modules\Catalog\Infrastructure\Models\Brand;
use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Catalog\Infrastructure\Models\TaxRate;
use App\Modules\Catalog\Infrastructure\Models\Unit;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Application\Tenancy\TenantContext;

/**
 * Catalog reference data for tests of modules that build on it.
 */
trait CreatesCatalog
{
    /**
     * @return array{unit: Unit, tax: TaxRate, category: Category, brand: Brand}
     */
    protected function createCatalog(Organization $organization): array
    {
        return app(TenantContext::class)->runAs($organization->id, fn () => [
            'unit' => Unit::query()->create(['name' => 'Piece', 'code' => 'pcs']),
            'tax' => TaxRate::query()->create(['name' => 'VAT 15%', 'rate' => '15']),
            'category' => Category::query()->create(['name' => 'Beverages']),
            'brand' => Brand::query()->create(['name' => 'Pran']),
        ]);
    }
}
