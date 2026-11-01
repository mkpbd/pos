<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Fulfilment (E10a). `shipments`: the parcel handed to a courier (one per order in E10a),
 * with the amount the courier must collect; `shipment_events`: its append-only tracking
 * history. `cod_remittances` + `cod_remittance_lines`: a courier's cash-on-delivery
 * statement — which delivered orders it paid for, gross, the courier's fee and the net
 * received; append-only, an order is remitted at most once.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shipments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('order_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('courier_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('courier_name', 80);
            $table->string('tracking_number', 60)->nullable();
            $table->string('status', 20);
            // What the courier collects at the door: the order total for unpaid COD orders, else 0.
            $table->decimal('cod_amount', 18, 2)->default(0);
            $table->timestampTz('shipped_at');
            $table->timestampTz('delivered_at')->nullable();
            $table->timestampTz('returned_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            // One shipment per order in E10a.
            $table->unique('order_id');
            $table->index(['organization_id', 'courier_id', 'status']);
        });

        Schema::create('shipment_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('shipment_id')->constrained()->restrictOnDelete();
            $table->string('status', 20);
            $table->string('note', 200)->nullable();
            $table->timestampTz('occurred_at');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index(['shipment_id', 'occurred_at']);
        });

        Schema::create('cod_remittances', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('number', 40);
            $table->foreignUuid('courier_id')->constrained()->restrictOnDelete();
            // The courier's statement number.
            $table->string('reference', 60)->nullable();
            $table->date('received_at');
            $table->string('method', 20);
            $table->char('currency', 3);
            $table->decimal('gross_amount', 18, 2);
            $table->decimal('fee_amount', 18, 2);
            $table->decimal('net_amount', 18, 2);
            // The courier fee booked in the Expenses module ("Courier fees"), when above zero.
            $table->foreignUuid('expense_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('expense_number', 40)->nullable();
            $table->string('note', 500)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'courier_id', 'received_at']);
            $table->index(['organization_id', 'received_at']);
        });

        Schema::create('cod_remittance_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('remittance_id')->constrained('cod_remittances')->restrictOnDelete();
            $table->foreignUuid('order_id')->constrained()->restrictOnDelete();
            $table->decimal('amount', 18, 2);

            // An order is remitted once.
            $table->unique(['organization_id', 'order_id']);
            $table->index('remittance_id');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE shipments ADD CONSTRAINT shipments_rules_check CHECK (status IN ('handed_over', 'in_transit', 'delivered', 'returned') AND cod_amount >= 0 AND (status <> 'delivered' OR delivered_at IS NOT NULL) AND (status <> 'returned' OR returned_at IS NOT NULL))");
            DB::statement("ALTER TABLE shipment_events ADD CONSTRAINT shipment_events_status_check CHECK (status IN ('handed_over', 'in_transit', 'delivered', 'returned'))");
            DB::statement('ALTER TABLE cod_remittances ADD CONSTRAINT cod_remittances_amounts_check CHECK (gross_amount > 0 AND fee_amount >= 0 AND fee_amount <= gross_amount AND net_amount = gross_amount - fee_amount)');
            DB::statement("ALTER TABLE cod_remittances ADD CONSTRAINT cod_remittances_method_check CHECK (method IN ('bank_transfer', 'cash', 'mobile_banking'))");
            DB::statement('ALTER TABLE cod_remittance_lines ADD CONSTRAINT cod_remittance_lines_amount_check CHECK (amount > 0)');
            // prevent_order_detail_mutation() comes from the E8a orders migration.
            DB::unprepared(<<<'SQL'
                CREATE TRIGGER shipment_events_append_only BEFORE UPDATE OR DELETE ON shipment_events
                    FOR EACH ROW EXECUTE FUNCTION prevent_order_detail_mutation();
                CREATE TRIGGER cod_remittances_append_only BEFORE UPDATE OR DELETE ON cod_remittances
                    FOR EACH ROW EXECUTE FUNCTION prevent_order_detail_mutation();
                CREATE TRIGGER cod_remittance_lines_append_only BEFORE UPDATE OR DELETE ON cod_remittance_lines
                    FOR EACH ROW EXECUTE FUNCTION prevent_order_detail_mutation();
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                DROP TRIGGER IF EXISTS cod_remittance_lines_append_only ON cod_remittance_lines;
                DROP TRIGGER IF EXISTS cod_remittances_append_only ON cod_remittances;
                DROP TRIGGER IF EXISTS shipment_events_append_only ON shipment_events;
            SQL);
        }

        Schema::dropIfExists('cod_remittance_lines');
        Schema::dropIfExists('cod_remittances');
        Schema::dropIfExists('shipment_events');
        Schema::dropIfExists('shipments');
    }
};
