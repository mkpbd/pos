<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How shoppers may pay (ADR-006). E8a: the offline methods `cod` and `bank_transfer`
 * (no credentials). Rows are created on first use with defaults; online gateways
 * (SSLCommerz, bKash, Nagad) add `mode` and encrypted credentials in E8c.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_gateways', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('code', 30);
            $table->boolean('is_enabled')->default(false);
            $table->string('display_name', 60);
            // Shown to the shopper after placing the order (bank account details for transfers).
            $table->text('instructions')->nullable();
            // bank_transfer: {hold_hours: 1–168}; cod: {max_order_total: amount|null}.
            $table->json('settings')->nullable();
            $table->integer('sort_order')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_gateways');
    }
};
