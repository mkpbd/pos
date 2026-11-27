<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ST2b: transfers can be received short / damaged, and a branch can request stock that the
 * source branch dispatches or rejects. Additive; existing received transfers are backfilled as
 * received in full. `dispatched_at` becomes nullable (a request is not dispatched yet).
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE stock_transfer_lines
 *     ADD COLUMN received_quantity numeric(18, 3) NULL,
 *     ADD COLUMN damaged_quantity numeric(18, 3) NOT NULL DEFAULT 0,
 *     ADD COLUMN requested_quantity numeric(18, 3) NULL,
 *     ADD COLUMN receive_note varchar(200) NULL;
 *   ALTER TABLE stock_transfer_lines ADD CONSTRAINT stock_transfer_lines_receive_check
 *     CHECK (damaged_quantity >= 0 AND (received_quantity IS NULL OR (received_quantity >= 0 AND received_quantity + damaged_quantity <= quantity)));
 *   ALTER TABLE stock_transfers
 *     ADD COLUMN requested_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
 *     ADD COLUMN requested_at timestamptz NULL,
 *     ADD COLUMN rejected_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
 *     ADD COLUMN rejected_at timestamptz NULL,
 *     ADD COLUMN rejection_reason varchar(200) NULL,
 *     ADD COLUMN loss_total numeric(18, 2) NOT NULL DEFAULT 0,
 *     ALTER COLUMN dispatched_at DROP NOT NULL;
 *   ALTER TABLE stock_transfers DROP CONSTRAINT stock_transfers_status_check;
 *   ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_status_check
 *     CHECK (status IN ('requested', 'in_transit', 'received', 'cancelled', 'rejected'));
 *   UPDATE stock_transfer_lines l SET received_quantity = l.quantity
 *     FROM stock_transfers t WHERE t.id = l.stock_transfer_id AND t.status = 'received' AND l.received_quantity IS NULL;
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_transfer_lines', function (Blueprint $table) {
            $table->decimal('received_quantity', 18, 3)->nullable();
            $table->decimal('damaged_quantity', 18, 3)->default(0);
            $table->decimal('requested_quantity', 18, 3)->nullable();
            $table->string('receive_note', 200)->nullable();
        });

        Schema::table('stock_transfers', function (Blueprint $table) {
            $table->foreignUuid('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('requested_at')->nullable();
            $table->foreignUuid('rejected_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('rejected_at')->nullable();
            $table->string('rejection_reason', 200)->nullable();
            $table->decimal('loss_total', 18, 2)->default(0);
            $table->timestampTz('dispatched_at')->nullable()->change();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_status_check');
            DB::statement("ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_status_check CHECK (status IN ('requested', 'in_transit', 'received', 'cancelled', 'rejected'))");
            DB::statement(<<<'SQL'
                ALTER TABLE stock_transfer_lines ADD CONSTRAINT stock_transfer_lines_receive_check
                    CHECK (damaged_quantity >= 0
                        AND (received_quantity IS NULL OR (received_quantity >= 0 AND received_quantity + damaged_quantity <= quantity)))
            SQL);
        }

        DB::statement(<<<'SQL'
            UPDATE stock_transfer_lines SET received_quantity = quantity
            WHERE received_quantity IS NULL
              AND stock_transfer_id IN (SELECT id FROM stock_transfers WHERE status = 'received')
        SQL);
    }

    public function down(): void
    {
        // Refuses (CHECK violation) while requested / rejected transfers exist: they have no older equivalent.
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE stock_transfer_lines DROP CONSTRAINT IF EXISTS stock_transfer_lines_receive_check');
            DB::statement('ALTER TABLE stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_status_check');
            DB::statement("ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_status_check CHECK (status IN ('in_transit', 'received', 'cancelled'))");
        }

        Schema::table('stock_transfers', function (Blueprint $table) {
            $table->dropConstrainedForeignId('requested_by');
            $table->dropConstrainedForeignId('rejected_by');
            $table->dropColumn(['requested_at', 'rejected_at', 'rejection_reason', 'loss_total']);
        });
        Schema::table('stock_transfer_lines', function (Blueprint $table) {
            $table->dropColumn(['received_quantity', 'damaged_quantity', 'requested_quantity', 'receive_note']);
        });
    }
};
