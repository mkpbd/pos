<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * BD1a: sign-in with a mobile number and an SMS code. Accounts created that way may have no
 * e-mail address and no password; a phone proven with a code is stamped `phone_verified_at` and
 * one verified phone belongs to one account per organization (unverified accounts may still
 * have typed the same number). The e-mail unique index stays (NULLs never clash).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE customer_accounts ALTER COLUMN email DROP NOT NULL');
        DB::statement('ALTER TABLE customer_accounts ALTER COLUMN password DROP NOT NULL');
        DB::statement('ALTER TABLE customer_accounts ADD COLUMN phone_verified_at timestamp(0) with time zone NULL');
        DB::statement('CREATE UNIQUE INDEX customer_accounts_org_verified_phone_unique ON customer_accounts (organization_id, phone) WHERE phone_verified_at IS NOT NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS customer_accounts_org_verified_phone_unique');
        Schema::table('customer_accounts', fn ($table) => $table->dropColumn('phone_verified_at'));
        // email / password stay nullable: phone-only accounts may exist and are never deleted here.
    }
};
