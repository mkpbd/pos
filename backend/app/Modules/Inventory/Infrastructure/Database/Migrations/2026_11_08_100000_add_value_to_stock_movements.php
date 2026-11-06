<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * SC3: value-only movements (`landed_cost`) keep quantity 0 and record the value they added
 * to the level's stock value; every other movement leaves `value` NULL.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->decimal('value', 18, 2)->nullable()->after('unit_cost');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_value_only_check
                    CHECK ((type = 'landed_cost') = (value IS NOT NULL)
                        AND (type <> 'landed_cost' OR (quantity = 0 AND value > 0)))
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_value_only_check');
        }
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->dropColumn('value');
        });
    }
};
