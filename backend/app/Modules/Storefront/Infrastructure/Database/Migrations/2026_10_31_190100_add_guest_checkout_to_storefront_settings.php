<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Whether shoppers may check out without an account (E8a).
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->boolean('guest_checkout_enabled')->default(true)->after('fulfilment_store_id');
        });
    }

    public function down(): void
    {
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->dropColumn('guest_checkout_enabled');
        });
    }
};
