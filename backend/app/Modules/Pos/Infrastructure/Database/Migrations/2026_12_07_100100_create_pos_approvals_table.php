<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * POS1a: a manager's approval given at the till with their PIN — `price_override` (bound to
 * `details.variant_id`) or `discount` (the cart's manual discounts). Valid for 10 minutes, used
 * once by the requester's checkout (`used_at`, `sale_id`). The PIN itself is never stored.
 *
 * Manual SQL (PostgreSQL):
 *   CREATE TABLE pos_approvals (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
 *     store_id uuid NOT NULL REFERENCES stores ON DELETE CASCADE, action varchar(20) NOT NULL,
 *     approver_id uuid NOT NULL REFERENCES users, requester_id uuid NOT NULL REFERENCES users,
 *     details jsonb NOT NULL DEFAULT '{}', expires_at timestamptz NOT NULL, used_at timestamptz NULL, sale_id uuid NULL,
 *     created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 *     CONSTRAINT pos_approvals_action_check CHECK (action IN ('price_override', 'discount')),
 *     CONSTRAINT pos_approvals_used_check CHECK ((used_at IS NULL) = (sale_id IS NULL)));
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pos_approvals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained()->cascadeOnDelete();
            $table->string('action', 20);
            $table->foreignUuid('approver_id')->constrained('users');
            $table->foreignUuid('requester_id')->constrained('users');
            $table->jsonb('details')->default('{}');
            $table->timestampTz('expires_at');
            $table->timestampTz('used_at')->nullable();
            // The sale that used it (no foreign key: consumed inside the checkout transaction).
            $table->uuid('sale_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['organization_id', 'created_at']);
            $table->index('sale_id');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE pos_approvals ADD CONSTRAINT pos_approvals_action_check CHECK (action IN ('price_override', 'discount'))");
            DB::statement('ALTER TABLE pos_approvals ADD CONSTRAINT pos_approvals_used_check CHECK ((used_at IS NULL) = (sale_id IS NULL))');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('pos_approvals');
    }
};
