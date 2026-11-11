<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Cash registers (tills), their sessions (shifts) and the organization-wide payments ledger:
 * every amount of money received or paid out (sales, refunds, collections, expenses, cash
 * in/out), linked to the register session it went through.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cash_registers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->string('code', 20);
            $table->string('name', 100);
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->index(['organization_id', 'branch_id']);
        });

        Schema::create('cash_register_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('cash_register_id')->constrained()->restrictOnDelete();
            $table->string('number', 40);
            $table->enum('status', ['open', 'closed'])->default('open');
            $table->char('currency', 3);
            $table->decimal('opening_float', 18, 2);
            $table->foreignUuid('opened_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('opened_at');
            // Filled when the session is closed: cash the ledger says should be in the drawer,
            // what was counted, and the difference (counted − expected).
            $table->decimal('expected_cash', 18, 2)->nullable();
            $table->decimal('counted_cash', 18, 2)->nullable();
            $table->decimal('variance', 18, 2)->nullable();
            $table->text('closing_notes')->nullable();
            $table->foreignUuid('closed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('closed_at')->nullable();
            $table->timestampsTz();

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'branch_id', 'opened_at']);
            $table->index(['organization_id', 'opened_by', 'opened_at']);
        });

        Schema::create('payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('cash_register_session_id')->nullable()->constrained()->restrictOnDelete();
            $table->enum('direction', ['in', 'out']);
            $table->string('method', 20);
            $table->char('currency', 3);
            // Always positive; the direction says which way the money went.
            $table->decimal('amount', 18, 2);
            // What the money was for: sale, sale_cancellation, sale_return, customer_payment,
            // expense, income, expense_void, income_void, cash_in, cash_out.
            $table->string('source_type', 30);
            $table->uuid('source_id')->nullable();
            $table->string('source_number', 40)->nullable();
            $table->foreignUuid('customer_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('reference', 100)->nullable();
            $table->string('description', 255)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index(['organization_id', 'branch_id', 'created_at']);
            $table->index(['cash_register_session_id', 'method']);
            $table->index(['organization_id', 'source_type', 'source_id']);
            $table->index(['organization_id', 'customer_id']);
        });

        DB::statement('CREATE UNIQUE INDEX cash_registers_code_unique ON cash_registers (organization_id, lower(code))');
        // A till runs one session at a time, and a cashier works one till at a time.
        DB::statement("CREATE UNIQUE INDEX cash_register_sessions_open_register ON cash_register_sessions (cash_register_id) WHERE status = 'open'");
        DB::statement("CREATE UNIQUE INDEX cash_register_sessions_open_user ON cash_register_sessions (opened_by) WHERE status = 'open'");

        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

                CREATE OR REPLACE FUNCTION prevent_payments_mutation() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payments
                    FOR EACH ROW EXECUTE FUNCTION prevent_payments_mutation();
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                DROP TRIGGER IF EXISTS payments_append_only ON payments;
                DROP FUNCTION IF EXISTS prevent_payments_mutation();
            SQL);
        }

        Schema::dropIfExists('payments');
        Schema::dropIfExists('cash_register_sessions');
        Schema::dropIfExists('cash_registers');
    }
};
