<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * POS1b: store credit and gift cards become ways to pay a sale and to refund a return
 * (their balances live in the StoredValue module; neither goes through the payments ledger).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::unprepared(<<<'SQL'
            ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_method_check;
            ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check
                CHECK (method IN ('cash', 'card', 'mobile_banking', 'loyalty_points', 'store_credit', 'gift_card'));

            ALTER TABLE sale_return_refunds DROP CONSTRAINT IF EXISTS sale_return_refunds_method_check;
            ALTER TABLE sale_return_refunds ADD CONSTRAINT sale_return_refunds_method_check
                CHECK (method IN ('cash', 'card', 'mobile_banking', 'loyalty_points', 'store_credit', 'gift_card'));
        SQL);
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::unprepared(<<<'SQL'
            ALTER TABLE sale_return_refunds DROP CONSTRAINT IF EXISTS sale_return_refunds_method_check;
            ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_method_check;
            ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check
                CHECK (method IN ('cash', 'card', 'mobile_banking', 'loyalty_points'));
        SQL);
    }
};
