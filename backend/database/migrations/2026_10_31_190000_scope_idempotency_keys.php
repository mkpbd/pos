<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Idempotency for shoppers (ADR-014): keys belong to a scope instead of a staff user —
 * `user:{id}` (staff), `customer:{account id}` (signed-in shopper) or `cart:{cart token hash}`
 * (guest). Existing rows become `user:{user_id}`; user_id stays for staff rows.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('idempotency_keys', function (Blueprint $table) {
            $table->string('scope', 80)->nullable()->after('id');
        });

        DB::table('idempotency_keys')->update(['scope' => DB::raw("'user:' || user_id")]);

        Schema::table('idempotency_keys', function (Blueprint $table) {
            $table->dropUnique(['user_id', 'key']);
        });

        Schema::table('idempotency_keys', function (Blueprint $table) {
            $table->uuid('user_id')->nullable()->change();
            $table->string('scope', 80)->nullable(false)->change();
            $table->unique(['scope', 'key']);
        });
    }

    public function down(): void
    {
        DB::table('idempotency_keys')->whereNull('user_id')->delete();

        Schema::table('idempotency_keys', function (Blueprint $table) {
            $table->dropUnique(['scope', 'key']);
        });

        Schema::table('idempotency_keys', function (Blueprint $table) {
            $table->uuid('user_id')->nullable(false)->change();
            $table->unique(['user_id', 'key']);
            $table->dropColumn('scope');
        });
    }
};
