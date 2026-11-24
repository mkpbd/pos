<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * BD1a: the contact fields of the storefront checkout — the customer e-mail (`required`,
 * `optional` (default) or `hidden`) and whether the mobile number is checked with an SMS code
 * before an order is placed (`off` (default), `cod` = cash-on-delivery orders, `all`).
 * Additive only.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE storefront_settings ADD COLUMN checkout_email varchar(10) NOT NULL DEFAULT 'optional',
 *     ADD COLUMN checkout_phone_verification varchar(5) NOT NULL DEFAULT 'off';
 *   ALTER TABLE storefront_settings ADD CONSTRAINT storefront_settings_checkout_contact_check
 *     CHECK (checkout_email IN ('required', 'optional', 'hidden') AND checkout_phone_verification IN ('off', 'cod', 'all'));
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->string('checkout_email', 10)->default('optional');
            $table->string('checkout_phone_verification', 5)->default('off');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE storefront_settings ADD CONSTRAINT storefront_settings_checkout_contact_check CHECK (checkout_email IN ('required', 'optional', 'hidden') AND checkout_phone_verification IN ('off', 'cod', 'all'))");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE storefront_settings DROP CONSTRAINT IF EXISTS storefront_settings_checkout_contact_check');
        }
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->dropColumn(['checkout_email', 'checkout_phone_verification']);
        });
    }
};
