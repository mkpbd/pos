<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * BD2b: abandoned-cart reminders — when a signed-in shopper's cart got its one reminder
 * (`cart:reminders` sets it in the same conditional update that claims the cart). Additive only.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE carts ADD COLUMN reminder_sent_at timestamptz NULL;
 *   CREATE INDEX carts_reminder_due_index ON carts (organization_id, updated_at)
 *     WHERE customer_id IS NOT NULL AND converted_order_id IS NULL AND reminder_sent_at IS NULL;
 *   CREATE INDEX carts_reminder_sent_index ON carts (organization_id, reminder_sent_at)
 *     WHERE reminder_sent_at IS NOT NULL;
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('carts', function (Blueprint $table) {
            $table->timestampTz('reminder_sent_at')->nullable();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('CREATE INDEX carts_reminder_due_index ON carts (organization_id, updated_at) WHERE customer_id IS NOT NULL AND converted_order_id IS NULL AND reminder_sent_at IS NULL');
            DB::statement('CREATE INDEX carts_reminder_sent_index ON carts (organization_id, reminder_sent_at) WHERE reminder_sent_at IS NOT NULL');
        }
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS carts_reminder_sent_index');
        DB::statement('DROP INDEX IF EXISTS carts_reminder_due_index');
        Schema::table('carts', function (Blueprint $table) {
            $table->dropColumn('reminder_sent_at');
        });
    }
};
