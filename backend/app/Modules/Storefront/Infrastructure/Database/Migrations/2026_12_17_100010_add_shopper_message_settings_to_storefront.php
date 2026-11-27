<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * BD2b: abandoned-cart reminders (`cart_reminders`, default off; `cart_reminder_after_hours`
 * 1–72, default 3) and the shipped / delivered e-mails to shoppers (`email_shipped`,
 * `email_delivered`, default on). Additive only.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE storefront_settings ADD COLUMN cart_reminders boolean NOT NULL DEFAULT false,
 *     ADD COLUMN cart_reminder_after_hours smallint NOT NULL DEFAULT 3,
 *     ADD COLUMN email_shipped boolean NOT NULL DEFAULT true,
 *     ADD COLUMN email_delivered boolean NOT NULL DEFAULT true;
 *   ALTER TABLE storefront_settings ADD CONSTRAINT storefront_settings_cart_reminder_check
 *     CHECK (cart_reminder_after_hours BETWEEN 1 AND 72);
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->boolean('cart_reminders')->default(false);
            $table->smallInteger('cart_reminder_after_hours')->default(3);
            $table->boolean('email_shipped')->default(true);
            $table->boolean('email_delivered')->default(true);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE storefront_settings ADD CONSTRAINT storefront_settings_cart_reminder_check CHECK (cart_reminder_after_hours BETWEEN 1 AND 72)');
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE storefront_settings DROP CONSTRAINT IF EXISTS storefront_settings_cart_reminder_check');
        }
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->dropColumn(['cart_reminders', 'cart_reminder_after_hours', 'email_shipped', 'email_delivered']);
        });
    }
};
