<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use Illuminate\Http\Request;

/**
 * GET /purchasing/supplier-performance?export=xlsx|pdf (SC3). Rates are percentages.
 */
class SupplierPerformanceExport extends PurchasingListExport
{
    public function name(): string
    {
        return 'supplier-performance';
    }

    public function title(): string
    {
        return 'Supplier performance';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('supplier.name', 'Supplier'),
            ExportColumn::number('score', 'Score'),
            ExportColumn::number('orders', 'Orders'),
            ExportColumn::money('spend', 'Spend'),
            ExportColumn::number('on_time_rate', 'On time %'),
            ExportColumn::number('fill_rate', 'Fill %'),
            ExportColumn::number('avg_lead_days', 'Lead days'),
            ExportColumn::number('return_rate', 'Returns %'),
            ExportColumn::number('price_change_pct', 'Price change %'),
            ExportColumn::number('quote_response_rate', 'Quote response %'),
            ExportColumn::number('quotes_won', 'Quotes won'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)
            ->lookup('supplier_id', 'Supplier', fn (string $id) => $this->suppliers->find($id, $this->tenant->requireOrganization())['name'] ?? null)
            ->dates('date_from', 'date_to')
            ->all();
    }
}
