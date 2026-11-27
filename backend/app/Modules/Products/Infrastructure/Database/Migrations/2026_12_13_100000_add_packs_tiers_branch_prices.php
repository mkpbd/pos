<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ST2c: pack (carton / box) barcodes, quantity-break prices and per-branch prices.
 * Additive only; existing barcodes stay 1 unit with no pack name.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE product_barcodes
 *     ADD COLUMN units numeric(18,3) NOT NULL DEFAULT 1,
 *     ADD COLUMN pack_name varchar(40) NULL,
 *     ADD CONSTRAINT product_barcodes_units_positive CHECK (units > 0);
 *   CREATE TABLE product_price_tiers (
 *     id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
 *     variant_id uuid NOT NULL REFERENCES product_variants (id) ON DELETE CASCADE,
 *     min_quantity numeric(18,3) NOT NULL CHECK (min_quantity > 1), price numeric(18,2) NOT NULL CHECK (price >= 0),
 *     created_at timestamptz NULL, updated_at timestamptz NULL, UNIQUE (variant_id, min_quantity));
 *   CREATE TABLE product_branch_prices (
 *     id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
 *     variant_id uuid NOT NULL REFERENCES product_variants (id) ON DELETE CASCADE,
 *     branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
 *     price numeric(18,2) NOT NULL CHECK (price >= 0),
 *     created_at timestamptz NULL, updated_at timestamptz NULL, UNIQUE (variant_id, branch_id));
 *   CREATE INDEX product_branch_prices_branch_id_index ON product_branch_prices (branch_id);
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_barcodes', function (Blueprint $table) {
            $table->decimal('units', 18, 3)->default(1);
            $table->string('pack_name', 40)->nullable();
        });
        DB::statement('ALTER TABLE product_barcodes ADD CONSTRAINT product_barcodes_units_positive CHECK (units > 0)');

        Schema::create('product_price_tiers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->cascadeOnDelete();
            $table->decimal('min_quantity', 18, 3);
            $table->decimal('price', 18, 2);
            $table->timestampsTz();

            $table->unique(['variant_id', 'min_quantity']);
        });
        DB::statement('ALTER TABLE product_price_tiers ADD CONSTRAINT product_price_tiers_min_quantity_check CHECK (min_quantity > 1)');
        DB::statement('ALTER TABLE product_price_tiers ADD CONSTRAINT product_price_tiers_price_check CHECK (price >= 0)');

        Schema::create('product_branch_prices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->restrictOnDelete();
            $table->decimal('price', 18, 2);
            $table->timestampsTz();

            $table->unique(['variant_id', 'branch_id']);
            $table->index('branch_id');
        });
        DB::statement('ALTER TABLE product_branch_prices ADD CONSTRAINT product_branch_prices_price_check CHECK (price >= 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('product_branch_prices');
        Schema::dropIfExists('product_price_tiers');
        DB::statement('ALTER TABLE product_barcodes DROP CONSTRAINT IF EXISTS product_barcodes_units_positive');
        Schema::table('product_barcodes', function (Blueprint $table) {
            $table->dropColumn(['units', 'pack_name']);
        });
    }
};
