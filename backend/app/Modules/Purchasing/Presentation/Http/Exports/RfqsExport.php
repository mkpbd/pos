<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /purchasing/rfqs?export=xlsx|pdf (SC2)
 */
class RfqsExport extends PurchasingListExport
{
    public function name(): string
    {
        return 'rfqs';
    }

    public function title(): string
    {
        return 'Requests for quotation';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'RFQ'),
            ExportColumn::text('title', 'Title'),
            ExportColumn::text('store.name', 'Store'),
            ExportColumn::text('requisition.number', 'Requisition'),
            ExportColumn::date('reply_by', 'Reply by'),
            ExportColumn::number('supplier_count', 'Suppliers'),
            ExportColumn::number('quote_count', 'Quotes'),
            ExportColumn::dateTime('sent_at', 'Sent'),
            ExportColumn::status('status', 'Status'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->value('status', 'Status')->all();
    }
}
