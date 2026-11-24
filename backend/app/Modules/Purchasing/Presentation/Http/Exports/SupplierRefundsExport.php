<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /purchasing/supplier-refunds?export=xlsx|csv|pdf (ST1)
 */
class SupplierRefundsExport extends PurchasingListExport
{
    public function name(): string
    {
        return 'supplier-refunds';
    }

    public function title(): string
    {
        return 'Supplier refunds';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Number'),
            ExportColumn::date('received_on', 'Received on'),
            ExportColumn::text('supplier.name', 'Supplier'),
            ExportColumn::text('branch.name', 'Branch'),
            ExportColumn::status('method', 'Method'),
            ExportColumn::text('reference', 'Reference'),
            ExportColumn::money('amount', 'Amount'),
            ExportColumn::text('notes', 'Notes'),
            ExportColumn::dateTime('voided_at', 'Voided'),
            ExportColumn::text('void_reason', 'Void reason'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->dates(label: 'Received on')->all();
    }
}
