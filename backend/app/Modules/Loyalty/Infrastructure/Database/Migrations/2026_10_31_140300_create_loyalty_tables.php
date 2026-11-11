<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Customer loyalty: the organization's program settings, a points balance per customer and
 * the append-only points ledger every earn, redemption and reversal is written to.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('loyalty_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->unique()->constrained()->restrictOnDelete();
            $table->boolean('is_enabled')->default(false);
            // Earning: points_per_spend points for every full spend_amount of a sale.
            $table->decimal('spend_amount', 18, 2)->default(100);
            $table->unsignedInteger('points_per_spend')->default(1);
            // Redeeming: one point is worth point_value; at least min_redeem_points per sale.
            $table->decimal('point_value', 18, 2)->default(1);
            $table->unsignedInteger('min_redeem_points')->default(0);
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        Schema::create('loyalty_accounts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('customer_id')->unique()->constrained()->restrictOnDelete();
            // May go negative when points earned on returned goods were already spent.
            $table->bigInteger('balance')->default(0);
            $table->unsignedBigInteger('lifetime_earned')->default(0);
            $table->unsignedBigInteger('lifetime_redeemed')->default(0);
            $table->timestampsTz();
        });

        Schema::create('loyalty_transactions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('customer_id')->constrained()->restrictOnDelete();
            // earn, redeem, earn_reversal, redeem_reversal, refund, adjustment
            $table->string('type', 20);
            $table->bigInteger('points');
            $table->bigInteger('balance_after');
            // Money value of redeemed/refunded points.
            $table->decimal('value', 18, 2)->nullable();
            $table->foreignUuid('sale_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('source_type', 30);
            $table->uuid('source_id')->nullable();
            $table->string('source_number', 40)->nullable();
            $table->string('notes', 255)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index(['organization_id', 'customer_id', 'created_at']);
            $table->index(['sale_id', 'type']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION prevent_loyalty_mutation() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER loyalty_transactions_append_only BEFORE UPDATE OR DELETE ON loyalty_transactions
                    FOR EACH ROW EXECUTE FUNCTION prevent_loyalty_mutation();

                ALTER TABLE loyalty_settings ADD CONSTRAINT loyalty_settings_positive CHECK (spend_amount > 0 AND point_value > 0);
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                DROP TRIGGER IF EXISTS loyalty_transactions_append_only ON loyalty_transactions;
                DROP FUNCTION IF EXISTS prevent_loyalty_mutation();
            SQL);
        }

        Schema::dropIfExists('loyalty_transactions');
        Schema::dropIfExists('loyalty_accounts');
        Schema::dropIfExists('loyalty_settings');
    }
};
