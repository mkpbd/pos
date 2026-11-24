<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ST1: supplier money goes through the payments ledger. Supplier payments can be voided
 * (the row stays, marked void; the ledger gets the opposite entry) and suppliers can give
 * money back (`supplier_refunds`, `SREF-` numbers, always booked to a branch). Additive only.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE supplier_payments
 *     ADD COLUMN voided_at timestamptz NULL,
 *     ADD COLUMN voided_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
 *     ADD COLUMN void_reason varchar(255) NULL;
 *   CREATE TABLE supplier_refunds (… see below …);
 *   ALTER TABLE supplier_refunds ADD CONSTRAINT supplier_refunds_method_check
 *     CHECK (method IN ('cash', 'card', 'mobile_banking', 'bank_transfer', 'cheque'));
 *   ALTER TABLE supplier_refunds ADD CONSTRAINT supplier_refunds_amount_check CHECK (amount > 0);
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('supplier_payments', function (Blueprint $table) {
            $table->timestampTz('voided_at')->nullable();
            $table->foreignUuid('voided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('void_reason', 255)->nullable();
        });

        Schema::create('supplier_refunds', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('number', 30);
            $table->foreignUuid('supplier_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->char('currency', 3);
            $table->decimal('amount', 18, 2);
            $table->string('method', 20);
            $table->string('reference', 100)->nullable();
            $table->date('received_on');
            $table->text('notes')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('voided_at')->nullable();
            $table->foreignUuid('voided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('void_reason', 255)->nullable();
            $table->timestampsTz();

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'supplier_id', 'received_on']);
            $table->index(['organization_id', 'branch_id', 'received_on']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE supplier_refunds ADD CONSTRAINT supplier_refunds_method_check CHECK (method IN ('cash', 'card', 'mobile_banking', 'bank_transfer', 'cheque'))");
            DB::statement('ALTER TABLE supplier_refunds ADD CONSTRAINT supplier_refunds_amount_check CHECK (amount > 0)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('supplier_refunds');
        Schema::table('supplier_payments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('voided_by');
            $table->dropColumn(['voided_at', 'void_reason']);
        });
    }
};
