<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /purchasing/requisitions?export=xlsx|pdf (SC2)
 */
class RequisitionsExport extends PurchasingListExport
{
    public function name(): string
    {
        return 'purchase-requisitions';
    }

    public function title(): string
    {
        return 'Purchase requisitions';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Requisition'),
            ExportColumn::dateTime('created_at', 'Created'),
            ExportColumn::text('store.name', 'Store'),
            ExportColumn::text('requested_by.name', 'Requested by'),
            ExportColumn::date('needed_by', 'Needed by'),
            ExportColumn::number('line_count', 'Lines'),
            ExportColumn::money('estimated_total', 'Estimated total'),
            ExportColumn::status('approval_level', 'Approval level'),
            ExportColumn::text('approved_by.name', 'Approved by'),
            ExportColumn::status('status', 'Status'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)
            ->value('status', 'Status')
            ->value('approval_level', 'Approval level')
            ->flag('mine', 'My requisitions only')
            ->all();
    }
}
