<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ST2a: line discount % and bonus (free) quantity on purchase order and goods receipt lines,
 * the effective unit cost of receipt lines (discounted subtotal ÷ (quantity + bonus)),
 * short-closing a partly received purchase order, and purchase returns without a goods receipt.
 * Additive; existing receipt lines get effective_unit_cost = unit_cost (no discount, no bonus).
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE purchase_order_lines
 *     ADD COLUMN discount_percent numeric(7,4) NOT NULL DEFAULT 0,
 *     ADD COLUMN bonus_quantity numeric(18,3) NOT NULL DEFAULT 0;
 *   ALTER TABLE goods_receipt_lines
 *     ADD COLUMN discount_percent numeric(7,4) NOT NULL DEFAULT 0,
 *     ADD COLUMN bonus_quantity numeric(18,3) NOT NULL DEFAULT 0,
 *     ADD COLUMN effective_unit_cost numeric(18,4) NULL;
 *   UPDATE goods_receipt_lines SET effective_unit_cost = unit_cost;
 *   ALTER TABLE goods_receipt_lines ALTER COLUMN effective_unit_cost SET NOT NULL;
 *   ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_discount_bonus_check
 *     CHECK (discount_percent >= 0 AND discount_percent < 100 AND bonus_quantity >= 0);
 *   ALTER TABLE goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_discount_bonus_check
 *     CHECK (discount_percent >= 0 AND discount_percent < 100 AND bonus_quantity >= 0 AND effective_unit_cost >= 0);
 *   ALTER TABLE purchase_orders ADD COLUMN closed_at timestamptz NULL, ADD COLUMN close_reason varchar(200) NULL;
 *   ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_status_check;
 *   ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
 *     CHECK (status IN ('draft', 'pending_approval', 'ordered', 'partially_received', 'received', 'cancelled', 'closed'));
 *   ALTER TABLE purchase_returns ALTER COLUMN goods_receipt_id DROP NOT NULL;
 *   ALTER TABLE purchase_return_lines ALTER COLUMN goods_receipt_line_id DROP NOT NULL;
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchase_order_lines', function (Blueprint $table) {
            $table->decimal('discount_percent', 7, 4)->default(0);
            $table->decimal('bonus_quantity', 18, 3)->default(0);
        });

        Schema::table('goods_receipt_lines', function (Blueprint $table) {
            $table->decimal('discount_percent', 7, 4)->default(0);
            $table->decimal('bonus_quantity', 18, 3)->default(0);
            $table->decimal('effective_unit_cost', 18, 4)->nullable();
        });
        DB::table('goods_receipt_lines')->update(['effective_unit_cost' => DB::raw('unit_cost')]);
        Schema::table('goods_receipt_lines', function (Blueprint $table) {
            $table->decimal('effective_unit_cost', 18, 4)->nullable(false)->change();
        });

        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->timestampTz('closed_at')->nullable();
            $table->string('close_reason', 200)->nullable();
        });

        Schema::table('purchase_returns', function (Blueprint $table) {
            $table->uuid('goods_receipt_id')->nullable()->change();
        });
        Schema::table('purchase_return_lines', function (Blueprint $table) {
            $table->uuid('goods_receipt_line_id')->nullable()->change();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_discount_bonus_check
                    CHECK (discount_percent >= 0 AND discount_percent < 100 AND bonus_quantity >= 0);
                ALTER TABLE goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_discount_bonus_check
                    CHECK (discount_percent >= 0 AND discount_percent < 100 AND bonus_quantity >= 0 AND effective_unit_cost >= 0);
                ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
                ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
                    CHECK (status IN ('draft', 'pending_approval', 'ordered', 'partially_received', 'received', 'cancelled', 'closed'));
            SQL);
        }
    }

    public function down(): void
    {
        // Returns without a receipt keep their NULL references: the columns stay nullable.
        // Restoring the status check fails while closed orders exist (they are not rewritten).
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
                ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
                    CHECK (status IN ('draft', 'pending_approval', 'ordered', 'partially_received', 'received', 'cancelled'));
                ALTER TABLE goods_receipt_lines DROP CONSTRAINT IF EXISTS goods_receipt_lines_discount_bonus_check;
                ALTER TABLE purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_discount_bonus_check;
            SQL);
        }
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropColumn(['closed_at', 'close_reason']);
        });
        Schema::table('goods_receipt_lines', function (Blueprint $table) {
            $table->dropColumn(['discount_percent', 'bonus_quantity', 'effective_unit_cost']);
        });
        Schema::table('purchase_order_lines', function (Blueprint $table) {
            $table->dropColumn(['discount_percent', 'bonus_quantity']);
        });
    }
};
