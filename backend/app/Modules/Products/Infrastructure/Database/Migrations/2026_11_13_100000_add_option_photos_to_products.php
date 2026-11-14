<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P1a: photos per option value ("photos by colour") and swatch styles per product option.
 *
 * - products.photo_option: the one option whose values own photos (NULL = none).
 * - products.option_styles: {"Colour": "color"|"image"|"button"}; options not named use
 *   their attribute's display.
 * - product_option_images: ordered product images of each value of the photo option.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->string('photo_option', 50)->nullable();
            $table->jsonb('option_styles')->nullable();
        });

        Schema::create('product_option_images', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->string('option_name', 50);
            $table->string('option_value', 50);
            $table->foreignUuid('image_id')->constrained('product_images')->cascadeOnDelete();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestampsTz();

            $table->unique(['product_id', 'option_name', 'option_value', 'image_id']);
            $table->index(['organization_id', 'product_id']);
            $table->index('image_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_option_images');
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn(['photo_option', 'option_styles']);
        });
    }
};
