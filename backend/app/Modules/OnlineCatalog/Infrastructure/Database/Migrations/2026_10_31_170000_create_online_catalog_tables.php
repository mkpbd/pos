<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // How a product appears in the online store. Products without a listing are not online.
        Schema::create('product_listings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_id')->unique()->constrained()->restrictOnDelete();
            $table->string('slug', 120);
            $table->boolean('is_published')->default(false);
            // Optional publishing window: NULL start = immediately, NULL end = open-ended.
            $table->timestampTz('published_at')->nullable();
            $table->timestampTz('unpublished_at')->nullable();
            $table->boolean('is_featured')->default(false);
            $table->date('is_new_until')->nullable();
            $table->string('short_description', 500)->nullable();
            $table->text('description_html')->nullable();
            $table->jsonb('specifications')->default('[]');
            $table->string('seo_title', 70)->nullable();
            $table->string('seo_description', 160)->nullable();
            $table->integer('sort_weight')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->index(['organization_id', 'is_published']);
        });

        // Per-variant web data: the struck-through "was" price and the image shown for it.
        Schema::create('variant_listings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->unique()->constrained('product_variants')->cascadeOnDelete();
            $table->decimal('compare_at_price', 18, 2)->nullable();
            $table->foreignUuid('image_id')->nullable()->constrained('product_images')->nullOnDelete();
            $table->timestampsTz();
        });

        Schema::create('category_listings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('category_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('slug', 120);
            $table->boolean('is_visible')->default(true);
            $table->foreignUuid('image_media_id')->nullable()->constrained('media')->restrictOnDelete();
            $table->foreignUuid('banner_media_id')->nullable()->constrained('media')->restrictOnDelete();
            $table->text('description_html')->nullable();
            $table->string('seo_title', 70)->nullable();
            $table->string('seo_description', 160)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        Schema::create('brand_listings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('brand_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('slug', 120);
            $table->boolean('is_visible')->default(true);
            $table->foreignUuid('logo_media_id')->nullable()->constrained('media')->restrictOnDelete();
            $table->string('description', 1000)->nullable();
            $table->string('seo_title', 70)->nullable();
            $table->string('seo_description', 160)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        // Hand-picked product recommendations, in order.
        Schema::create('related_products', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('related_product_id')->constrained('products')->cascadeOnDelete();
            $table->string('kind', 20);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestampsTz();

            $table->primary(['product_id', 'related_product_id', 'kind']);
            $table->index(['organization_id', 'product_id', 'kind']);
        });

        // Popularity projection rebuilt from completed POS sales (RefreshProductStats).
        Schema::create('product_stats', function (Blueprint $table) {
            $table->foreignUuid('product_id')->primary()->constrained()->cascadeOnDelete();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->decimal('units_sold_30d', 18, 3)->default(0);
            $table->decimal('units_sold_total', 18, 3)->default(0);
            $table->timestampTz('refreshed_at');

            $table->index(['organization_id', 'units_sold_30d']);
        });

        // Slugs are unique per organization regardless of case (expression indexes: PostgreSQL and SQLite).
        DB::statement('CREATE UNIQUE INDEX product_listings_org_slug_unique ON product_listings (organization_id, lower(slug))');
        DB::statement('CREATE UNIQUE INDEX category_listings_org_slug_unique ON category_listings (organization_id, lower(slug))');
        DB::statement('CREATE UNIQUE INDEX brand_listings_org_slug_unique ON brand_listings (organization_id, lower(slug))');

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE product_listings ADD CONSTRAINT product_listings_window_check CHECK (unpublished_at IS NULL OR published_at IS NULL OR unpublished_at > published_at)');
            DB::statement("ALTER TABLE related_products ADD CONSTRAINT related_products_kind_check CHECK (kind IN ('related', 'frequently_bought'))");
            DB::statement('ALTER TABLE related_products ADD CONSTRAINT related_products_not_self_check CHECK (product_id <> related_product_id)');
            DB::statement('ALTER TABLE variant_listings ADD CONSTRAINT variant_listings_compare_at_check CHECK (compare_at_price IS NULL OR compare_at_price > 0)');

            // Storefront search matches substrings of product names (lower(name) LIKE '%q%');
            // a trigram index lets PostgreSQL answer that without a full scan.
            DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');
            DB::statement('CREATE INDEX products_name_trgm_index ON products USING gin (lower(name) gin_trgm_ops)');
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS products_name_trgm_index');
        }
        Schema::dropIfExists('product_stats');
        Schema::dropIfExists('related_products');
        Schema::dropIfExists('brand_listings');
        Schema::dropIfExists('category_listings');
        Schema::dropIfExists('variant_listings');
        Schema::dropIfExists('product_listings');
    }
};
