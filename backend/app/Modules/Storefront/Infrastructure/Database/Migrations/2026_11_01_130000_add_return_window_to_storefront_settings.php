<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Days after delivery a customer may ask to return goods of a web order (E10b); 0 = no online returns.
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->unsignedSmallInteger('return_window_days')->default(7)->after('guest_checkout_enabled');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE storefront_settings ADD CONSTRAINT storefront_settings_return_window_check CHECK (return_window_days BETWEEN 0 AND 60)');
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE storefront_settings DROP CONSTRAINT IF EXISTS storefront_settings_return_window_check');
        }
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->dropColumn('return_window_days');
        });
    }
};
