<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * BD1a: per-customer promotion limits also count a guest's mobile number (01XXXXXXXXX), so
 * phone-only shoppers cannot reuse a once-per-customer offer. Additive only (the append-only
 * trigger compares whole rows, so it covers the new column too).
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE promotion_redemptions ADD COLUMN phone varchar(11) NULL;
 *   CREATE INDEX promotion_redemptions_promotion_id_phone_index ON promotion_redemptions (promotion_id, phone);
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('promotion_redemptions', function (Blueprint $table) {
            $table->string('phone', 11)->nullable();
            $table->index(['promotion_id', 'phone']);
        });
    }

    public function down(): void
    {
        Schema::table('promotion_redemptions', function (Blueprint $table) {
            $table->dropIndex(['promotion_id', 'phone']);
            $table->dropColumn('phone');
        });
    }
};
