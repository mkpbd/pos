<?php

namespace App\Modules\System\Tests\Concerns;

use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;
use Throwable;

/**
 * G1b backup tests: a temporary backup folder (removed afterwards) and the PostgreSQL client
 * programs — POS_PG_BIN, else PATH, else the usual install folders; tests that need them are
 * skipped with a clear message when they are not installed.
 */
trait UsesBackupFolder
{
    protected string $backupDir;

    protected function setUpBackupFolder(): void
    {
        $this->backupDir = str_replace('\\', '/', sys_get_temp_dir()).'/pos-g1b-backups-'.Str::lower(Str::random(8));
        config(['pos.backup.path' => $this->backupDir, 'pos.backup.after_command' => '', 'pos.backup.verify_database' => '']);
        $this->beforeApplicationDestroyed(fn () => File::deleteDirectory($this->backupDir));
    }

    protected function requirePostgresTools(): void
    {
        $candidates = array_filter([(string) config('pos.backup.pg_bin')]);
        $candidates[] = '';
        foreach (array_reverse(glob('C:/Program Files/PostgreSQL/*/bin') ?: []) as $dir) {
            $candidates[] = $dir;
        }
        foreach (array_reverse(glob('/usr/lib/postgresql/*/bin') ?: []) as $dir) {
            $candidates[] = $dir;
        }

        foreach ($candidates as $dir) {
            if ($this->runs($dir, 'pg_dump') && $this->runs($dir, 'pg_restore')) {
                config(['pos.backup.pg_bin' => $dir]);

                return;
            }
        }

        $this->markTestSkipped('pg_dump / pg_restore were not found (set POS_PG_BIN to the PostgreSQL bin folder).');
    }

    private function runs(string $dir, string $program): bool
    {
        $binary = $dir === '' ? $program : $dir.'/'.$program.(PHP_OS_FAMILY === 'Windows' ? '.exe' : '');
        if ($dir !== '' && ! is_file($binary)) {
            return false;
        }

        try {
            $process = new Process([$binary, '--version']);
            $process->run();

            return $process->isSuccessful();
        } catch (Throwable) {
            return false;
        }
    }
}
