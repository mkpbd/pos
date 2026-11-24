<?php

namespace App\Modules\System\Application\Services;

use App\Modules\System\Application\Actions\PruneRecords;
use App\Modules\System\Domain\Status\HealthRules;
use App\Modules\System\Infrastructure\Console\HeartbeatCommand;
use App\Modules\System\Infrastructure\Jobs\QueueHeartbeat;
use App\Modules\System\Infrastructure\Models\ErrorEvent;
use App\Modules\System\Infrastructure\Models\SystemBackup;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * G1b: the operators' view of the installation — dependencies, scheduler and queue heartbeats,
 * mail, backups, disk space, the error log, data retention — plus plain warnings.
 * Each part is computed on its own, so one failing dependency never hides the others.
 */
final class SystemStatus
{
    /**
     * @return array<string, mixed>
     */
    public function snapshot(): array
    {
        $now = CarbonImmutable::now();

        $checks = [
            'database' => $this->probe('database', fn () => DB::select('select 1')),
            'cache' => $this->probe('cache', function () {
                $key = 'status:'.Str::random(8);
                Cache::put($key, true, 10);
                throw_unless(Cache::pull($key) === true, new RuntimeException('Cache round-trip failed.'));
            }),
            'scheduler' => $this->scheduler($now),
            'queue' => $this->queue($now),
            'mail' => $this->mail(),
            'backups' => $this->backups($now),
            'storage' => $this->storage(),
            'errors' => $this->errors($now),
        ];

        $app = [
            'environment' => app()->environment(),
            'debug' => (bool) config('app.debug'),
            'php_version' => PHP_VERSION,
            'laravel_version' => app()->version(),
            'timezone' => (string) config('app.timezone'),
        ];

        $retention = $this->attempt(fn () => Cache::get(PruneRecords::CACHE_KEY));
        // Also removes the internal backup flags from $checks.
        $warnings = $this->warnings($checks, $app);

        return [
            'checks' => $checks,
            'app' => $app,
            'retention' => [
                'last_run_at' => is_array($retention) ? ($retention['last_run_at'] ?? null) : null,
                'deleted' => (object) (is_array($retention) ? ($retention['deleted'] ?? []) : []),
            ],
            'warnings' => $warnings,
        ];
    }

    /**
     * @return array{status: string, last_heartbeat_at: ?string}
     */
    private function scheduler(CarbonImmutable $now): array
    {
        $last = $this->heartbeat(HeartbeatCommand::SCHEDULER_KEY);

        return ['status' => HealthRules::scheduler($last, $now), 'last_heartbeat_at' => $last?->toIso8601String()];
    }

    /**
     * @return array<string, mixed>
     */
    private function queue(CarbonImmutable $now): array
    {
        $connection = (string) config('queue.default');
        $driver = (string) config("queue.connections.{$connection}.driver", $connection);
        $last = $this->heartbeat(QueueHeartbeat::CACHE_KEY);

        return [
            'status' => HealthRules::queue($driver, $last, $now),
            'driver' => $driver,
            'last_heartbeat_at' => $last?->toIso8601String(),
            'pending_jobs' => $this->attempt(fn () => $driver === 'sync' ? 0 : Queue::connection($connection)->size()),
            'failed_jobs' => $this->attempt(fn () => DB::connection(config('queue.failed.database'))->table((string) config('queue.failed.table', 'failed_jobs'))->count()),
        ];
    }

    /**
     * @return array{status: string, mailer: string, from_address: ?string}
     */
    private function mail(): array
    {
        $mailer = (string) config('mail.default');
        $from = config('mail.from.address');
        $from = is_string($from) && trim($from) !== '' ? $from : null;
        $notSending = in_array($mailer, ['log', 'array'], true) && app()->isProduction();

        return ['status' => $notSending || $from === null ? 'warn' : 'ok', 'mailer' => $mailer, 'from_address' => $from];
    }

