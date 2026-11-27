<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ST2c: a customer group's price level — wholesale members are charged the variant's wholesale
 * price at the till. Additive; existing groups stay retail.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE customer_groups
 *     ADD COLUMN price_level varchar(16) NOT NULL DEFAULT 'retail',
 *     ADD CONSTRAINT customer_groups_price_level_check CHECK (price_level IN ('retail', 'wholesale'));
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customer_groups', function (Blueprint $table) {
            $table->string('price_level', 16)->default('retail');
        });
        DB::statement("ALTER TABLE customer_groups ADD CONSTRAINT customer_groups_price_level_check CHECK (price_level IN ('retail', 'wholesale'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE customer_groups DROP CONSTRAINT IF EXISTS customer_groups_price_level_check');
        Schema::table('customer_groups', function (Blueprint $table) {
            $table->dropColumn('price_level');
        });
    }
};
