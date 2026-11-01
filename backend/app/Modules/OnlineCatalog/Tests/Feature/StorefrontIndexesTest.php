<?php

namespace App\Modules\OnlineCatalog\Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * E12 query review: the storefront performance indexes exist on PostgreSQL (partial where
 * planned). EXPLAIN on real data is still pending (no PostgreSQL access during E12a).
 */
class StorefrontIndexesTest extends TestCase
{
    use RefreshDatabase;

    public function test_storefront_indexes_exist_on_postgresql(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->markTestSkipped('PostgreSQL only (partial indexes).');
        }

        $indexes = collect(DB::select("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname IN ('product_listings_live_window_index', 'product_listings_unpublish_index', 'product_variants_live_product_index')"))
            ->pluck('indexdef', 'indexname');

        $this->assertCount(3, $indexes);
        $this->assertStringContainsString('(organization_id, published_at, unpublished_at) WHERE is_published', $indexes['product_listings_live_window_index']);
        $this->assertStringContainsString('(organization_id, unpublished_at) WHERE (is_published AND (unpublished_at IS NOT NULL))', $indexes['product_listings_unpublish_index']);
        $this->assertStringContainsString('(product_id, sort_order) WHERE ((deleted_at IS NULL) AND is_active)', $indexes['product_variants_live_product_index']);
    }
}
