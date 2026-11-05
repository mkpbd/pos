<?php

namespace App\Modules\Orders\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use Illuminate\Http\Request;

/**
 * GET /web-order-returns?export=xlsx|pdf — online order returns.
 */
class WebOrderReturnsExport extends ListExport
{
    public function name(): string
    {
        return 'web-returns';
    }

    public function title(): string
    {
        return 'Web order returns';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Return'),
            ExportColumn::dateTime('created_at', 'Requested'),
            ExportColumn::text('order.number', 'Order'),
            ExportColumn::text('customer_name', 'Customer'),
            ExportColumn::text('reason_label', 'Reason'),
            ExportColumn::money('refund_amount', 'Refund'),
            ExportColumn::text('status_label', 'Status'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)->search()->value('status', 'Status')->all();
    }
}
