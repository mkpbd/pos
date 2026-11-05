<?php

namespace App\Modules\Sales\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Http\Request;

/**
 * GET /sales?export=xlsx|pdf — the sales history with its filters.
 */
class SalesExport extends SalesListExport
{
    public function name(): string
    {
        return 'sales';
    }

    public function title(): string
    {
        return 'Sales';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Invoice'),
            ExportColumn::dateTime('sold_at', 'Date'),
            ExportColumn::text('branch.name', 'Branch'),
            ExportColumn::text('store.name', 'Store'),
            ExportColumn::text('customer.name', 'Customer', fn (array $r) => $r['customer']['name'] ?? 'Walk-in'),
            ExportColumn::text('cashier.name', 'Cashier'),
            ExportColumn::money('subtotal', 'Subtotal'),
            ExportColumn::money('discount', 'Discount', fn (array $r) => Decimal::add((string) $r['item_discount_total'], (string) $r['invoice_discount_total'], 2)),
            ExportColumn::money('tax_total', 'Tax'),
            ExportColumn::money('total', 'Total'),
            ExportColumn::money('paid_total', 'Paid'),
            ExportColumn::money('due_total', 'Due'),
            ExportColumn::status('status', 'Status'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)
            ->lookup('cashier_id', 'Cashier', fn (string $id) => $this->userName($id))
            ->value('status', 'Status')
            ->dates()
            ->all();
    }
}
