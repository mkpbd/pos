<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Online store sign-in of a customer (ADR-002): separate from staff users, one per customer.
        Schema::create('customer_accounts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('customer_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('email', 254);
            // Bangladeshi mobile, normalized to 01XXXXXXXXX.
            $table->string('phone', 11)->nullable();
            $table->string('password');
            $table->string('status', 16)->default('active');
            $table->timestampTz('email_verified_at')->nullable();
            $table->string('email_verification_token_hash', 64)->nullable()->unique();
            $table->timestampTz('email_verification_sent_at')->nullable();
            $table->timestampTz('last_login_at')->nullable();
            $table->rememberToken();
            $table->timestampsTz();
        });

        // One live reset token per e-mail and organization (sha256 of the e-mailed token).
        Schema::create('customer_password_reset_tokens', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->string('email', 254);
            $table->string('token_hash', 64);
            $table->timestampTz('created_at');

            $table->primary(['organization_id', 'email']);
        });

        DB::statement('CREATE UNIQUE INDEX customer_accounts_org_email_unique ON customer_accounts (organization_id, lower(email))');

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_status_check CHECK (status IN ('active', 'disabled'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_password_reset_tokens');
        Schema::dropIfExists('customer_accounts');
    }
};
