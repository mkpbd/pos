<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * BD1b: orders entered by staff (taken by phone, Facebook, WhatsApp…) and editing an order
 * before it ships.
 *
 * - `orders.source` gains `staff`; `orders.channel` (staff orders only: where the order was
 *   taken) and `orders.created_by` (the staff member); `orders.revision` counts the versions of
 *   the order's contents (1 at placement, + 1 per edit).
 * - `order_edits`: one append-only row per edit with a before/after snapshot of the contents.
 * - The content snapshots (`order_lines`, `order_line_stock`, `order_promotions`) stay
 *   append-only: their triggers now call `prevent_order_content_mutation()`, which refuses every
 *   UPDATE and allows DELETE only while the edit has set `pos.order_edit = 'on'` (SET LOCAL,
 *   inside its transaction). `prevent_order_detail_mutation()` and the other tables' triggers
 *   are unchanged.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE orders DROP CONSTRAINT orders_source_check;
 *   ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('storefront', 'landing_page', 'staff'));
 *   ALTER TABLE orders ADD COLUMN channel varchar(20) NULL, ADD COLUMN created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
 *       ADD COLUMN revision smallint NOT NULL DEFAULT 1;
 *   ALTER TABLE orders ADD CONSTRAINT orders_channel_check CHECK (channel IS NULL OR channel IN ('phone', 'facebook', 'whatsapp', 'instagram', 'walk_in', 'other'));
 *   ALTER TABLE orders ADD CONSTRAINT orders_revision_check CHECK (revision >= 1);
 *   CREATE TABLE order_edits (…); CREATE TRIGGER order_edits_append_only … prevent_order_detail_mutation();
 *   CREATE FUNCTION prevent_order_content_mutation() …; re-point order_lines_append_only,
 *   order_line_stock_append_only and order_promotions_append_only to it.
 */
return new class extends Migration
{
    private const CONTENT_TRIGGERS = [
        'order_lines' => 'order_lines_append_only',
        'order_line_stock' => 'order_line_stock_append_only',
        'order_promotions' => 'order_promotions_append_only',
    ];

    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('channel', 20)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedSmallInteger('revision')->default(1);
        });

        Schema::create('order_edits', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('order_id')->constrained()->restrictOnDelete();
            $table->unsignedSmallInteger('revision');
            $table->string('reason', 200)->nullable();
            $table->jsonb('before');
            $table->jsonb('after');
            $table->foreignUuid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->unique(['order_id', 'revision']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check');
            DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('storefront', 'landing_page', 'staff'))");
            DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_channel_check CHECK (channel IS NULL OR channel IN ('phone', 'facebook', 'whatsapp', 'instagram', 'walk_in', 'other'))");
            DB::statement('ALTER TABLE orders ADD CONSTRAINT orders_revision_check CHECK (revision >= 1)');

            $repoint = '';
            foreach (self::CONTENT_TRIGGERS as $table => $trigger) {
                $repoint .= "DROP TRIGGER IF EXISTS {$trigger} ON {$table};\n"
                    ."CREATE TRIGGER {$trigger} BEFORE UPDATE OR DELETE ON {$table} FOR EACH ROW EXECUTE FUNCTION prevent_order_content_mutation();\n";
            }
            DB::unprepared(<<<SQL
                CREATE OR REPLACE FUNCTION prevent_order_content_mutation() RETURNS trigger AS \$\$
                BEGIN
                    IF TG_OP = 'DELETE' AND current_setting('pos.order_edit', true) = 'on' THEN
                        RETURN OLD;
                    END IF;
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
                END;
                \$\$ LANGUAGE plpgsql;

                {$repoint}
                CREATE TRIGGER order_edits_append_only BEFORE UPDATE OR DELETE ON order_edits
                    FOR EACH ROW EXECUTE FUNCTION prevent_order_detail_mutation();
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            $repoint = '';
            foreach (self::CONTENT_TRIGGERS as $table => $trigger) {
                $repoint .= "DROP TRIGGER IF EXISTS {$trigger} ON {$table};\n"
                    ."CREATE TRIGGER {$trigger} BEFORE UPDATE OR DELETE ON {$table} FOR EACH ROW EXECUTE FUNCTION prevent_order_detail_mutation();\n";
            }
            DB::unprepared($repoint.'DROP FUNCTION IF EXISTS prevent_order_content_mutation();');
            DB::statement('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_revision_check');
            DB::statement('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check');
            DB::statement('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check');
            DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('storefront', 'landing_page'))");
        }

        Schema::dropIfExists('order_edits');
        Schema::table('orders', function (Blueprint $table) {
            $table->dropConstrainedForeignId('created_by');
            $table->dropColumn(['channel', 'revision']);
        });
    }
};
