<?php

namespace App\Modules\System\Infrastructure\Backups;

use Illuminate\Contracts\Process\ProcessResult;
use Illuminate\Database\ConfigurationUrlParser;
use Illuminate\Support\Facades\Process;

/**
 * G1b: runs pg_dump / pg_restore against the application's default connection. Connection
 * settings — the password included — travel as PG* environment variables of the process, never
 * on its command line.
 */
final class PostgresTools
{
    /**
     * The default connection's settings (DB_URL resolved).
     *
     * @return array<string, mixed>
     */
    public static function connectionConfig(): array
    {
        $name = (string) config('database.default');

        return (new ConfigurationUrlParser)->parseConfiguration((array) config("database.connections.{$name}"));
    }

    public static function isPostgres(): bool
    {
        return (self::connectionConfig()['driver'] ?? null) === 'pgsql';
    }

    public static function liveDatabase(): string
    {
        return (string) (self::connectionConfig()['database'] ?? '');
    }

    /**
     * The live connection's password, so error texts can be scrubbed of it.
     */
    public static function password(): string
    {
        return (string) (self::connectionConfig()['password'] ?? '');
    }

    /**
     * @return array<string, string>
     */
    public static function environment(?string $database = null): array
    {
        $config = self::connectionConfig();
        $env = [
            'PGHOST' => (string) ($config['host'] ?? '127.0.0.1'),
            'PGPORT' => (string) ($config['port'] ?? '5432'),
            'PGUSER' => (string) ($config['username'] ?? ''),
            'PGPASSWORD' => (string) ($config['password'] ?? ''),
            'PGDATABASE' => $database ?? (string) ($config['database'] ?? ''),
        ];
        if (is_array($config['host'] ?? null)) {
            $env['PGHOST'] = (string) ($config['host'][0] ?? '127.0.0.1');
        }
        if (! empty($config['sslmode'])) {
            $env['PGSSLMODE'] = (string) $config['sslmode'];
        }
        // Windows: pg_dump 18 needs the system random source ("could not generate restrict key")
        // and sockets, both of which need SystemRoot — absent in a web server's trimmed environment.
        if (PHP_OS_FAMILY === 'Windows') {
            $env['SystemRoot'] = (string) (getenv('SystemRoot') ?: getenv('SYSTEMROOT') ?: 'C:\\Windows');
        }

        return $env;
    }

    /**
     * Path of a client program: in POS_PG_BIN when set (with `.exe` on Windows), else its bare
     * name for the PATH lookup.
     */
    public static function binary(string $program): string
    {
        $dir = rtrim(str_replace('\\', '/', (string) config('pos.backup.pg_bin')), '/');
        if ($dir === '') {
            return $program;
        }

        $path = $dir.'/'.$program;
        if (PHP_OS_FAMILY === 'Windows' && ! is_file($path) && is_file($path.'.exe')) {
            return $path.'.exe';
        }

        return $path;
    }

    public static function timeout(): int
    {
        return max(60, (int) config('pos.backup.timeout', 3600));
    }

    public function dump(string $target): ProcessResult
    {
        return Process::timeout(self::timeout())
            ->env(self::environment())
            ->run([self::binary('pg_dump'), '--format=custom', '--no-owner', '--no-privileges', '--file='.$target]);
    }

    public function listArchive(string $file): ProcessResult
    {
        return Process::timeout(self::timeout())
            ->env(self::environment())
            ->run([self::binary('pg_restore'), '--list', $file]);
    }

    public function restoreInto(string $database, string $file): ProcessResult
    {
        return Process::timeout(self::timeout())
            ->env(self::environment($database))
            ->run([self::binary('pg_restore'), '--clean', '--if-exists', '--no-owner', '--no-privileges', '--dbname='.$database, $file]);
    }

    /**
     * The operator's off-site hook (POS_BACKUP_AFTER_COMMAND, never request input) with `{file}`
     * replaced by the shell-escaped path. Runs without the database password in its environment.
     */
    public function afterCommand(string $template, string $file): ProcessResult
    {
        $env = ['PGPASSWORD' => false];
        if (PHP_OS_FAMILY === 'Windows') {
            $env['SystemRoot'] = (string) (getenv('SystemRoot') ?: getenv('SYSTEMROOT') ?: 'C:\\Windows');
        }

        return Process::timeout(self::timeout())
            ->env($env)
            ->run(str_replace('{file}', escapeshellarg($file), $template));
    }
}
