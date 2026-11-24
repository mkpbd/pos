<?php

namespace App\Modules\System\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\System\Application\Actions\ChangeErrorStatus;
use App\Modules\System\Infrastructure\Models\ErrorEvent;
use App\Modules\System\Presentation\Http\Resources\ErrorEventResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * G1b: the built-in error log — list by status, detail with trace, resolve / ignore / reopen.
 */
class ErrorEventController
{
    public function index(Request $request): JsonResponse
    {
        $request->validate(['status' => ['sometimes', Rule::in(ErrorEvent::STATUSES)]]);
        $status = (string) $request->query('status', ErrorEvent::OPEN);

        $counts = ErrorEvent::query()->selectRaw('status, count(*) AS total')->groupBy('status')->pluck('total', 'status');

        return ApiResponse::paginated(
            ListQuery::paginate(
                ErrorEvent::query()->where('status', $status),
                $request,
                sortable: ['last_seen_at', 'occurrences', 'first_seen_at'],
                searchable: ['exception_class', 'message'],
                defaultSort: '-last_seen_at',
            ),
            ErrorEventResource::class,
            ['counts' => collect(ErrorEvent::STATUSES)->mapWithKeys(fn (string $s) => [$s => (int) ($counts[$s] ?? 0)])->all()],
        );
    }

    public function show(ErrorEvent $error): JsonResponse
    {
        return ApiResponse::success((new ErrorEventResource($error))->withTrace());
    }

    public function update(Request $request, ErrorEvent $error, ChangeErrorStatus $change): JsonResponse
    {
        $data = $request->validate(['status' => ['required', Rule::in(ErrorEvent::STATUSES)]]);
        $userId = $request->user()?->getAuthIdentifier();

        return ApiResponse::success((new ErrorEventResource($change($error, $data['status'], $userId !== null ? (string) $userId : null)))->withTrace());
    }
}
