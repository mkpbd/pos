<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A cart that became a web order keeps its row (linked to the order, lines deleted) and is
 * never used again: a customer has one active cart = the one not converted yet.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('carts', function (Blueprint $table) {
            $table->foreignUuid('converted_order_id')->nullable()->after('expires_at')->constrained('orders')->nullOnDelete();
        });

        DB::statement('DROP INDEX IF EXISTS carts_customer_unique');
        DB::statement('CREATE UNIQUE INDEX carts_customer_unique ON carts (customer_id) WHERE customer_id IS NOT NULL AND converted_order_id IS NULL');
    }

    public function down(): void
    {
        DB::table('carts')->whereNotNull('converted_order_id')->delete();
        DB::statement('DROP INDEX IF EXISTS carts_customer_unique');
        DB::statement('CREATE UNIQUE INDEX carts_customer_unique ON carts (customer_id) WHERE customer_id IS NOT NULL');

        Schema::table('carts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('converted_order_id');
        });
    }
};
