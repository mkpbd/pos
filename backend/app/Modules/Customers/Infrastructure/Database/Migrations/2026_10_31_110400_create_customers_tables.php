<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_groups', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('name', 100);
            $table->string('description')->nullable();
            // Default invoice discount offered to members (validated again at checkout).
            $table->decimal('discount_percent', 5, 2)->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        Schema::create('customers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('customer_group_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('code', 30);
            $table->string('name');
            $table->string('phone', 32)->nullable();
            $table->string('email')->nullable();
            $table->text('address')->nullable();
            $table->string('tax_number', 64)->nullable();
            // 0 = no credit sales allowed.
            $table->decimal('credit_limit', 18, 2)->default(0);
            // Amount the customer owed when migrating to the system.
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

        DB::statement('CREATE UNIQUE INDEX customer_groups_org_name_unique ON customer_groups (organization_id, lower(name))');
        DB::statement('CREATE UNIQUE INDEX customers_org_code_unique ON customers (organization_id, lower(code)) WHERE deleted_at IS NULL');
        // Phone is the cashier's lookup key, so it must identify one live customer.
        DB::statement('CREATE UNIQUE INDEX customers_org_phone_unique ON customers (organization_id, phone) WHERE deleted_at IS NULL AND phone IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('customers');
        Schema::dropIfExists('customer_groups');
    }
};
