<?php

namespace App\Modules\Sales\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /customer-payments?export=xlsx|pdf — payments received from customers.
 */
class CustomerPaymentsExport extends SalesListExport
{
    public function name(): string
    {
        return 'customer-payments';
    }

    public function title(): string
    {
        return 'Customer payments';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Number'),
            ExportColumn::dateTime('created_at', 'Date'),
            ExportColumn::text('customer.name', 'Customer'),
            ExportColumn::text('customer.code', 'Customer code'),
            ExportColumn::text('method_label', 'Method'),
            ExportColumn::text('reference', 'Reference'),
            ExportColumn::money('amount', 'Amount'),
            ExportColumn::text('created_by.name', 'Received by'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->all();
    }
}
