<?php

namespace App\Modules\Audit\Infrastructure\Services;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Shared\Application\Contracts\AuditHistory;
use Carbon\CarbonImmutable;

/**
 * B16: a record's audit entries, organization-scoped by the model's tenant scope.
 */
class DatabaseAuditHistory implements AuditHistory
{
    public function forSubject(string $subjectType, string $subjectId, ?CarbonImmutable $before, int $limit, string $actionPrefix = ''): array
    {
        return AuditLog::query()
            ->where('subject_type', $subjectType)
            ->where('subject_id', $subjectId)
            ->when($actionPrefix !== '', fn ($q) => $q->where('action', 'like', str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $actionPrefix).'%'))
            ->when($before !== null, fn ($q) => $q->where('created_at', '<', $before->format('Y-m-d H:i:s.uP')))
            ->orderByDesc('created_at')->orderByDesc('id')
            ->limit(max(1, $limit))
            ->get()
            ->map(fn (AuditLog $log) => [
                'id' => $log->id,
                'action' => $log->action,
                'user_id' => $log->user_id,
                'old_values' => $log->old_values,
                'new_values' => $log->new_values,
                'context' => $log->context,
                'created_at' => CarbonImmutable::instance($log->created_at),
            ])
            ->values()
            ->all();
    }
}
