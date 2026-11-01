<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // E12: false (staging stores) = robots.txt "Disallow: /" and noindex on every page.
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->boolean('allow_indexing')->default(true)->after('return_window_days');
        });
    }

    public function down(): void
    {
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->dropColumn('allow_indexing');
        });
    }
};
