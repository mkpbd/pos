<?php

namespace App\Modules\Shared\Infrastructure\Persistence;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Migration helper for content translations (E12b): a nullable `translations` jsonb column
 * `{"bn": {field: value}}`; on PostgreSQL a CHECK keeps it a JSON object.
 */
final class TranslationsColumn
{
    public static function add(string $table): void
    {
        Schema::table($table, function (Blueprint $t) {
            $t->jsonb('translations')->nullable();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_translations_check CHECK (translations IS NULL OR jsonb_typeof(translations) = 'object')");
        }
    }

    public static function drop(string $table): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE {$table} DROP CONSTRAINT IF EXISTS {$table}_translations_check");
        }
        Schema::table($table, function (Blueprint $t) {
            $t->dropColumn('translations');
        });
    }
}
