<?php

namespace App\Modules\Inventory\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /inventory/adjustments?export=xlsx|pdf
 */
class AdjustmentsExport extends InventoryListExport
{
    public function name(): string
    {
        return 'stock-adjustments';
    }

    public function title(): string
    {
        return 'Stock adjustments';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Adjustment'),
            ExportColumn::dateTime('created_at', 'Date'),
            ExportColumn::status('reason', 'Reason'),
            ExportColumn::text('store.name', 'Store'),
            ExportColumn::number('lines_count', 'Lines'),
            ExportColumn::text('note', 'Note'),
            ExportColumn::text('created_by', 'By', fn (array $r) => $this->userName($r['created_by'] ?? null)),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->value('reason', 'Reason')->all();
    }
}
