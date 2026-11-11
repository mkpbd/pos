<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * SC3: landed costs.
 * - Charges on a goods receipt (freight, duty…) allocated over its lines; stock enters at the
 *   landed unit cost. Charges without a charge supplier are part of the main supplier's
 *   invoice (`payable_total`); charges billed by another supplier are payables on that
 *   supplier's account.
 * - Landed cost vouchers (`LCV-000001`) for bills that arrive after the goods: draft → posted
 *   (no void in SC3). Posting writes append-only allocation rows per receipt line, split into
 *   the share on hand (value-only stock movement) and the share already consumed (expense).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('goods_receipts', function (Blueprint $table) {
            // Σ charge amounts (capitalised into stock) and Σ their recoverable tax (not capitalised).
            $table->decimal('charges_total', 18, 2)->default(0)->after('total');
            $table->decimal('charges_tax_total', 18, 2)->default(0)->after('charges_total');
            // subtotal + charges_total: the value the goods enter stock with.
            $table->decimal('landed_total', 18, 2)->default(0)->after('charges_tax_total');
            // What the main supplier invoiced: total + charges (with tax) not billed by another supplier.
            $table->decimal('payable_total', 18, 2)->default(0)->after('landed_total');
        });
        DB::table('goods_receipts')->update(['landed_total' => DB::raw('subtotal'), 'payable_total' => DB::raw('total')]);

        Schema::table('goods_receipt_lines', function (Blueprint $table) {
            // The line's share of the receipt's charges, and unit_cost + landed_cost / quantity (4 dp).
            $table->decimal('landed_cost', 18, 2)->default(0)->after('line_total');
            $table->decimal('landed_unit_cost', 18, 4)->default(0)->after('landed_cost');
        });
        DB::table('goods_receipt_lines')->update(['landed_unit_cost' => DB::raw('unit_cost')]);

        Schema::create('goods_receipt_charges', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('goods_receipt_id')->constrained()->restrictOnDelete();
            $table->string('type', 20);
            $table->string('description', 120)->nullable();
            $table->decimal('amount', 18, 2);
            $table->decimal('tax_amount', 18, 2)->default(0);
            $table->string('allocation', 10);
            // Who bills it; NULL = included in the main supplier's invoice.
            $table->foreignUuid('charge_supplier_id')->nullable()->constrained('suppliers')->restrictOnDelete();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestampTz('created_at');

            $table->index('goods_receipt_id');
            $table->index(['organization_id', 'charge_supplier_id']);
        });

        Schema::create('landed_cost_vouchers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('number', 30);
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->string('status', 10)->default('draft');
            $table->date('voucher_date');
            // The supplier who bills the charges (freight forwarder, customs agent…): the payable.
            $table->foreignUuid('charge_supplier_id')->constrained('suppliers')->restrictOnDelete();
            $table->string('reference', 64)->nullable();
            $table->string('notes', 1000)->nullable();
            $table->char('currency', 3);
            $table->decimal('charges_total', 18, 2)->default(0);
            $table->decimal('tax_total', 18, 2)->default(0);
            $table->decimal('total', 18, 2)->default(0);
            // Set on posting: capitalised into stock on hand / expensed for stock already gone.
            $table->decimal('on_hand_total', 18, 2)->nullable();
            $table->decimal('consumed_total', 18, 2)->nullable();
            $table->foreignUuid('expense_id')->nullable()->constrained('expenses')->restrictOnDelete();
            $table->string('expense_number', 40)->nullable();
            $table->foreignUuid('posted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('posted_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'status']);
            $table->index(['organization_id', 'branch_id', 'voucher_date']);
            $table->index(['organization_id', 'charge_supplier_id']);
        });

        Schema::create('landed_cost_voucher_charges', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('landed_cost_voucher_id')->constrained()->cascadeOnDelete();
            $table->string('type', 20);
            $table->string('description', 120)->nullable();
            $table->decimal('amount', 18, 2);
            $table->decimal('tax_amount', 18, 2)->default(0);
            $table->string('allocation', 10);
            $table->unsignedSmallInteger('sort_order')->default(0);

            $table->index('landed_cost_voucher_id');
        });

        Schema::create('landed_cost_voucher_receipts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('landed_cost_voucher_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('goods_receipt_id')->constrained()->restrictOnDelete();
            $table->unsignedSmallInteger('sort_order')->default(0);

            $table->unique(['landed_cost_voucher_id', 'goods_receipt_id']);
            $table->index('goods_receipt_id');
        });

        // Append-only: one row per receipt line when a voucher is posted.
        Schema::create('landed_cost_allocations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('landed_cost_voucher_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('goods_receipt_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('goods_receipt_line_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('batch_id')->nullable()->constrained()->restrictOnDelete();
            $table->decimal('received_quantity', 18, 3);
            $table->decimal('on_hand_quantity', 18, 3);
            $table->decimal('amount', 18, 2);
            $table->decimal('on_hand_amount', 18, 2);
            $table->decimal('consumed_amount', 18, 2);
            $table->decimal('average_cost_before', 18, 4)->nullable();
            $table->decimal('average_cost_after', 18, 4)->nullable();
            $table->foreignUuid('stock_movement_id')->nullable()->constrained()->restrictOnDelete();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestampTz('created_at');

            $table->index('landed_cost_voucher_id');
            $table->index('goods_receipt_line_id');
        });

        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::unprepared(<<<'SQL'
            ALTER TABLE goods_receipts ADD CONSTRAINT goods_receipts_landed_check
                CHECK (charges_total >= 0 AND charges_tax_total >= 0 AND landed_total >= 0 AND payable_total >= 0);
            ALTER TABLE goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_landed_check
                CHECK (landed_cost >= 0 AND landed_unit_cost >= 0);
            ALTER TABLE goods_receipt_charges ADD CONSTRAINT goods_receipt_charges_values_check
                CHECK (type IN ('freight', 'duty', 'insurance', 'handling', 'other') AND allocation IN ('value', 'quantity')
                    AND amount > 0 AND tax_amount >= 0);

            ALTER TABLE landed_cost_vouchers ADD CONSTRAINT landed_cost_vouchers_status_check
                CHECK (status IN ('draft', 'posted'));
            ALTER TABLE landed_cost_vouchers ADD CONSTRAINT landed_cost_vouchers_totals_check
                CHECK (charges_total >= 0 AND tax_total >= 0 AND total = charges_total + tax_total);
            ALTER TABLE landed_cost_vouchers ADD CONSTRAINT landed_cost_vouchers_posted_check
                CHECK (status <> 'posted' OR (posted_at IS NOT NULL AND on_hand_total >= 0 AND consumed_total >= 0
                    AND on_hand_total + consumed_total = charges_total));
            ALTER TABLE landed_cost_voucher_charges ADD CONSTRAINT landed_cost_voucher_charges_values_check
                CHECK (type IN ('freight', 'duty', 'insurance', 'handling', 'other') AND allocation IN ('value', 'quantity')
                    AND amount > 0 AND tax_amount >= 0);
            ALTER TABLE landed_cost_allocations ADD CONSTRAINT landed_cost_allocations_values_check
                CHECK (amount >= 0 AND on_hand_amount >= 0 AND consumed_amount >= 0 AND on_hand_amount + consumed_amount = amount
                    AND on_hand_quantity >= 0 AND on_hand_quantity <= received_quantity);

            CREATE OR REPLACE FUNCTION prevent_landed_cost_mutation() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
            END;
            $$ LANGUAGE plpgsql;

            CREATE TRIGGER landed_cost_allocations_append_only BEFORE UPDATE OR DELETE ON landed_cost_allocations
                FOR EACH ROW EXECUTE FUNCTION prevent_landed_cost_mutation();
            CREATE TRIGGER goods_receipt_charges_append_only BEFORE UPDATE OR DELETE ON goods_receipt_charges
                FOR EACH ROW EXECUTE FUNCTION prevent_landed_cost_mutation();
        SQL);
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                DROP TRIGGER IF EXISTS goods_receipt_charges_append_only ON goods_receipt_charges;
                DROP TRIGGER IF EXISTS landed_cost_allocations_append_only ON landed_cost_allocations;
                DROP FUNCTION IF EXISTS prevent_landed_cost_mutation();
                ALTER TABLE goods_receipt_lines DROP CONSTRAINT IF EXISTS goods_receipt_lines_landed_check;
                ALTER TABLE goods_receipts DROP CONSTRAINT IF EXISTS goods_receipts_landed_check;
            SQL);
        }

        Schema::dropIfExists('landed_cost_allocations');
        Schema::dropIfExists('landed_cost_voucher_receipts');
        Schema::dropIfExists('landed_cost_voucher_charges');
        Schema::dropIfExists('landed_cost_vouchers');
        Schema::dropIfExists('goods_receipt_charges');
        Schema::table('goods_receipt_lines', function (Blueprint $table) {
            $table->dropColumn(['landed_cost', 'landed_unit_cost']);
        });
        Schema::table('goods_receipts', function (Blueprint $table) {
            $table->dropColumn(['charges_total', 'charges_tax_total', 'landed_total', 'payable_total']);
        });
    }
};
