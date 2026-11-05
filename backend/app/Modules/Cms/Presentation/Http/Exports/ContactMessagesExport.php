<?php

namespace App\Modules\Cms\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use Illuminate\Http\Request;

/**
 * GET /cms/contact-messages?export=xlsx|pdf
 */
class ContactMessagesExport extends ListExport
{
    public function name(): string
    {
        return 'contact-messages';
    }

    public function title(): string
    {
        return 'Contact messages';
    }

    public function columns(): array
    {
        return [
            ExportColumn::dateTime('created_at', 'Received'),
            ExportColumn::text('name', 'Name'),
            ExportColumn::text('email', 'E-mail'),
            ExportColumn::text('phone', 'Phone'),
            ExportColumn::text('subject', 'Subject'),
            ExportColumn::text('message', 'Message'),
            ExportColumn::text('is_handled', 'Status', fn (array $r) => ($r['is_handled'] ?? false) ? 'Handled' : 'Open'),
            ExportColumn::dateTime('handled_at', 'Handled'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)->search()->value('status', 'Status')->all();
    }
}
