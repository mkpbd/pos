<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * ST2c: a till line's list price may now be a wholesale price or a quantity-break price, so
 * `sale_lines.price_source` gains `wholesale` and `tier` (catalog | wholesale | tier | override | open).
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE sale_lines DROP CONSTRAINT IF EXISTS sale_lines_price_source_check;
 *   ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_price_source_check
 *       CHECK (price_source IN ('catalog', 'wholesale', 'tier', 'override', 'open')
 *       AND promotion_discount >= 0 AND promotion_discount <= discount_amount);
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::unprepared(<<<'SQL'
            ALTER TABLE sale_lines DROP CONSTRAINT IF EXISTS sale_lines_price_source_check;
            ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_price_source_check
                CHECK (price_source IN ('catalog', 'wholesale', 'tier', 'override', 'open')
                    AND promotion_discount >= 0 AND promotion_discount <= discount_amount);
        SQL);
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        // NOT VALID: sales already recorded at wholesale / tier prices are kept as they are.
        DB::unprepared(<<<'SQL'
            ALTER TABLE sale_lines DROP CONSTRAINT IF EXISTS sale_lines_price_source_check;
            ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_price_source_check
                CHECK (price_source IN ('catalog', 'override', 'open')
                    AND promotion_discount >= 0 AND promotion_discount <= discount_amount) NOT VALID;
        SQL);
    }
};
