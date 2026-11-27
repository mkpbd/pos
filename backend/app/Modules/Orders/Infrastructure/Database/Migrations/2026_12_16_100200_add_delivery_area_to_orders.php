<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * BD2a: the delivery area an order was priced for and its delivery fee breakdown. Additive only.
 *
 * - `order_addresses.area_id`: the merchant-defined delivery area (Shipping `shipping_areas`)
 *   chosen for the address; its name stays in `area`. No foreign key — the address is a
 *   snapshot and an area may later be deleted.
 * - `orders.shipping_base_fee` / `shipping_area_adjustment` / `shipping_weight_fee`: the chosen
 *   method's fee before `free_over` and free-delivery promotions; null on orders placed before.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE order_addresses ADD COLUMN area_id uuid NULL;
 *   ALTER TABLE orders ADD COLUMN shipping_base_fee numeric(18,2) NULL,
 *     ADD COLUMN shipping_area_adjustment numeric(18,2) NULL, ADD COLUMN shipping_weight_fee numeric(18,2) NULL;
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_addresses', function (Blueprint $table) {
            $table->uuid('area_id')->nullable();
        });
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('shipping_base_fee', 18, 2)->nullable();
            $table->decimal('shipping_area_adjustment', 18, 2)->nullable();
            $table->decimal('shipping_weight_fee', 18, 2)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['shipping_base_fee', 'shipping_area_adjustment', 'shipping_weight_fee']);
        });
        Schema::table('order_addresses', function (Blueprint $table) {
            $table->dropColumn('area_id');
        });
    }
};
