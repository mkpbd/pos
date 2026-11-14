<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // P2a: a campaign address — the page a domain opens on (`/p/eid-sale`); null = the home page.
        Schema::table('storefront_domains', function (Blueprint $table) {
            $table->string('entry_path', 255)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('storefront_domains', function (Blueprint $table) {
            $table->dropColumn('entry_path');
        });
    }
};
