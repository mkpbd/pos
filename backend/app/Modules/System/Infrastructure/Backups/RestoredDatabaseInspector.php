<?php

namespace App\Modules\System\Infrastructure\Backups;

use Illuminate\Support\Facades\DB;

/**
 * G1b: after a full restore check, looks into the scratch database: the core tables must exist
 * and at least one organization must have come back. Never used on the live database.
 */
class RestoredDatabaseInspector
{
    private const CONNECTION = 'backup_verify';

    private const REQUIRED_TABLES = ['migrations', 'organizations', 'users'];

    /**
     * What is wrong with the restored database, or null when it looks complete.
     */
    public function problem(string $database): ?string
    {
        config(['database.connections.'.self::CONNECTION => ['url' => null, 'database' => $database] + PostgresTools::connectionConfig()]);

        try {
            $connection = DB::connection(self::CONNECTION);
            foreach (self::REQUIRED_TABLES as $table) {
                if ($connection->selectOne('SELECT to_regclass(?) AS found', ['public.'.$table])?->found === null) {
                    return "The restored database has no {$table} table.";
                }
            }

            return $connection->table('organizations')->exists() ? null : 'The restored database has no organizations.';
        } finally {
            DB::purge(self::CONNECTION);
        }
    }
}
