<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // P2a: where a web order was placed — the cart checkout (`storefront`) or a landing
        // page's order form (`landing_page`) — and the campaign attribution the storefront sent
        // (UTM parameters, short link, first landing path, referrer host; sanitized, no personal
        // data). Landing page order forms may leave the e-mail address out.
        Schema::table('orders', function (Blueprint $table) {
            $table->string('source', 20)->default('storefront');
            $table->jsonb('attribution')->nullable();
            $table->string('contact_email', 255)->nullable()->change();
            $table->index(['organization_id', 'placed_at']);
        });
        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('storefront', 'landing_page'))");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check');
        }
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex(['organization_id', 'placed_at']);
            $table->dropColumn(['source', 'attribution']);
        });
    }
};
