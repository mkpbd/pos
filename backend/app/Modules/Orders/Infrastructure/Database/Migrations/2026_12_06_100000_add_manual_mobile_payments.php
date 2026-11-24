<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * BD1c: bKash / Nagad / Rocket "Send Money" payments and the advance delivery charge of
 * cash-on-delivery orders. Additive only (`orders.payment_method` and `payment_status` are
 * plain strings without CHECK constraints; the new codes need no schema change).
 *
 * - `orders.advance_amount`: the part of a COD order the shopper pays in advance by Send Money
 *   (0 = none). Set at placement only.
 * - `order_payment_claims`: what the shopper reports after sending money — sender number and
 *   transaction ID (TrxID, upper-cased) — checked and confirmed or rejected by staff. A TrxID is
 *   used at most once per organization and wallet while its claim is not rejected.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE orders ADD COLUMN advance_amount numeric(18,2) NOT NULL DEFAULT 0;
 *   ALTER TABLE orders ADD CONSTRAINT orders_advance_amount_check CHECK (advance_amount >= 0);
 *   CREATE TABLE order_payment_claims (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations,
 *     order_id uuid NOT NULL REFERENCES orders, method varchar(20) NOT NULL, purpose varchar(10) NOT NULL,
 *     amount numeric(12,2) NOT NULL, sender_phone varchar(20) NOT NULL, transaction_id varchar(40) NOT NULL,
 *     status varchar(10) NOT NULL DEFAULT 'submitted', reject_reason varchar(200), submitted_at timestamptz NOT NULL,
 *     reviewed_by uuid REFERENCES users ON DELETE SET NULL, reviewed_at timestamptz, ip varchar(45),
 *     created_at timestamptz, updated_at timestamptz);
 *   CHECK (method IN ('bkash_manual','nagad_manual','rocket_manual') AND purpose IN ('full','advance')
 *     AND status IN ('submitted','confirmed','rejected') AND amount > 0 AND transaction_id ~ '^[A-Z0-9]{6,40}$');
 *   CREATE UNIQUE INDEX order_payment_claims_transaction_unique ON order_payment_claims (organization_id, method, transaction_id)
 *     WHERE status <> 'rejected';
 *   CREATE INDEX ON order_payment_claims (organization_id, status); CREATE INDEX ON order_payment_claims (order_id);
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('advance_amount', 18, 2)->default(0);
        });

        Schema::create('order_payment_claims', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('order_id')->constrained()->restrictOnDelete();
            $table->string('method', 20);
            $table->string('purpose', 10);
            // The amount that was due when the shopper submitted the claim.
            $table->decimal('amount', 12, 2);
            $table->string('sender_phone', 20);
            $table->string('transaction_id', 40);
            $table->string('status', 10)->default('submitted');
            $table->string('reject_reason', 200)->nullable();
            $table->timestampTz('submitted_at');
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('reviewed_at')->nullable();
            $table->string('ip', 45)->nullable();
            $table->timestampsTz();

            $table->index(['organization_id', 'status']);
            $table->index('order_id');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE orders ADD CONSTRAINT orders_advance_amount_check CHECK (advance_amount >= 0)');
            DB::statement("ALTER TABLE order_payment_claims ADD CONSTRAINT order_payment_claims_rules_check CHECK (
                method IN ('bkash_manual', 'nagad_manual', 'rocket_manual')
                AND purpose IN ('full', 'advance')
                AND status IN ('submitted', 'confirmed', 'rejected')
                AND amount > 0
                AND transaction_id ~ '^[A-Z0-9]{6,40}$'
            )");
            DB::statement("CREATE UNIQUE INDEX order_payment_claims_transaction_unique ON order_payment_claims (organization_id, method, transaction_id) WHERE status <> 'rejected'");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('order_payment_claims');
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_advance_amount_check');
        }
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('advance_amount');
        });
    }
};
