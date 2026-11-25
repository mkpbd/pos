<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * POS1a: open-price products — their variants are sold at a price the cashier types at the
 * till (no catalog price is charged). Additive only.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE products ADD COLUMN open_price boolean NOT NULL DEFAULT false;
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->boolean('open_price')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('open_price');
        });
    }
};
