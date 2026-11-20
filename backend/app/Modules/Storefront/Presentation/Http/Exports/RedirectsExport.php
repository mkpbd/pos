<?php

namespace App\Modules\Storefront\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use Illuminate\Http\Request;

/**
 * B16: GET /storefront/redirects?export=csv|xlsx|pdf — the redirects with the list's filters.
 */
class RedirectsExport extends ListExport
{
    public function name(): string
    {
        return 'store-redirects';
    }

    public function title(): string
    {
        return 'Store redirects';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('from_path', 'Old address'),
            ExportColumn::text('to_path', 'Goes to'),
            ExportColumn::number('type', 'Type'),
            ExportColumn::text('source', 'Added', fn (array $r) => $r['source'] === 'auto' ? 'Automatically' : 'By hand'),
            ExportColumn::number('hits', 'Visits'),
            ExportColumn::dateTime('last_hit_at', 'Last used'),
            ExportColumn::dateTime('created_at', 'Created'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)->search()->value('source', 'Added')->all();
    }
}
