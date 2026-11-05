<?php

namespace App\Modules\Inventory\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /inventory/batches?export=xlsx|pdf — batches with stock, soonest expiry first.
 */
class BatchesExport extends InventoryListExport
{
    public function name(): string
    {
        return 'batches';
    }

    public function title(): string
    {
        return 'Stock by batch';
    }

    public function columns(): array
    {
        return [
            ...self::productColumns(),
            ExportColumn::text('batch.batch_number', 'Batch'),
            ExportColumn::date('batch.expires_on', 'Expires'),
            ExportColumn::text('store.name', 'Store'),
            ExportColumn::quantity('quantity', 'Quantity'),
            ExportColumn::text('is_expired', 'Expired', fn (array $r) => ($r['is_expired'] ?? false) ? 'Yes' : null),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)
            ->value('expiring_within_days', 'Expiring within', fn (string $days) => $days.' days')
            ->all();
    }
}
