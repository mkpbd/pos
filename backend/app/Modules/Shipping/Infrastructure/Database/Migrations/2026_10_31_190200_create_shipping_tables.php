<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Delivery zones (sets of districts) and the delivery methods offered in each (E8a).
 * A district belongs to at most one zone per organization. Couriers and shipments are E10.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shipping_zones', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('name', 60);
            $table->boolean('is_active')->default(true);
            $table->integer('sort_order')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->index(['organization_id', 'sort_order']);
        });

        Schema::create('shipping_zone_districts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('zone_id')->constrained('shipping_zones')->cascadeOnDelete();
            $table->unsignedSmallInteger('district_id');
            $table->foreign('district_id')->references('id')->on('geo_districts')->restrictOnDelete();

            // One zone per district per organization (the save action reports DISTRICT_IN_OTHER_ZONE first).
            $table->unique(['organization_id', 'district_id']);
            $table->index('zone_id');
        });

        Schema::create('shipping_methods', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('zone_id')->constrained('shipping_zones')->cascadeOnDelete();
            $table->string('name', 60);
            $table->string('description', 160)->nullable();
            $table->decimal('fee', 18, 2);
            // Free delivery when the goods total (after tax) reaches this amount.
            $table->decimal('free_over', 18, 2)->nullable();
            $table->boolean('cod_allowed')->default(true);
            $table->decimal('cod_fee', 18, 2)->default(0);
            $table->unsignedSmallInteger('eta_min_days');
            $table->unsignedSmallInteger('eta_max_days');
            $table->boolean('is_active')->default(true);
            $table->integer('sort_order')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->index(['zone_id', 'sort_order']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE shipping_methods ADD CONSTRAINT shipping_methods_amounts_check CHECK (fee >= 0 AND cod_fee >= 0 AND (free_over IS NULL OR free_over >= 0))');
            DB::statement('ALTER TABLE shipping_methods ADD CONSTRAINT shipping_methods_eta_check CHECK (eta_min_days <= eta_max_days AND eta_max_days <= 30)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('shipping_methods');
        Schema::dropIfExists('shipping_zone_districts');
        Schema::dropIfExists('shipping_zones');
    }
};
