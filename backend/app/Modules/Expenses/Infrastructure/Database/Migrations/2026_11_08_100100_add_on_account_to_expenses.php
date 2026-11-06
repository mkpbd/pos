<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * SC3: an expense booked on a supplier's account (landed cost on stock already sold) — it is
 * settled later by a supplier payment, so it moves no money through the payments ledger and
 * cannot be voided on its own (the document that booked it owns it).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('expenses', function (Blueprint $table) {
            $table->boolean('on_account')->default(false)->after('method');
        });
    }

    public function down(): void
    {
        Schema::table('expenses', function (Blueprint $table) {
            $table->dropColumn('on_account');
        });
    }
};
