<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * POS1d: the cash drawer opened at the till without a sale ("no sale") — who, why, on which
 * register session and till, and the manager who approved it by PIN when the cashier lacks
 * `pos.no_sale`. No money moves; the rows are append-only. A manager approval may now be for
 * `no_sale` (consumed by the opening: its id goes into `pos_approvals.sale_id`).
 *
 * Manual SQL (PostgreSQL):
 *   CREATE TABLE pos_drawer_openings (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations,
 *     branch_id uuid NOT NULL REFERENCES branches, store_id uuid NOT NULL REFERENCES stores,
 *     register_session_id uuid NULL REFERENCES cash_register_sessions, register_session_number varchar(40) NULL,
 *     terminal_id uuid NULL REFERENCES pos_terminals, user_id uuid NOT NULL REFERENCES users,
 *     approved_by uuid NULL REFERENCES users, approval_id uuid NULL, reason varchar(200) NOT NULL,
 *     opened_at timestamptz NOT NULL);
 *   CREATE INDEX ON pos_drawer_openings (organization_id, branch_id, opened_at);
 *   CREATE INDEX ON pos_drawer_openings (register_session_id);
 *   + BEFORE UPDATE OR DELETE trigger raising "pos_drawer_openings is append-only";
 *   pos_approvals_action_check: action IN ('price_override', 'discount', 'return', 'no_sale').
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pos_drawer_openings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('store_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('register_session_id')->nullable()->constrained('cash_register_sessions')->restrictOnDelete();
            // The session's number when it was opened (sessions never change it), for lists without reading Payments.
            $table->string('register_session_number', 40)->nullable();
            $table->foreignUuid('terminal_id')->nullable()->constrained('pos_terminals')->restrictOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->uuid('approval_id')->nullable();
            $table->string('reason', 200);
            $table->timestampTz('opened_at');

            $table->index(['organization_id', 'branch_id', 'opened_at']);
            $table->index('register_session_id');
        });

        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION prevent_pos_drawer_opening_mutation() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
            END;
            $$ LANGUAGE plpgsql;

            CREATE TRIGGER pos_drawer_openings_append_only BEFORE UPDATE OR DELETE ON pos_drawer_openings
                FOR EACH ROW EXECUTE FUNCTION prevent_pos_drawer_opening_mutation();

            ALTER TABLE pos_approvals DROP CONSTRAINT IF EXISTS pos_approvals_action_check;
            ALTER TABLE pos_approvals ADD CONSTRAINT pos_approvals_action_check
                CHECK (action IN ('price_override', 'discount', 'return', 'no_sale'));
        SQL);
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                DELETE FROM pos_approvals WHERE action = 'no_sale';
                ALTER TABLE pos_approvals DROP CONSTRAINT IF EXISTS pos_approvals_action_check;
                ALTER TABLE pos_approvals ADD CONSTRAINT pos_approvals_action_check
                    CHECK (action IN ('price_override', 'discount', 'return'));
                DROP TRIGGER IF EXISTS pos_drawer_openings_append_only ON pos_drawer_openings;
                DROP FUNCTION IF EXISTS prevent_pos_drawer_opening_mutation();
            SQL);
        }

        Schema::dropIfExists('pos_drawer_openings');
    }
};
