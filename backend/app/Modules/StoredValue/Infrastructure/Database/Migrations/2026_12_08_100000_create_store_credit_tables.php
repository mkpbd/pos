<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * POS1b: customers' store credit — an append-only ledger of signed amounts per customer
 * (advances taken at the till, pay-outs, sales paid with it and their reversals, refunds of
 * returns, manual adjustments). The balance is the sum (= the last balance_after), never
 * negative; every change is written under a per-customer lock.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('store_credit_entries', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('customer_id')->constrained()->restrictOnDelete();
            // top_up, withdrawal, sale_payment, sale_reversal, refund, adjustment
            $table->string('type', 20);
            // Signed: + raises the balance, − lowers it.
            $table->decimal('amount', 18, 2);
            $table->decimal('balance_after', 18, 2);
            $table->char('currency', 3);
            // Top-ups and withdrawals: how the money moved (cash, card, mobile_banking).
            $table->string('method', 20)->nullable();
            $table->string('reference', 100)->nullable();
            // sale | sale_return
            $table->string('reference_type', 20)->nullable();
            $table->uuid('reference_id')->nullable();
            $table->string('reference_number', 40)->nullable();
            // ADV-000001 (top-ups) / ADW-000001 (withdrawals).
            $table->string('receipt_number', 40)->nullable();
            $table->string('note', 200)->nullable();
            $table->foreignUuid('store_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index(['organization_id', 'customer_id', 'created_at']);
            $table->index(['reference_type', 'reference_id']);
        });

        DB::statement('CREATE UNIQUE INDEX store_credit_entries_receipt_unique ON store_credit_entries (organization_id, receipt_number) WHERE receipt_number IS NOT NULL');

        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION prevent_store_credit_mutation() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER store_credit_entries_append_only BEFORE UPDATE OR DELETE ON store_credit_entries
                    FOR EACH ROW EXECUTE FUNCTION prevent_store_credit_mutation();

                ALTER TABLE store_credit_entries
                    ADD CONSTRAINT store_credit_entries_type_check
                        CHECK (type IN ('top_up', 'withdrawal', 'sale_payment', 'sale_reversal', 'refund', 'adjustment')),
                    ADD CONSTRAINT store_credit_entries_amount_nonzero CHECK (amount <> 0),
                    ADD CONSTRAINT store_credit_entries_balance_nonnegative CHECK (balance_after >= 0),
                    ADD CONSTRAINT store_credit_entries_method_check
                        CHECK (method IS NULL OR method IN ('cash', 'card', 'mobile_banking')),
                    ADD CONSTRAINT store_credit_entries_reference_type_check
                        CHECK (reference_type IS NULL OR reference_type IN ('sale', 'sale_return'));
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                DROP TRIGGER IF EXISTS store_credit_entries_append_only ON store_credit_entries;
                DROP FUNCTION IF EXISTS prevent_store_credit_mutation();
            SQL);
        }

        Schema::dropIfExists('store_credit_entries');
    }
};
