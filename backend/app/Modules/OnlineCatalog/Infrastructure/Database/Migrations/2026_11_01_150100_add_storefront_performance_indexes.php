<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * E12 query review: indexes for the storefront's live-listing reads.
 *
 * - product_listings_live_window_index: the candidate set, sitemap and "next schedule
 *   change" queries filter published listings of one organization by their window
 *   (published_at / unpublished_at). Partial on PostgreSQL (published rows only).
 * - product_listings_unpublish_index: MIN(unpublished_at) > now per organization (cache expiry).
 * - product_variants_live_product_index: "has an active variant" (EXISTS) and the variant
 *   load of the candidate set, restricted to live variants on PostgreSQL.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('CREATE INDEX IF NOT EXISTS product_listings_live_window_index ON product_listings (organization_id, published_at, unpublished_at) WHERE is_published');
            DB::statement('CREATE INDEX IF NOT EXISTS product_listings_unpublish_index ON product_listings (organization_id, unpublished_at) WHERE is_published AND unpublished_at IS NOT NULL');
            DB::statement('CREATE INDEX IF NOT EXISTS product_variants_live_product_index ON product_variants (product_id, sort_order) WHERE deleted_at IS NULL AND is_active');

            return;
        }

        DB::statement('CREATE INDEX IF NOT EXISTS product_listings_live_window_index ON product_listings (organization_id, is_published, published_at, unpublished_at)');
        DB::statement('CREATE INDEX IF NOT EXISTS product_listings_unpublish_index ON product_listings (organization_id, unpublished_at)');
        DB::statement('CREATE INDEX IF NOT EXISTS product_variants_live_product_index ON product_variants (product_id, is_active, sort_order)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS product_listings_live_window_index');
        DB::statement('DROP INDEX IF EXISTS product_listings_unpublish_index');
        DB::statement('DROP INDEX IF EXISTS product_variants_live_product_index');
    }
};
