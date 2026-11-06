<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * SC1: per-store reorder rules (reorder point / order-up-to level) and the organization's
 * replenishment settings (central source store, coverage, velocity and safety days).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_reorder_rules', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            // Reorder point: order when the available quantity is at or below it.
            $table->decimal('min_qty', 18, 3);
            // Order-up-to level; NULL = cover the configured number of days of sales.
            $table->decimal('max_qty', 18, 3)->nullable();
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['store_id', 'variant_id']);
            $table->index(['organization_id', 'variant_id']);
        });

        // One row per organization; missing = defaults (no source store, 14 / 30 / 3 days).
        Schema::create('replenishment_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->unique()->constrained()->restrictOnDelete();
            $table->foreignUuid('source_store_id')->nullable()->constrained('stores')->restrictOnDelete();
            $table->unsignedSmallInteger('coverage_days')->default(14);
            $table->unsignedSmallInteger('velocity_days')->default(30);
            $table->unsignedSmallInteger('safety_days')->default(3);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE stock_reorder_rules ADD CONSTRAINT stock_reorder_rules_min_check CHECK (min_qty >= 0)');
            DB::statement('ALTER TABLE stock_reorder_rules ADD CONSTRAINT stock_reorder_rules_max_check CHECK (max_qty IS NULL OR max_qty >= min_qty)');
            DB::statement('ALTER TABLE replenishment_settings ADD CONSTRAINT replenishment_settings_coverage_check CHECK (coverage_days BETWEEN 1 AND 180)');
            DB::statement('ALTER TABLE replenishment_settings ADD CONSTRAINT replenishment_settings_velocity_check CHECK (velocity_days BETWEEN 7 AND 180)');
            DB::statement('ALTER TABLE replenishment_settings ADD CONSTRAINT replenishment_settings_safety_check CHECK (safety_days BETWEEN 0 AND 60)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('replenishment_settings');
        Schema::dropIfExists('stock_reorder_rules');
    }
};
