<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * SC2: purchase requisitions with amount-based approval, purchase order approval
 * (`pending_approval`), requests for quotation with supplier quotes and awards, append-only
 * status histories, and the log of daily "replies overdue" reminders.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_approval_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->unique()->constrained()->restrictOnDelete();
            // At or below: no approval needed.
            $table->decimal('auto_approve_limit', 18, 2)->default(10000);
            // Above auto and at or below: purchases.approve; above: purchases.approve_high.
            $table->decimal('manager_limit', 18, 2)->default(100000);
            $table->boolean('require_po_approval')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        Schema::create('purchase_requisitions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('number', 30);
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->string('status', 20)->default('draft');
            $table->foreignUuid('requested_by')->constrained('users')->restrictOnDelete();
            $table->date('needed_by')->nullable();
            $table->string('notes', 1000)->nullable();
            $table->char('currency', 3);
            // Estimates incl. tax, recomputed on every save.
            $table->decimal('estimated_subtotal', 18, 2);
            $table->decimal('estimated_tax', 18, 2);
            $table->decimal('estimated_total', 18, 2);
            // Decided on submit from the estimated total and the approval limits.
            $table->string('approval_level', 10)->nullable();
            $table->timestampTz('submitted_at')->nullable();
            // NULL with approved_at set = approved by the system (at or below the auto limit).
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('approved_at')->nullable();
            $table->foreignUuid('rejected_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('rejected_at')->nullable();
            $table->string('rejection_reason', 500)->nullable();
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('cancelled_at')->nullable();
            $table->string('cancellation_reason', 500)->nullable();
            $table->timestampTz('converted_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'branch_id', 'status']);
            $table->index(['organization_id', 'requested_by']);
        });

        Schema::create('purchase_requisition_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('purchase_requisition_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            $table->decimal('quantity', 18, 3);
            // Tax-exclusive, like purchase order unit costs.
            $table->decimal('estimated_unit_cost', 18, 4);
            $table->decimal('tax_rate', 9, 4)->default(0);
            $table->decimal('line_total', 18, 2);
            $table->foreignUuid('suggested_supplier_id')->nullable()->constrained('suppliers')->restrictOnDelete();
            $table->string('notes', 255)->nullable();
            // Turned into purchase orders or handed to an RFQ.
            $table->decimal('converted_quantity', 18, 3)->default(0);
            $table->unsignedSmallInteger('sort_order')->default(0);

            $table->index(['purchase_requisition_id', 'sort_order']);
        });

        Schema::create('purchase_requisition_status_history', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('purchase_requisition_id')->constrained()->restrictOnDelete();
            $table->string('from_status', 20)->nullable();
            $table->string('to_status', 20);
            $table->string('note', 500)->nullable();
            // NULL = the system (automatic approval, released RFQ quantities).
            $table->foreignUuid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index(['purchase_requisition_id', 'created_at']);
        });

        Schema::create('rfqs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('number', 30);
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->string('status', 20)->default('draft');
            $table->foreignUuid('requisition_id')->nullable()->constrained('purchase_requisitions')->restrictOnDelete();
            $table->string('title', 150);
            $table->date('needed_by')->nullable();
            $table->date('reply_by')->nullable();
            $table->string('notes', 2000)->nullable();
            $table->timestampTz('sent_at')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->timestampTz('awarded_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'branch_id', 'status']);
            $table->index(['organization_id', 'status', 'reply_by']);
        });

        Schema::create('rfq_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('rfq_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            $table->decimal('quantity', 18, 3);
            $table->foreignUuid('requisition_line_id')->nullable()->constrained('purchase_requisition_lines')->restrictOnDelete();
            $table->string('notes', 255)->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);

            $table->unique(['rfq_id', 'variant_id']);
        });

        Schema::create('rfq_suppliers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('rfq_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('supplier_id')->constrained()->restrictOnDelete();
            $table->timestampTz('invited_at');
            // When the request (PDF) was issued to this supplier.
            $table->timestampTz('sent_at')->nullable();
            // When the e-mail with the PDF was queued, and to which address; NULL = send manually.
            $table->timestampTz('emailed_at')->nullable();
            $table->string('email')->nullable();

            $table->unique(['rfq_id', 'supplier_id']);
            $table->index(['organization_id', 'supplier_id']);
        });

        Schema::create('supplier_quotes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('rfq_supplier_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('status', 20);
            $table->timestampTz('received_at');
            $table->date('valid_until')->nullable();
            $table->string('notes', 1000)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        Schema::create('supplier_quote_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('supplier_quote_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('rfq_line_id')->constrained()->cascadeOnDelete();
            // Per base unit, tax-exclusive.
            $table->decimal('unit_price', 18, 4);
            $table->decimal('quantity_offered', 18, 3)->nullable();
            $table->unsignedSmallInteger('lead_time_days')->nullable();
            $table->string('notes', 255)->nullable();

            $table->unique(['supplier_quote_id', 'rfq_line_id']);
        });

        Schema::create('rfq_awards', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('rfq_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('rfq_line_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('supplier_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('purchase_order_id')->constrained()->restrictOnDelete();
            $table->decimal('quantity', 18, 3);
            $table->decimal('unit_price', 18, 4);
            $table->timestampTz('created_at');

            $table->unique(['rfq_line_id', 'supplier_id']);
            $table->index('rfq_id');
        });

        Schema::create('rfq_status_history', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('rfq_id')->constrained()->restrictOnDelete();
            $table->string('from_status', 20)->nullable();
            $table->string('to_status', 20);
            $table->string('note', 500)->nullable();
            $table->foreignUuid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index(['rfq_id', 'created_at']);
        });

        Schema::create('rfq_reminder_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('rfq_id')->constrained()->restrictOnDelete();
            // The organization-local day the reminder is for.
            $table->date('run_on');
            $table->unsignedSmallInteger('missing');
            $table->timestampTz('created_at');

            $table->unique(['rfq_id', 'run_on']);
        });

        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->foreignUuid('requisition_id')->nullable()->after('store_id')->constrained('purchase_requisitions')->restrictOnDelete();
            $table->foreignUuid('rfq_id')->nullable()->after('requisition_id')->constrained('rfqs')->restrictOnDelete();
            // Pre-approval: the share of an approved requisition this order covers (5 % tolerance).
            $table->decimal('approved_amount', 18, 2)->nullable()->after('total');
            $table->string('approval_level', 10)->nullable()->after('approved_amount');
            $table->foreignUuid('submitted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('submitted_at')->nullable();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('approved_at')->nullable();
            $table->foreignUuid('rejected_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('rejected_at')->nullable();
            $table->string('rejection_reason', 500)->nullable();

            $table->index(['organization_id', 'requisition_id']);
            $table->index(['organization_id', 'rfq_id']);
        });

        Schema::create('purchase_order_status_history', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('purchase_order_id')->constrained()->restrictOnDelete();
            $table->string('from_status', 20)->nullable();
            $table->string('to_status', 20);
            $table->string('note', 500)->nullable();
            $table->foreignUuid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index(['purchase_order_id', 'created_at']);
        });

        if (DB::getDriverName() !== 'pgsql') {
            // SQLite keeps the enum's CHECK in the column definition; widen it to a string.
            Schema::table('purchase_orders', function (Blueprint $table) {
                $table->string('status', 20)->default('draft')->change();
            });

            return;
        }

        DB::unprepared(<<<'SQL'
            ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
            ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
                CHECK (status IN ('draft', 'pending_approval', 'ordered', 'partially_received', 'received', 'cancelled'));
            ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_approval_level_check
                CHECK (approval_level IS NULL OR approval_level IN ('none', 'manager', 'high'));
            ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_approved_amount_check
                CHECK (approved_amount IS NULL OR approved_amount >= 0);
            ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_self_approval_check
                CHECK (approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by);

            ALTER TABLE purchase_approval_settings ADD CONSTRAINT purchase_approval_settings_limits_check
                CHECK (auto_approve_limit >= 0 AND manager_limit >= 0 AND auto_approve_limit <= manager_limit);

            ALTER TABLE purchase_requisitions ADD CONSTRAINT purchase_requisitions_status_check
                CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled', 'converted'));
            ALTER TABLE purchase_requisitions ADD CONSTRAINT purchase_requisitions_approval_level_check
                CHECK (approval_level IS NULL OR approval_level IN ('none', 'manager', 'high'));
            ALTER TABLE purchase_requisitions ADD CONSTRAINT purchase_requisitions_amounts_check
                CHECK (estimated_subtotal >= 0 AND estimated_tax >= 0 AND estimated_total >= 0);
            ALTER TABLE purchase_requisitions ADD CONSTRAINT purchase_requisitions_approved_check
                CHECK (status NOT IN ('approved', 'converted') OR (approved_at IS NOT NULL AND approval_level IS NOT NULL));
            ALTER TABLE purchase_requisitions ADD CONSTRAINT purchase_requisitions_rejected_check
                CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL);
            ALTER TABLE purchase_requisitions ADD CONSTRAINT purchase_requisitions_self_approval_check
                CHECK (approved_by IS NULL OR approved_by <> requested_by);
            ALTER TABLE purchase_requisition_lines ADD CONSTRAINT purchase_requisition_lines_quantity_check
                CHECK (quantity > 0 AND estimated_unit_cost >= 0 AND line_total >= 0);
            ALTER TABLE purchase_requisition_lines ADD CONSTRAINT purchase_requisition_lines_converted_check
                CHECK (converted_quantity >= 0 AND converted_quantity <= quantity);

            ALTER TABLE rfqs ADD CONSTRAINT rfqs_status_check
                CHECK (status IN ('draft', 'sent', 'closed', 'awarded', 'cancelled'));
            ALTER TABLE rfq_lines ADD CONSTRAINT rfq_lines_quantity_check CHECK (quantity > 0);
            ALTER TABLE supplier_quotes ADD CONSTRAINT supplier_quotes_status_check CHECK (status IN ('received', 'declined'));
            ALTER TABLE supplier_quote_lines ADD CONSTRAINT supplier_quote_lines_values_check
                CHECK (unit_price >= 0 AND (quantity_offered IS NULL OR quantity_offered > 0)
                    AND (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 365));
            ALTER TABLE rfq_awards ADD CONSTRAINT rfq_awards_values_check CHECK (quantity > 0 AND unit_price >= 0);

            CREATE OR REPLACE FUNCTION prevent_procurement_history_mutation() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
            END;
            $$ LANGUAGE plpgsql;

            CREATE TRIGGER purchase_requisition_status_history_append_only BEFORE UPDATE OR DELETE ON purchase_requisition_status_history
                FOR EACH ROW EXECUTE FUNCTION prevent_procurement_history_mutation();
            CREATE TRIGGER purchase_order_status_history_append_only BEFORE UPDATE OR DELETE ON purchase_order_status_history
                FOR EACH ROW EXECUTE FUNCTION prevent_procurement_history_mutation();
            CREATE TRIGGER rfq_status_history_append_only BEFORE UPDATE OR DELETE ON rfq_status_history
                FOR EACH ROW EXECUTE FUNCTION prevent_procurement_history_mutation();
            CREATE TRIGGER rfq_awards_append_only BEFORE UPDATE OR DELETE ON rfq_awards
                FOR EACH ROW EXECUTE FUNCTION prevent_procurement_history_mutation();
        SQL);
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                DROP TRIGGER IF EXISTS rfq_awards_append_only ON rfq_awards;
                DROP TRIGGER IF EXISTS rfq_status_history_append_only ON rfq_status_history;
                DROP TRIGGER IF EXISTS purchase_order_status_history_append_only ON purchase_order_status_history;
                DROP TRIGGER IF EXISTS purchase_requisition_status_history_append_only ON purchase_requisition_status_history;
                DROP FUNCTION IF EXISTS prevent_procurement_history_mutation();
                ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_self_approval_check;
                ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_approved_amount_check;
                ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_approval_level_check;
                UPDATE purchase_orders SET status = 'draft' WHERE status = 'pending_approval';
                ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
                ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
                    CHECK (status IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled'));
            SQL);
        }

        Schema::dropIfExists('purchase_order_status_history');
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropIndex(['organization_id', 'requisition_id']);
            $table->dropIndex(['organization_id', 'rfq_id']);
            $table->dropConstrainedForeignId('requisition_id');
            $table->dropConstrainedForeignId('rfq_id');
            $table->dropConstrainedForeignId('submitted_by');
            $table->dropConstrainedForeignId('approved_by');
            $table->dropConstrainedForeignId('rejected_by');
            $table->dropColumn(['approved_amount', 'approval_level', 'submitted_at', 'approved_at', 'rejected_at', 'rejection_reason']);
        });
        Schema::dropIfExists('rfq_reminder_runs');
        Schema::dropIfExists('rfq_status_history');
        Schema::dropIfExists('rfq_awards');
        Schema::dropIfExists('supplier_quote_lines');
        Schema::dropIfExists('supplier_quotes');
        Schema::dropIfExists('rfq_suppliers');
        Schema::dropIfExists('rfq_lines');
        Schema::dropIfExists('rfqs');
        Schema::dropIfExists('purchase_requisition_status_history');
        Schema::dropIfExists('purchase_requisition_lines');
        Schema::dropIfExists('purchase_requisitions');
        Schema::dropIfExists('purchase_approval_settings');
    }
};
