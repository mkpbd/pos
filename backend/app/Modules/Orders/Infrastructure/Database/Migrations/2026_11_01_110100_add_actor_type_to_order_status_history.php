<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Who made a status change (E9): `customer` (placement, and cancelling from the account
 * area), `staff` (actor_user_id set) or `system` (expiry). The history is append-only, so
 * rows from before E9 keep NULL and the presenter derives it (staff actor → staff, the
 * placement row → customer, otherwise system).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_status_history', function (Blueprint $table) {
            $table->string('actor_type', 10)->nullable()->after('actor_user_id');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_actor_type_check CHECK (actor_type IS NULL OR actor_type IN ('customer', 'staff', 'system'))");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE order_status_history DROP CONSTRAINT IF EXISTS order_status_history_actor_type_check');
        }
        Schema::table('order_status_history', function (Blueprint $table) {
            $table->dropColumn('actor_type');
        });
    }
};
