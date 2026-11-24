<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // BD1c: the ad click ids of a shop or landing-page order ({fbp, fbc, ttp, ttclid, gclid},
        // each ≤ 200 characters, absent keys left out) for the Conversions API; null when none.
        Schema::table('orders', function (Blueprint $table) {
            $table->jsonb('tracking_ids')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('tracking_ids');
        });
    }
};
