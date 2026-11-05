<?php

namespace App\Modules\Audit\Presentation\Http\Exports;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Audit\Presentation\Http\Resources\AuditLogResource;
use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * GET /audit-logs?export=xlsx|pdf — who did what, when; changed fields listed by name.
 */
class AuditLogsExport extends ListExport
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly UserDirectory $users,
    ) {}

    public function name(): string
    {
        return 'audit-log';
    }

    public function title(): string
    {
        return 'Audit log';
    }

    /**
     * A chunk of entries as list rows plus the acting user's name.
     *
     * @param  Collection<int, AuditLog>  $logs
     * @return Collection<int, array<string, mixed>>
     */
    public function present(Collection $logs): Collection
    {
        $names = $this->users->names($this->tenant->requireOrganization(), $logs->pluck('user_id')->filter()->unique()->values()->all());

        return $logs->map(fn (AuditLog $log) => (new AuditLogResource($log))->resolve(request()) + ['user_name' => $names[$log->user_id] ?? null]);
    }

    public function columns(): array
    {
        return [
            ExportColumn::dateTime('created_at', 'Date'),
            ExportColumn::text('action', 'Action'),
            ExportColumn::text('user_name', 'User'),
            ExportColumn::text('subject_type', 'Subject'),
            ExportColumn::text('subject_id', 'Subject id'),
            ExportColumn::text('changes', 'Changed fields', fn (array $r) => implode(', ', array_unique([...array_keys((array) ($r['old_values'] ?? [])), ...array_keys((array) ($r['new_values'] ?? []))]))),
            ExportColumn::text('context', 'Details', fn (array $r) => empty($r['context']) ? null : mb_strimwidth((string) json_encode($r['context'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 0, 300, '…')),
            ExportColumn::text('ip_address', 'IP address'),
        ];
    }

    public function filters(Request $request): array
    {
        $org = $this->tenant->requireOrganization();

        return FilterSummary::of($request)
            ->value('action', 'Action', fn (string $v) => $v)
            ->lookup('user_id', 'User', fn (string $id) => $this->users->names($org, [$id])[$id] ?? null)
            ->value('subject_type', 'Subject', fn (string $v) => $v)
            ->value('subject_id', 'Subject id', fn (string $v) => $v)
            ->dates()
            ->all();
    }
}
