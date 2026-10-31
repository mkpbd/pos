<?php

namespace App\Modules\Audit\Presentation\Http\Controllers;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Audit\Presentation\Http\Resources\AuditLogResource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuditLogController
{
    /**
     * Audit trail
     *
     * Filters: `action` (exact or prefix with `*`, e.g. `user.*`), `user_id`, `subject_type`,
     * `subject_id`, `from`/`to` (dates, inclusive).
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'action' => ['sometimes', 'string', 'max:100', 'regex:/^[a-z_.]+\*?$/'],
            'user_id' => ['sometimes', 'uuid'],
            'subject_type' => ['sometimes', 'string', 'max:100'],
            'subject_id' => ['sometimes', 'uuid'],
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
        ]);

        $query = AuditLog::query()
            ->when($request->query('action'), function (Builder $q, string $action) {
                str_ends_with($action, '*')
                    ? $q->where('action', 'like', rtrim($action, '*').'%')
                    : $q->where('action', $action);
            })
            ->when($request->query('user_id'), fn (Builder $q, string $v) => $q->where('user_id', $v))
            ->when($request->query('subject_type'), fn (Builder $q, string $v) => $q->where('subject_type', $v))
            ->when($request->query('subject_id'), fn (Builder $q, string $v) => $q->where('subject_id', $v))
            ->when($request->query('from'), fn (Builder $q, string $v) => $q->where('created_at', '>=', $v))
            ->when($request->query('to'), fn (Builder $q, string $v) => $q->where('created_at', '<', now()->parse($v)->addDay()->startOfDay()));

        return ApiResponse::paginated(ListQuery::paginate($query, $request, sortable: ['created_at']), AuditLogResource::class);
    }
}
