<?php

namespace App\Modules\System\Application\Actions;

use App\Modules\Shared\Application\Contracts\RetentionTask;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * G1b: data retention (`pos:prune-records`). Deletes old operational records in chunks, per
 * config pos.retention (days; empty / 0 = keep forever):
 *  - login_activities, failed_jobs, ai_requests (not rows another table still references),
 *  - notifications that were read (unread ones are kept),
 *  - error_events that are resolved / ignored and were last seen before the cut-off,
 *  - audit_logs only when POS_RETAIN_AUDIT_DAYS is set,
 *  - system_backups rows without a file (failed, or the file was deleted by backup retention),
 *  - ST1: the RetentionTask steps other modules tag (Imports: uploaded files of finished imports).
 *
 * An install-wide maintenance path: it deletes rows of other modules' tables by design.
 */
final class PruneRecords
{
    public const CACHE_KEY = 'system:retention:last_run';

    private const CHUNK = 1000;

    /**
     * @return array<string, int> rows deleted (or, on a dry run, that would be) per table
     */
    public function __invoke(bool $dryRun = false): array
    {
        $counts = [];
        foreach ($this->rules() as $table => $rule) {
            $days = self::days(config("pos.retention.{$table}"));
            if ($days === null || ! Schema::hasTable($table)) {
                continue;
            }

            $counts[$table] = $this->prune($table, $rule['key'], fn (Builder $q) => $rule['where']($q, now()->subDays($days)), $dryRun);
        }

        // ST1: retention steps other modules add (e.g. Imports deletes old uploaded files).
        foreach (app()->tagged(RetentionTask::TAG) as $task) {
            /** @var RetentionTask $task */
            $count = $task->prune($dryRun);
            if ($count !== null) {
                $counts[$task->name()] = $count;
            }
        }

        if (! $dryRun) {
            Cache::forever(self::CACHE_KEY, ['last_run_at' => now()->toIso8601String(), 'deleted' => $counts]);
            Log::info('Records pruned (data retention).', $counts);
        }

        return $counts;
    }

    public static function days(mixed $value): ?int
    {
        if ($value === null || $value === '' || ! is_numeric($value) || (int) $value <= 0) {
            return null;
        }

        return (int) $value;
    }

    /**
     * @return array<string, array{key: string, where: callable(Builder, Carbon): void}>
     */
    private function rules(): array
    {
        return [
            'login_activities' => ['key' => 'id', 'where' => fn (Builder $q, Carbon $cutoff) => $q->where('created_at', '<', $cutoff)],
            'notifications' => ['key' => 'id', 'where' => fn (Builder $q, Carbon $cutoff) => $q->whereNotNull('read_at')->where('created_at', '<', $cutoff)],
            // failed_at is a timestamp without time zone, written in UTC.
            'failed_jobs' => ['key' => 'id', 'where' => fn (Builder $q, Carbon $cutoff) => $q->where('failed_at', '<', $cutoff->copy()->utc()->format('Y-m-d H:i:s'))],
            'ai_requests' => ['key' => 'id', 'where' => function (Builder $q, Carbon $cutoff) {
                $q->where('created_at', '<', $cutoff);
                $this->whereNotReferenced($q, 'ai_requests');
            }],
            'error_events' => ['key' => 'id', 'where' => fn (Builder $q, Carbon $cutoff) => $q->whereIn('status', ['resolved', 'ignored'])->where('last_seen_at', '<', $cutoff)],
            'audit_logs' => ['key' => 'id', 'where' => fn (Builder $q, Carbon $cutoff) => $q->where('created_at', '<', $cutoff)],
            'system_backups' => ['key' => 'id', 'where' => fn (Builder $q, Carbon $cutoff) => $q->where('created_at', '<', $cutoff)
                ->where(fn (Builder $w) => $w->whereNotNull('file_deleted_at')->orWhere('status', 'failed'))],
        ];
    }

    /**
     * @param  callable(Builder): void  $where
     */
    private function prune(string $table, string $key, callable $where, bool $dryRun): int
    {
        $base = fn () => tap(DB::table($table), $where);

        if ($dryRun) {
            return $base()->count();
        }

        $deleted = 0;
        do {
            $batch = DB::table($table)->whereIn($key, $base()->select($key)->limit(self::CHUNK))->delete();
            $deleted += $batch;
        } while ($batch === self::CHUNK);

        return $deleted;
    }

    /**
     * Skips rows still referenced by a foreign key of another table (PostgreSQL catalog).
     */
    private function whereNotReferenced(Builder $query, string $table): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        $references = DB::select(<<<'SQL'
            SELECT src.relname AS source_table, src_col.attname AS source_column, dst_col.attname AS target_column
            FROM pg_constraint c
            JOIN pg_class src ON src.oid = c.conrelid
            JOIN pg_class dst ON dst.oid = c.confrelid
            JOIN pg_namespace ns ON ns.oid = dst.relnamespace
            JOIN pg_attribute src_col ON src_col.attrelid = c.conrelid AND src_col.attnum = c.conkey[1]
            JOIN pg_attribute dst_col ON dst_col.attrelid = c.confrelid AND dst_col.attnum = c.confkey[1]
            WHERE c.contype = 'f' AND dst.relname = ? AND ns.nspname = current_schema() AND array_length(c.conkey, 1) = 1
            SQL, [$table]);

        foreach ($references as $ref) {
            $query->whereNotExists(fn (Builder $sub) => $sub->selectRaw('1')
                ->from($ref->source_table)
                ->whereColumn("{$ref->source_table}.{$ref->source_column}", "{$table}.{$ref->target_column}"));
        }
    }
}
