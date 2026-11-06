<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /purchasing/approvals?export=xlsx|pdf (SC2) — the documents waiting for my approval.
 */
class ApprovalsExport extends PurchasingListExport
{
    public function name(): string
    {
        return 'pending-approvals';
    }

    public function title(): string
    {
        return 'Waiting for my approval';
    }

    public function columns(): array
    {
        return [
            ExportColumn::status('kind', 'Document'),
            ExportColumn::text('number', 'Number'),
            ExportColumn::dateTime('submitted_at', 'Submitted'),
            ExportColumn::text('requested_by.name', 'Requested by'),
            ExportColumn::text('store.name', 'Store'),
            ExportColumn::text('supplier.name', 'Supplier'),
            ExportColumn::money('amount', 'Amount'),
            ExportColumn::status('approval_level', 'Approval level'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)
            ->value('kind', 'Document')
            ->value('approval_level', 'Approval level')
            ->all();
    }
}
