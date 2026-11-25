<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * POS1c: exchanges at the till. The return of an exchange points at the new sale it paid for
 * (one return per exchange sale), and `exchange` becomes a payment method of that sale and a
 * refund method of the return — value moved between the two documents, never money (it does
 * not go through the payments ledger).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_returns', function (Blueprint $table) {
            $table->foreignUuid('exchange_sale_id')->nullable()->unique()->constrained('sales')->restrictOnDelete();
        });

        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::unprepared(<<<'SQL'
            ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_method_check;
            ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check
                CHECK (method IN ('cash', 'card', 'mobile_banking', 'loyalty_points', 'store_credit', 'gift_card', 'exchange'));

            ALTER TABLE sale_return_refunds DROP CONSTRAINT IF EXISTS sale_return_refunds_method_check;
            ALTER TABLE sale_return_refunds ADD CONSTRAINT sale_return_refunds_method_check
                CHECK (method IN ('cash', 'card', 'mobile_banking', 'loyalty_points', 'store_credit', 'gift_card', 'exchange'));
        SQL);
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_method_check;
                ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check
                    CHECK (method IN ('cash', 'card', 'mobile_banking', 'loyalty_points', 'store_credit', 'gift_card'));

                ALTER TABLE sale_return_refunds DROP CONSTRAINT IF EXISTS sale_return_refunds_method_check;
                ALTER TABLE sale_return_refunds ADD CONSTRAINT sale_return_refunds_method_check
                    CHECK (method IN ('cash', 'card', 'mobile_banking', 'loyalty_points', 'store_credit', 'gift_card'));
            SQL);
        }

        Schema::table('sale_returns', function (Blueprint $table) {
            $table->dropConstrainedForeignId('exchange_sale_id');
        });
    }
};
