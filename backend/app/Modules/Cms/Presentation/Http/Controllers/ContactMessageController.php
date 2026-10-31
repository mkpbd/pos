<?php

namespace App\Modules\Cms\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Actions\ContactMessages;
use App\Modules\Cms\Infrastructure\Models\ContactMessage;
use App\Modules\Cms\Presentation\Http\Support\CmsPresenter;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ContactMessageController
{
    /**
     * List contact messages
     *
     * Newest first. `?status=open|handled` (default: all); `?search=` matches name, e-mail and subject.
     * `meta.open` counts unhandled messages.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['status' => ['sometimes', 'in:open,handled']]);
        $status = $request->query('status');

        return ApiResponse::paginated(
            ListQuery::paginate(
                ContactMessage::query()
                    ->when($status === 'open', fn (Builder $q) => $q->whereNull('handled_at'))
                    ->when($status === 'handled', fn (Builder $q) => $q->whereNotNull('handled_at')),
                $request,
                ['created_at'],
                ['name', 'email', 'subject'],
            ),
            fn (ContactMessage $m) => new JsonResource(CmsPresenter::contactMessage($m)),
            ['open' => ContactMessage::query()->whereNull('handled_at')->count()],
        );
    }

    /**
     * Mark handled or open again
     */
    public function update(Request $request, ContactMessage $contactMessage, ContactMessages $messages): JsonResponse
    {
        $data = $request->validate(['is_handled' => ['required', 'boolean']]);

        return ApiResponse::success(CmsPresenter::contactMessage($messages->markHandled($contactMessage, $data['is_handled'])));
    }
}
