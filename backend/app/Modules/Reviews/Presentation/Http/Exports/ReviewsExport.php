<?php

namespace App\Modules\Reviews\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use Illuminate\Http\Request;

/**
 * GET /reviews?export=xlsx|pdf — the moderation queue (pending first).
 */
class ReviewsExport extends ListExport
{
    public function name(): string
    {
        return 'reviews';
    }

    public function title(): string
    {
        return 'Product reviews';
    }

    public function columns(): array
    {
        return [
            ExportColumn::dateTime('created_at', 'Date'),
            ExportColumn::text('product.name', 'Product'),
            ExportColumn::text('customer.name', 'Customer'),
            ExportColumn::text('customer.email', 'E-mail'),
            ExportColumn::number('rating', 'Rating'),
            ExportColumn::text('title', 'Title'),
            ExportColumn::text('body', 'Review'),
            ExportColumn::status('status', 'Status'),
            ExportColumn::text('moderated_by_name', 'Moderated by'),
            ExportColumn::text('rejection_reason', 'Rejection reason'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)
            ->search()
            ->value('status', 'Status')
            ->value('rating', 'Rating', fn (string $v) => $v.' ★')
            ->all();
    }
}
