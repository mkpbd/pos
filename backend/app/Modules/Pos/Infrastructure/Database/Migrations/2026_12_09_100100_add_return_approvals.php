<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * POS1c: a manager approves a return at the till (an exchange) with their PIN — action `return`,
 * bound to `details.sale_id` (the original invoice).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::unprepared(<<<'SQL'
            ALTER TABLE pos_approvals DROP CONSTRAINT IF EXISTS pos_approvals_action_check;
            ALTER TABLE pos_approvals ADD CONSTRAINT pos_approvals_action_check
                CHECK (action IN ('price_override', 'discount', 'return'));
        SQL);
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::unprepared(<<<'SQL'
            DELETE FROM pos_approvals WHERE action = 'return';
            ALTER TABLE pos_approvals DROP CONSTRAINT IF EXISTS pos_approvals_action_check;
            ALTER TABLE pos_approvals ADD CONSTRAINT pos_approvals_action_check
                CHECK (action IN ('price_override', 'discount'));
        SQL);
    }
};
