<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * BD1c: the advance delivery charge of cash-on-delivery orders — `cod_advance` `off` (default),
 * `risky` (the cash-on-delivery check's risky numbers) or `all`; `cod_advance_amount`
 * `delivery` (delivery charge + COD fee, default) or `fixed` (`cod_advance_fixed`, capped at
 * the order total); `cod_advance_hold_hours` (1–168, default 24) to pay it. Additive only.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE storefront_settings ADD COLUMN cod_advance varchar(10) NOT NULL DEFAULT 'off',
 *     ADD COLUMN cod_advance_amount varchar(10) NOT NULL DEFAULT 'delivery',
 *     ADD COLUMN cod_advance_fixed numeric(12,2) NULL,
 *     ADD COLUMN cod_advance_hold_hours smallint NOT NULL DEFAULT 24;
 *   ALTER TABLE storefront_settings ADD CONSTRAINT storefront_settings_cod_advance_check
 *     CHECK (cod_advance IN ('off', 'risky', 'all') AND cod_advance_amount IN ('delivery', 'fixed')
 *       AND (cod_advance_fixed IS NULL OR cod_advance_fixed > 0) AND cod_advance_hold_hours BETWEEN 1 AND 168);
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->string('cod_advance', 10)->default('off');
            $table->string('cod_advance_amount', 10)->default('delivery');
            $table->decimal('cod_advance_fixed', 12, 2)->nullable();
            $table->smallInteger('cod_advance_hold_hours')->default(24);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE storefront_settings ADD CONSTRAINT storefront_settings_cod_advance_check CHECK (cod_advance IN ('off', 'risky', 'all') AND cod_advance_amount IN ('delivery', 'fixed') AND (cod_advance_fixed IS NULL OR cod_advance_fixed > 0) AND cod_advance_hold_hours BETWEEN 1 AND 168)");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE storefront_settings DROP CONSTRAINT IF EXISTS storefront_settings_cod_advance_check');
        }
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->dropColumn(['cod_advance', 'cod_advance_amount', 'cod_advance_fixed', 'cod_advance_hold_hours']);
        });
    }
};
