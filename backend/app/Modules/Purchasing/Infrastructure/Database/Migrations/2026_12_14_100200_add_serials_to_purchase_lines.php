<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ST2d: the serial numbers received on a goods receipt line and returned on a purchase return
 * line (serial-tracked variants only; the register itself is Inventory's serial_numbers).
 * Additive; existing lines keep NULL.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE goods_receipt_lines ADD COLUMN serials jsonb NULL;
 *   ALTER TABLE purchase_return_lines ADD COLUMN serials jsonb NULL;
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('goods_receipt_lines', function (Blueprint $table) {
            $table->jsonb('serials')->nullable();
        });
        Schema::table('purchase_return_lines', function (Blueprint $table) {
            $table->jsonb('serials')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('purchase_return_lines', function (Blueprint $table) {
            $table->dropColumn('serials');
        });
        Schema::table('goods_receipt_lines', function (Blueprint $table) {
            $table->dropColumn('serials');
        });
    }
};
