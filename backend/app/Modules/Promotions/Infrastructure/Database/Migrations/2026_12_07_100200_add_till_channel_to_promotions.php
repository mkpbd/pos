<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * POS1a: promotions at the till.
 *
 * - promotions.channels: where a promotion applies — a non-empty JSON array of `online`
 *   and/or `till`; existing promotions keep applying to the online store only.
 * - promotion_redemptions.sale_id: a redemption belongs to a web order or to a POS sale
 *   (exactly one of the two); `order_number` holds the sale's invoice number for sales.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE promotions ADD COLUMN channels jsonb NOT NULL DEFAULT '["online"]';
 *   ALTER TABLE promotions ADD CONSTRAINT promotions_channels_check CHECK (jsonb_typeof(channels) = 'array'
 *       AND jsonb_array_length(channels) >= 1 AND channels <@ '["online", "till"]'::jsonb);
 *   ALTER TABLE promotion_redemptions ALTER COLUMN order_id DROP NOT NULL;
 *   ALTER TABLE promotion_redemptions ADD COLUMN sale_id uuid NULL REFERENCES sales (id) ON DELETE RESTRICT;
 *   CREATE INDEX promotion_redemptions_sale_id_index ON promotion_redemptions (sale_id);
 *   ALTER TABLE promotion_redemptions ADD CONSTRAINT promotion_redemptions_document_check CHECK (num_nonnulls(order_id, sale_id) = 1);
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('promotions', function (Blueprint $table) {
            $table->jsonb('channels')->default(DB::raw("'[\"online\"]'::jsonb"));
        });

        Schema::table('promotion_redemptions', function (Blueprint $table) {
            $table->uuid('order_id')->nullable()->change();
            $table->foreignUuid('sale_id')->nullable()->constrained('sales')->restrictOnDelete();
            $table->index('sale_id');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE promotions ADD CONSTRAINT promotions_channels_check CHECK (
                    jsonb_typeof(channels) = 'array' AND jsonb_array_length(channels) >= 1
                    AND channels <@ '["online", "till"]'::jsonb
                )
            SQL);
            DB::statement('ALTER TABLE promotion_redemptions ADD CONSTRAINT promotion_redemptions_document_check CHECK (num_nonnulls(order_id, sale_id) = 1)');
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE promotion_redemptions DROP CONSTRAINT IF EXISTS promotion_redemptions_document_check');
            DB::statement('ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_channels_check');
        }

        Schema::table('promotion_redemptions', function (Blueprint $table) {
            $table->dropIndex(['sale_id']);
            $table->dropConstrainedForeignId('sale_id');
        });
        // order_id stays nullable: till redemptions would not fit NOT NULL.

        Schema::table('promotions', function (Blueprint $table) {
            $table->dropColumn('channels');
        });
    }
};
