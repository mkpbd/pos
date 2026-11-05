<?php

namespace App\Modules\Cms\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Actions\ContactMessages;
use App\Modules\Cms\Infrastructure\Models\ContactMessage;
use App\Modules\Cms\Presentation\Http\Exports\ContactMessagesExport;
use App\Modules\Cms\Presentation\Http\Support\CmsPresenter;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\Response;

class ContactMessageController
{
    /**
     * List contact messages
     *
     * Newest first. `?status=open|handled` (default: all); `?search=` matches name, e-mail and subject.
     * `meta.open` counts unhandled messages.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate(['status' => ['sometimes', 'in:open,handled']]);
        $status = $request->query('status');

        $query = ListQuery::apply(
            ContactMessage::query()
                ->when($status === 'open', fn (Builder $q) => $q->whereNull('handled_at'))
                ->when($status === 'handled', fn (Builder $q) => $q->whereNotNull('handled_at')),
            $request,
            ['created_at'],
            ['name', 'email', 'subject'],
        );
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, ContactMessagesExport::class, RowSource::fromQuery($query, fn (Collection $messages) => $messages->map(fn (ContactMessage $m) => CmsPresenter::contactMessage($m))));
        }

        return ApiResponse::paginated(
            $query->paginate(ListQuery::perPage($request)),
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
