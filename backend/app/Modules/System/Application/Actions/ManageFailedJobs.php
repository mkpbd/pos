<?php

namespace App\Modules\System\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/**
 * G1b: failed queue jobs for operators — retry (Laravel's `queue:retry`), delete, retry all.
 * Listing never exposes a job's payload (it may hold customer data).
 */
final class ManageFailedJobs
{
    public function __construct(private readonly AuditTrail $audit) {}

    public static function table(): Builder
    {
        return DB::connection(config('queue.failed.database'))->table((string) config('queue.failed.table', 'failed_jobs'));
    }

    public function paginate(int $perPage): LengthAwarePaginator
    {
        return self::table()->select(['id', 'uuid', 'connection', 'queue', 'payload', 'exception', 'failed_at'])
            ->orderByDesc('failed_at')->orderByDesc('id')
            ->paginate($perPage);
    }

    public function retry(string $uuid): void
    {
        $job = $this->find($uuid);
        Artisan::call('queue:retry', ['id' => [$uuid]]);

        $this->audit->record('system.failed_job_retried', context: ['uuid' => $uuid, 'job' => self::displayName($job->payload), 'queue' => $job->queue]);
    }

    /**
     * @return int how many jobs were pushed back onto their queues
     */
    public function retryAll(): int
    {
        $count = self::table()->count();
        if ($count > 0) {
            Artisan::call('queue:retry', ['id' => ['all']]);
        }

        $this->audit->record('system.failed_job_retried', context: ['all' => true, 'count' => $count]);

        return $count;
    }

    public function delete(string $uuid): void
    {
        $job = $this->find($uuid);
        app('queue.failer')->forget($uuid);

        $this->audit->record('system.failed_job_deleted', context: ['uuid' => $uuid, 'job' => self::displayName($job->payload), 'queue' => $job->queue]);
    }

    /**
     * The job's display name from its payload (else its handler, else "Unknown job").
     */
    public static function displayName(?string $payload): string
    {
        $decoded = json_decode((string) $payload, true);
        foreach (['displayName', 'job'] as $key) {
            if (is_array($decoded) && is_string($decoded[$key] ?? null) && $decoded[$key] !== '') {
                return $decoded[$key];
            }
        }

        return 'Unknown job';
    }

    private function find(string $uuid): object
    {
        $job = self::table()->where('uuid', $uuid)->first(['id', 'uuid', 'queue', 'payload']);
        if ($job === null) {
            throw new BusinessRuleViolation('NOT_FOUND', 'The failed job was not found.', status: 404);
        }

        return $job;
    }
}
