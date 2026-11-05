<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /purchasing/payments?export=xlsx|pdf
 */
class SupplierPaymentsExport extends PurchasingListExport
{
    public function name(): string
    {
        return 'supplier-payments';
    }

    public function title(): string
    {
        return 'Supplier payments';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Number'),
            ExportColumn::date('paid_on', 'Paid on'),
            ExportColumn::text('supplier.name', 'Supplier'),
            ExportColumn::status('method', 'Method'),
            ExportColumn::text('reference', 'Reference'),
            ExportColumn::money('amount', 'Amount'),
            ExportColumn::text('notes', 'Notes'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->dates(label: 'Paid on')->all();
    }
}
