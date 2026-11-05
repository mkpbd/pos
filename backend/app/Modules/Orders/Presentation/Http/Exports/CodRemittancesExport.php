<?php

namespace App\Modules\Orders\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use App\Modules\Shipping\Application\Contracts\CourierDirectory;
use Illuminate\Http\Request;

/**
 * GET /cod-remittances?export=xlsx|pdf — cash-on-delivery money received from couriers.
 */
class CodRemittancesExport extends ListExport
{
    public function __construct(private readonly CourierDirectory $couriers) {}

    public function name(): string
    {
        return 'cod-remittances';
    }

    public function title(): string
    {
        return 'COD remittances';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Remittance'),
            ExportColumn::date('received_at', 'Received'),
            ExportColumn::text('courier.name', 'Courier'),
            ExportColumn::text('reference', 'Reference'),
            ExportColumn::text('method_label', 'Method'),
            ExportColumn::number('order_count', 'Orders'),
            ExportColumn::money('gross_amount', 'Collected'),
            ExportColumn::money('fee_amount', 'Courier fee'),
            ExportColumn::money('net_amount', 'Net received'),
            ExportColumn::text('created_by.name', 'Recorded by'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)
            ->search()
            ->lookup('courier_id', 'Courier', fn (string $id) => $this->couriers->summaries([$id])[$id]['name'] ?? null)
            ->dates('date_from', 'date_to', 'Received')
            ->all();
    }
}
