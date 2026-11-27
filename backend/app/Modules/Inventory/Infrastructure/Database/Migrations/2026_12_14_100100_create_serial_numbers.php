<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ST2d: the serial-number register (SerialRegister). One row per serial-numbered unit of a
 * variant and an append-only history of what happened to it. Additive; nothing is backfilled —
 * stock from before the register is covered by the legacy rule (unregistered units on hand).
 *
 * Manual SQL (PostgreSQL):
 *   CREATE TABLE serial_numbers (
 *     id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
 *     variant_id uuid NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
 *     serial varchar(100) NOT NULL, store_id uuid NULL REFERENCES stores (id) ON DELETE RESTRICT,
 *     status varchar(30) NOT NULL, updated_at timestamptz NULL,
 *     CONSTRAINT serial_numbers_status_check CHECK (status IN ('in_stock', 'in_transit', 'sold', 'returned_to_supplier', 'written_off')));
 *   CREATE UNIQUE INDEX serial_numbers_variant_serial_unique ON serial_numbers (organization_id, variant_id, lower(serial));
 *   CREATE INDEX serial_numbers_store_variant_status_index ON serial_numbers (store_id, variant_id, status);
 *   CREATE TABLE serial_number_events (
 *     id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
 *     serial_number_id uuid NOT NULL REFERENCES serial_numbers (id) ON DELETE RESTRICT,
 *     type varchar(30) NOT NULL, store_id uuid NULL REFERENCES stores (id) ON DELETE RESTRICT,
 *     reference_type varchar(50) NOT NULL, reference_id uuid NOT NULL, reference_number varchar(30) NULL,
 *     created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL, created_at timestamptz NOT NULL,
 *     CONSTRAINT serial_number_events_type_check CHECK (type IN ('received', 'transferred_out', 'transferred_in', 'sold', 'returned', 'returned_to_supplier', 'adjusted_in', 'written_off')));
 *   CREATE INDEX serial_number_events_serial_index ON serial_number_events (serial_number_id, created_at);
 *   CREATE INDEX serial_number_events_reference_index ON serial_number_events (reference_type, reference_id);
 *   CREATE TRIGGER serial_number_events_append_only BEFORE UPDATE OR DELETE ON serial_number_events
 *     FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('serial_numbers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->restrictOnDelete();
            $table->string('serial', 100);
            // The store holding it (in_stock), its source store (in_transit); null once it left the business.
            $table->foreignUuid('store_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('status', 30);
            $table->timestampTz('updated_at')->nullable();

            $table->index(['store_id', 'variant_id', 'status']);
        });

        Schema::create('serial_number_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('serial_number_id')->constrained()->restrictOnDelete();
            $table->string('type', 30);
            $table->foreignUuid('store_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('reference_type', 50);
            $table->uuid('reference_id');
            $table->string('reference_number', 30)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index(['serial_number_id', 'created_at']);
            $table->index(['reference_type', 'reference_id']);
        });

        DB::statement('CREATE UNIQUE INDEX serial_numbers_variant_serial_unique ON serial_numbers (organization_id, variant_id, lower(serial))');

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE serial_numbers ADD CONSTRAINT serial_numbers_status_check CHECK (status IN ('in_stock', 'in_transit', 'sold', 'returned_to_supplier', 'written_off'))");
            DB::statement("ALTER TABLE serial_number_events ADD CONSTRAINT serial_number_events_type_check CHECK (type IN ('received', 'transferred_out', 'transferred_in', 'sold', 'returned', 'returned_to_supplier', 'adjusted_in', 'written_off'))");
            // prevent_ledger_mutation() comes with the stock ledger (2026_10_31_120000).
            DB::unprepared('CREATE TRIGGER serial_number_events_append_only BEFORE UPDATE OR DELETE ON serial_number_events FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation()');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('serial_number_events');
        Schema::dropIfExists('serial_numbers');
    }
};