    /**
     * @return array<string, mixed>
     */
    private function backups(CarbonImmutable $now): array
    {
        $enabled = (bool) config('pos.backup.enabled');
        $data = $this->attempt(function () {
            $finished = SystemBackup::query()->where('status', '!=', SystemBackup::RUNNING)->orderByDesc('started_at')->first();

            return [
                'last_success' => SystemBackup::query()->where('status', SystemBackup::SUCCEEDED)->orderByDesc('started_at')->first(),
                'last_failure' => SystemBackup::query()->where('status', SystemBackup::FAILED)->orderByDesc('started_at')->first(),
                'last_verified' => SystemBackup::query()->whereNotNull('verified_at')->orderByDesc('verified_at')->first(),
                'last_run_failed' => $finished?->status === SystemBackup::FAILED,
            ];
        }) ?? ['last_success' => null, 'last_failure' => null, 'last_verified' => null, 'last_run_failed' => false];

        /** @var ?SystemBackup $success */
        $success = $data['last_success'];
        /** @var ?SystemBackup $verified */
        $verified = $data['last_verified'];

        $problems = [];
        if ($data['last_run_failed']) {
            $problems[] = 'BACKUP_FAILED';
        }
        if (HealthRules::backupIsStale($success?->finished_at, $now)) {
            $problems[] = 'BACKUP_STALE';
        }
        if ($verified?->verify_status === 'failed') {
            $problems[] = 'BACKUP_VERIFY_FAILED';
        }
        $unverified = HealthRules::verificationIsStale($verified?->verified_at, $now);

        $status = match (true) {
            ! $enabled => 'disabled',
            $problems !== [] => 'fail',
            $unverified => 'warn',
            default => 'ok',
        };

        return [
            'status' => $status,
            'enabled' => $enabled,
            'schedule_time' => (string) config('pos.backup.time'),
            'keep_days' => (int) config('pos.backup.keep_days'),
            'last_success_at' => $success?->finished_at?->toIso8601String(),
            'last_file' => $success?->file_name,
            'last_size_bytes' => $success?->size_bytes,
            'last_verified_at' => $verified?->verified_at?->toIso8601String(),
            'verify_status' => $verified?->verify_status,
            'last_failure_at' => ($data['last_failure']?->finished_at ?? $data['last_failure']?->started_at)?->toIso8601String(),
            // Internal (not part of the response): which backup warnings apply.
            '_problems' => $problems,
            '_unverified' => $unverified,
        ];
    }

    /**
     * @return array{status: string, path: string, free_bytes: ?int, total_bytes: ?int}
     */
    private function storage(): array
    {
        $path = (string) config('pos.backup.path');
        $probe = $path;
        while ($probe !== '' && ! is_dir($probe) && dirname($probe) !== $probe) {
            $probe = dirname($probe);
        }

        $free = is_dir($probe) ? @disk_free_space($probe) : false;
        $total = is_dir($probe) ? @disk_total_space($probe) : false;
        $free = $free === false ? null : $free;
        $total = $total === false ? null : $total;

        return [
            'status' => HealthRules::diskIsLow($free, $total) ? 'warn' : 'ok',
            'path' => $path,
            'free_bytes' => $free === null ? null : (int) $free,
            'total_bytes' => $total === null ? null : (int) $total,
        ];
    }

    /**
     * @return array{open: ?int, new_last_24h: ?int}
     */
    private function errors(CarbonImmutable $now): array
    {
        return [
            'open' => $this->attempt(fn () => ErrorEvent::query()->where('status', ErrorEvent::OPEN)->count()),
            'new_last_24h' => $this->attempt(fn () => ErrorEvent::query()->where('first_seen_at', '>=', $now->subDay())->count()),
        ];
    }

