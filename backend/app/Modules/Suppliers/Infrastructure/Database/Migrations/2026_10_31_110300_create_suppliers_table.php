<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('suppliers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('code', 30);
            $table->string('name');
            $table->string('contact_person')->nullable();
            $table->string('email')->nullable();
            $table->string('phone', 32)->nullable();
            $table->text('address')->nullable();
            $table->string('tax_number', 64)->nullable();
            $table->unsignedSmallInteger('payment_terms_days')->default(0);
            // Amount owed to the supplier when migrating to the system; positive = we owe them.
            $table->decimal('opening_balance', 18, 2)->default(0);
            $table->text('notes')->nullable();
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['organization_id', 'is_active']);
            $table->index(['organization_id', 'name']);
        });

        DB::statement('CREATE UNIQUE INDEX suppliers_org_code_unique ON suppliers (organization_id, lower(code)) WHERE deleted_at IS NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('suppliers');
    }
};
