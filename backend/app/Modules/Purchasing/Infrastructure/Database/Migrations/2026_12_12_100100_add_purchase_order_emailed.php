<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ST2b: when a purchase order was last e-mailed to the supplier and to which address.
 * Additive and nullable; no backfill.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE purchase_orders
 *     ADD COLUMN emailed_at timestamptz NULL,
 *     ADD COLUMN emailed_to varchar(255) NULL;
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->timestampTz('emailed_at')->nullable();
            $table->string('emailed_to', 255)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropColumn(['emailed_at', 'emailed_to']);
        });
    }
};
