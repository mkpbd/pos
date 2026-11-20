<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AI2b: the shopper support assistant of the store — off by default, switched on per store; its
 * name, greeting (Bangla in `assistant_translations` {bn: {greeting}}), the number of new
 * conversations per store-local day and the hand-off (null = WhatsApp when a number is set,
 * else the contact page).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->boolean('assistant_enabled')->default(false);
            $table->string('assistant_name', 40)->nullable();
            $table->string('assistant_greeting', 200)->nullable();
            $table->jsonb('assistant_translations')->nullable();
            $table->unsignedSmallInteger('assistant_daily_limit')->default(200);
            $table->string('assistant_handoff', 10)->nullable();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE storefront_settings ADD CONSTRAINT storefront_settings_assistant_check CHECK (assistant_daily_limit BETWEEN 1 AND 2000 AND (assistant_handoff IS NULL OR assistant_handoff IN ('whatsapp', 'contact', 'none')) AND (assistant_translations IS NULL OR jsonb_typeof(assistant_translations) = 'object'))");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE storefront_settings DROP CONSTRAINT IF EXISTS storefront_settings_assistant_check');
        }
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->dropColumn(['assistant_enabled', 'assistant_name', 'assistant_greeting', 'assistant_translations', 'assistant_daily_limit', 'assistant_handoff']);
        });
    }
};
