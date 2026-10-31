<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('batches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            $table->string('batch_number', 64);
            $table->date('manufactured_on')->nullable();
            $table->date('expires_on')->nullable();
            $table->timestampsTz();

            $table->index(['organization_id', 'expires_on']);
        });

        // Current quantity per store × variant × batch. A projection of stock_movements,
        // updated in the same transaction under a row lock (SELECT … FOR UPDATE).
        Schema::create('stock_levels', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            $table->foreignUuid('batch_id')->nullable()->constrained()->restrictOnDelete();
            $table->decimal('quantity', 18, 3)->default(0);
            // Weighted average unit cost of the quantity on hand.
            $table->decimal('average_cost', 18, 4)->default(0);
            $table->timestampTz('updated_at')->nullable();

            $table->index(['organization_id', 'variant_id']);
            $table->index(['organization_id', 'branch_id']);
        });

        // Append-only stock ledger. Every quantity change is one row; never updated or deleted.
        Schema::create('stock_movements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            $table->foreignUuid('batch_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('type', 30);
            // Signed: positive = into the store, negative = out of it.
            $table->decimal('quantity', 18, 3);
            $table->decimal('unit_cost', 18, 4);
            $table->decimal('balance_after', 18, 3);
            $table->string('reference_type', 50);
            $table->uuid('reference_id');
            $table->string('reference_number', 30)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index(['store_id', 'variant_id', 'created_at']);
            $table->index(['organization_id', 'variant_id', 'created_at']);
            $table->index(['organization_id', 'created_at']);
            $table->index(['reference_type', 'reference_id']);
        });

        Schema::create('stock_adjustments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->string('number', 30);
            $table->enum('reason', ['opening', 'count', 'damage', 'expiry', 'theft', 'correction', 'other']);
            $table->text('note')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'branch_id', 'created_at']);
        });

        Schema::create('stock_adjustment_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('stock_adjustment_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            $table->foreignUuid('batch_id')->nullable()->constrained()->restrictOnDelete();
            $table->decimal('quantity', 18, 3);
            $table->decimal('unit_cost', 18, 4);
        });

        Schema::create('stock_transfers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('number', 30);
            $table->foreignUuid('from_branch_id')->constrained('branches')->restrictOnDelete();
            $table->foreignUuid('from_store_id')->constrained('stores')->restrictOnDelete();
            $table->foreignUuid('to_branch_id')->constrained('branches')->restrictOnDelete();
            $table->foreignUuid('to_store_id')->constrained('stores')->restrictOnDelete();
            $table->enum('status', ['in_transit', 'received', 'cancelled'])->default('in_transit');
            $table->text('note')->nullable();
            $table->foreignUuid('dispatched_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('dispatched_at');
            $table->foreignUuid('completed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('completed_at')->nullable();
            $table->timestampsTz();

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'status']);
        });

        Schema::create('stock_transfer_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('stock_transfer_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            $table->foreignUuid('batch_id')->nullable()->constrained()->restrictOnDelete();
            $table->decimal('quantity', 18, 3);
            $table->decimal('unit_cost', 18, 4)->default(0);
        });

        DB::statement('CREATE UNIQUE INDEX batches_variant_number_unique ON batches (organization_id, variant_id, lower(batch_number))');
        // One level row per store × variant × batch (NULL batch = untracked stock).
        DB::statement('CREATE UNIQUE INDEX stock_levels_unbatched_unique ON stock_levels (store_id, variant_id) WHERE batch_id IS NULL');
        DB::statement('CREATE UNIQUE INDEX stock_levels_batched_unique ON stock_levels (store_id, variant_id, batch_id) WHERE batch_id IS NOT NULL');

        if (DB::getDriverName() === 'pgsql') {
            // Defence in depth: the ledger cannot be rewritten, even by a buggy query.
            DB::unprepared(<<<'SQL'
                CREATE FUNCTION prevent_ledger_mutation() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER stock_movements_append_only
                    BEFORE UPDATE OR DELETE ON stock_movements
                    FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS stock_movements_append_only ON stock_movements; DROP FUNCTION IF EXISTS prevent_ledger_mutation();');
        }

        Schema::dropIfExists('stock_transfer_lines');
        Schema::dropIfExists('stock_transfers');
        Schema::dropIfExists('stock_adjustment_lines');
        Schema::dropIfExists('stock_adjustments');
        Schema::dropIfExists('stock_movements');
        Schema::dropIfExists('stock_levels');
        Schema::dropIfExists('batches');
    }
};