    /**
     * @param  array<string, mixed>  $checks
     * @param  array<string, mixed>  $app
     * @return list<array{code: string, message: string}>
     */
    private function warnings(array &$checks, array $app): array
    {
        $warnings = [];
        $add = function (string $code, string $message) use (&$warnings) {
            $warnings[] = ['code' => $code, 'message' => $message];
        };

        if ($checks['database'] === 'fail') {
            $add('DATABASE_DOWN', 'The database cannot be reached.');
        }
        if ($checks['cache'] === 'fail') {
            $add('CACHE_DOWN', 'The cache cannot be reached.');
        }
        if ($app['debug'] && ! app()->environment(['local', 'testing'])) {
            $add('APP_DEBUG_ON', 'APP_DEBUG is on: error pages can show internal details. Set APP_DEBUG=false.');
        }
        if ($checks['mail']['status'] === 'warn') {
            $add('MAIL_NOT_SENDING', $checks['mail']['from_address'] === null
                ? 'No sender address is set (MAIL_FROM_ADDRESS): e-mails may be rejected.'
                : "E-mails are not sent: the mailer is \"{$checks['mail']['mailer']}\". Set MAIL_MAILER to smtp (or another real mailer).");
        }

        $backups = $checks['backups'];
        if (! $backups['enabled']) {
            $add('BACKUPS_DISABLED', 'Automatic database backups are off. Set POS_BACKUP_ENABLED=true.');
        } else {
            if (in_array('BACKUP_FAILED', $backups['_problems'], true)) {
                $add('BACKUP_FAILED', 'The last database backup failed.');
            }
            if (in_array('BACKUP_STALE', $backups['_problems'], true)) {
                $add('BACKUP_STALE', $backups['last_success_at'] === null
                    ? 'No database backup has succeeded yet.'
                    : 'The newest database backup is more than '.HealthRules::BACKUP_STALE_AFTER_HOURS.' hours old.');
            }
            if (in_array('BACKUP_VERIFY_FAILED', $backups['_problems'], true)) {
                $add('BACKUP_VERIFY_FAILED', 'The last restore check of a backup failed.');
            } elseif ($backups['_unverified']) {
                $add('BACKUP_UNVERIFIED', 'No backup has passed a restore check in the last '.HealthRules::VERIFY_STALE_AFTER_DAYS.' days.');
            }
        }
        unset($checks['backups']['_problems'], $checks['backups']['_unverified']);

        if ($checks['scheduler']['status'] !== 'ok') {
            $add('SCHEDULER_STALE', $checks['scheduler']['status'] === 'unknown'
                ? 'The scheduler has never run: add the cron entry for "php artisan schedule:run".'
                : 'The scheduler has not run for more than '.intdiv(HealthRules::SCHEDULER_STALE_AFTER_SECONDS, 60).' minutes.');
        }
        $queue = $checks['queue'];
        if ($queue['status'] === 'sync') {
            if (app()->isProduction()) {
                $add('QUEUE_SYNC_IN_PRODUCTION', 'Queued work runs inside web requests (QUEUE_CONNECTION=sync). Use redis or database with a queue worker.');
            }
        } elseif ($queue['status'] !== 'ok') {
            $add('QUEUE_STALE', $queue['status'] === 'unknown'
                ? 'No queue worker has run a job yet: start "php artisan queue:work".'
                : 'No queue worker has run a job for more than '.intdiv(HealthRules::QUEUE_STALE_AFTER_SECONDS, 60).' minutes.');
        }
        if (($queue['failed_jobs'] ?? 0) > 0) {
            $add('FAILED_JOBS', "{$queue['failed_jobs']} queued job(s) failed.");
        }
        if ($checks['storage']['status'] === 'warn') {
            $add('DISK_LOW', 'Less than 10% free space is left on the backup volume.');
        }
        if (($checks['errors']['open'] ?? 0) > 0) {
            $add('OPEN_ERRORS', "{$checks['errors']['open']} open error(s) in the error log.");
        }

        return $warnings;
    }

    private function heartbeat(string $key): ?CarbonImmutable
    {
        return $this->attempt(function () use ($key) {
            $value = Cache::get($key);

            return is_string($value) && $value !== '' ? CarbonImmutable::parse($value) : null;
        });
    }

    /**
     * @return 'ok'|'fail'
     */
    private function probe(string $name, callable $probe): string
    {
        try {
            $probe();

            return 'ok';
        } catch (Throwable $e) {
            Log::warning("Status check [{$name}] failed.", ['exception' => $e::class]);

            return 'fail';
        }
    }

    /**
     * @template T
     *
     * @param  callable(): T  $callback
     * @return T|null
     */
    private function attempt(callable $callback): mixed
    {
        try {
            return $callback();
        } catch (Throwable $e) {
            Log::warning('Status detail unavailable.', ['exception' => $e::class]);

            return null;
        }
    }
}
