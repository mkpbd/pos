<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ST1: stocktake sessions. A stocktake counts one store (whole store, some categories or some
 * products); each line keeps what was counted and what the system held at the moment it was
 * last counted, so posting (one `count` adjustment) is right even when sales happened after a
 * shelf was counted. One open (draft / counting) stocktake per store.
 *
 * Manual SQL (PostgreSQL), in addition to the tables below:
 *   CREATE UNIQUE INDEX stocktakes_open_store_unique ON stocktakes (store_id) WHERE status IN ('draft', 'counting');
 *   CREATE UNIQUE INDEX stocktake_lines_unbatched_unique ON stocktake_lines (stocktake_id, variant_id) WHERE batch_id IS NULL;
 *   CREATE UNIQUE INDEX stocktake_lines_batched_unique ON stocktake_lines (stocktake_id, variant_id, batch_id) WHERE batch_id IS NOT NULL;
 *   ALTER TABLE stocktakes ADD CONSTRAINT stocktakes_status_check CHECK (status IN ('draft', 'counting', 'posted', 'cancelled'));
 *   ALTER TABLE stocktakes ADD CONSTRAINT stocktakes_scope_check CHECK (scope IN ('all', 'categories', 'products'));
 *   ALTER TABLE stocktakes ADD CONSTRAINT stocktakes_uncounted_policy_check CHECK (uncounted_policy IS NULL OR uncounted_policy IN ('ignore', 'zero'));
 *   ALTER TABLE stocktake_lines ADD CONSTRAINT stocktake_lines_count_check
 *     CHECK ((counted_quantity IS NULL) = (system_quantity IS NULL) AND (counted_quantity IS NULL OR counted_quantity >= 0));
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stocktakes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->string('number', 30);
            $table->string('status', 20)->default('draft');
            $table->string('scope', 20)->default('all');
            $table->jsonb('scope_ids')->nullable();
            $table->boolean('blind')->default(false);
            $table->text('notes')->nullable();
            $table->timestampTz('started_at')->nullable();
            $table->string('uncounted_policy', 10)->nullable();
            $table->timestampTz('posted_at')->nullable();
            $table->foreignUuid('posted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('adjustment_id')->nullable()->constrained('stock_adjustments')->restrictOnDelete();
            $table->timestampTz('cancelled_at')->nullable();
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'branch_id', 'created_at']);
            $table->index(['organization_id', 'store_id', 'status']);
        });

        Schema::create('stocktake_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('stocktake_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            $table->foreignUuid('batch_id')->nullable()->constrained()->restrictOnDelete();
            // Display order: lines generated at start by product name, items found later after them.
            $table->unsignedInteger('position')->default(0);
            // Found on the shelf but outside the stocktake's scope (added while counting).
            $table->boolean('is_extra')->default(false);
            // On hand when the line was last counted (read under the stock row lock); NULL until counted.
            $table->decimal('system_quantity', 18, 3)->nullable();
            $table->decimal('counted_quantity', 18, 3)->nullable();
            $table->timestampTz('counted_at')->nullable();
            $table->foreignUuid('counted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('note', 255)->nullable();
            $table->timestampsTz();

            $table->index(['stocktake_id', 'position']);
        });

        DB::statement("CREATE UNIQUE INDEX stocktakes_open_store_unique ON stocktakes (store_id) WHERE status IN ('draft', 'counting')");
        DB::statement('CREATE UNIQUE INDEX stocktake_lines_unbatched_unique ON stocktake_lines (stocktake_id, variant_id) WHERE batch_id IS NULL');
        DB::statement('CREATE UNIQUE INDEX stocktake_lines_batched_unique ON stocktake_lines (stocktake_id, variant_id, batch_id) WHERE batch_id IS NOT NULL');

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE stocktakes ADD CONSTRAINT stocktakes_status_check CHECK (status IN ('draft', 'counting', 'posted', 'cancelled'))");
            DB::statement("ALTER TABLE stocktakes ADD CONSTRAINT stocktakes_scope_check CHECK (scope IN ('all', 'categories', 'products'))");
            DB::statement("ALTER TABLE stocktakes ADD CONSTRAINT stocktakes_uncounted_policy_check CHECK (uncounted_policy IS NULL OR uncounted_policy IN ('ignore', 'zero'))");
            DB::statement(<<<'SQL'
                ALTER TABLE stocktake_lines ADD CONSTRAINT stocktake_lines_count_check
                    CHECK ((counted_quantity IS NULL) = (system_quantity IS NULL)
                        AND (counted_quantity IS NULL OR counted_quantity >= 0))
            SQL);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('stocktake_lines');
        Schema::dropIfExists('stocktakes');
    }
};
