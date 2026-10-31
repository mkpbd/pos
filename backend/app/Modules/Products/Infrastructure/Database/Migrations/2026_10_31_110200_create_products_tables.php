<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('category_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('brand_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('unit_id')->constrained()->restrictOnDelete();
            // NULL = tax exempt.
            $table->foreignUuid('tax_rate_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('name');
            $table->text('description')->nullable();
            $table->enum('type', ['standard', 'service'])->default('standard');
            $table->boolean('track_stock')->default(true);
            $table->boolean('track_batches')->default(false);
            $table->boolean('track_serials')->default(false);
            // Upper bound for item-level discounts at the POS; NULL = no product-specific limit.
            $table->decimal('max_discount_percent', 5, 2)->nullable();
            // Variant option definitions, e.g. [{"name":"Size","values":["S","M"]}].
            $table->jsonb('options')->nullable();
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['organization_id', 'is_active']);
            $table->index(['organization_id', 'category_id']);
            $table->index(['organization_id', 'brand_id']);
            $table->index(['organization_id', 'name']);
        });

        // The sellable unit. Every product has at least one variant; a simple product has exactly one.
        Schema::create('product_variants', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_id')->constrained()->restrictOnDelete();
            $table->string('sku', 64);
            // Label such as "Red / L"; NULL for the default variant of a simple product.
            $table->string('name')->nullable();
            $table->jsonb('option_values')->default('{}');
            $table->decimal('purchase_price', 18, 2);
            $table->decimal('selling_price', 18, 2);
            $table->decimal('wholesale_price', 18, 2)->nullable();
            // Minimum stock before a low-stock alert (used from Phase 4).
            $table->decimal('reorder_level', 18, 3)->default(0);
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['product_id', 'sort_order']);
        });

        Schema::create('product_barcodes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->cascadeOnDelete();
            // EAN/UPC/Code128 or any scanner payload (QR codes included).
            $table->string('barcode', 128);
            $table->timestampsTz();

            $table->unique(['organization_id', 'barcode']);
            $table->index('variant_id');
        });

        Schema::create('product_images', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->string('path');
            $table->string('original_name');
            $table->string('mime_type', 50);
            $table->unsignedInteger('size');
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestampsTz();

            $table->index(['product_id', 'sort_order']);
        });

        // SKUs are unique among live variants; archived variants release their SKU.
        DB::statement('CREATE UNIQUE INDEX product_variants_org_sku_unique ON product_variants (organization_id, lower(sku)) WHERE deleted_at IS NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('product_images');
        Schema::dropIfExists('product_barcodes');
        Schema::dropIfExists('product_variants');
        Schema::dropIfExists('products');
    }
};
