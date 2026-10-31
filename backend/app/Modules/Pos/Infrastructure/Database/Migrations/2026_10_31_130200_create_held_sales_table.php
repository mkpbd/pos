<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Parked POS carts ("hold" / draft sales). Not financial records: they hold no prices and
 * are priced again on resume; checking out or discarding deletes them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('held_sales', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained()->cascadeOnDelete();
            $table->string('label', 100)->nullable();
            $table->foreignUuid('customer_id')->nullable()->constrained()->nullOnDelete();
            // {lines: [{variant_id, quantity, discount, serials}], invoice_discount?, notes}
            $table->json('cart');
            $table->unsignedSmallInteger('lines_count');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->index(['organization_id', 'branch_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('held_sales');
    }
};
