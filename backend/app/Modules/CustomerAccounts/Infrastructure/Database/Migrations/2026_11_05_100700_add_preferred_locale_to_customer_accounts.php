<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // E12b: the storefront language of the shopper's last sign-up / sign-in (`lang`);
        // null until then. Read by the e-mails of E13.
        Schema::table('customer_accounts', function (Blueprint $table) {
            $table->string('preferred_locale', 2)->nullable();
        });
        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_preferred_locale_check CHECK (preferred_locale IS NULL OR preferred_locale IN ('en', 'bn'))");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE customer_accounts DROP CONSTRAINT IF EXISTS customer_accounts_preferred_locale_check');
        }
        Schema::table('customer_accounts', function (Blueprint $table) {
            $table->dropColumn('preferred_locale');
        });
    }
};
