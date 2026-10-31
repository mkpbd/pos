<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Gap-free, per-organization counters for human-readable numbers
 * (customer codes, auto SKUs, later invoice numbers). Rows are locked
 * FOR UPDATE inside the transaction that consumes the number.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_sequences', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            // e.g. "customer", "supplier", "sku", later "invoice:<branch-id>"
            $table->string('key', 100);
            $table->unsignedBigInteger('next_number')->default(1);
            $table->timestampsTz();

            $table->primary(['organization_id', 'key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_sequences');
    }
};
