<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The stock location whose on-hand quantities decide online availability.
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->foreignUuid('fulfilment_store_id')->nullable()->after('meta_description')->constrained('stores')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->dropConstrainedForeignId('fulfilment_store_id');
        });
    }
};
