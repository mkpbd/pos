<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // P2a: landing page orders may be placed without an e-mail address (phone only).
        Schema::table('promotion_redemptions', function (Blueprint $table) {
            $table->string('email', 255)->nullable()->change();
        });
    }

    public function down(): void
    {
        // Irreversible without losing e-mail-less redemptions; left nullable.
    }
};
