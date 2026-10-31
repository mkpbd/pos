<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Web orders (ADR-003): their own document, not POS sales. Stock leaves the fulfilment store
 * at placement (order_line_stock keeps the exact batch allocations for restocking); lines,
 * allocations, addresses and status history are append-only snapshots.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('number', 40);
            // NULL for guest orders (contact snapshot below); set for signed-in customers.
            $table->foreignUuid('customer_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('customer_account_id')->nullable()->constrained()->nullOnDelete();
            // The fulfilment store the stock left from.
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->string('status', 20);
            $table->string('payment_status', 20);
            $table->string('payment_method', 30);
            $table->foreignUuid('shipping_method_id')->nullable()->constrained()->nullOnDelete();
            $table->string('shipping_method_name', 60);
            $table->unsignedSmallInteger('eta_min_days')->nullable();
            $table->unsignedSmallInteger('eta_max_days')->nullable();
            $table->char('currency', 3);
            $table->string('tax_mode', 10);
            $table->decimal('subtotal', 18, 2);
            $table->decimal('tax_total', 18, 2);
            $table->decimal('shipping_total', 18, 2);
            $table->decimal('cod_fee', 18, 2);
            $table->decimal('total', 18, 2);
            $table->decimal('paid_total', 18, 2)->default(0);
            $table->decimal('cost_total', 18, 2);
            $table->string('contact_name', 120);
            $table->string('contact_email', 255);
            $table->string('contact_phone', 20);
            $table->string('notes', 500)->nullable();
            // sha256 of the guest's access token (the token itself is only ever shown once).
            $table->char('access_token_hash', 64)->nullable();
            $table->string('courier_name', 100)->nullable();
            $table->string('tracking_number', 100)->nullable();
            $table->timestampTz('placed_at');
            $table->timestampTz('expires_at')->nullable();
            $table->timestampTz('confirmed_at')->nullable();
            $table->timestampTz('shipped_at')->nullable();
            $table->timestampTz('delivered_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('cancel_reason', 200)->nullable();
            $table->string('ip', 45)->nullable();
            $table->string('user_agent', 255)->nullable();
            $table->timestampsTz();

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'status', 'placed_at']);
            $table->index(['organization_id', 'customer_id', 'placed_at']);
            $table->index(['status', 'expires_at']);
        });

        Schema::create('order_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('order_id')->constrained()->restrictOnDelete();
            $table->unsignedSmallInteger('position');
            $table->foreignUuid('product_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            // Snapshots: the order reads the same forever, whatever happens to the product.
            $table->string('product_name', 255);
            $table->string('variant_name', 255)->nullable();
            $table->string('product_slug', 160)->nullable();
            $table->string('sku', 64);
            $table->json('option_values')->nullable();
            $table->string('image_url', 500)->nullable();
            $table->decimal('quantity', 18, 3);
            $table->decimal('unit_price', 18, 2);
            $table->decimal('compare_at_price', 18, 2)->nullable();
            $table->decimal('line_subtotal', 18, 2);
            $table->decimal('net_amount', 18, 2);
            $table->decimal('tax_rate', 9, 4);
            $table->decimal('tax_amount', 18, 2);
            $table->decimal('line_total', 18, 2);
            $table->decimal('unit_cost', 18, 4);
            $table->decimal('cost_total', 18, 2);
            $table->timestampTz('created_at');

            $table->index(['order_id', 'position']);
            $table->index(['organization_id', 'variant_id']);
        });

        // Which batches (or untracked-batch stock, batch NULL) each line was taken from, at what cost.
        Schema::create('order_line_stock', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('order_line_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('batch_id')->nullable()->constrained()->restrictOnDelete();
            $table->decimal('quantity', 18, 3);
            $table->decimal('unit_cost', 18, 4);
            $table->uuid('movement_id')->nullable();

            $table->index('order_line_id');
        });

        Schema::create('order_addresses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('order_id')->constrained()->restrictOnDelete();
            $table->string('kind', 10); // shipping | billing (E8a: shipping only; billing = shipping)
            $table->string('recipient_name', 120);
            $table->string('phone', 20);
            $table->string('email', 255)->nullable();
            $table->unsignedSmallInteger('division_id');
            $table->string('division_name', 60);
            $table->unsignedSmallInteger('district_id');
            $table->string('district_name', 60);
            $table->string('area', 100)->nullable();
            $table->string('address_line', 255);
            $table->string('postcode', 10)->nullable();
            $table->timestampTz('created_at');

            $table->unique(['order_id', 'kind']);
        });

        Schema::create('order_status_history', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('order_id')->constrained()->restrictOnDelete();
            $table->string('from_status', 20)->nullable();
            $table->string('to_status', 20);
            $table->string('note', 255)->nullable();
            // NULL = the shopper (placement) or the system (expiry).
            $table->foreignUuid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index(['order_id', 'created_at']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE orders ADD CONSTRAINT orders_amounts_check CHECK (subtotal >= 0 AND tax_total >= 0 AND shipping_total >= 0 AND cod_fee >= 0 AND total >= 0 AND paid_total >= 0)');
            DB::statement('ALTER TABLE order_lines ADD CONSTRAINT order_lines_quantity_check CHECK (quantity > 0)');
            DB::unprepared(<<<'SQL'
                CREATE FUNCTION prevent_order_detail_mutation() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER order_lines_append_only BEFORE UPDATE OR DELETE ON order_lines
                    FOR EACH ROW EXECUTE FUNCTION prevent_order_detail_mutation();
                CREATE TRIGGER order_line_stock_append_only BEFORE UPDATE OR DELETE ON order_line_stock
                    FOR EACH ROW EXECUTE FUNCTION prevent_order_detail_mutation();
                CREATE TRIGGER order_status_history_append_only BEFORE UPDATE OR DELETE ON order_status_history
                    FOR EACH ROW EXECUTE FUNCTION prevent_order_detail_mutation();
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                DROP TRIGGER IF EXISTS order_status_history_append_only ON order_status_history;
                DROP TRIGGER IF EXISTS order_line_stock_append_only ON order_line_stock;
                DROP TRIGGER IF EXISTS order_lines_append_only ON order_lines;
                DROP FUNCTION IF EXISTS prevent_order_detail_mutation();
            SQL);
        }

        Schema::dropIfExists('order_status_history');
        Schema::dropIfExists('order_addresses');
        Schema::dropIfExists('order_line_stock');
        Schema::dropIfExists('order_lines');
        Schema::dropIfExists('orders');
    }
};
