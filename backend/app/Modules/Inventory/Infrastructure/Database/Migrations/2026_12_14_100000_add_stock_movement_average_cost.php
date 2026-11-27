<?php

use App\Modules\Inventory\Infrastructure\Ledger\AverageCostReplay;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ST2d: the level's weighted average cost right after each movement, so stock can be valued
 * as of a past date (balance_after × average_cost_after of the last movement before then).
 * Existing rows are backfilled by replaying each level's ledger (AverageCostReplay), which
 * logs how many levels do not end on their stored average.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE stock_movements ADD COLUMN average_cost_after numeric(18, 4) NULL;
 *   -- backfill: php artisan migrate runs AverageCostReplay (chunked, trigger lifted while it runs)
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->decimal('average_cost_after', 18, 4)->nullable();
        });

        if (DB::getDriverName() === 'pgsql') {
            app(AverageCostReplay::class)->run();
        }
    }

    public function down(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->dropColumn('average_cost_after');
        });
    }
};
