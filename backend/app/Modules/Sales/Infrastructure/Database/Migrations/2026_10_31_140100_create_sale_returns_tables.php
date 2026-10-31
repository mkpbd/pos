<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Sales returns (against the original invoice, with an approval step), their refunds, the
 * reasons customers return goods for, and payments customers make against what they owe.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('return_reasons', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('name', 100);
            // Whether returned goods go back on the shelf by default (e.g. "Changed mind") or
            // are written off (e.g. "Damaged"). The clerk can still decide per line.
            $table->boolean('restock_by_default')->default(true);
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        Schema::create('sale_returns', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('customer_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('number', 40);
            $table->enum('status', ['pending', 'completed', 'rejected'])->default('pending');
            $table->foreignUuid('return_reason_id')->nullable()->constrained()->restrictOnDelete();
            $table->text('notes')->nullable();
            $table->char('currency', 3);
            $table->decimal('subtotal', 18, 2);
            $table->decimal('tax_total', 18, 2);
            $table->decimal('total', 18, 2);
            // On completion the total is settled: first against what the customer still owes
            // on the invoice (credited), the rest handed back (refunded).
            $table->decimal('credited_total', 18, 2)->default(0);
            $table->decimal('refunded_total', 18, 2)->default(0);
            $table->foreignUuid('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('requested_at');
            $table->foreignUuid('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('decided_at')->nullable();
            $table->string('rejection_reason', 255)->nullable();
            $table->timestampsTz();

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'branch_id', 'requested_at']);
            $table->index(['organization_id', 'status']);
            $table->index('sale_id');
        });

        Schema::create('sale_return_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_return_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_line_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            $table->decimal('quantity', 18, 3);
            // false = written off (damaged, expired): no stock comes back.
            $table->boolean('restock');
            // Share of the original line, at the price actually charged (discounts and tax included).
            $table->decimal('net_amount', 18, 2);
            $table->decimal('tax_amount', 18, 2);
            $table->decimal('line_total', 18, 2);
            $table->decimal('unit_cost', 18, 4);
            $table->decimal('cost_total', 18, 2);
            $table->json('serials')->nullable();
            $table->timestampTz('created_at');

            $table->index('sale_return_id');
            $table->index('sale_line_id');
        });

        // Which batches restocked goods went back to, at the cost they left with.
        Schema::create('sale_return_line_stock', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_return_line_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_line_stock_id')->constrained('sale_line_stock')->restrictOnDelete();
            $table->foreignUuid('batch_id')->nullable()->constrained()->restrictOnDelete();
            $table->decimal('quantity', 18, 3);
            $table->decimal('unit_cost', 18, 4);

            $table->index('sale_return_line_id');
            $table->index('sale_line_stock_id');
        });

        Schema::create('sale_return_refunds', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_return_id')->constrained()->restrictOnDelete();
            $table->string('method', 20);
            $table->decimal('amount', 18, 2);
            $table->string('reference', 100)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index('sale_return_id');
        });

        Schema::create('customer_payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('customer_id')->constrained()->restrictOnDelete();
            $table->string('number', 40);
            $table->char('currency', 3);
            $table->decimal('amount', 18, 2);
            $table->string('method', 20);
            $table->string('reference', 100)->nullable();
            $table->text('notes')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'customer_id', 'created_at']);
            $table->index(['organization_id', 'branch_id', 'created_at']);
        });

        DB::statement('CREATE UNIQUE INDEX return_reasons_name_unique ON return_reasons (organization_id, lower(name))');

        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                CREATE TRIGGER sale_return_lines_append_only BEFORE UPDATE OR DELETE ON sale_return_lines
                    FOR EACH ROW EXECUTE FUNCTION prevent_sales_mutation();
                CREATE TRIGGER sale_return_line_stock_append_only BEFORE UPDATE OR DELETE ON sale_return_line_stock
                    FOR EACH ROW EXECUTE FUNCTION prevent_sales_mutation();
                CREATE TRIGGER sale_return_refunds_append_only BEFORE UPDATE OR DELETE ON sale_return_refunds
                    FOR EACH ROW EXECUTE FUNCTION prevent_sales_mutation();
                CREATE TRIGGER customer_payments_append_only BEFORE UPDATE OR DELETE ON customer_payments
                    FOR EACH ROW EXECUTE FUNCTION prevent_sales_mutation();

                ALTER TABLE customer_payments ADD CONSTRAINT customer_payments_amount_positive CHECK (amount > 0);
                ALTER TABLE sale_return_refunds ADD CONSTRAINT sale_return_refunds_amount_positive CHECK (amount > 0);

                -- Loyalty points become a way to pay (redeemed at checkout).
                ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_method_check;
                ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check
                    CHECK (method IN ('cash', 'card', 'mobile_banking', 'loyalty_points'));
            SQL);
        } else {
            Schema::table('sale_payments', function (Blueprint $table) {
                $table->string('method', 20)->change();
            });
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_method_check;
                ALTER TABLE sale_payments ADD CONSTRAINT sale_payments_method_check
                    CHECK (method IN ('cash', 'card', 'mobile_banking'));
                DROP TRIGGER IF EXISTS customer_payments_append_only ON customer_payments;
                DROP TRIGGER IF EXISTS sale_return_refunds_append_only ON sale_return_refunds;
                DROP TRIGGER IF EXISTS sale_return_line_stock_append_only ON sale_return_line_stock;
                DROP TRIGGER IF EXISTS sale_return_lines_append_only ON sale_return_lines;
            SQL);
        }

        Schema::dropIfExists('customer_payments');
        Schema::dropIfExists('sale_return_refunds');
        Schema::dropIfExists('sale_return_line_stock');
        Schema::dropIfExists('sale_return_lines');
        Schema::dropIfExists('sale_returns');
        Schema::dropIfExists('return_reasons');
    }
};
