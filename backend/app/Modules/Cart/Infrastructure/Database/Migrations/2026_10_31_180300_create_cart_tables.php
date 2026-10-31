<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Shopping carts: a guest's (found by the sha256 of its httpOnly cookie token) or a customer's.
        // No prices are stored: every read reprices from the catalog (ADR-005).
        Schema::create('carts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('customer_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('token_hash', 64)->nullable()->unique();
            // Guest carts: 30 days after the last change (cart:prune). Customer carts: null.
            $table->timestampTz('expires_at')->nullable();
            $table->timestampsTz();

            $table->index(['organization_id', 'expires_at']);
        });
        DB::statement('CREATE UNIQUE INDEX carts_customer_unique ON carts (customer_id) WHERE customer_id IS NOT NULL');

        Schema::create('cart_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('cart_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->cascadeOnDelete();
            $table->decimal('quantity', 18, 3);
            $table->timestampsTz();

            $table->unique(['cart_id', 'variant_id']);
        });

        // A signed-in customer's saved products (guests keep theirs in the browser).
        Schema::create('wishlists', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('customer_id')->unique()->constrained()->cascadeOnDelete();
            $table->timestampsTz();
        });

        Schema::create('wishlist_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('wishlist_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('variant_id')->nullable()->constrained('product_variants')->cascadeOnDelete();
            $table->timestampTz('created_at')->nullable();
        });
        // One entry per product and variant; NULL variants need their own partial index (NULLs never collide).
        DB::statement('CREATE UNIQUE INDEX wishlist_items_product_unique ON wishlist_items (wishlist_id, product_id) WHERE variant_id IS NULL');
        DB::statement('CREATE UNIQUE INDEX wishlist_items_variant_unique ON wishlist_items (wishlist_id, product_id, variant_id) WHERE variant_id IS NOT NULL');

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE cart_items ADD CONSTRAINT cart_items_quantity_check CHECK (quantity > 0)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('wishlist_items');
        Schema::dropIfExists('wishlists');
        Schema::dropIfExists('cart_items');
        Schema::dropIfExists('carts');
    }
};
