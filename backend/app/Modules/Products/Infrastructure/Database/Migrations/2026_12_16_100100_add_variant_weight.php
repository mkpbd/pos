<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * BD2a: a variant's delivery weight in grams for weight-based delivery fees. Optional;
 * existing variants stay null (counted as 0).
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE product_variants
 *     ADD COLUMN weight_grams integer NULL,
 *     ADD CONSTRAINT product_variants_weight_grams_check CHECK (weight_grams > 0);
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_variants', function (Blueprint $table) {
            $table->integer('weight_grams')->nullable();
        });
        DB::statement('ALTER TABLE product_variants ADD CONSTRAINT product_variants_weight_grams_check CHECK (weight_grams > 0)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_weight_grams_check');
        Schema::table('product_variants', function (Blueprint $table) {
            $table->dropColumn('weight_grams');
        });
    }
};
