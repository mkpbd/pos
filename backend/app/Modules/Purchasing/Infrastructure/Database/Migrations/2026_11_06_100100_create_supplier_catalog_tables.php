<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * SC1: the supplier catalog (what each supplier sells us, at what cost, pack size, minimum
 * order and lead time; one preferred supplier per variant) and the log of daily reorder
 * notifications (one per store and organization-local day).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('supplier_products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('supplier_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            $table->string('supplier_sku', 64)->nullable();
            // Per base unit of the variant, tax-exclusive (as on purchase orders).
            $table->decimal('unit_cost', 18, 4);
            // Order quantities are rounded up to whole packs.
            $table->decimal('pack_size', 18, 3)->default(1);
            $table->decimal('min_order_qty', 18, 3)->nullable();
            $table->unsignedSmallInteger('lead_time_days')->default(7);
            $table->boolean('is_preferred')->default(false);
            // Written by goods receipts only.
            $table->decimal('last_purchase_cost', 18, 4)->nullable();
            $table->timestampTz('last_purchased_at')->nullable();
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['supplier_id', 'variant_id']);
            $table->index(['organization_id', 'variant_id']);
        });

        Schema::create('reorder_notification_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            // The organization-local day the notification is for.
            $table->date('run_on');
            $table->unsignedInteger('items');
            $table->unsignedInteger('recipients');
            $table->timestampTz('created_at');

            $table->unique(['store_id', 'run_on']);
            $table->index(['organization_id', 'run_on']);
        });

        // At most one preferred supplier per variant.
        DB::statement('CREATE UNIQUE INDEX supplier_products_preferred_unique ON supplier_products (organization_id, variant_id) WHERE is_preferred');

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE supplier_products ADD CONSTRAINT supplier_products_unit_cost_check CHECK (unit_cost >= 0)');
            DB::statement('ALTER TABLE supplier_products ADD CONSTRAINT supplier_products_pack_size_check CHECK (pack_size >= 1)');
            DB::statement('ALTER TABLE supplier_products ADD CONSTRAINT supplier_products_min_order_check CHECK (min_order_qty IS NULL OR min_order_qty > 0)');
            DB::statement('ALTER TABLE supplier_products ADD CONSTRAINT supplier_products_lead_time_check CHECK (lead_time_days BETWEEN 0 AND 365)');
            DB::statement('ALTER TABLE supplier_products ADD CONSTRAINT supplier_products_last_cost_check CHECK (last_purchase_cost IS NULL OR last_purchase_cost >= 0)');
            DB::statement('ALTER TABLE supplier_products ADD CONSTRAINT supplier_products_preferred_active_check CHECK (NOT is_preferred OR is_active)');
            DB::statement('ALTER TABLE reorder_notification_runs ADD CONSTRAINT reorder_notification_runs_items_check CHECK (items > 0)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('reorder_notification_runs');
        Schema::dropIfExists('supplier_products');
    }
};
