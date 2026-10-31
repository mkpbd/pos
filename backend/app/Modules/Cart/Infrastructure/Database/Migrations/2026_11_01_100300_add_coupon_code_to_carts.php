<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One coupon per cart (E8b). The code is kept as entered (normalized upper-case) and
 * re-checked on every pricing; an invalid code stays, ignored, until the shopper removes it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('carts', function (Blueprint $table) {
            $table->string('coupon_code', 40)->nullable()->after('expires_at');
        });
    }

    public function down(): void
    {
        Schema::table('carts', function (Blueprint $table) {
            $table->dropColumn('coupon_code');
        });
    }
};
