<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Q1: a stock count line keeps what was counted and what the system held at that moment (read
 * under the row lock); `quantity` stays the posted signed difference. Both NULL on other lines.
 * Additive only.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE stock_adjustment_lines
 *     ADD COLUMN counted_quantity numeric(18, 3) NULL,
 *     ADD COLUMN system_quantity numeric(18, 3) NULL;
 *   ALTER TABLE stock_adjustment_lines ADD CONSTRAINT stock_adjustment_lines_count_check
 *     CHECK ((counted_quantity IS NULL) = (system_quantity IS NULL)
 *       AND (counted_quantity IS NULL OR (counted_quantity >= 0 AND quantity = counted_quantity - system_quantity)));
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_adjustment_lines', function (Blueprint $table) {
            $table->decimal('counted_quantity', 18, 3)->nullable();
            $table->decimal('system_quantity', 18, 3)->nullable();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE stock_adjustment_lines ADD CONSTRAINT stock_adjustment_lines_count_check
                    CHECK ((counted_quantity IS NULL) = (system_quantity IS NULL)
                        AND (counted_quantity IS NULL OR (counted_quantity >= 0 AND quantity = counted_quantity - system_quantity)))
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE stock_adjustment_lines DROP CONSTRAINT IF EXISTS stock_adjustment_lines_count_check');
        }
        Schema::table('stock_adjustment_lines', function (Blueprint $table) {
            $table->dropColumn(['counted_quantity', 'system_quantity']);
        });
    }
};
