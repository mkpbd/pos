<?php

namespace App\Modules\Notifications\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Notifications\DatabaseNotification;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * The signed-in user's in-app inbox (low-stock alerts and future system messages).
 */
class NotificationController
{
    /**
     * My notifications
     *
     * Newest first; `unread=1` for unread only.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['unread' => ['sometimes', 'boolean']]);
        $query = $request->user()->notifications()->getQuery()
            ->when($request->boolean('unread'), fn ($q) => $q->whereNull('read_at'));

        return ApiResponse::paginated(
            ListQuery::paginate($query, $request, sortable: ['created_at']),
            fn (DatabaseNotification $n) => new JsonResource([
                'id' => $n->id,
                'type' => $n->type,
                'data' => $n->data,
                'read_at' => $n->read_at?->toIso8601String(),
                'created_at' => $n->created_at?->toIso8601String(),
            ]),
        );
    }

    public function unreadCount(Request $request): JsonResponse
    {
        return ApiResponse::success(['count' => $request->user()->unreadNotifications()->count()]);
    }

    public function markRead(Request $request, string $notificationId): JsonResponse
    {
        $notification = $request->user()->notifications()->whereKey($notificationId)->first() ?? throw new NotFoundHttpException;
        $notification->markAsRead();

        return ApiResponse::noContent();
    }

    public function markAllRead(Request $request): JsonResponse
    {
        $request->user()->unreadNotifications()->update(['read_at' => now()]);

        return ApiResponse::noContent();
    }
}
