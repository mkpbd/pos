<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Money spent on running the business (rent, salaries, utilities…) and income that is not a
 * sale (rent received, commissions…). Entries are immutable; a mistake is voided, which
 * reverses its payment.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('expense_categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->enum('type', ['expense', 'income']);
            $table->string('name', 100);
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        Schema::create('expenses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->enum('type', ['expense', 'income']);
            $table->string('number', 40);
            $table->foreignUuid('expense_category_id')->constrained()->restrictOnDelete();
            $table->char('currency', 3);
            $table->decimal('amount', 18, 2);
            $table->string('method', 20);
            $table->string('reference', 100)->nullable();
            // Who was paid (expense) or who paid (income).
            $table->string('party', 150)->nullable();
            $table->date('occurred_on');
            $table->text('notes')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('voided_at')->nullable();
            $table->foreignUuid('voided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('void_reason', 255)->nullable();
            $table->timestampsTz();

            $table->unique(['organization_id', 'number']);
            $table->index(['organization_id', 'type', 'occurred_on']);
            $table->index(['organization_id', 'branch_id', 'occurred_on']);
            $table->index('expense_category_id');
        });

        DB::statement('CREATE UNIQUE INDEX expense_categories_name_unique ON expense_categories (organization_id, type, lower(name))');

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE expenses ADD CONSTRAINT expenses_amount_positive CHECK (amount > 0)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('expenses');
        Schema::dropIfExists('expense_categories');
    }
};
