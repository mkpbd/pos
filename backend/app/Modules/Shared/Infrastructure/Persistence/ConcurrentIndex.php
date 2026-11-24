<?php

namespace App\Modules\Shared\Infrastructure\Persistence;

use Illuminate\Support\Facades\DB;

/**
 * G1c: index DDL for large, busy tables. On PostgreSQL the index is built with
 * `CREATE INDEX CONCURRENTLY` — writes (checkouts, web orders) continue during the build —
 * which cannot run inside a transaction: migrations using this set `$withinTransaction = false`.
 * A build that failed half way leaves an INVALID index behind; it is dropped and rebuilt on
 * the next run instead of being skipped by `IF NOT EXISTS`. Other drivers get the plain
 * statement ({@see self::create()} `$portable`), or nothing when the definition is PostgreSQL-only.
 */
final class ConcurrentIndex
{
    /**
     * @param  string  $definition  e.g. `sale_lines (sale_id) INCLUDE (quantity)`
     * @param  ?string  $portable  definition for other drivers (null = PostgreSQL only)
     */
    public static function create(string $name, string $definition, ?string $portable = null): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            if ($portable !== null) {
                DB::statement("CREATE INDEX IF NOT EXISTS {$name} ON {$portable}");
            }

            return;
        }

        $invalid = DB::selectOne(
            'SELECT 1 AS invalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = ? AND n.nspname = current_schema() AND NOT i.indisvalid',
            [$name],
        );
        if ($invalid !== null) {
            DB::statement("DROP INDEX CONCURRENTLY IF EXISTS {$name}");
        }
        DB::statement("CREATE INDEX CONCURRENTLY IF NOT EXISTS {$name} ON {$definition}");
    }

    public static function drop(string $name): void
    {
        DB::statement(DB::getDriverName() === 'pgsql' ? "DROP INDEX CONCURRENTLY IF EXISTS {$name}" : "DROP INDEX IF EXISTS {$name}");
    }
}
