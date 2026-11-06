<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use Illuminate\Http\Request;

/**
 * GET /purchasing/landed-cost-vouchers?export=xlsx|pdf (SC3)
 */
class LandedCostVouchersExport extends PurchasingListExport
{
    public function name(): string
    {
        return 'landed-cost-vouchers';
    }

    public function title(): string
    {
        return 'Landed cost vouchers';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Voucher'),
            ExportColumn::date('voucher_date', 'Date'),
            ExportColumn::text('branch.name', 'Branch'),
            ExportColumn::text('charge_supplier.name', 'Billed by'),
            ExportColumn::text('reference', 'Reference'),
            ExportColumn::text('receipt_numbers', 'Receipts', fn (array $row) => implode(', ', $row['receipt_numbers'] ?? [])),
            ExportColumn::money('charges_total', 'Charges'),
            ExportColumn::money('tax_total', 'Tax'),
            ExportColumn::money('total', 'Total'),
            ExportColumn::money('on_hand_total', 'To stock'),
            ExportColumn::money('consumed_total', 'Expensed'),
            ExportColumn::status('status', 'Status'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)
            ->search()
            ->value('status', 'Status')
            ->lookup('charge_supplier_id', 'Billed by', fn (string $id) => $this->suppliers->find($id, $this->tenant->requireOrganization())['name'] ?? null)
            ->dates()
            ->all();
    }
}
