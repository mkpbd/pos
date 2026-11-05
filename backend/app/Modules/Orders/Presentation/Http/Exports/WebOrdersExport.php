<?php

namespace App\Modules\Orders\Presentation\Http\Exports;

use App\Modules\Geography\Application\Contracts\GeoDirectory;
use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use App\Modules\Shipping\Application\Contracts\CourierDirectory;
use Illuminate\Http\Request;

/**
 * GET /web-orders?export=xlsx|pdf — the orders board with its filters.
 */
class WebOrdersExport extends ListExport
{
    public function __construct(
        private readonly CourierDirectory $couriers,
        private readonly GeoDirectory $geo,
    ) {}

    public function name(): string
    {
        return 'web-orders';
    }

    public function title(): string
    {
        return 'Web orders';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Order'),
            ExportColumn::dateTime('placed_at', 'Placed'),
            ExportColumn::text('contact_name', 'Customer'),
            ExportColumn::text('contact_phone', 'Phone'),
            ExportColumn::text('district', 'District'),
            ExportColumn::quantity('item_count', 'Items'),
            ExportColumn::money('total', 'Total'),
            ExportColumn::text('payment_method', 'Payment', fn (array $r) => OrderPaymentMethod::tryFrom((string) $r['payment_method'])?->label() ?? $r['payment_method']),
            ExportColumn::text('payment_status', 'Payment status', fn (array $r) => PaymentStatus::tryFrom((string) $r['payment_status'])?->label() ?? $r['payment_status']),
            ExportColumn::text('status_label', 'Status'),
            ExportColumn::text('courier_name', 'Courier'),
            ExportColumn::text('tracking_number', 'Tracking no.'),
            ExportColumn::dateTime('delivered_at', 'Delivered'),
        ];
    }

    public function filters(Request $request): array
    {
        // The board accepts `date_from`/`date_to` and the older `from`/`to`.
        $dated = $request->query->has('date_from') || $request->query->has('date_to');

        return FilterSummary::of($request)
            ->search()
            ->value('status', 'Status')
            ->value('payment_status', 'Payment status', fn (string $v) => PaymentStatus::tryFrom($v)?->label())
            ->value('payment_method', 'Payment', fn (string $v) => OrderPaymentMethod::tryFrom($v)?->label())
            ->lookup('courier_id', 'Courier', fn (string $id) => $this->couriers->summaries([$id])[$id]['name'] ?? null)
            ->lookup('district_id', 'District', fn (string $id) => $this->geo->names([], [(int) $id])['districts'][(int) $id] ?? null)
            ->flag('cod_unremitted', 'COD not yet remitted')
            ->dates($dated ? 'date_from' : 'from', $dated ? 'date_to' : 'to', 'Placed')
            ->all();
    }
}
