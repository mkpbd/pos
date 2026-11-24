<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * BD1b: holding cash-on-delivery orders for a confirmation call — `cod_review` `off` (default),
 * `risky` (numbers whose delivery success rate is below `cod_review_min_success_rate` %, and
 * with `cod_review_new_numbers` numbers that never received an order) or `all`. Additive only.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE storefront_settings ADD COLUMN cod_review varchar(10) NOT NULL DEFAULT 'off',
 *     ADD COLUMN cod_review_min_success_rate smallint NOT NULL DEFAULT 70,
 *     ADD COLUMN cod_review_new_numbers boolean NOT NULL DEFAULT false;
 *   ALTER TABLE storefront_settings ADD CONSTRAINT storefront_settings_cod_review_check
 *     CHECK (cod_review IN ('off', 'risky', 'all') AND cod_review_min_success_rate BETWEEN 0 AND 100);
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->string('cod_review', 10)->default('off');
            $table->smallInteger('cod_review_min_success_rate')->default(70);
            $table->boolean('cod_review_new_numbers')->default(false);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE storefront_settings ADD CONSTRAINT storefront_settings_cod_review_check CHECK (cod_review IN ('off', 'risky', 'all') AND cod_review_min_success_rate BETWEEN 0 AND 100)");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE storefront_settings DROP CONSTRAINT IF EXISTS storefront_settings_cod_review_check');
        }
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->dropColumn(['cod_review', 'cod_review_min_success_rate', 'cod_review_new_numbers']);
        });
    }
};
