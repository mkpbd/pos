<?php

namespace App\Modules\Cms\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use Illuminate\Http\Request;

/**
 * GET /cms/newsletter-subscribers?export=xlsx|pdf (the mailing-tool CSV of confirmed
 * addresses stays at /cms/newsletter-subscribers/export).
 */
class NewsletterSubscribersExport extends ListExport
{
    public function name(): string
    {
        return 'newsletter-subscribers';
    }

    public function title(): string
    {
        return 'Newsletter subscribers';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('email', 'E-mail'),
            ExportColumn::status('status', 'Status'),
            ExportColumn::dateTime('created_at', 'Signed up'),
            ExportColumn::dateTime('confirmed_at', 'Confirmed'),
            ExportColumn::dateTime('unsubscribed_at', 'Unsubscribed'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)->search()->value('status', 'Status')->all();
    }
}
