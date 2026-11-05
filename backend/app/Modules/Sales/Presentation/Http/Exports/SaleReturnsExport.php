<?php

namespace App\Modules\Sales\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /returns?export=xlsx|pdf — sales returns.
 */
class SaleReturnsExport extends SalesListExport
{
    public function name(): string
    {
        return 'sale-returns';
    }

    public function title(): string
    {
        return 'Sales returns';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Return'),
            ExportColumn::dateTime('requested_at', 'Requested'),
            ExportColumn::text('sale.number', 'Invoice'),
            ExportColumn::text('branch.name', 'Branch'),
            ExportColumn::text('customer.name', 'Customer', fn (array $r) => $r['customer']['name'] ?? 'Walk-in'),
            ExportColumn::text('reason.name', 'Reason'),
            ExportColumn::money('total', 'Total'),
            ExportColumn::money('credited_total', 'Credited'),
            ExportColumn::money('refunded_total', 'Refunded'),
            ExportColumn::status('status', 'Status'),
            ExportColumn::text('requested_by.name', 'Requested by'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->value('status', 'Status')->dates()->all();
    }
}
