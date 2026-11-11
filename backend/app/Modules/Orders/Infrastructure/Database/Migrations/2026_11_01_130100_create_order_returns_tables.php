<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Online returns and refunds (E10b).
 *
 * `order_returns`: a return of goods of a delivered, paid web order — requested by the
 * customer (or staff), approved or rejected, received (restocked or written off per line)
 * and refunded (method and reference; the ledger entry is `online_order_refund`). The refund
 * is the sum of the lines plus an optional `shipping_refund` granted at approval.
 * `order_return_lines`: per order line the requested quantity (fixed) and the approved
 * quantity with its amount — the proportional share of what the line charged (discount and
 * tax included; the return that takes the last unit takes the exact remainder) — and, at
 * receipt, whether it goes back to stock. No deletes; identity columns never change.
 * `order_return_line_stock`: which `order_line_stock` allocations (batch, cost) restocked
 * goods went back to — append-only, so later returns never restock an allocation twice.
 * `order_return_history`: the return's append-only status history.
 * `orders.refunded_total`: the sum of booked refunds (payment status partially_refunded /
 * refunded).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('refunded_total', 18, 2)->default(0)->after('paid_total');
        });

        Schema::create('order_returns', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('order_id')->constrained()->restrictOnDelete();
            $table->string('number', 40);
            $table->string('status', 20);
            $table->string('reason_code', 20);
            $table->string('customer_note', 500)->nullable();
            $table->string('staff_note', 500)->nullable();
            $table->string('rejection_reason', 200)->nullable();
            $table->string('requested_by', 10); // customer | staff
            // Staff created it after the return window (audited, with a note).
            $table->boolean('override_window')->default(false);
            $table->char('currency', 3);
            $table->decimal('items_amount', 18, 2);
            $table->decimal('shipping_refund', 18, 2)->default(0);
            $table->decimal('refund_amount', 18, 2);
            $table->string('refund_method', 20)->nullable();
            $table->string('refund_reference', 80)->nullable();
            $table->foreignUuid('requested_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('approved_at')->nullable();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('rejected_at')->nullable();
            $table->foreignUuid('rejected_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('received_at')->nullable();
            $table->foreignUuid('received_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('refunded_at')->nullable();
            $table->foreignUuid('refunded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('cancelled_at')->nullable();
            $table->timestampsTz();

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'status', 'created_at']);
            $table->index('order_id');
        });

        Schema::create('order_return_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('return_id')->constrained('order_returns')->restrictOnDelete();
            $table->foreignUuid('order_line_id')->constrained()->restrictOnDelete();
            $table->decimal('requested_quantity', 18, 3);
            // Approved quantity (staff may lower it at approval; 0 = not returned after all).
            $table->decimal('quantity', 18, 3);
            $table->decimal('amount', 18, 2);
            $table->decimal('tax_amount', 18, 2);
            $table->decimal('cost_total', 18, 2);
            // Decided at receipt: true = back to stock, false = written off. NULL before.
            $table->boolean('restock')->nullable();
            $table->decimal('restocked_quantity', 18, 3)->default(0);
            $table->timestampTz('created_at');

            $table->unique(['return_id', 'order_line_id']);
            $table->index('order_line_id');
        });

        Schema::create('order_return_line_stock', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('return_line_id')->constrained('order_return_lines')->restrictOnDelete();
            $table->foreignUuid('order_line_stock_id')->constrained('order_line_stock')->restrictOnDelete();
            $table->foreignUuid('batch_id')->nullable()->constrained()->restrictOnDelete();
            $table->decimal('quantity', 18, 3);
            $table->decimal('unit_cost', 18, 4);
            $table->uuid('movement_id')->nullable();

            $table->index('return_line_id');
            $table->index('order_line_stock_id');
        });

        Schema::create('order_return_history', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('return_id')->constrained('order_returns')->restrictOnDelete();
            $table->string('from_status', 20)->nullable();
            $table->string('to_status', 20);
            $table->string('note', 255)->nullable();
            $table->foreignUuid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('actor_type', 10); // customer | staff
            $table->timestampTz('created_at');

            $table->index(['return_id', 'created_at']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE orders ADD CONSTRAINT orders_refunded_total_check CHECK (refunded_total >= 0 AND refunded_total <= paid_total)');
            DB::statement(<<<'SQL'
                ALTER TABLE order_returns ADD CONSTRAINT order_returns_rules_check CHECK (
                    status IN ('requested', 'approved', 'received', 'refunded', 'rejected', 'cancelled')
                    AND reason_code IN ('damaged', 'wrong_item', 'not_as_described', 'changed_mind', 'other')
                    AND requested_by IN ('customer', 'staff')
                    AND (refund_method IS NULL OR refund_method IN ('cash', 'bank_transfer', 'mobile_banking'))
                    AND items_amount >= 0 AND shipping_refund >= 0
                    AND refund_amount = items_amount + shipping_refund
                    AND (status <> 'refunded' OR (refund_method IS NOT NULL AND refunded_at IS NOT NULL))
                    AND (status <> 'rejected' OR (rejection_reason IS NOT NULL AND rejected_at IS NOT NULL))
                    AND (status <> 'cancelled' OR cancelled_at IS NOT NULL)
                    AND (status NOT IN ('approved', 'received', 'refunded') OR approved_at IS NOT NULL)
                    AND (status NOT IN ('received', 'refunded') OR received_at IS NOT NULL)
                )
            SQL);
            DB::statement(<<<'SQL'
                ALTER TABLE order_return_lines ADD CONSTRAINT order_return_lines_rules_check CHECK (
                    requested_quantity > 0 AND quantity >= 0 AND quantity <= requested_quantity
                    AND amount >= 0 AND tax_amount >= 0 AND cost_total >= 0
                    AND restocked_quantity >= 0 AND restocked_quantity <= quantity
                )
            SQL);
            DB::statement('ALTER TABLE order_return_line_stock ADD CONSTRAINT order_return_line_stock_quantity_check CHECK (quantity > 0)');
            DB::statement("ALTER TABLE order_return_history ADD CONSTRAINT order_return_history_actor_type_check CHECK (actor_type IN ('customer', 'staff'))");
            // prevent_order_detail_mutation() comes from the E8a orders migration.
            DB::unprepared(<<<'SQL'
                CREATE TRIGGER order_return_line_stock_append_only BEFORE UPDATE OR DELETE ON order_return_line_stock
                    FOR EACH ROW EXECUTE FUNCTION prevent_order_detail_mutation();
                CREATE TRIGGER order_return_history_append_only BEFORE UPDATE OR DELETE ON order_return_history
                    FOR EACH ROW EXECUTE FUNCTION prevent_order_detail_mutation();

                -- Return lines: never deleted; the line they return and the requested quantity never change.
                CREATE OR REPLACE FUNCTION guard_order_return_line() RETURNS trigger AS $$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'order_return_lines rows cannot be deleted';
                    END IF;
                    IF NEW.return_id <> OLD.return_id OR NEW.order_line_id <> OLD.order_line_id
                        OR NEW.organization_id <> OLD.organization_id OR NEW.requested_quantity <> OLD.requested_quantity THEN
                        RAISE EXCEPTION 'order_return_lines identity columns cannot change';
                    END IF;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER order_return_lines_guard BEFORE UPDATE OR DELETE ON order_return_lines
                    FOR EACH ROW EXECUTE FUNCTION guard_order_return_line();
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                DROP TRIGGER IF EXISTS order_return_lines_guard ON order_return_lines;
                DROP FUNCTION IF EXISTS guard_order_return_line();
                DROP TRIGGER IF EXISTS order_return_history_append_only ON order_return_history;
                DROP TRIGGER IF EXISTS order_return_line_stock_append_only ON order_return_line_stock;
            SQL);
            DB::statement('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_refunded_total_check');
        }

        Schema::dropIfExists('order_return_history');
        Schema::dropIfExists('order_return_line_stock');
        Schema::dropIfExists('order_return_lines');
        Schema::dropIfExists('order_returns');
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('refunded_total');
        });
    }
};
