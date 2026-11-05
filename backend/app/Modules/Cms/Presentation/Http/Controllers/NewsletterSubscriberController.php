<?php

namespace App\Modules\Cms\Presentation\Http\Controllers;

use App\Modules\Cms\Domain\SubscriberStatus;
use App\Modules\Cms\Infrastructure\Models\NewsletterSubscriber;
use App\Modules\Cms\Presentation\Http\Exports\NewsletterSubscribersExport;
use App\Modules\Cms\Presentation\Http\Support\CmsPresenter;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

class NewsletterSubscriberController
{
    /**
     * List newsletter subscribers
     *
     * Newest first. `?status=pending|subscribed|unsubscribed`; `?search=` matches the e-mail.
     * `meta.counts` gives the number per status.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate(['status' => ['sometimes', Rule::enum(SubscriberStatus::class)]]);

        $query = ListQuery::apply(
            NewsletterSubscriber::query()->when($request->query('status'), fn (Builder $q, string $status) => $q->where('status', $status)),
            $request,
            ['created_at', 'email'],
            ['email'],
        );
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, NewsletterSubscribersExport::class, RowSource::fromQuery($query, fn (Collection $subscribers) => $subscribers->map(fn (NewsletterSubscriber $s) => CmsPresenter::subscriber($s))));
        }

        return ApiResponse::paginated(
            $query->paginate(ListQuery::perPage($request)),
            fn (NewsletterSubscriber $s) => new JsonResource(CmsPresenter::subscriber($s)),
            ['counts' => $this->counts()],
        );
    }

    /**
     * Export confirmed subscribers (CSV)
     *
     * Only confirmed, still subscribed addresses: the list to import into a mailing tool.
     */
    public function export(AuditTrail $audit): StreamedResponse
    {
        $audit->record('newsletter.exported', null, [], ['count' => NewsletterSubscriber::query()->where('status', SubscriberStatus::Subscribed)->count()]);

        return response()->streamDownload(function () {
            $out = fopen('php://output', 'wb');
            fputcsv($out, ['email', 'confirmed_at'], escape: '');
            NewsletterSubscriber::query()->where('status', SubscriberStatus::Subscribed)->orderBy('email')
                ->each(fn (NewsletterSubscriber $s) => fputcsv($out, [$s->email, $s->confirmed_at?->toIso8601String()], escape: ''));
            fclose($out);
        }, 'newsletter-subscribers-'.now()->format('Y-m-d').'.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /**
     * @return array<string, int>
     */
    private function counts(): array
    {
        $counts = NewsletterSubscriber::query()->toBase()->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');

        return collect(SubscriberStatus::cases())->mapWithKeys(fn (SubscriberStatus $s) => [$s->value => (int) ($counts[$s->value] ?? 0)])->all();
    }
}
