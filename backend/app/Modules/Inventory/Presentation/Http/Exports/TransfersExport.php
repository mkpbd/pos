<?php

namespace App\Modules\Inventory\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /inventory/transfers?export=xlsx|pdf
 */
class TransfersExport extends InventoryListExport
{
    public function name(): string
    {
        return 'stock-transfers';
    }

    public function title(): string
    {
        return 'Stock transfers';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Transfer'),
            ExportColumn::dateTime('dispatched_at', 'Dispatched'),
            ExportColumn::text('from_store.name', 'From'),
            ExportColumn::text('to_store.name', 'To'),
            ExportColumn::number('lines_count', 'Lines'),
            ExportColumn::status('status', 'Status'),
            ExportColumn::dateTime('completed_at', 'Completed'),
            ExportColumn::text('note', 'Note'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->value('status', 'Status')->value('direction', 'Direction')->all();
    }
}
