<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Posted sales (immutable invoices). Lines, stock allocations and payments are append-only;
 * the only change a sale header ever sees is its cancellation.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sales', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->string('number', 40);
            $table->foreignUuid('customer_id')->nullable()->constrained()->restrictOnDelete();
            $table->enum('status', ['completed', 'cancelled'])->default('completed');
            $table->enum('tax_mode', ['inclusive', 'exclusive']);
            $table->char('currency', 3);
            $table->decimal('subtotal', 18, 2);
            $table->decimal('item_discount_total', 18, 2);
            $table->string('invoice_discount_type', 10)->nullable();
            $table->decimal('invoice_discount_value', 18, 2)->nullable();
            $table->string('invoice_discount_source', 20)->nullable(); // manual | customer_group
            $table->decimal('invoice_discount_total', 18, 2);
            $table->decimal('tax_total', 18, 2);
            $table->decimal('total', 18, 2);
            $table->decimal('paid_total', 18, 2);
            $table->decimal('change_total', 18, 2);
            $table->decimal('due_total', 18, 2);
            $table->decimal('cost_total', 18, 2);
            $table->text('notes')->nullable();
            $table->timestampTz('sold_at');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('cancelled_at')->nullable();
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('cancellation_reason', 255)->nullable();
            $table->timestampsTz();

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'branch_id', 'sold_at']);
            $table->index(['organization_id', 'customer_id', 'status']);
            $table->index(['organization_id', 'created_by', 'sold_at']);
        });

        Schema::create('sale_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_id')->constrained()->restrictOnDelete();
            $table->unsignedSmallInteger('position');
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            // Snapshots: the invoice must read the same forever, whatever happens to the product.
            $table->string('product_name', 255);
            $table->string('variant_name', 255)->nullable();
            $table->string('sku', 64);
            $table->string('unit_code', 20)->nullable();
            $table->decimal('quantity', 18, 3);
            $table->decimal('unit_price', 18, 2);
            $table->string('discount_type', 10)->nullable();
            $table->decimal('discount_value', 18, 2)->nullable();
            $table->decimal('line_subtotal', 18, 2);
            $table->decimal('discount_amount', 18, 2);
            $table->decimal('invoice_discount_share', 18, 2);
            $table->decimal('net_amount', 18, 2);
            $table->decimal('tax_rate', 9, 4);
            $table->decimal('tax_amount', 18, 2);
            $table->decimal('line_total', 18, 2);
            $table->decimal('unit_cost', 18, 4);
            $table->decimal('cost_total', 18, 2);
            $table->timestampTz('created_at');

            $table->index(['sale_id', 'position']);
            $table->index(['organization_id', 'variant_id']);
        });

        // Which batches (or untracked stock, batch NULL) each line was taken from, at what cost.
        Schema::create('sale_line_stock', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_line_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('batch_id')->nullable()->constrained()->restrictOnDelete();
            $table->decimal('quantity', 18, 3);
            $table->decimal('unit_cost', 18, 4);

            $table->index('sale_line_id');
        });

        Schema::create('sale_line_serials', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_line_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            $table->string('serial', 100);
            // Set when the sale is cancelled (later: returned); the serial can then be sold again.
            $table->timestampTz('released_at')->nullable();

            $table->index('sale_line_id');
        });

        Schema::create('sale_payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->enum('kind', ['payment', 'reversal']);
            $table->enum('method', ['cash', 'card', 'mobile_banking']);
            // Signed: reversals (cancellation refunds) are negative.
            $table->decimal('amount', 18, 2);
            $table->decimal('tendered', 18, 2)->nullable();
            $table->string('reference', 100)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index('sale_id');
            $table->index(['organization_id', 'branch_id', 'created_at']);
        });

        // A serial number can only be "out there" once per product.
        DB::statement('CREATE UNIQUE INDEX sale_line_serials_active_unique ON sale_line_serials (organization_id, variant_id, lower(serial)) WHERE released_at IS NULL');

        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                CREATE FUNCTION prevent_sales_mutation() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER sale_lines_append_only BEFORE UPDATE OR DELETE ON sale_lines
                    FOR EACH ROW EXECUTE FUNCTION prevent_sales_mutation();
                CREATE TRIGGER sale_line_stock_append_only BEFORE UPDATE OR DELETE ON sale_line_stock
                    FOR EACH ROW EXECUTE FUNCTION prevent_sales_mutation();
                CREATE TRIGGER sale_payments_append_only BEFORE UPDATE OR DELETE ON sale_payments
                    FOR EACH ROW EXECUTE FUNCTION prevent_sales_mutation();
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                DROP TRIGGER IF EXISTS sale_payments_append_only ON sale_payments;
                DROP TRIGGER IF EXISTS sale_line_stock_append_only ON sale_line_stock;
                DROP TRIGGER IF EXISTS sale_lines_append_only ON sale_lines;
                DROP FUNCTION IF EXISTS prevent_sales_mutation();
            SQL);
        }

        Schema::dropIfExists('sale_payments');
        Schema::dropIfExists('sale_line_serials');
        Schema::dropIfExists('sale_line_stock');
        Schema::dropIfExists('sale_lines');
        Schema::dropIfExists('sales');
    }
};
