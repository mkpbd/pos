<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Delivery and billing addresses a customer keeps in the online store (max 10, one default shipping).
        Schema::create('customer_addresses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('customer_id')->constrained()->cascadeOnDelete();
            $table->string('label', 40)->nullable();
            $table->string('recipient_name', 120);
            // Bangladeshi mobile, normalized to 01XXXXXXXXX.
            $table->string('phone', 11);
            $table->unsignedSmallInteger('division_id');
            $table->foreign('division_id')->references('id')->on('geo_divisions')->restrictOnDelete();
            $table->unsignedSmallInteger('district_id');
            $table->foreign('district_id')->references('id')->on('geo_districts')->restrictOnDelete();
            // Thana / area as typed (no upazila reference table yet).
            $table->string('area', 100);
            $table->string('address_line', 255);
            $table->string('postcode', 4)->nullable();
            $table->boolean('is_default_shipping')->default(false);
            $table->boolean('is_default_billing')->default(false);
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['organization_id', 'customer_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_addresses');
    }
};
