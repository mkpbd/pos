<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Q1: a cancelled web order gives its promotions back — its redemptions get `released_at` and
 * stop counting towards usage limits (overall and per customer). The rows stay append-only
 * otherwise: the trigger now allows exactly one change, `released_at` NULL → a time, with every
 * other column unchanged. Additive only.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE promotion_redemptions ADD COLUMN released_at timestamptz NULL;
 *   CREATE OR REPLACE FUNCTION prevent_promotion_redemption_mutation() RETURNS trigger AS $$
 *   BEGIN
 *       IF TG_OP = 'UPDATE' AND OLD.released_at IS NULL AND NEW.released_at IS NOT NULL
 *           AND (to_jsonb(NEW) - 'released_at') = (to_jsonb(OLD) - 'released_at') THEN
 *           RETURN NEW;
 *       END IF;
 *       RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
 *   END;
 *   $$ LANGUAGE plpgsql;
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('promotion_redemptions', function (Blueprint $table) {
            $table->timestampTz('released_at')->nullable();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION prevent_promotion_redemption_mutation() RETURNS trigger AS $$
                BEGIN
                    IF TG_OP = 'UPDATE' AND OLD.released_at IS NULL AND NEW.released_at IS NOT NULL
                        AND (to_jsonb(NEW) - 'released_at') = (to_jsonb(OLD) - 'released_at') THEN
                        RETURN NEW;
                    END IF;
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
                END;
                $$ LANGUAGE plpgsql;
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION prevent_promotion_redemption_mutation() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
                END;
                $$ LANGUAGE plpgsql;
            SQL);
        }
        Schema::table('promotion_redemptions', function (Blueprint $table) {
            $table->dropColumn('released_at');
        });
    }
};
